// Library loading and decoding.
//
// The library ships in two files so the first paint does not wait for text it
// does not need yet:
//
//   data/titles.json  everything the recommender and the grid need
//   data/extra.json   one-line summaries, filming/story locations, article
//                     names — fetched straight after, then folded in
//
// Both use interned dictionaries and positional rows rather than objects with
// repeated keys. Names like "Christopher Nolan" appear once in a dictionary
// and as a small integer everywhere else, which is most of the saving: the
// same content as plain JSON objects is roughly a third of the bytes.
(function () {
  "use strict";

  // Row layout, kept in step with tools/assemble.py.
  const QID = 0, IMDB = 1, KIND = 2, TITLE = 3, YEAR = 4, END = 5, MINS = 6,
        SEASONS = 7, GENRES = 8, DIRS = 9, CAST = 10, LANG = 11, COUNTRIES = 12,
        RT = 13, MC = 14, REACH = 15, TAGS = 16, AWARDS = 17, NOMS = 18;

  const LANG_NAMES = {
    en: "English", fr: "French", es: "Spanish", de: "German", it: "Italian", ja: "Japanese",
    ko: "Korean", zh: "Chinese", yue: "Cantonese", hi: "Hindi", ta: "Tamil", te: "Telugu",
    ml: "Malayalam", kn: "Kannada", bn: "Bengali", mr: "Marathi", pa: "Punjabi", ur: "Urdu",
    fa: "Persian", ar: "Arabic", he: "Hebrew", tr: "Turkish", ru: "Russian", uk: "Ukrainian",
    pl: "Polish", cs: "Czech", sk: "Slovak", hu: "Hungarian", ro: "Romanian", bg: "Bulgarian",
    sr: "Serbian", hr: "Croatian", bs: "Bosnian", sl: "Slovene", mk: "Macedonian", sq: "Albanian",
    el: "Greek", sv: "Swedish", no: "Norwegian", da: "Danish", fi: "Finnish", is: "Icelandic",
    nl: "Dutch", pt: "Portuguese", ca: "Catalan", eu: "Basque", gl: "Galician", ga: "Irish",
    cy: "Welsh", th: "Thai", vi: "Vietnamese", id: "Indonesian", ms: "Malay", tl: "Filipino",
    km: "Khmer", my: "Burmese", ne: "Nepali", si: "Sinhala", mn: "Mongolian", kk: "Kazakh",
    uz: "Uzbek", az: "Azerbaijani", hy: "Armenian", ka: "Georgian", ku: "Kurdish", ps: "Pashto",
    am: "Amharic", sw: "Swahili", zu: "Zulu", xh: "Xhosa", af: "Afrikaans", yo: "Yoruba",
    ha: "Hausa", ig: "Igbo", la: "Latin", yi: "Yiddish", haw: "Hawaiian", mi: "Maori",
    iu: "Inuktitut", nv: "Navajo", sgn: "Sign language", none: "No dialogue"
  };

  function decode(payload) {
    const d = payload.dict;
    const titles = payload.rows.map((r, i) => {
      const qid = r[QID];
      const t = {
        i,
        id: "q" + qid,
        qid,
        imdb: r[IMDB] ? "tt" + String(r[IMDB]).padStart(7, "0") : null,
        t: r[KIND] ? "series" : "movie",
        title: r[TITLE],
        year: r[YEAR],
        end: r[END],
        runtime: r[MINS],
        seasons: r[SEASONS],
        genres: (r[GENRES] || []).map(x => d.g[x]),
        director: (r[DIRS] || []).map(x => d.n[x]),
        cast: (r[CAST] || []).map(x => d.n[x]),
        lang: r[LANG] == null ? null : d.l[r[LANG]],
        country: (r[COUNTRIES] || []).map(x => d.c[x]),
        rt: r[RT],
        mc: r[MC],
        reach: r[REACH],
        tags: (r[TAGS] || []).map(x => d.t[x]),
        awards: r[AWARDS] || 0,
        noms: r[NOMS] || 0,
        hook: "",
        wiki: null,
        places: []
      };
      return t;
    });
    return { titles, built: payload.built, counts: payload.counts || {}, names: d.n };
  }

  // Folded in once data/extra.json arrives. Keyed by row index.
  let NAMES = [];
  function merge(titles, extra) {
    const h = extra.h || {}, p = extra.p || {}, w = extra.w || {}, im = extra.i || {}, cr = extra.c || {};
    for (const t of titles) t.wiki = t.title;               // the usual case; exceptions below
    for (const k in h) { const t = titles[k]; if (t) t.hook = h[k]; }
    for (const k in w) { const t = titles[k]; if (t) t.wiki = w[k]; }
    for (const k in im) { const t = titles[k]; if (t) t.imdb = "tt" + String(im[k]).padStart(7, "0"); }
    for (const k in p) {
      const t = titles[k];
      if (t) t.places = p[k].map(x => ({ name: x[0], lat: x[1], lng: x[2], kind: x[3] ? "filmed" : "set" }));
    }
    // Full credits: numbers index the shared name list, strings are one-offs.
    const name = x => typeof x === "number" ? NAMES[x] : x;
    for (const k in cr) {
      const t = titles[k];
      if (t) { t.director = cr[k][0].map(name); t.cast = cr[k][1].map(name); }
    }
  }

  // The build step points these at content-hashed copies.
  const asset = (key, fallback) => (window.TS_ASSETS && window.TS_ASSETS[key]) || fallback;

  async function getJSON(url) {
    // Default caching, not force-cache: these files are regenerated whenever
    // the library is rebuilt, and force-cache would pin someone to an old
    // copy for as long as it survived in their browser. A revalidation that
    // comes back 304 is cheap.
    const r = await fetch(url);
    if (!r.ok) throw new Error(url + " → HTTP " + r.status);
    return r.json();
  }

  window.TSData = {
    LANG_NAMES,
    langName: c => (c == null ? "Unknown" : LANG_NAMES[c] || c),
    async load() {
      const lib = decode(await getJSON(asset("titles", "data/titles.json")));
      NAMES = lib.names;
      return lib;
    },
    async loadExtra(titles) {
      merge(titles, await getJSON(asset("extra", "data/extra.json")));
    }
  };
})();
