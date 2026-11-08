#!/usr/bin/env python3
"""Fetch a one-line summary for every candidate that has an English Wikipedia
article, using Wikipedia's REST summary endpoint.

    python3 tools/fetch_wikipedia.py

Writes cache/wikipedia.json keyed by Wikidata item id. Resumable and polite
(8 threads, roughly 10 requests a second).

Wikipedia text is CC BY-SA 4.0, not CC0 like Wikidata, so these summaries are
the one part of the dataset that carries a share-alike obligation. The app
credits Wikipedia in the footer and links every summary back to the article it
came from, and data/README.md states the licence. Keep that in place if you
redistribute the result.
"""
import json
import pathlib
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = pathlib.Path(__file__).resolve().parent.parent
CACHE = ROOT / "cache"
OUT = CACHE / "wikipedia.json"
UA = "TwoSeats/1.0 (+https://github.com/alisoltani7596/two-seats) dataset build"

lock = threading.Lock()
last = [0.0]


def throttle():
    with lock:
        wait = last[0] + 0.1 - time.time()
        if wait > 0:
            time.sleep(wait)
        last[0] = time.time()


def hook_from(extract):
    """One or two sentences, with the lead parenthetical dropped."""
    text = re.sub(r"\s+", " ", extract or "").strip()
    text = re.sub(r"\s*\([^)]*\)", "", text, count=1)
    sentences = re.split(r"(?<=[.!?])\s+(?=[A-Z\"'])", text)
    out = sentences[0] if sentences else text
    if len(out) < 90 and len(sentences) > 1:
        out += " " + sentences[1]
    if len(out) > 230:
        out = out[:227].rsplit(" ", 1)[0] + "…"
    return out


def fetch(item):
    qid, article = item
    throttle()
    url = "https://en.wikipedia.org/api/rest_v1/page/summary/" + urllib.parse.quote(article.replace(" ", "_"), safe="")
    for i in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=30) as r:
                d = json.load(r)
            return qid, {"hook": hook_from(d.get("extract", "")), "article": article}
        except urllib.error.HTTPError as e:
            if e.code in (404, 400):
                return qid, {"hook": None, "article": article}
            time.sleep(2 * (i + 1))
        except Exception:  # noqa: BLE001
            time.sleep(2 * (i + 1))
    return qid, None


def articles():
    """Article titles from the cached core detail queries."""
    out = {}
    for path in sorted(CACHE.glob("wd/core-*.json")):
        for row in json.loads(path.read_text()):
            qid = row["x"].rsplit("/", 1)[-1]
            if row.get("enwiki"):
                out[qid] = row["enwiki"]
    return out


def main():
    arts = articles()
    done = json.loads(OUT.read_text()) if OUT.exists() else {}
    todo = [(q, a) for q, a in arts.items() if q not in done]
    print(f"{len(arts):,} articles known, {len(done):,} cached, {len(todo):,} to fetch")
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=8) as ex:
        for n, (qid, res) in enumerate(ex.map(fetch, todo), 1):
            if res is not None:
                done[qid] = res
            if n % 250 == 0 or n == len(todo):
                OUT.write_text(json.dumps(done, ensure_ascii=False))
                print(f"  {n:,}/{len(todo):,}  {n / (time.time() - t0):.1f}/s", flush=True)
    OUT.write_text(json.dumps(done, ensure_ascii=False))
    print(f"done: {sum(1 for r in done.values() if r.get('hook')):,} summaries")


if __name__ == "__main__":
    main()
