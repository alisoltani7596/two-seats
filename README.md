# Two Seats

**[alisoltani7596.github.io/two-seats](https://alisoltani7596.github.io/two-seats/)**

Two people rate films and series. Two Seats models the two tastes separately
and shows what survives both.

![Two Seats](assets/og.png)

## Why it works this way

Picking something to watch together is not a ranking problem. A top-rated list
suits neither person, and averaging two tastes produces a bland middle that
neither of them asked for. The thing you actually want is the *overlap*.

So the score for a pair is the mean of both fits **minus 0.35 × how far apart
they are**. A film one person would love and the other would hate ranks below
one they both merely like. That penalty is the entire point of the app; the
rest is plumbing.

Each title in the match list carries a small two-bar gauge. One bar per person,
and a line across both at the level they both clear. Tall solid band means they
agree it's good. Two tall bars with a thin band means they disagree, and the
pick is weaker than either bar alone suggests.

## No account, no server, no key

Everything runs in the browser. Ratings live in `localStorage`; there is no
backend, no analytics, no sign-in and no API key anywhere in this repository.

To get two people's ratings onto one screen, **Seats → Make link** packs one
person's ratings into the URL fragment — the part after `#`, which browsers
never send to a server. Open that link on the other phone and it fills the
second seat. Ratings are keyed by Wikidata item id, which is stable, so a link
keeps working after the dataset is rebuilt.

The **Ask** tab answers plain-English requests ("something like Money Heist
that Leonardo DiCaprio has played") with a rule-based parser and similarity
ranker that run locally. You can optionally download a small language model
(Qwen 2.5 via [WebLLM](https://github.com/mlc-ai/web-llm), 350 MB–2 GB, needs
WebGPU) that runs **on your device** to read looser wording. It is off by
default and the app works fully without it.

## The data, and why there is no IMDb rating

The earlier private version of this app was built on
[IMDb's non-commercial datasets](https://data.imdb.com/non-commercial-datasets/).
Publishing it meant re-examining that, and the datasets did not survive the
check.

IMDb's own page describes the grant as: *"Subsets of IMDb data are available
for access to customers for personal and non-commercial use."* IMDb's
[Conditions of Use](https://www.imdb.com/conditions) add that the compilation
is *"the exclusive property of IMDb"* and may not be *"reproduced, duplicated,
copied, sold, resold, visited, or otherwise exploited for any commercial
purpose"* without written consent.

Publishing a derived dataset on a public website is not personal use, whether
or not money changes hands — "personal **and** non-commercial" is a
conjunction, and a public site fails the first half. Using the dumps even to
*choose* which titles to ship would make the selection a derived product of
that database. So this repository ships none of it, and the pipeline does not
download it. (This is my reading of the terms, not legal advice.)

**What the public dataset is built from instead:**

| Source | Licence | What it provides |
| --- | --- | --- |
| [Wikidata](https://www.wikidata.org/) | [CC0](https://creativecommons.org/publicdomain/zero/1.0/) (public domain) | titles, years, type, genres, directors, cast, original language, country, runtime, seasons, story and filming locations, Rotten Tomatoes and Metacritic scores, IMDb ids |
| [Wikipedia](https://en.wikipedia.org/) | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | the one-line summary on each title |
| [Natural Earth](https://www.naturalearthdata.com/) | public domain | the map outlines |

Two consequences worth knowing about:

- **There is no IMDb rating in the app.** IMDb ids *are* included — they come
  from Wikidata's own `P345` property, and they are used only to link out. Open
  a title and the IMDb chip takes you to the page to see the rating there.
- **Quality uses what is actually free.** Rotten Tomatoes and Metacritic scores
  where Wikidata records them, which is most films but almost no series. Where
  neither exists, the fallback is *reach* — how many Wikipedia language
  editions cover the title. Reach says how well known something is, not how
  good it is, and the app labels it that way and never lets it outweigh a real
  score.

Streaming availability is deliberately absent: it differs by country and
changes constantly, so recording it would mean shipping something wrong. Set
your country in **Seats** and each title's "Where to watch" link goes to
JustWatch for it.

Because the summaries are CC BY-SA, `data/extra.json` carries a share-alike
obligation — see [`data/README.md`](data/README.md). The code is MIT.

## Posters

There is no poster art in the dataset, on purpose: IMDb's terms rule theirs
out, and the posters on Wikipedia are non-free fair-use uploads that cannot be
reused on a third-party site. Each title gets a generated poster instead
(`src/poster.js`): one of six Swiss-style compositions — a sun, rings, a
diagonal band, a horizon, stripes, a quarter disc — picked and positioned from
a hash of the title, in a palette tuned per genre, with a print-grain overlay.
The same title always gets the same poster. It is all CSS background layers on
one element, so a grid of a hundred costs nothing to download.

## Performance

The page is built to open fast on a phone over mobile data.

- **The library is split in two.** `data/titles.json` holds what the
  recommender and grid need and is preloaded in parallel with the script; the
  app is usable as soon as it lands. `data/extra.json` — summaries, locations,
  article names — follows straight after and is folded in. Both use interned
  dictionaries and positional rows, so a name like "Christopher Nolan" is
  stored once and referenced by number.
- **The first screen does not wait for data.** Saved state is read from local
  storage synchronously, so a returning visitor sees the app shell with
  skeletons immediately, and a new visitor sees the welcome screen.
- **The map loads on demand.** d3, topojson and the world outlines (about
  400 KB) are fetched the first time the Map tab opens, never before.
- **Fonts are self-hosted.** Three variable woff2 files, 130 KB together,
  preloaded — no request to Google Fonts, which would also log every visitor.
- **The deployed site is bundled, minified and content-hashed.** One script
  and one stylesheet instead of six and one, with hashed names so they can be
  cached for ever without going stale.
- **A service worker** pre-caches the shell and the library, so a second visit
  opens instantly and the app keeps working offline.
- **Long lists render lazily** with `content-visibility`, and the rating deck
  computes its sort keys once per title rather than inside the comparator.

`python3 tools/assemble.py` prints the raw and gzipped size of both data files,
so you can see what a change to the inclusion thresholds costs before shipping.

## Build the dataset yourself

No API keys and no account. Every step is resumable — rerun after an
interruption and it picks up from the cache.

```sh
python3 tools/fetch_wikidata.py     # candidates + details  → cache/wd/
python3 tools/fetch_wikipedia.py    # one-line summaries    → cache/wikipedia.json
python3 tools/assemble.py           # → data/titles.json, data/extra.json
```

`assemble.py` takes two optional arguments: the minimum number of Wikipedia
language editions a film and a series need to be included. Higher numbers mean
fewer, better-known titles and a smaller download.

```sh
python3 tools/assemble.py 25 14     # smaller, more mainstream
python3 tools/assemble.py 15 8      # larger, deeper cuts
```

Please keep the descriptive `User-Agent` in the fetchers; the Wikimedia query
service asks for one, and a build that hammers it anonymously spoils it for
everyone.

## Run it locally

Any static file server will do. The app `fetch`es its data, which browsers
block on `file://` URLs, so opening `index.html` directly will not work.

```sh
python3 -m http.server 8752 --directory .
```

That serves the readable source, with no service worker, which is what you
want while editing. To try the production build:

```sh
python3 tools/build_site.py          # → _site/  (uses esbuild through npx if present)
python3 -m http.server 8752 --directory _site
```

## Deploying

Pushing to `main` runs `.github/workflows/pages.yml`, which builds `_site/` and
publishes it to GitHub Pages. Nothing generated is committed except the data.

## Layout

```
index.html             markup and the tab shell
src/styles.css         design tokens, light and dark
src/data.js            decodes the compact library format
src/poster.js          generated poster artwork
src/app.js             state, recommender, rendering
src/share.js           packs ratings into a URL fragment
src/ask.js             the local search engines
src/map.js             d3 world map with zoom clustering
assets/fonts/          self-hosted variable fonts (SIL OFL)
tools/                 dataset pipeline, site build, service-worker template
data/                  generated library — do not hand-edit
.github/workflows/     build and deploy to GitHub Pages
```

## Licence

Code: [MIT](LICENSE). Data: see [`data/README.md`](data/README.md). Fonts: Bricolage Grotesque and Geist, both under the [SIL Open Font License](assets/fonts/) (licence files alongside the fonts).

Not affiliated with IMDb, Rotten Tomatoes, Metacritic or JustWatch.
