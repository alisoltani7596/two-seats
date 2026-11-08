#!/usr/bin/env python3
"""Turn the Wikidata and Wikipedia caches into the two files the app loads.

    python3 tools/assemble.py [movie_sitelink_floor] [series_sitelink_floor]

Writes:
    data/titles.json   everything the recommender and the grid need
    data/extra.json    summaries, locations and article names, fetched second

Both use interned dictionaries and positional rows: a name like "Christopher
Nolan" is stored once and referenced by integer, which is where most of the
saving comes from. The row layout is mirrored in src/data.js — change one and
you must change the other.

The sitelink floors decide how much of the candidate set ships. Higher floors
mean fewer, better-known titles and a smaller download; the defaults aim at a
first load that is comfortable over mobile data.
"""
import datetime
import gzip
import json
import pathlib
import re
import sys
from collections import Counter

ROOT = pathlib.Path(__file__).resolve().parent.parent
CACHE = ROOT / "cache"
WD = CACHE / "wd"

# ---------------------------------------------------------------- vocabularies
GENRES = ["Drama", "Comedy", "Thriller", "Crime", "Mystery", "Science fiction", "Fantasy", "Horror",
          "Action", "Adventure", "Romance", "Animation", "Documentary", "History", "War", "Biography",
          "Musical", "Sport", "Family", "Western"]

# Wikidata genre labels, stripped of their "... film" / "... television series"
# wrapper, mapped onto the canonical set plus any mood tags they imply.
GENRE_MAP = {
    "drama": (["Drama"], []),
    "comedy": (["Comedy"], ["funny"]),
    "comedy-drama": (["Comedy", "Drama"], ["funny"]),
    "romantic comedy": (["Romance", "Comedy"], ["funny", "romantic", "romantic-comedy"]),
    "black comedy": (["Comedy"], ["dark", "satire"]),
    "dark comedy": (["Comedy"], ["dark", "satire"]),
    "satire": (["Comedy"], ["satire"]),
    "parody": (["Comedy"], ["satire"]),
    "mockumentary": (["Comedy"], ["satire", "mockumentary"]),
    "sitcom": (["Comedy"], ["sitcom", "short-episodes", "funny"]),
    "situation comedy": (["Comedy"], ["sitcom", "short-episodes", "funny"]),
    "stand-up comedy": (["Comedy"], ["funny"]),
    "thriller": (["Thriller"], ["tense"]),
    "psychological thriller": (["Thriller"], ["tense", "psychological"]),
    "techno-thriller": (["Thriller"], ["tense", "tech"]),
    "political thriller": (["Thriller"], ["tense", "political"]),
    "spy": (["Thriller"], ["spy"]),
    "spy fiction": (["Thriller"], ["spy"]),
    "crime": (["Crime"], []),
    "crime fiction": (["Crime"], []),
    "crime thriller": (["Crime", "Thriller"], ["tense"]),
    "gangster": (["Crime"], ["gangster"]),
    "heist": (["Crime"], ["heist", "twisty"]),
    "film noir": (["Crime"], ["noir", "dark"]),
    "neo-noir": (["Crime"], ["noir", "dark"]),
    "police procedural": (["Crime"], ["whodunit"]),
    "mystery": (["Mystery"], ["whodunit"]),
    "whodunit": (["Mystery"], ["whodunit"]),
    "detective fiction": (["Mystery"], ["whodunit"]),
    "science fiction": (["Science fiction"], ["sci-fi"]),
    "space opera": (["Science fiction"], ["sci-fi", "space"]),
    "cyberpunk": (["Science fiction"], ["sci-fi", "dystopian"]),
    "dystopian": (["Science fiction"], ["dystopian"]),
    "post-apocalyptic": (["Science fiction"], ["dystopian", "survival"]),
    "fantasy": (["Fantasy"], ["fantasy"]),
    "high fantasy": (["Fantasy"], ["fantasy", "fantasy-epic", "epic"]),
    "supernatural": (["Fantasy"], ["supernatural"]),
    "superhero": (["Action"], ["superhero"]),
    "horror": (["Horror"], ["scary"]),
    "slasher": (["Horror"], ["scary", "slasher"]),
    "psychological horror": (["Horror"], ["scary", "psychological"]),
    "zombie": (["Horror"], ["zombies"]),
    "vampire": (["Horror"], ["vampires"]),
    "monster movie": (["Horror"], ["monster"]),
    "found footage": (["Horror"], ["found-footage"]),
    "horror comedy": (["Horror", "Comedy"], ["funny", "scary"]),
    "action": (["Action"], []),
    "martial arts": (["Action"], ["martial-arts"]),
    "disaster": (["Action"], ["survival"]),
    "adventure": (["Adventure"], []),
    "swashbuckler": (["Adventure"], ["pirates"]),
    "road movie": (["Adventure"], ["road-trip"]),
    "romance": (["Romance"], ["romantic"]),
    "romantic drama": (["Romance", "Drama"], ["romantic"]),
    "animation": (["Animation"], ["animated"]),
    "animated": (["Animation"], ["animated"]),
    "computer animation": (["Animation"], ["animated"]),
    "stop motion": (["Animation"], ["animated", "stop-motion"]),
    "anime": (["Animation"], ["animated", "anime"]),
    "documentary": (["Documentary"], ["true-story"]),
    "docudrama": (["Documentary", "Drama"], ["true-story"]),
    "nature documentary": (["Documentary"], ["true-story", "nature"]),
    "history": (["History"], ["period"]),
    "historical": (["History"], ["period"]),
    "historical drama": (["History", "Drama"], ["period"]),
    "period piece": (["History"], ["period"]),
    "war": (["War"], ["war"]),
    "biography": (["Biography"], ["true-story", "biopic"]),
    "biographical": (["Biography"], ["true-story", "biopic"]),
    "musical": (["Musical"], ["music"]),
    "music": (["Musical"], ["music"]),
    "sports": (["Sport"], ["sports"]),
    "sport": (["Sport"], ["sports"]),
    "family": (["Family"], ["family-friendly", "family"]),
    "children's": (["Family"], ["family-friendly", "kids"]),
    "educational": (["Family"], ["kids"]),
    "teen sitcom": (["Comedy"], ["teen", "sitcom", "kids"]),
    "preschool": (["Family"], ["kids"]),
    "western": (["Western"], ["western"]),
    "coming-of-age story": (["Drama"], ["coming-of-age"]),
    "coming-of-age": (["Drama"], ["coming-of-age"]),
    "teen": (["Drama"], ["teen"]),
    "soap opera": (["Drama"], []),
    "medical drama": (["Drama"], ["medical"]),
    "legal drama": (["Drama"], ["legal"]),
    "legal thriller": (["Thriller"], ["legal", "tense"]),
    "political drama": (["Drama"], ["political"]),
    "workplace comedy": (["Comedy"], ["workplace", "funny"]),
    "prison": (["Drama"], ["prison"]),
    "survival": (["Drama"], ["survival"]),
    "art": (["Drama"], ["art-house"]),
    "experimental": (["Drama"], ["art-house"]),
    "epic": (["Adventure"], ["epic"]),
    "lgbt-related": (["Drama"], ["lgbtq"]),
    "christmas": (["Family"], ["christmas"]),
    "miniseries": ([], ["limited-series"]),
    "anthology": ([], ["anthology"]),
    "reality television": (["Documentary"], ["reality"]),
}
# Wrappers Wikidata hangs on genre labels; stripped before the map lookup.
STRIP = [
    r"^animated\s+", r"^live-action\s+",
    r"\s+film$", r"\s+films$", r"\s+movie$", r"\s+movies$", r"\s+fiction film$",
    r"^television\s+", r"\s+television series$", r"\s+television programme$", r"\s+television program$",
    r"\s+television$", r"\s+series$", r"\s+genre$", r"\s+show$",
]

LANG_CODES = {"English": "en", "Persian": "fa", "Korean": "ko", "Japanese": "ja", "French": "fr", "German": "de", "Spanish": "es", "Italian": "it",
    "Hindi": "hi", "Mandarin Chinese": "zh", "Mandarin": "zh", "Standard Chinese": "zh", "Chinese": "zh", "Cantonese": "yue", "Portuguese": "pt", "Brazilian Portuguese": "pt",
    "Russian": "ru", "Turkish": "tr", "Arabic": "ar", "Danish": "da", "Swedish": "sv", "Norwegian": "no", "Norwegian Bokmål": "no", "Finnish": "fi", "Dutch": "nl",
    "Polish": "pl", "Hebrew": "he", "Modern Hebrew": "he", "Thai": "th", "Indonesian": "id", "Tamil": "ta", "Telugu": "te", "Malayalam": "ml", "Kannada": "kn", "Bengali": "bn",
    "Marathi": "mr", "Punjabi": "pa", "Urdu": "ur", "Greek": "el", "Modern Greek": "el", "Hungarian": "hu", "Czech": "cs", "Romanian": "ro", "Ukrainian": "uk", "Vietnamese": "vi",
    "Filipino": "tl", "Tagalog": "tl", "Icelandic": "is", "Irish": "ga", "Catalan": "ca", "Basque": "eu", "Georgian": "ka", "Kurdish": "ku", "Yiddish": "yi",
    "Hawaiian": "haw", "Latin": "la", "Afrikaans": "af", "Swahili": "sw", "Serbian": "sr", "Croatian": "hr", "Bosnian": "bs", "Bulgarian": "bg",
    "Estonian": "et", "Latvian": "lv", "Lithuanian": "lt", "Slovak": "sk", "Slovene": "sl", "Malay": "ms", "Nepali": "ne", "Sinhala": "si",
    "Mongolian": "mn", "Kazakh": "kk", "Pashto": "ps", "Dari": "fa", "Amharic": "am", "Zulu": "zu", "Xhosa": "xh", "Yoruba": "yo", "Igbo": "ig",
    "Hausa": "ha", "Galician": "gl", "Welsh": "cy", "Scottish Gaelic": "gd", "Inuktitut": "iu", "Khmer": "km", "Burmese": "my",
    "Armenian": "hy", "Azerbaijani": "az", "Uzbek": "uz", "Albanian": "sq", "Macedonian": "mk", "Maori": "mi", "Māori": "mi",
    "American Sign Language": "sgn", "Sign language": "sgn", "no linguistic content": "none", "No linguistic content": "none"}
ENGLISH_COUNTRIES = {"United States", "United Kingdom", "Canada", "Australia", "New Zealand", "Ireland"}
COUNTRY_NAMES = {"United States of America": "United States", "People's Republic of China": "China", "Republic of Ireland": "Ireland",
    "Czech Republic": "Czechia", "Kingdom of the Netherlands": "Netherlands", "Türkiye": "Turkey", "Kingdom of Denmark": "Denmark",
    "Republic of China": "Taiwan", "Russian Federation": "Russia", "Islamic Republic of Iran": "Iran", "Republic of Korea": "South Korea",
    "Democratic People's Republic of Korea": "North Korea", "Bolivarian Republic of Venezuela": "Venezuela", "Federal Republic of Germany": "Germany",
    "Soviet Union": "Russia", "West Germany": "Germany", "Hong Kong": "Hong Kong"}

# Moods inferred from the Wikipedia summary, so similarity can see past the
# broad genre labels. Spliced in from the original pipeline.
HOOK_TAGS = [
    (r"\bheist\b|\bbank robbery\b|\brobbery\b", "heist"), (r"\bspy\b|\bespionage\b|\bmi6\b|\bcia\b", "spy"), (r"\bzombie", "zombies"),
    (r"\bvampire", "vampires"), (r"\bsuperhero|\bmarvel\b|\bdc comics\b|\bbatman\b|\bspider-man\b", "superhero"), (r"\btime travel|\btime loop|\btime-travel", "time-travel"),
    (r"\bspace\b|\bastronaut|\bouter space|\bspacecraft|\bmars\b", "space"), (r"\bpost-apocalyptic|\bapocalyp|\bdystopian|\bdystopia", "dystopian"),
    (r"\bcoming-of-age|\bcoming of age", "coming-of-age"), (r"\broad trip|\broad movie|\broad film", "road-trip"), (r"\brevenge\b|\bavenge", "revenge"),
    (r"\bserial killer", "serial-killer"), (r"\bcourtroom|\blegal drama|\btrial\b|\blawyer", "legal"), (r"\bboxing|\bboxer\b", "sports"), (r"\bfootball|\bsoccer|\bbasketball|\bbaseball|\bcricket|\btennis|\bformula one|\bracing\b", "sports"),
    (r"\bchess\b", "chess"), (r"\bchef\b|\brestaurant|\bcooking|\bfood\b", "food"), (r"\bmusician|\bband\b|\bsinger|\bjazz\b|\bhip hop|\bhip-hop|\brock band|\bconcert", "music"),
    (r"\bnoir\b", "noir"), (r"\bsatir", "satire"), (r"\bmockumentary", "mockumentary"), (r"\banime\b|\bmanga\b", "anime"), (r"\bstop-motion|\bstop motion", "stop-motion"),
    (r"\bfound footage|\bfound-footage", "found-footage"), (r"\bslasher", "slasher"), (r"\bhaunted|\bghost", "ghost-story"), (r"\bpsychological", "psychological"),
    (r"\bromantic comedy|\brom-com|\bromcom", "romantic-comedy"), (r"\bbuddy\b", "buddy"), (r"\bprison\b|\binmate", "prison"), (r"\bmafia\b|\bgangster|\bmob\b|\bcartel\b|\bdrug lord|\bcrime family", "gangster"),
    (r"\bheist\b", "twisty"), (r"\bmystery\b|\bwhodunit|\bdetective", "whodunit"), (r"\bsurvival\b|\bstranded|\bcastaway", "survival"), (r"\bwar\b|\bsoldier|\bbattle of|\bworld war", "war"),
    (r"\bmedieval|\bkingdom\b|\bdragon|\bwizard|\bsorcer|\bmagic\b", "fantasy-epic"), (r"\bpirate", "pirates"), (r"\bmartial arts|\bkung fu|\bsamurai|\bninja", "martial-arts"),
    (r"\bmonster\b|\bkaiju|\bgodzilla|\bcreature", "monster"), (r"\brobot|\bandroid\b|\bartificial intelligence|\b a\.i\.\b|\bcyborg", "robots"), (r"\balien\b|\bextraterrestrial|\binvasion", "aliens"),
    (r"\bmultiverse|\bparallel universe|\balternate reality", "multiverse"), (r"\bteen\b|\bteenage|\bhigh school", "teen"), (r"\bfamily\b", "family"), (r"\bchristmas", "christmas"),
    (r"\bbased on (?:a |the )?true|\btrue story|\bbased on real|\bbiographical|\bdocumentary", "true-story"), (r"\bhistorical\b|\bperiod\b|\b1[5-9]\d\ds\b|\bvictorian|\bmedieval", "period"),
    (r"\bpolitical|\bpolitician|\bpresident|\belection", "political"), (r"\bjournalis|\bnewspaper|\breporter", "journalism"), (r"\bhorror comedy|\bcomedy horror", "horror-comedy"),
    (r"\bdark comedy|\bblack comedy", "dark"), (r"\bfeel-good|\bheartwarming", "feel-good"), (r"\bepic\b", "epic"), (r"\banthology", "anthology"), (r"\bminiseries|\blimited series", "limited-series"),
    (r"\bsitcom", "sitcom"), (r"\bworkplace|\boffice\b", "workplace"), (r"\bmedical\b|\bhospital|\bdoctor", "medical"), (r"\bpolice\b|\bcop\b|\bdetective", "police"),
    (r"\bassassin|\bhitman|\bhit man", "assassin"), (r"\bcon artist|\bcon man|\bscam|\bswindl|\bhustler", "con-artist"), (r"\baddict|\bdrug\b|\bheroin|\bcocaine", "addiction"),
    (r"\bimmigra|\brefugee", "immigrant"), (r"\blgbt|\bgay\b|\blesbian|\bqueer|\btransgender", "lgbtq"), (r"\bwedding|\bmarriage|\bdivorce", "marriage"),
    (r"\bfriendship|\bbest friends?\b", "friendship"), (r"\bgrief|\bbereave|\bdeath of", "grief"), (r"\bcomputer|\bhacker|\bvideo game|\bsilicon valley|\btech ", "tech"),
]


def num(v):
    """A number from a Wikidata literal, or None. Wikidata writes "unknown
    value" as a blank-node URI (…/.well-known/genid/…) where a number would be."""
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


def clean_genre(label):
    g = label.strip().lower()
    for _ in range(3):
        before = g
        for rx in STRIP:
            g = re.sub(rx, "", g).strip()
        if g == before:
            break
    return g


def tags_from_hook(hook):
    if not hook:
        return []
    low = " " + hook.lower() + " "
    return [tag for rx, tag in HOOK_TAGS if re.search(rx, low)]


def parse_score(raw, by):
    """Wikidata records these as free text: "87%", "74/100", "7.4/10"."""
    m = re.search(r"(\d+(?:\.\d+)?)", raw or "")
    if not m:
        return None
    v = float(m.group(1))
    if "/10" in raw and "/100" not in raw:
        v *= 10
    if not 0 <= v <= 100:
        return None
    return int(round(v))


def ranked_cast(p, n=6):
    """Up to n cast members, best known first (by the actor's Wikipedia reach)."""
    rows = p.get("castrank") or []
    best = {}
    for r in rows:
        name, sl = r.get("v"), num(r.get("sl")) or 0
        if name and sl >= best.get(name, -1):
            best[name] = sl
    return [k for k, _ in sorted(best.items(), key=lambda kv: (-kv[1], kv[0]))][:n]


def load_parts():
    """Every cached detail response, grouped by item id."""
    out = {}
    for path in sorted(WD.glob("*.json")):
        name = path.name
        if name.startswith("select-"):
            continue
        part = name.rsplit("-", 1)[0]
        for row in json.loads(path.read_text()):
            qid = row.get("x", "").rsplit("/", 1)[-1]
            if not qid:
                continue
            out.setdefault(qid, {}).setdefault(part, []).append(row)
    return out


def main():
    movie_floor = int(sys.argv[1]) if len(sys.argv) > 1 else 20
    series_floor = int(sys.argv[2]) if len(sys.argv) > 2 else 11
    cand = json.loads((CACHE / "candidates.json").read_text())
    parts = load_parts()
    wp = json.loads((CACHE / "wikipedia.json").read_text()) if (CACHE / "wikipedia.json").exists() else {}

    records = []
    for qid, c in cand.items():
        floor = movie_floor if c["t"] == "movie" else series_floor
        if c["sl"] < floor:
            continue
        p = parts.get(qid)
        if not p:
            continue
        core = (p.get("core") or [{}])[0]
        title = core.get("label")
        # The earliest date wins; anything first released before 2000 is out of scope.
        year = num((p.get("first") or [{}])[0].get("vals")) or c.get("year")
        if not title or not year or year < 2000:
            continue
        c = dict(c, year=year)

        split = lambda key: [x for x in (p.get(key, [{}])[0].get("vals") or "").split("|") if x]

        genres, tags = [], []
        for label in split("genres"):
            g = clean_genre(label)
            # Children's programming is flagged whatever else it is tagged as,
            # so the app can keep it out of grown-up picks by default.
            if "child" in g or "preschool" in g:
                tags.append("kids")
            hit = GENRE_MAP.get(g)
            if not hit:
                # "crime drama" and friends: fall back to any canonical word in the label
                hit = ([x for x in GENRES if x.lower() in g], [])
                if not hit[0]:
                    continue
            for x in hit[0]:
                if x not in genres:
                    genres.append(x)
            tags += hit[1]

        langs = [LANG_CODES.get(x) for x in split("langs")]
        langs = [x for x in langs if x]
        countries = []
        for x in split("countries"):
            x = COUNTRY_NAMES.get(x, x)
            if x not in countries:
                countries.append(x)
        countries = countries[:3]
        if not langs:
            lang = "en" if set(countries) & ENGLISH_COUNTRIES else None
        elif "en" in langs and set(countries) & ENGLISH_COUNTRIES:
            lang = "en"
        else:
            lang = next((x for x in langs if x != "en"), langs[0])

        scores = {}
        for row in p.get("scores", []):
            by, method = row.get("by"), (row.get("method") or "").lower()
            if not by or "audience" in method or "popcorn" in method or "user" in method:
                continue
            v = parse_score(row.get("score"), by)
            if v is not None:
                scores.setdefault(by, []).append(v)
        rt = sorted(scores["rt"])[len(scores["rt"]) // 2] if scores.get("rt") else None
        mc = sorted(scores["mc"])[len(scores["mc"]) // 2] if scores.get("mc") else None

        places = []
        for row in p.get("places", []):
            m = re.match(r"Point\(([-\d.]+) ([-\d.]+)\)", row.get("coord", ""))
            if not m or not row.get("pname"):
                continue
            name = row["pname"]
            if any(x[0] == name for x in places):
                continue
            places.append([name, round(float(m.group(2)), 3), round(float(m.group(1)), 3), 1 if row.get("kind") == "filmed" else 0])
        places = places[:6]

        hook = (wp.get(qid) or {}).get("hook") or ""
        tags += tags_from_hook(hook)
        runtime = num(core.get("dur"))
        seasons = num(core.get("seasons"))
        end = num(core.get("endy"))
        if runtime is not None and not 20 <= runtime <= 400:
            runtime = None
        if seasons is not None and not 1 <= seasons <= 60:
            seasons = None
        if end is not None and end < c["year"]:
            end = None
        if c["t"] == "movie" and runtime and runtime > 150:
            tags.append("long")
        if seasons and seasons >= 5:
            tags.append("long-runner")

        awards = num((p.get("awards") or [{}])[0].get("vals")) or 0
        noms = num((p.get("noms") or [{}])[0].get("vals")) or 0
        records.append({
            "awards": awards,
            "noms": noms,
            "qid": int(qid[1:]),
            "imdb": int(core["imdb"][2:]) if (core.get("imdb") or "").startswith("tt") and core["imdb"][2:].isdigit() else None,
            "t": 1 if c["t"] == "series" else 0,
            "title": title,
            "year": c["year"],
            "end": end,
            "runtime": runtime,
            "seasons": seasons,
            "genres": genres[:4],
            "dirs": split("crew")[:3],
            "cast": ranked_cast(p) or split("cast")[:6],
            "lang": lang,
            "countries": countries,
            "rt": rt,
            "mc": mc,
            "reach": c["sl"],
            "tags": sorted(set(tags)),
            "hook": hook,
            "places": places,
            "article": (wp.get(qid) or {}).get("article"),
        })

    records.sort(key=lambda r: (-r["reach"], r["title"]))

    # ---- intern the repeated strings
    # Only people credited on two or more titles go in the first file: someone
    # in a single title can't link two titles, so the recommender never needs
    # them before the second file arrives, and most of the 26,000 credited
    # names are exactly that. Everyone is restored from extra.json for display
    # and search.
    names = Counter()
    for r in records:
        names.update(set(r["dirs"]) | set(r["cast"]))
    name_list = [n for n, k in names.most_common() if k >= 2]
    name_ix = {n: i for i, n in enumerate(name_list)}
    genre_list = sorted({g for r in records for g in r["genres"]})
    genre_ix = {g: i for i, g in enumerate(genre_list)}
    lang_list = sorted({r["lang"] for r in records if r["lang"]})
    lang_ix = {l: i for i, l in enumerate(lang_list)}
    country_list = sorted({c for r in records for c in r["countries"]})
    country_ix = {c: i for i, c in enumerate(country_list)}
    tag_list = sorted({x for r in records for x in r["tags"]})
    tag_ix = {t: i for i, t in enumerate(tag_list)}

    rows, hooks, places, arts, imdbs, credits = [], {}, {}, {}, {}, {}
    for i, r in enumerate(records):
        shared = lambda people: [name_ix[n] for n in people if n in name_ix]
        rows.append([
            r["qid"], None, r["t"], r["title"], r["year"], r["end"], r["runtime"], r["seasons"],
            [genre_ix[g] for g in r["genres"]],
            shared(r["dirs"]),
            shared(r["cast"]),
            lang_ix.get(r["lang"]),
            [country_ix[c] for c in r["countries"]],
            r["rt"], r["mc"], r["reach"],
            [tag_ix[t] for t in r["tags"]],
            r["awards"] or None, r["noms"] or None,
        ])
        if r["hook"]:
            hooks[i] = r["hook"]
        if r["places"]:
            places[i] = r["places"]
        # The article is usually named exactly like the title; store the exceptions.
        if r["article"] and r["article"] != r["title"]:
            arts[i] = r["article"]
        if r["imdb"]:
            imdbs[i] = r["imdb"]
        # Full credits in billing order: an integer is an index into the first
        # file's name list, a string is someone credited on this title alone.
        if any(n not in name_ix for n in r["dirs"] + r["cast"]):
            credits[i] = [[name_ix.get(n, n) for n in r["dirs"]], [name_ix.get(n, n) for n in r["cast"]]]

    built = datetime.date.today().isoformat()
    films = sum(1 for r in records if r["t"] == 0)
    titles_doc = {
        "v": 2, "built": built,
        "counts": {"all": len(records), "films": films, "series": len(records) - films,
                   "rt": sum(1 for r in records if r["rt"] is not None),
                   "mc": sum(1 for r in records if r["mc"] is not None),
                   "awarded": sum(1 for r in records if r["awards"] or r["noms"]),
                   "kids": sum(1 for r in records if "kids" in r["tags"])},
        "dict": {"g": genre_list, "n": name_list, "l": lang_list, "c": country_list, "t": tag_list},
        "rows": rows,
    }
    extra_doc = {"v": 2, "h": hooks, "p": places, "w": arts, "i": imdbs, "c": credits}

    (ROOT / "data").mkdir(exist_ok=True)
    for name, doc in (("titles.json", titles_doc), ("extra.json", extra_doc)):
        (ROOT / "data" / name).write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")))

    def sizes(name):
        raw = (ROOT / "data" / name).read_bytes()
        return len(raw) / 1e6, len(gzip.compress(raw, 6)) / 1e6

    t_raw, t_gz = sizes("titles.json")
    e_raw, e_gz = sizes("extra.json")
    print(f"{len(records):,} titles ({films:,} films, {len(records) - films:,} series) "
          f"floors {movie_floor}/{series_floor}")
    print(f"  RT {titles_doc['counts']['rt']:,}  Metacritic {titles_doc['counts']['mc']:,}  "
          f"summaries {len(hooks):,}  locations {len(places):,}  "
          f"with awards {titles_doc['counts']['awarded']:,}  children's {titles_doc['counts']['kids']:,}")
    print(f"  titles.json {t_raw:.2f} MB raw / {t_gz:.2f} MB gzipped")
    print(f"  extra.json  {e_raw:.2f} MB raw / {e_gz:.2f} MB gzipped")
    print(f"  first load  {t_gz:.2f} MB gzipped, {t_gz + e_gz:.2f} MB in total")


if __name__ == "__main__":
    main()
