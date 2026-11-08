#!/usr/bin/env python3
"""Build the Two Seats candidate set from Wikidata alone (CC0).

Every field here comes from Wikidata, whose structured data is released under
CC0, so the result can be republished freely. Nothing is taken from IMDb's
downloadable datasets: those are licensed for "personal and non-commercial
use", which does not cover publishing a derived dataset on a public site.
IMDb ids appear only as identifiers for outbound links, and they come from
Wikidata's own P345 property.

Two phases, both resumable (every response is cached under cache/wd/):

  1. select  - one lean query per (kind, year) listing candidate items and how
               many Wikipedias cover them. The class traversal is expensive, so
               it is paid once here rather than once per field.
  2. details - one query per field over explicit batches of item ids, which
               skips the traversal entirely and runs in seconds.
"""
import csv, io, json, pathlib, sys, time, urllib.error, urllib.parse, urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
CACHE = ROOT / "cache" / "wd"
UA = "TwoSeats/1.0 (+https://github.com/alisoltani7596/two-seats) dataset build"
EP = "https://query.wikidata.org/sparql"

YEARS = range(2000, 2027)
KINDS = {"movie": ("wd:Q11424", 15), "series": ("wd:Q5398426", 8)}
BATCH = 400

DETAILS = {
    "core": ("?x ?label ?imdb ?dur ?seasons ?endy ?enwiki",
             """?x rdfs:label ?label FILTER(LANG(?label) = "en")
                OPTIONAL { ?x wdt:P345 ?imdb }
                OPTIONAL { ?x wdt:P2047 ?dur }
                OPTIONAL { ?x wdt:P2437 ?seasons }
                OPTIONAL { ?x wdt:P582 ?end BIND(YEAR(?end) AS ?endy) }
                OPTIONAL { ?a schema:about ?x ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?enwiki }""", ""),
    "genres": ('?x (GROUP_CONCAT(DISTINCT ?v; separator="|") AS ?vals)',
               '?x wdt:P136 ?g . ?g rdfs:label ?v FILTER(LANG(?v) = "en")', "GROUP BY ?x"),
    "crew": ('?x (GROUP_CONCAT(DISTINCT ?v; separator="|") AS ?vals)',
             '{ ?x wdt:P57 ?d } UNION { ?x wdt:P170 ?d } UNION { ?x wdt:P1431 ?d } '
             '?d rdfs:label ?v FILTER(LANG(?v) = "en")', "GROUP BY ?x"),
    "cast": ('?x (GROUP_CONCAT(DISTINCT ?v; separator="|") AS ?vals)',
             '?x wdt:P161 ?c . ?c rdfs:label ?v FILTER(LANG(?v) = "en")', "GROUP BY ?x"),
    # Wikidata's cast property carries no billing order, so each name comes
    # with the actor's own Wikipedia reach and the assembler ranks by it:
    # the people a viewer would recognise come first.
    "castrank": ("?x ?v ?sl",
                 '?x wdt:P161 ?c . ?c wikibase:sitelinks ?sl ; rdfs:label ?v FILTER(LANG(?v) = "en")', ""),
    "langs": ('?x (GROUP_CONCAT(DISTINCT ?v; separator="|") AS ?vals)',
              '?x wdt:P364 ?l . ?l rdfs:label ?v FILTER(LANG(?v) = "en")', "GROUP BY ?x"),
    "countries": ('?x (GROUP_CONCAT(DISTINCT ?v; separator="|") AS ?vals)',
                  '?x wdt:P495 ?c . ?c rdfs:label ?v FILTER(LANG(?v) = "en")', "GROUP BY ?x"),
    "scores": ("?x ?score ?by ?method",
               """?x p:P444 ?st . ?st ps:P444 ?score ; pq:P447 ?byq .
                  VALUES ?byq { wd:Q105584 wd:Q150248 }
                  BIND(IF(?byq = wd:Q105584, "rt", "mc") AS ?by)
                  OPTIONAL { ?st pq:P459 ?m . ?m rdfs:label ?method FILTER(LANG(?method) = "en") }""", ""),
    # Awards won and nominations: the prestige signal for series, which almost
    # never carry a Rotten Tomatoes or Metacritic score in Wikidata.
    # Earliest release or start date. Some films carry several (re-releases,
    # festival runs), so the per-year selection can place a 1995 film in 2014.
    "first": ('?x (MIN(YEAR(?d)) AS ?vals)', "{ ?x wdt:P577 ?d } UNION { ?x wdt:P580 ?d }", "GROUP BY ?x"),
    "awards": ('?x (COUNT(DISTINCT ?a) AS ?vals)', "?x wdt:P166 ?a .", "GROUP BY ?x"),
    "noms": ('?x (COUNT(DISTINCT ?a) AS ?vals)', "?x wdt:P1411 ?a .", "GROUP BY ?x"),
    "places": ("?x ?pname ?coord ?kind",
               """{ ?x wdt:P840 ?pl BIND("set" AS ?kind) } UNION { ?x wdt:P915 ?pl BIND("filmed" AS ?kind) }
                  ?pl wdt:P625 ?coord ; rdfs:label ?pname FILTER(LANG(?pname) = "en")""", ""),
}


def run(sparql, tries=6):
    """POST the query and read CSV back.

    The SPARQL JSON results format spends about 170 bytes per row on type
    wrappers; CSV spends about 45, which keeps every response small enough to
    arrive in one piece. POST also avoids URL length limits, which the batched
    detail queries would otherwise blow past.
    """
    data = urllib.parse.urlencode({"query": sparql}).encode()
    for attempt in range(tries):
        try:
            req = urllib.request.Request(EP, data=data, headers={
                "User-Agent": UA, "Accept": "text/csv",
                "Content-Type": "application/x-www-form-urlencoded",
            })
            with urllib.request.urlopen(req, timeout=300) as r:
                body = r.read().decode("utf-8")
            rows = list(csv.DictReader(io.StringIO(body)))
            # A query that runs past the service's own time limit comes back
            # with a 200 and a half-written final row rather than an error.
            # DictReader fills a short row with None, which nothing else does,
            # so that is the truncation signal: reject it and let the retry
            # (or the caller's band split) deal with it.
            if any(v is None for row in rows for v in row.values()):
                raise ValueError(f"truncated response ({len(rows)} rows)")
            return [{k: v for k, v in row.items() if v} for row in rows]
        except Exception as e:
            if attempt == tries - 1:
                raise
            code = getattr(e, "code", "")
            wait = 10 * (attempt + 1)
            print(f"      retry in {wait}s ({type(e).__name__} {code})", flush=True)
            time.sleep(wait)


def cached(name, sparql):
    path = CACHE / f"{name}.json"
    if path.exists():
        return json.loads(path.read_text())
    t0 = time.time()
    rows = run(sparql)
    path.write_text(json.dumps(rows, ensure_ascii=False))
    print(f"    {name:28} {len(rows):>6} rows  {time.time() - t0:5.1f}s", flush=True)
    time.sleep(0.5)
    return rows


def select_band(kind, cls, year, lo, hi, out, depth=0):
    """Candidates for one year, narrowed by sitelink count when needed.

    A busy year can take longer than the query service allows. Splitting the
    sitelink range in two makes each half cheap, and the halves union back to
    exactly the same set.
    """
    band = f"{lo}-{hi}" if hi else str(lo)
    name = f"select-{kind}-{year}-{band}"
    cond = f"?sl >= {lo}" + (f" && ?sl < {hi}" if hi else "")
    sparql = f"""
    SELECT ?x ?sl WHERE {{
      ?x wdt:P31/wdt:P279* {cls} ; wikibase:sitelinks ?sl .
      OPTIONAL {{ ?x wdt:P580 ?s }} OPTIONAL {{ ?x wdt:P577 ?p }}
      BIND(COALESCE(YEAR(?s), YEAR(?p)) AS ?y)
      FILTER(BOUND(?y) && ?y = {year}) FILTER({cond})
    }}"""
    try:
        rows = cached(name, sparql)
    except Exception as e:
        if depth >= 3:
            raise
        mid = (lo + (hi or lo + 40)) // 2
        if mid <= lo:
            raise
        print(f"    {name} failed ({e}); splitting at {mid}", flush=True)
        select_band(kind, cls, year, lo, mid, out, depth + 1)
        select_band(kind, cls, year, mid, hi, out, depth + 1)
        return
    for r in rows:
        qid = r["x"].rsplit("/", 1)[-1]
        out[qid] = {"qid": qid, "t": kind, "year": year, "sl": int(r["sl"])}


def select():
    """Phase 1: the candidate set, with Wikipedia reach as the quality signal."""
    out = {}
    for kind, (cls, floor) in KINDS.items():
        for year in YEARS:
            select_band(kind, cls, year, floor, None, out)
    return out


def details(qids, parts):
    """Phase 2: one query per field over batches of ids."""
    qids = sorted(qids)
    for part in parts:
        select_, body, group = DETAILS[part]
        for i in range(0, len(qids), BATCH):
            chunk = qids[i:i + BATCH]
            values = " ".join(f"wd:{q}" for q in chunk)
            # Without this hint the planner can start from every review score
            # (or every located place) on Wikidata instead of from these few
            # hundred items, and the query times out. Keep the written order.
            hint = 'hint:Query hint:optimizer "None" .' if part in ("scores", "places") else ""
            sparql = f"SELECT {select_} WHERE {{ {hint} VALUES ?x {{ {values} }} {body} }} {group}"
            cached(f"{part}-{i // BATCH:03d}", sparql)


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    print("phase 1: candidate selection")
    cand = select()
    (ROOT / "cache" / "candidates.json").write_text(json.dumps(cand, ensure_ascii=False))
    movies = sum(1 for c in cand.values() if c["t"] == "movie")
    print(f"  {len(cand):,} candidates ({movies:,} films, {len(cand) - movies:,} series)")
    print("phase 2: details")
    details(cand, sys.argv[1:] or list(DETAILS))
    print("done")


if __name__ == "__main__":
    main()
