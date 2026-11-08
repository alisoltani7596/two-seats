#!/usr/bin/env python3
"""Build the deployable site into _site/.

    python3 tools/build_site.py

What it does, and why:

- Bundles the scripts index.html lists into one file and minifies it, and
  minifies the stylesheet. One request instead of six, and roughly half the
  bytes. Uses esbuild through npx when it is available; without it the files
  are copied as they are and the site still works.
- Names every asset by a hash of its content (app.3f9c2a1b.js, titles.
  8d01….json). A changed file gets a new name, so browsers and the service
  worker can keep old copies forever without ever serving a stale one.
- Writes a service worker that pre-caches the app shell and the library, so a
  second visit opens instantly and the app works offline once it has loaded.
- Points the page's preload hints at the hashed data, so the library download
  starts in parallel with the script instead of after it.

The source tree stays readable and is what you edit; _site/ is disposable.
"""
import hashlib
import json
import pathlib
import re
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "_site"
ESBUILD = ["npx", "--yes", "esbuild@0.24.0"]


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()[:10]


def minify(source: str, kind: str) -> str:
    """Minify with esbuild if it can be run; otherwise return the input."""
    try:
        r = subprocess.run(ESBUILD + [f"--loader={kind}", "--minify", "--target=es2020" if kind == "js" else "--target=chrome100,safari15,firefox100"],
                           input=source.encode(), capture_output=True, timeout=180)
    except (OSError, subprocess.TimeoutExpired) as e:
        print(f"  esbuild unavailable ({e}); shipping {kind} unminified")
        return source
    if r.returncode != 0:
        sys.exit(f"esbuild failed on {kind}:\n{r.stderr.decode()}")
    return r.stdout.decode()


def emit(rel_dir: str, stem: str, ext: str, data: bytes) -> str:
    name = f"{rel_dir}/{stem}.{digest(data)}.{ext}"
    path = OUT / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return name


def strip_img(path):
    """'/abc123.jpg' → 'abc123'; anything that isn't a .jpg keeps its extension."""
    if not path:
        return None
    path = path.lstrip("/")
    return path[:-4] if path.endswith(".jpg") else path


def emit_tmdb(assets, precache):
    """Posters, backdrops, trailers and per-country availability, if fetched.

    Read from cache/tmdb (built by tools/fetch_tmdb.py, never committed) and
    written only into _site, so TMDB's content reaches the deployed app and
    nowhere else — see the note at the top of fetch_tmdb.py.
    """
    raw_path = ROOT / "cache" / "tmdb" / "titles.json"
    if not raw_path.exists():
        print("  no TMDB cache: generated posters and search links only")
        return
    raw = json.loads(raw_path.read_text())
    providers = json.loads((ROOT / "cache" / "tmdb" / "providers.json").read_text())
    ids = json.loads((ROOT / "data" / "tmdb-ids.json").read_text())
    rows = json.loads((ROOT / "data" / "titles.json").read_text())["rows"]

    media = {"p": {}, "b": {}, "v": {}, "k": {}}
    per_cc = {}
    for i, row in enumerate(rows):
        key = ids.get(str(row[0]))
        d = (raw.get(key) or {}).get("d") if key else None
        if not d:
            continue
        media["k"][i] = key
        if d.get("p"): media["p"][i] = strip_img(d["p"])
        if d.get("b"): media["b"][i] = strip_img(d["b"])
        if d.get("v"): media["v"][i] = d["v"]
        for cc, w in (d.get("w") or {}).items():
            per_cc.setdefault(cc, {"s": {}, "f": {}, "r": []})
            if w.get("s"): per_cc[cc]["s"][i] = w["s"]
            if w.get("f"): per_cc[cc]["f"][i] = w["f"]
            if w.get("r"): per_cc[cc]["r"].append(i)

    assets["media"] = emit("data", "media", "json", json.dumps(media, separators=(",", ":")).encode())
    used = set()
    watch = {}
    for cc, w in sorted(per_cc.items()):
        streaming = len(w["s"]) + len(w["f"])
        if streaming < 300:          # too thin to be useful; the drawer falls back to a TMDB link
            continue
        counts = {}
        for lst in list(w["s"].values()) + list(w["f"].values()):
            for pid in lst:
                counts[pid] = counts.get(pid, 0) + 1
        w["top"] = [pid for pid, _ in sorted(counts.items(), key=lambda kv: -kv[1])][:40]
        used.update(counts)
        watch[cc] = emit("data/watch", cc.lower(), "json", json.dumps(w, separators=(",", ":")).encode())
    prov = {pid: [providers[str(pid)][0], strip_img(providers[str(pid)][1])] for pid in used if str(pid) in providers}
    assets["providers"] = emit("data", "providers", "json", json.dumps(prov, separators=(",", ":")).encode())
    assets["watch"] = watch
    precache += [assets["media"], assets["providers"]]
    print(f"  TMDB: posters {len(media['p']):,}, backdrops {len(media['b']):,}, trailers {len(media['v']):,}, "
          f"availability for {len(watch)} countries, {len(prov)} services")


def main():
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir()
    html = (ROOT / "index.html").read_text()

    # ---- scripts, in the order the page loads them
    scripts = re.findall(r'<script src="(src/[^"]+\.js)"></script>', html)
    bundle = "\n;\n".join((ROOT / s).read_text() for s in scripts)
    raw_js = len(bundle.encode())
    js = minify(bundle, "js")
    js_name = emit("assets", "app", "js", js.encode())

    # ---- stylesheet; font URLs stay relative, and resolve the same from assets/
    css_src = (ROOT / "src" / "styles.css").read_text()
    css = minify(css_src, "css")
    css_name = emit("assets", "app", "css", css.encode())

    # ---- data, under content-hashed names
    titles = emit("data", "titles", "json", (ROOT / "data" / "titles.json").read_bytes())
    extra = emit("data", "extra", "json", (ROOT / "data" / "extra.json").read_bytes())
    world = emit("data", "world", "js", (ROOT / "data" / "world.js").read_bytes())

    # ---- static files that keep their names
    shutil.copytree(ROOT / "assets", OUT / "assets", dirs_exist_ok=True)
    for f in ("manifest.webmanifest", ".nojekyll"):
        shutil.copy2(ROOT / f, OUT / f)

    # ---- the page
    assets = {"titles": titles, "extra": extra, "world": world, "sw": "sw.js"}
    tmdb_precache = []
    emit_tmdb(assets, tmdb_precache)
    html = re.sub(r"<script>window\.TS_ASSETS = .*?</script>",
                  f"<script>window.TS_ASSETS = {json.dumps(assets)};</script>", html)
    html = html.replace('<link rel="preload" href="data/titles.json"', f'<link rel="preload" href="{titles}"')
    html = html.replace('<link rel="stylesheet" href="src/styles.css">', f'<link rel="stylesheet" href="{css_name}">')
    html = re.sub(r'(<script src="src/[^"]+\.js"></script>\n?)+', f'<script src="{js_name}" defer></script>\n', html)
    html = html.replace("<!-- The build step rewrites these paths to content-hashed names. -->\n", "")
    (OUT / "index.html").write_text(html)

    # ---- service worker
    precache = ["./", css_name, js_name, titles, extra,
                "assets/fonts/bricolage.woff2", "assets/fonts/geist.woff2", "assets/fonts/geist-mono.woff2",
                "assets/favicon.svg", "assets/apple-touch-icon.png", "assets/icon-512.png", "manifest.webmanifest"] + tmdb_precache
    version = digest("".join(precache).encode() + html.encode())
    sw = (ROOT / "tools" / "sw.template.js").read_text()
    sw = sw.replace("__VERSION__", version).replace("__PRECACHE__", json.dumps(precache, indent=2))
    (OUT / "sw.js").write_text(sw)

    def kb(name):
        return (OUT / name).stat().st_size / 1024
    print(f"built _site/ (version {version})")
    print(f"  {js_name}   {kb(js_name):6.1f} KB  (from {raw_js / 1024:.1f} KB across {len(scripts)} files)")
    print(f"  {css_name}  {kb(css_name):6.1f} KB  (from {len(css_src.encode()) / 1024:.1f} KB)")
    print(f"  {titles}  {kb(titles):6.1f} KB")
    print(f"  {extra}  {kb(extra):6.1f} KB")


if __name__ == "__main__":
    main()
