#!/usr/bin/env python3
"""Fetch posters, backdrops, trailers and streaming availability from TMDB.

    TMDB_TOKEN=… python3 tools/fetch_tmdb.py

The token comes from the TMDB_TOKEN environment variable (a GitHub Actions
secret in the deploy workflow) or, locally, from ~/.config/two-seats/tmdb_token.
Either an API Read Access Token (v4, starts "eyJ") or a v3 API key works.
Without one the script says so and exits cleanly; the site then builds with
its generated posters and search links.

Why this data never enters the repository:

TMDB's API terms forbid caching its data "for longer than 6 months" and count
"providing archived or cached data sets containing TMDB Content" to others as
commercial use. So the results live only in cache/ (gitignored) and in the
deployed site, and the deploy workflow refetches them weekly. The only thing
committed is data/tmdb-ids.json — the mapping from our titles to TMDB ids,
which comes from Wikidata and is CC0.

Streaming availability is supplied to TMDB by JustWatch, and TMDB requires
that source to be credited; the app does so next to every availability list.

Resumable: each title is cached with the time it was fetched, and anything
older than TMDB_MAX_AGE_DAYS (default 6) is fetched again.
"""
import json
import os
import pathlib
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "cache" / "tmdb"
RAW = OUT / "titles.json"
PROVIDERS = OUT / "providers.json"
API = "https://api.themoviedb.org/3"
MAX_AGE = float(os.environ.get("TMDB_MAX_AGE_DAYS", "6")) * 86400
WORKERS = 8
RATE = 30   # requests per second, comfortably under TMDB's limit

lock = threading.Lock()
last = [0.0]


def token():
    t = os.environ.get("TMDB_TOKEN", "").strip()
    if not t:
        f = pathlib.Path.home() / ".config" / "two-seats" / "tmdb_token"
        if f.exists():
            t = f.read_text().strip()
    return t


def throttle():
    with lock:
        wait = last[0] + 1 / RATE - time.time()
        if wait > 0:
            time.sleep(wait)
        last[0] = time.time()


def request(path, tok, params):
    params = dict(params)
    headers = {"Accept": "application/json", "User-Agent": "TwoSeats/1.0 (+https://github.com/alisoltani7596/two-seats)"}
    if tok.startswith("eyJ"):
        headers["Authorization"] = "Bearer " + tok
    else:
        params["api_key"] = tok
    url = f"{API}{path}?{urllib.parse.urlencode(params)}"
    for attempt in range(5):
        throttle()
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if e.code == 401:
                raise SystemExit("TMDB rejected the token (401). Check TMDB_TOKEN.")
            if e.code == 429:
                time.sleep(2 + attempt * 2)
                continue
            time.sleep(1 + attempt)
        except Exception:  # noqa: BLE001 — network blips: retry
            time.sleep(1 + attempt)
    raise RuntimeError(f"giving up on {path}")


def pick_trailer(videos):
    """The best YouTube trailer: official English trailers first, then teasers."""
    cands = [v for v in (videos or {}).get("results", []) if v.get("site") == "YouTube" and v.get("key")
             and v.get("type") in ("Trailer", "Teaser")]
    if not cands:
        return None
    cands.sort(key=lambda v: (v.get("type") == "Trailer", bool(v.get("official")),
                              v.get("iso_639_1") == "en", v.get("size") or 0, v.get("published_at") or ""), reverse=True)
    return cands[0]["key"]


def compact(d, providers):
    """Keep only what the app shows."""
    out = {"p": d.get("poster_path"), "b": d.get("backdrop_path"), "v": pick_trailer(d.get("videos"))}
    watch = {}
    for cc, w in ((d.get("watch/providers") or {}).get("results") or {}).items():
        s = [p["provider_id"] for p in w.get("flatrate") or []]
        f = [p["provider_id"] for p in (w.get("free") or []) + (w.get("ads") or [])]
        rent = bool(w.get("rent") or w.get("buy"))
        for p in (w.get("flatrate") or []) + (w.get("free") or []) + (w.get("ads") or []):
            providers.setdefault(str(p["provider_id"]), [p.get("provider_name"), p.get("logo_path"), p.get("display_priority", 99)])
        if s or f or rent:
            watch[cc] = {k: v for k, v in (("s", s), ("f", f), ("r", 1 if rent else 0)) if v}
    out["w"] = watch
    return out


def main():
    tok = token()
    if not tok:
        print("No TMDB token (TMDB_TOKEN or ~/.config/two-seats/tmdb_token): skipping. "
              "The site will build with generated posters and search links.")
        return
    OUT.mkdir(parents=True, exist_ok=True)
    ids = sorted(set(json.loads((ROOT / "data" / "tmdb-ids.json").read_text()).values()))
    cache = json.loads(RAW.read_text()) if RAW.exists() else {}
    providers = json.loads(PROVIDERS.read_text()) if PROVIDERS.exists() else {}
    now = time.time()
    todo = [k for k in ids if now - cache.get(k, {}).get("at", 0) > MAX_AGE]
    print(f"{len(ids):,} TMDB titles, {len(ids) - len(todo):,} fresh in cache, {len(todo):,} to fetch")

    def one(key):
        kind = "movie" if key[0] == "m" else "tv"
        d = request(f"/{kind}/{key[1:]}", tok, {"language": "en-US", "include_video_language": "en,null",
                                                  "append_to_response": "videos,watch/providers"})
        return key, d

    t0 = time.time()
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        for n, (key, d) in enumerate(ex.map(one, todo), 1):
            with lock:
                cache[key] = {"at": time.time(), "d": compact(d, providers) if d else None}
            if n % 500 == 0 or n == len(todo):
                RAW.write_text(json.dumps(cache, separators=(",", ":")))
                PROVIDERS.write_text(json.dumps(providers, separators=(",", ":")))
                print(f"  {n:,}/{len(todo):,}  {n / (time.time() - t0):.1f}/s", flush=True)
    RAW.write_text(json.dumps(cache, separators=(",", ":")))
    PROVIDERS.write_text(json.dumps(providers, separators=(",", ":")))
    got = [v["d"] for v in cache.values() if v.get("d")]
    print(f"done: posters {sum(1 for d in got if d['p']):,}, trailers {sum(1 for d in got if d['v']):,}, "
          f"with availability somewhere {sum(1 for d in got if d['w']):,}, providers {len(providers):,}")


if __name__ == "__main__":
    main()
