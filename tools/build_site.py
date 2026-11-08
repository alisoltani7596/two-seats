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
                "assets/favicon.svg", "assets/apple-touch-icon.png", "assets/icon-512.png", "manifest.webmanifest"]
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
