// Two Seats — app logic.
//
// Two tastes are modelled separately and never averaged into one profile. A
// title's score for the pair is the lower-bounded blend of both fits: the mean
// minus a penalty proportional to how far apart the two are, so something one
// person would love and the other would hate sinks below something they both
// merely like. That penalty is the whole point of the app.
//
// All state lives in this browser (localStorage). There is no server, no
// account and no key; the only way state leaves the device is the share link,
// which the person has to copy and send themselves.
(function () {
"use strict";

// ---------------------------------------------------------------- constants
const GENRE_ORDER = ["Drama", "Comedy", "Thriller", "Crime", "Mystery", "Science fiction", "Fantasy", "Horror", "Action", "Adventure", "Romance", "Animation", "Documentary", "History", "War", "Biography", "Musical", "Sport", "Family", "Western"];
const SCALE = [
  { v: 1, label: "No" },
  { v: 2, label: "Meh" },
  { v: 3, label: "Fine" },
  { v: 4, label: "Good" },
  { v: 5, label: "Great" }
];
const CHIPS = [
  { id: "gripping", label: "Gripping", tags: ["tense", "twisty"], w: 0.5 },
  { id: "funny", label: "Made us laugh", tags: ["funny", "satire"], w: 0.5 },
  { id: "visual", label: "Beautiful", tags: ["visual-spectacle", "art-house"], w: 0.5 },
  { id: "chars", label: "Great characters", tags: ["character-study", "ensemble"], w: 0.5 },
  { id: "moving", label: "Moving", tags: ["emotional", "romantic"], w: 0.5 },
  { id: "comfort", label: "Comfort watch", tags: ["cozy", "feel-good"], w: 0.5 },
  { id: "smart", label: "Thought-provoking", tags: ["cerebral", "political"], w: 0.5 },
  { id: "slow", label: "Too slow", tags: ["slow-burn", "meditative"], w: -0.5 },
  { id: "long", label: "Too long", tags: [], w: 0, runtime: true },
  { id: "dark", label: "Too bleak", tags: ["dark", "bleak", "violent"], w: -0.5 },
  { id: "confusing", label: "Confusing", tags: ["nonlinear", "twisty"], w: -0.4 },
  { id: "generic", label: "Predictable", tags: ["blockbuster", "superhero"], w: -0.4 }
];
const CHIP_BY_ID = Object.fromEntries(CHIPS.map(c => [c.id, c]));
const LS_KEY = "two-seats-public:v1";
const PAGE = 48;
const SEATS = ["a", "b"];

// ---------------------------------------------------------------- state
let TITLES = [], BY_ID = {}, BY_QID = {}, ALL_PEOPLE = { directors: {}, actors: {} }, BUILT = "";

const state = {
  people: { a: { name: "" }, b: { name: "", on: true } },
  who: "both", type: "all", tab: "match",
  entries: {},
  prefs: {
    favorites: { directors: [], actors: [] },
    genres: { like: [], avoid: [] },
    settings: { cross: 0.6, quality: 1.0, recency: 0.3 },
    region: "", services: [], theme: "", kids: false
  },
  filters: null,
  deck: { seat: "a", history: [] },
  mapKind: "all", mapSeen: "all", mapSel: null, mapMulti: null, mapReady: false,
  browsePage: 1, langsOpen: false, countriesOpen: false,
  drawerId: null, recCache: null, extraReady: false
};
const DEFAULT_FILTERS = () => ({ q: "", sort: "fit", status: "any", genres: [], genresOut: [], langs: [], langsOut: [], countries: [], countriesOut: [], minRt: 0, minMc: 0, require: false, yearFrom: 2000, yearTo: 2026 });
state.filters = DEFAULT_FILTERS();

const seatsOn = () => (state.people.b.on ? SEATS : ["a"]);
const solo = () => !state.people.b.on;
const nameOf = s => state.people[s].name || (s === "a" ? "Seat A" : "Seat B");

function blankEntry() { return { w: { a: false, b: false }, s: { a: null, b: null }, skip: { a: false, b: false }, chips: [], note: "", list: { a: false, b: false }, at: null }; }
function getEntry(id) { return state.entries[id] || blankEntry(); }
function editEntry(id, fn) {
  const e = JSON.parse(JSON.stringify(getEntry(id)));
  fn(e);
  e.at = new Date().toISOString();
  const empty = !e.w.a && !e.w.b && !e.skip.a && !e.skip.b && !e.list.a && !e.list.b && !e.note && !e.chips.length;
  if (empty) delete state.entries[id]; else state.entries[id] = e;
  state.recCache = null;
  save();
}
function ratedBy(e, seat) { return e.w[seat]; }
function anyRated(e) { return seatsOn().some(s => e.w[s]); }
// Is this still a candidate for the current audience?
function openFor(e, who) {
  const seats = who === "both" ? seatsOn() : [who];
  // Never suggest something someone in the audience actively disliked.
  if (seats.some(x => e.s[x] != null && e.s[x] <= 2)) return false;
  // For the pair, one person having seen it is not disqualifying — showing it
  // to the other is the whole point. Both having seen it is.
  if (who === "both") return !seats.every(x => e.w[x]);
  return !e.w[who];
}

// ---------------------------------------------------------------- storage
function save() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({
      people: state.people, entries: state.entries, prefs: state.prefs,
      ui: { who: state.who, type: state.type, filters: state.filters, deckSeat: state.deck.seat }
    }));
  } catch (e) { /* private mode or blocked storage: run in memory */ }
}
function load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return false;
    const o = JSON.parse(raw);
    if (o.people) state.people = deepMerge(state.people, o.people);
    if (o.entries) state.entries = o.entries;
    if (o.prefs) state.prefs = deepMerge(state.prefs, o.prefs);
    if (o.ui) {
      state.who = o.ui.who || state.who;
      state.type = o.ui.type || state.type;
      state.deck.seat = o.ui.deckSeat || "a";
      if (o.ui.filters) { state.filters = Object.assign(DEFAULT_FILTERS(), o.ui.filters); state.filters.q = ""; }
    }
    return !!(state.people.a.name || Object.keys(state.entries).length);
  } catch (e) { return false; }
}
function deepMerge(base, over) {
  const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
  for (const k of Object.keys(over || {})) {
    if (over[k] && typeof over[k] === "object" && !Array.isArray(over[k]) && base && typeof base[k] === "object" && !Array.isArray(base[k])) out[k] = deepMerge(base[k], over[k]);
    else out[k] = over[k];
  }
  return out;
}

// ---------------------------------------------------------------- helpers
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const enc = encodeURIComponent;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const uniq = a => a.filter((x, i) => a.indexOf(x) === i);
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => { t.hidden = true; }, 2400); }
const typeOK = t => state.type === "all" || t.t === state.type;
const langName = c => window.TSData.langName(c);

function runtimeLabel(t) {
  if (t.t === "movie") return t.runtime ? `${t.runtime} min` : "film";
  if (t.seasons) return `${t.seasons} season${t.seasons === 1 ? "" : "s"}`;
  return t.end ? "series" : "ongoing series";
}
function yearLabel(t) {
  if (t.t === "movie") return String(t.year);
  if (t.end && t.end !== t.year) return `${t.year}–${t.end}`;
  return t.end ? String(t.year) : `${t.year}–`;
}
function links(t) {
  const q = enc(`${t.title} ${t.year}`);
  return {
    imdb: t.imdb ? `https://www.imdb.com/title/${t.imdb}/` : `https://www.imdb.com/find/?q=${q}`,
    wiki: t.wiki ? `https://en.wikipedia.org/wiki/${enc(t.wiki.replace(/ /g, "_"))}` : `https://en.wikipedia.org/w/index.php?search=${q}`,
    wikidata: `https://www.wikidata.org/wiki/Q${t.qid}`,
    // The official trailer when TMDB knows it; a search otherwise.
    trailer: t.trailer ? `https://www.youtube.com/watch?v=${t.trailer}` : `https://www.youtube.com/results?search_query=${enc(t.title + " " + t.year + " official trailer")}`,
    rt: `https://www.rottentomatoes.com/search?search=${enc(t.title)}`,
    mc: `https://www.metacritic.com/search/${enc(t.title)}/`,
    tmdb: t.tmdb ? `https://www.themoviedb.org/${t.tmdb[0] === "m" ? "movie" : "tv"}/${t.tmdb.slice(1)}` : null
  };
}

// ---------------------------------------------------------------- where to watch
// Availability comes from TMDB, which gets it from JustWatch; both are credited
// wherever it is shown. Each service links to its own search for the title.
const SERVICE_SEARCH = [
  [/netflix/, "https://www.netflix.com/search?q="],
  [/prime video|amazon/, "https://www.primevideo.com/search/ref=atv_nb_sr?phrase="],
  [/apple tv/, "https://tv.apple.com/search?term="],
  [/disney/, "https://www.disneyplus.com/search?q="],
  [/^max$|hbo max|^max /, "https://play.max.com/search?q="],
  [/hulu/, "https://www.hulu.com/search?q="],
  [/crave/, "https://www.crave.ca/en/search?q="],
  [/paramount/, "https://www.paramountplus.com/search/?q="],
  [/peacock/, "https://www.peacocktv.com/search?q="],
  [/crunchyroll/, "https://www.crunchyroll.com/search?q="],
  [/mubi/, "https://mubi.com/en/search/films?query="],
  [/tubi/, "https://tubitv.com/search/"],
  [/pluto/, "https://pluto.tv/search/details?query="],
  [/youtube/, "https://www.youtube.com/results?search_query="],
  [/criterion/, "https://www.criterionchannel.com/search?q="],
  [/britbox/, "https://www.britbox.com/search?q="],
  [/shudder/, "https://www.shudder.com/search?q="],
  [/kanopy/, "https://www.kanopy.com/search?query="],
  [/cbc gem/, "https://gem.cbc.ca/search?q="],
  [/now tv|^now$/, "https://www.nowtv.com/search?q="],
  [/stan$/, "https://www.stan.com.au/search?q="],
  [/hotstar|jiocinema|jiohotstar/, "https://www.hotstar.com/in/explore?search_query="],
  [/zee5/, "https://www.zee5.com/search?q="],
  [/viaplay/, "https://viaplay.com/search?query="],
  [/filmin/, "https://www.filmin.es/buscador?q="],
  [/canal\+/, "https://www.canalplus.com/recherche/?q="],
  [/rakuten/, "https://www.rakuten.tv/search?q="],
  [/sky go|sky store|sky /, "https://www.sky.com/search?q="]
];
function providerName(pid) { const p = window.TSData.providers()[pid]; return p ? p[0] : "Service"; }
function providerLogo(pid) { const p = window.TSData.providers()[pid]; return p ? window.TSData.img(p[1], "w92") : null; }
function serviceLink(pid, t) {
  const name = providerName(pid).toLowerCase();
  for (const [rx, base] of SERVICE_SEARCH) if (rx.test(name)) return base + enc(t.title);
  const L = links(t);
  return L.tmdb ? `${L.tmdb}/watch?locale=${state.watch ? state.watch.cc : ""}` : `https://www.google.com/search?q=${enc("watch " + t.title + " " + t.year)}`;
}
function regionName(cc) {
  try { return new Intl.DisplayNames([navigator.language || "en"], { type: "region" }).of(cc) || cc; } catch (e) { return cc; }
}
function availability(t) {
  const w = state.watch && state.watch.data;
  if (!w) return null;
  return { s: w.s[t.i] || [], f: w.f[t.i] || [], rent: w.rent.has(t.i) };
}
function onMyServices(t) {
  const a = availability(t), mine = state.prefs.services || [];
  if (!a || !mine.length) return [];
  return a.s.concat(a.f).filter(pid => mine.includes(pid));
}
// A few logos for a card: the household's own services first.
function whereStrip(t) {
  const a = availability(t);
  if (!a) return "";
  const mine = state.prefs.services || [];
  const all = a.s.concat(a.f.filter(x => !a.s.includes(x)));
  if (!all.length) return a.rent ? `<div class="where"><span class="where-note">Rent or buy</span></div>` : "";
  all.sort((x, y) => (mine.includes(y) ? 1 : 0) - (mine.includes(x) ? 1 : 0));
  const shown = all.slice(0, 4);
  return `<div class="where">${shown.map(pid => {
    const logo = providerLogo(pid);
    return `<a href="${esc(serviceLink(pid, t))}" target="_blank" rel="noopener" title="${esc(providerName(pid))}${a.f.includes(pid) && !a.s.includes(pid) ? " (free)" : ""}" class="${mine.includes(pid) ? "mine" : ""}">${logo ? `<img src="${logo}" alt="${esc(providerName(pid))}" loading="lazy" decoding="async" width="24" height="24">` : esc(providerName(pid))}</a>`;
  }).join("")}${all.length > shown.length ? `<span class="where-note">+${all.length - shown.length}</span>` : ""}</div>`;
}
// The full list, for the details panel.
function whereFull(t) {
  if (!window.TSData.regions().length) return "";
  const cc = state.watch && state.watch.cc;
  if (!cc) return `<div class="d-sec"><h3>Where to watch</h3><p class="hint">Pick your country in <button type="button" class="link" data-tab="you">Seats</button> to see which services carry it.</p></div>`;
  const a = availability(t), mine = state.prefs.services || [];
  const row = (label, pids, free) => pids.length ? `<div class="wf-row"><span class="wf-k">${label}</span><div class="wf-list">${pids.map(pid => {
    const logo = providerLogo(pid);
    return `<a class="wf-svc${mine.includes(pid) ? " mine" : ""}" href="${esc(serviceLink(pid, t))}" target="_blank" rel="noopener">${logo ? `<img src="${logo}" alt="" loading="lazy" width="28" height="28">` : ""}<span>${esc(providerName(pid))}</span>${free ? `<em>free</em>` : ""}</a>`;
  }).join("")}</div></div>` : "";
  const streams = a ? a.s : [], frees = a ? a.f.filter(x => !a.s.includes(x)) : [];
  const body = streams.length || frees.length
    ? row("Stream", streams, false) + row("Free", frees, true) + (a.rent ? `<p class="hint">Also to rent or buy.</p>` : "")
    : `<p class="hint">Not on a subscription service in ${esc(regionName(cc))} right now${a && a.rent ? " — available to rent or buy" : ""}.</p>`;
  const L = links(t);
  return `<div class="d-sec"><h3>Where to watch in ${esc(regionName(cc))}</h3>${body}
    <p class="d-src">Availability from <a href="https://www.justwatch.com/" target="_blank" rel="noopener">JustWatch</a> via <a href="${L.tmdb ? L.tmdb + "/watch?locale=" + cc : "https://www.themoviedb.org/"}" target="_blank" rel="noopener">TMDB</a>, refreshed weekly. Each service opens its own search.</p></div>`;
}
// Load the viewer's country once TMDB media is in.
function detectRegion() {
  const regions = window.TSData.regions();
  for (const l of navigator.languages || [navigator.language || ""]) {
    const m = /-([A-Za-z]{2})$/.exec(l);
    if (m && regions.includes(m[1].toUpperCase())) return m[1].toUpperCase();
  }
  return regions.includes("US") ? "US" : null;
}
function ensureWatch() {
  const regions = window.TSData.regions();
  if (!regions.length) return;
  let cc = (state.prefs.region || "").toUpperCase();
  if (!regions.includes(cc)) cc = detectRegion();
  if (!cc) return;
  if (state.watch && state.watch.cc === cc) return;
  window.TSData.loadWatch(cc).then(data => {
    if (!data) return;
    state.watch = { cc, data };
    rerenderAll();
  }).catch(() => {});
}
function rerenderAll() {
  if (!state.libReady || $("#app").hidden) return;
  syncChrome();
  if (state.tab !== "ask") renderTab();
  if (state.drawerId) renderDrawer();
}

// ---------------------------------------------------------------- trailer player
// Plays inside the app, through YouTube's privacy-enhanced embed domain, so
// nothing is set until someone presses play.
function openTrailer(t) {
  const box = $("#player");
  box.innerHTML = `<div class="player-in"><button type="button" class="close" data-closeplayer aria-label="Close trailer"><svg class="ic"><use href="#i-x"/></svg></button>
    <div class="player-frame"><iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(t.trailer)}?autoplay=1&rel=0&playsinline=1" title="${esc(t.title)} trailer" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div>
    <p class="player-cap">${esc(t.title)} · ${yearLabel(t)} · <a href="https://www.youtube.com/watch?v=${encodeURIComponent(t.trailer)}" target="_blank" rel="noopener">open on YouTube</a></p></div>`;
  box.hidden = false;
}
function closeTrailer() { const box = $("#player"); box.hidden = true; box.innerHTML = ""; }
function trailerBtn(t, cls, label) {
  return `<a class="${cls}" href="${links(t).trailer}" target="_blank" rel="noopener"${t.trailer ? ` data-trailer="${t.id}"` : ""}><svg class="ic"><use href="#i-play"/></svg>${label || "Trailer"}</a>`;
}

// ---------------------------------------------------------------- recommender
function buildProfile(seat, forType) {
  const cross = state.prefs.settings.cross;
  const p = { genre: {}, tag: {}, director: {}, actor: {}, evidence: [], n: 0, longPenalty: 0 };
  for (const t of TITLES) {
    const e = state.entries[t.id];
    if (!e || !e.w[seat]) continue;
    const v = e.s[seat];
    const mult = t.t === forType ? 1 : cross;
    // 5 = loved, 3 = neutral, 1 = disliked. Seen-but-unscored counts a little.
    const w = (v == null ? 0.15 : (2 * v - 6) / 4) * mult;
    p.n++;
    p.evidence.push({ t, w, v });
    for (const g of t.genres) p.genre[g] = (p.genre[g] || 0) + w;
    for (const x of t.tags) p.tag[x] = (p.tag[x] || 0) + w;
    for (const d of t.director) p.director[d] = (p.director[d] || 0) + w;
    for (const a of t.cast) p.actor[a] = (p.actor[a] || 0) + w;
    for (const cid of e.chips || []) {
      const c = CHIP_BY_ID[cid];
      if (!c) continue;
      if (c.runtime) p.longPenalty++;
      for (const x of c.tags) p.tag[x] = (p.tag[x] || 0) + c.w * mult;
    }
  }
  for (const k of ["genre", "tag", "director", "actor"]) for (const key in p[k]) p[k][key] = clamp(p[k][key], -2, 2);
  return p;
}

// How good a title is, from what the CC0 data actually holds. Critics' scores
// where Wikidata records them (most films); awards and nominations next (the
// signal most acclaimed series have); and reach — how many Wikipedias cover it
// — last. Reach measures distribution, not quality: children's cartoons are
// dubbed into dozens of languages and top it, so it only ever breaks ties.
function reachNorm(t) {
  const r = Math.max(1, t.reach || 1);
  return clamp((Math.log(r) - Math.log(10)) / (Math.log(150) - Math.log(10)), 0, 1);
}
function prestige(t) {
  return clamp(Math.log1p((t.awards || 0) + 0.35 * (t.noms || 0)) / Math.log1p(30), 0, 1);
}
function quality(t) {
  let q = 0, n = 0;
  if (t.rt != null) { q += clamp((t.rt - 75) / 22, -1, 1) * 0.55; n += 0.55; }
  if (t.mc != null) { q += clamp((t.mc - 65) / 24, -1, 1) * 0.45; n += 0.45; }
  const pr = prestige(t), reach = reachNorm(t);
  if (n) return (q / n) * 0.75 + pr * 0.2 + reach * 0.05;
  // No critics' score: awards carry it, and an unrecognised title with no
  // awards sits below an average reviewed one rather than above it.
  return pr * 0.9 + reach * 0.15 - 0.3;
}
// How likely someone is to have seen it — the order the rating deck deals in.
function recognisable(t) {
  return reachNorm(t) * 0.55 + prestige(t) * 0.25 + (t.rt != null || t.mc != null ? 0.2 : 0);
}
// Children's programming stays out of picks unless the household wants it.
function kidsOK(t) {
  return state.prefs.kids || state.prefs.genres.like.includes("Family") || !t.tags.includes("kids");
}

function fitFor(t, p) {
  let fit = 0;
  const gs = t.genres.map(g => p.genre[g] || 0);
  fit += (gs.reduce((a, b) => a + b, 0) / Math.max(1, gs.length)) * 1.2;
  const ts = t.tags.map(x => p.tag[x] || 0);
  fit += (ts.reduce((a, b) => a + b, 0) / Math.sqrt(Math.max(1, ts.length))) * 0.9;
  fit += t.director.reduce((a, d) => a + (p.director[d] || 0), 0) * 1.4;
  fit += clamp(t.cast.reduce((a, c) => a + (p.actor[c] || 0), 0) * 0.7, -1.6, 1.6);
  if (p.longPenalty && t.t === "movie" && (t.runtime || 0) > 140) fit -= 0.3 * Math.min(3, p.longPenalty);
  return fit;
}
function favBoost(t) {
  const f = state.prefs.favorites, g = state.prefs.genres;
  let b = 0; const reasons = [];
  for (const d of t.director) if (f.directors.includes(d)) { b += 1.5; reasons.push(`${t.t === "movie" ? "directed" : "created"} by ${d}, a favourite`); }
  let ac = 0;
  for (const a of t.cast) if (f.actors.includes(a)) { ac += 0.8; reasons.push(`stars ${a}, a favourite`); }
  b += Math.min(1.6, ac);
  for (const x of t.genres) { if (g.like.includes(x)) b += 0.4; if (g.avoid.includes(x)) b -= 1.5; }
  return { b, reasons };
}
function evidenceFor(t, p, limit) {
  return p.evidence.filter(e => e.w > 0.05 && e.t.id !== t.id).map(e => {
    let sim = 0; const shared = [];
    for (const a of t.cast) if (e.t.cast.includes(a)) { sim += 0.6; shared.push(a); }
    for (const d of t.director) if (e.t.director.includes(d)) { sim += 1.5; shared.unshift(d); }
    for (const g of t.genres) if (e.t.genres.includes(g)) { sim += 0.5; shared.push(g.toLowerCase()); }
    for (const x of t.tags) if (e.t.tags.includes(x)) { sim += 0.3; shared.push(x.replace(/-/g, " ")); }
    return { e, v: sim * e.w, shared };
  }).filter(x => x.v > 0.25).sort((a, b) => b.v - a.v).slice(0, limit || 2);
}
function profiles() {
  const key = JSON.stringify([state.who, state.prefs.settings, Object.keys(state.entries).length, state.people.b.on, state.extraReady]);
  if (state.recCache && state.recCache.key === key) return state.recCache;
  const c = { key, a: { movie: buildProfile("a", "movie"), series: buildProfile("a", "series") }, b: { movie: buildProfile("b", "movie"), series: buildProfile("b", "series") }, scores: {} };
  for (const t of TITLES) c.scores[t.id] = scoreTitle(t, c);
  state.recCache = c;
  return c;
}
function scoreTitle(t, c) {
  const st = state.prefs.settings;
  const q = quality(t) * st.quality + (st.recency || 0) * clamp((t.year - 2000) / 26, 0, 1);
  const pa = c.a[t.t], pb = c.b[t.t];
  const fa = fitFor(t, pa), fb = solo() ? null : fitFor(t, pb);
  const { b, reasons } = favBoost(t);
  let fit, joint = null, gap = 0;
  if (state.who === "a" || solo()) fit = fa;
  else if (state.who === "b") fit = pb.n ? fb : fa;
  else if (!pb.n) fit = fa;
  else {
    gap = Math.abs(fa - fb);
    joint = (fa + fb) / 2 - 0.35 * gap;
    fit = joint;
  }
  return { total: q + fit + b, q, fa, fb, joint, gap, favReasons: reasons };
}
function reasonHTML(t, c) {
  const sc = c.scores[t.id];
  const parts = [];
  if (sc.favReasons.length) parts.push(sc.favReasons[0][0].toUpperCase() + sc.favReasons[0].slice(1));
  const pa = c.a[t.t], pb = c.b[t.t];
  const say = (seat, ev) => `${esc(nameOf(seat))} liked <b>${esc(ev.e.t.title)}</b>`;
  if (state.who === "both" && !solo() && pa.n && pb.n) {
    const ea = evidenceFor(t, pa, 1), eb = evidenceFor(t, pb, 1);
    if (ea.length && eb.length && ea[0].e.t.id === eb[0].e.t.id) {
      parts.push(`You both liked <b>${esc(ea[0].e.t.title)}</b>` + (ea[0].shared.length ? ` — shares ${esc(uniq(ea[0].shared).slice(0, 3).join(", "))}` : ""));
    } else {
      if (ea.length) parts.push(say("a", ea[0]) + (ea[0].shared.length ? ` (${esc(uniq(ea[0].shared).slice(0, 2).join(", "))})` : ""));
      if (eb.length) parts.push(say("b", eb[0]) + (eb[0].shared.length ? ` (${esc(uniq(eb[0].shared).slice(0, 2).join(", "))})` : ""));
    }
    if (sc.gap > 0.8 && Math.min(sc.fa, sc.fb) < 0.6) parts.push(sc.fa > sc.fb ? `leans ${esc(nameOf("a"))}'s way` : `leans ${esc(nameOf("b"))}'s way`);
    else if (sc.joint != null && sc.gap < 0.3 && (sc.fa > 0.3)) parts.push("you two line up on this one");
  } else {
    const seat = state.who === "b" && pb.n ? "b" : "a";
    const ev = evidenceFor(t, seat === "a" ? pa : pb, 2);
    if (ev.length) parts.push("Because you rated " + ev.map(x => `<b>${esc(x.e.t.title)}</b>`).join(" and ") + (ev[0].shared.length ? ` — shares ${esc(uniq(ev[0].shared).slice(0, 3).join(", "))}` : ""));
  }
  if (!parts.length) {
    // Cold start: say something true about the title rather than repeating the
    // same instruction down the whole list. The lede already explains why.
    const bits = [];
    if (t.rt != null) bits.push(`${t.rt}% on Rotten Tomatoes`);
    if (t.mc != null) bits.push(`Metacritic ${t.mc}`);
    if (t.director.length) bits.push(`${t.t === "movie" ? "directed" : "created"} by ${esc(t.director[0])}`);
    if (!bits.length) bits.push(`covered by ${t.reach || 0} Wikipedias`);
    return bits.join(" · ");
  }
  return parts.join(" · ");
}

// ---------------------------------------------------------------- pieces
function titleSizeClass(title) { return title.length > 34 ? " vlong" : title.length > 20 ? " long" : ""; }

// A generated poster. As a button it opens the title; as a span or div it is
// decoration inside something else that is already clickable.
// Real artwork from TMDB when this build has it, laid over the generated poster,
// which stays underneath as the placeholder and as the fallback if an image
// can't load. Portrait posters already carry their title, so the typeset title
// hides once one has loaded; wide backdrops don't, so it stays.
const LOADED = new Set();
function artHTML(t, size) {
  const wide = size === "wide" && t.backdrop;
  const path = wide ? t.backdrop : t.poster;
  if (!path) return { html: "", cls: "" };
  const I = window.TSData.img;
  let src, set, sizes;
  if (wide) { src = I(path, "w780"); set = `${I(path, "w780")} 780w, ${I(path, "w1280")} 1280w`; sizes = "(max-width: 760px) 100vw, 560px"; }
  else if (size === "mini") { src = I(path, "w92"); set = `${I(path, "w92")} 92w, ${I(path, "w185")} 185w`; sizes = "52px"; }
  else if (size === "hero") { src = I(path, "w342"); set = `${I(path, "w342")} 342w, ${I(path, "w500")} 500w, ${I(path, "w780")} 780w`; sizes = "(max-width: 760px) 100vw, 240px"; }
  else { src = I(path, "w342"); set = `${I(path, "w185")} 185w, ${I(path, "w342")} 342w, ${I(path, "w500")} 500w`; sizes = "(max-width: 760px) 46vw, 180px"; }
  const kind = wide ? "bd" : "img";
  const done = LOADED.has(src);
  return {
    html: `<img class="p-img" src="${src}" srcset="${set}" sizes="${sizes}" alt="" data-kind="${kind}"${size === "hero" || size === "wide" ? "" : ` loading="lazy"`} decoding="async">`,
    cls: done ? ` has-${kind} instant` : ""
  };
}
function posterHTML(t, opts) {
  opts = opts || {};
  const art = artHTML(t, opts.size);
  const tag = opts.tag || "button";
  const attrs = tag === "button"
    ? ` type="button" data-open="${t.id}" aria-label="${esc(t.title)}, ${yearLabel(t)}: open details"`
    : ` aria-hidden="true"`;
  let inner = "";
  if (!opts.bare) {
    const e = getEntry(t.id);
    const dots = seatsOn().filter(s => e.w[s]).map(s => `<i class="${s}"></i>`).join("");
    inner = `<span class="p-k">${t.t === "movie" ? "Film" : "Series"}</span>`
      + `<span class="p-y">${yearLabel(t)}</span>`
      + (dots ? `<span class="p-dots" title="Rated">${dots}</span>` : "")
      + `<span class="p-t${titleSizeClass(t.title)}">${esc(t.title)}</span>`
      + `<span class="p-s">${esc(t.director.slice(0, 2).join(", ") || t.genres.slice(0, 2).join(", "))}</span>`;
  }
  return `<${tag} class="poster${art.cls}"${attrs} style="${window.TSPoster.style(t)}">${art.html}${inner}</${tag}>`;
}

function gaugeHTML(sc, large) {
  const n = v => clamp((v + 1.4) / 3.4, 0.04, 1);
  const cls = "gauge" + (large ? " lg" : "");
  if (solo() || sc.fb == null) return `<span class="${cls} solo" style="--ga:${n(sc.fa).toFixed(3)}" aria-hidden="true"><i class="g-a"></i><i class="g-b"></i></span>`;
  const a = n(sc.fa), b = n(sc.fb);
  return `<span class="${cls}" style="--ga:${a.toFixed(3)};--gb:${b.toFixed(3)};--gm:${Math.min(a, b).toFixed(3)}" aria-hidden="true"><i class="g-a"></i><i class="g-b"></i></span>`;
}
function gaugeLabel(sc, c) {
  c = c || profiles();
  const na = c.a.movie.n, nb = c.b.movie.n;
  if (solo() || sc.fb == null) return na ? `fit ${fitWord(sc.fa)}` : "not rated yet";
  // With nothing rated on one side both bars sit at zero, which is not agreement.
  if (!na || !nb) return "one seat empty";
  // Agreement is about whether both clear the bar, not about the raw gap:
  // two strong fits of different strength are still two people who'd enjoy it.
  const lo = Math.min(sc.fa, sc.fb), hi = Math.max(sc.fa, sc.fb);
  if (lo >= 0.6) return "you both like it";
  if (hi >= 0.6 && lo < 0.1) return "you differ";
  if (lo >= 0.1) return "mostly agree";
  return "a long shot";
}
function fitWord(v) { return v >= 0.6 ? "strong" : v >= 0.1 ? "fair" : v > -0.4 ? "weak" : "poor"; }
function fitLegendHTML(sc, c) {
  const na = c.a.movie.n, nb = c.b.movie.n;
  const row = (colour, k, v) => `<div><i style="background:var(--${colour})"></i><span class="k">${k}</span><span class="v">${v}</span></div>`;
  let h = row("a", esc(nameOf("a")), na ? fitWord(sc.fa) : "no ratings yet");
  if (!solo()) {
    h += row("b", esc(nameOf("b")), nb ? fitWord(sc.fb) : "no ratings yet");
    h += row("ink", "Together", gaugeLabel(sc, c));
  }
  return `<div class="fit-legend">${h}</div>`;
}
function scoreChips(t, full) {
  const L = links(t);
  const chip = (href, label, val, suffix, title) => val == null
    ? (full ? `<span class="score na"><i>${label}</i><b>—</b></span>` : "")
    : `<a class="score" href="${href}" target="_blank" rel="noopener" title="${esc(title)}"><i>${label}</i><b>${val}${suffix || ""}</b></a>`;
  const reach = `<a class="score" href="${L.wikidata}" target="_blank" rel="noopener" title="Covered by ${t.reach} Wikipedia language editions: how widely known it is, not how good"><i>Reach</i><b>${t.reach || 0}</b></a>`;
  if (!full) {
    const got = chip(L.rt, "RT", t.rt, "%", "Rotten Tomatoes, as recorded in Wikidata. Opens a search so you can check today's number")
      + chip(L.mc, "MC", t.mc, "", "Metacritic, as recorded in Wikidata. Opens a search so you can check today's number");
    return `<div class="scores">${got || reach}</div>`;
  }
  return `<div class="scores">${chip(L.rt, "Rotten Tomatoes", t.rt, "%", "Recorded in Wikidata; opens a search")}${chip(L.mc, "Metacritic", t.mc, "", "Recorded in Wikidata; opens a search")}${reach}${t.imdb ? `<a class="score" href="${L.imdb}" target="_blank" rel="noopener" title="Ratings aren't in this dataset; the page has one"><i>IMDb</i><b>page ↗</b></a>` : ""}</div>`;
}

function cardHTML(t, opts) {
  const e = getEntry(t.id);
  const onList = e.list.a || e.list.b;
  const reason = opts && opts.reason ? `<div class="c-reason">${esc(opts.reason)}</div>` : "";
  return `<article class="card" data-id="${t.id}">
    ${posterHTML(t)}
    <div class="c-body">
      ${reason}
      <div class="c-meta"><span>${esc(t.genres.slice(0, 2).join(" · ") || "—")}</span><span>${runtimeLabel(t)}</span></div>
      ${scoreChips(t)}
      ${whereStrip(t)}
      <div class="actions">
        <button type="button" class="btn sm${onList ? " is-on" : ""}" data-act="list" data-id="${t.id}"><svg class="ic"><use href="#i-bookmark"/></svg>${onList ? "Saved" : "Save"}</button>
        ${trailerBtn(t, "btn sm")}
      </div>
    </div>
  </article>`;
}

// ---------------------------------------------------------------- shell
function renderAll() { syncChrome(); renderTab(); }
function syncChrome() {
  const who = [["a", nameOf("a")]];
  if (!solo()) { who.push(["b", nameOf("b")]); who.push(["both", "Both"]); }
  if (solo() && state.who !== "a") state.who = "a";
  $("#whoSeg").innerHTML = who.map(([k, n]) => `<button type="button" data-who="${k}">${esc(n)}</button>`).join("");
  $$("#whoSeg button").forEach(b => b.classList.toggle("is-on", b.dataset.who === state.who));
  $$("#typeSeg button").forEach(b => b.classList.toggle("is-on", b.dataset.type === state.type));
  $$("#tabs button").forEach(b => { const on = b.dataset.tab === state.tab; b.classList.toggle("is-on", on); b.setAttribute("aria-current", on ? "page" : "false"); });
  $$(".panel").forEach(p => { p.hidden = p.dataset.panel !== state.tab; });
  $("#dataNote").textContent = state.libReady
    ? `${TITLES.length.toLocaleString()} titles · updated ${BUILT}` + (state.extraReady ? "" : " · loading summaries…")
    : "Loading the library…";
  $("#themeBtn").innerHTML = `<svg class="ic"><use href="#i-${currentTheme() === "dark" ? "sun" : "moon"}"/></svg>`;
}
function renderTab() {
  if (!state.libReady) return;   // skeletons stay up until the library lands
  ({ match: renderMatch, rate: renderRate, browse: renderBrowse, map: renderMap, ask: renderAskTab, you: renderYou }[state.tab] || renderMatch)();
}

// ---------------------------------------------------------------- match
function candidates() {
  const c = profiles();
  return TITLES.filter(t => typeOK(t) && kidsOK(t) && openFor(getEntry(t.id), state.who))
    .sort((x, y) => c.scores[y.id].total - c.scores[x.id].total);
}
function metaSpans(t) {
  return `<span>${yearLabel(t)}</span><span>${runtimeLabel(t)}</span><span>${esc(t.genres.slice(0, 3).join(", ") || "—")}</span>`
    + (t.lang && t.lang !== "en" ? `<span>${esc(langName(t.lang))}</span>` : "")
    + (t.rt != null ? `<span>RT ${t.rt}%</span>` : t.mc != null ? `<span>MC ${t.mc}</span>` : "");
}
// In the pair's list, a title one of them has already seen stays a candidate
// (showing it to the other is the point), but the row says so.
function seenNote(t) {
  if (state.who !== "both" || solo()) return "";
  const e = getEntry(t.id), who = seatsOn().filter(x => e.w[x]);
  return who.length === 1 ? `<span class="seen-by">${esc(nameOf(who[0]))} has seen it</span>` : "";
}
function heroHTML(t, c) {
  const sc = c.scores[t.id], L = links(t), e = getEntry(t.id), onList = e.list.a || e.list.b;
  return `<article class="hero">
    ${posterHTML(t, { size: "hero" })}
    <div class="hero-body">
      <div class="hero-k"><span class="pip"></span>Tonight's pick</div>
      <h2 class="hero-t">${esc(t.title)}</h2>
      <div class="hero-meta">${metaSpans(t)}${seenNote(t)}</div>
      ${t.hook ? `<p class="hero-hook">${esc(t.hook)}</p>` : ""}
      <div class="hero-why">${reasonHTML(t, c)}</div>
      ${whereStrip(t)}
      <div class="hero-fit">${gaugeHTML(sc, true)}${fitLegendHTML(sc, c)}</div>
      <div class="hero-cta">
        <button type="button" class="btn primary" data-open="${t.id}">See details</button>
        ${trailerBtn(t, "btn")}
        ${(() => { const m = onMyServices(t); return m.length ? `<a class="btn" href="${esc(serviceLink(m[0], t))}" target="_blank" rel="noopener">Watch on ${esc(providerName(m[0]))} <svg class="ic"><use href="#i-ext"/></svg></a>` : ""; })()}
        <button type="button" class="btn${onList ? " is-on" : ""}" data-act="list" data-id="${t.id}"><svg class="ic"><use href="#i-bookmark"/></svg>${onList ? "Saved" : "Save"}</button>
      </div>
    </div>
  </article>`;
}
function runRowHTML(t, c, rank) {
  const sc = c.scores[t.id];
  return `<button type="button" class="run-row" data-open="${t.id}">
    <span class="run-n">${rank}</span>
    ${posterHTML(t, { tag: "span", bare: true, size: "mini" })}
    <span class="run-main">
      <span class="run-t">${esc(t.title)}</span>
      <span class="run-meta">${metaSpans(t)}${seenNote(t)}</span>
      <span class="run-why">${reasonHTML(t, c)}</span>
    </span>
    <span class="run-side"><span class="run-label">${gaugeLabel(sc, c)}</span>${gaugeHTML(sc)}</span>
  </button>`;
}
function renderMatch() {
  const c = profiles();
  // Each profile already counts every rated title, so one of them is the
  // total; adding movie and series together would count each rating twice.
  const na = c.a.movie.n, nb = c.b.movie.n;
  const recs = candidates();
  const h = $("#matchTitle"), l = $("#matchLede");
  if (state.who === "both" && !solo()) {
    $("#matchEyebrow").textContent = `${nameOf("a")} + ${nameOf("b")}`;
    h.textContent = "What you'll both enjoy";
    l.innerHTML = nb && na
      ? `Weighing ${na} rating${na === 1 ? "" : "s"} from ${esc(nameOf("a"))} against ${nb} from ${esc(nameOf("b"))}. Each pick shows two bars, one per person, and a line at the level you both clear — that line is what the list is sorted by.`
      : `${esc(nameOf(nb ? "a" : "b"))} hasn't rated anything yet, so this is still one person's taste. Open <strong>Rate</strong> and switch seats, or send a link from <strong>Seats</strong>.`;
  } else {
    const seat = state.who === "b" ? "b" : "a", n = seat === "b" ? nb : na;
    $("#matchEyebrow").textContent = nameOf(seat);
    h.textContent = solo() ? "Picked for you" : `Picked for ${nameOf(seat)}`;
    l.textContent = n
      ? `From ${n} rating${n === 1 ? "" : "s"}. Series ratings shape film picks, and the other way round, at ${Math.round(state.prefs.settings.cross * 100)}% weight.`
      : `Nothing rated yet, so these are the best-reviewed and best-known titles. Rate a handful and the order changes straight away.`;
  }
  const body = $("#matchBody");
  if (!recs.length) { body.innerHTML = `<div class="empty">Everything here has been rated. Switch the film/series filter, or clear a rating from <strong>Browse</strong>.</div>`; return; }
  let out = heroHTML(recs[0], c);
  out += `<section class="sec"><div class="sec-head"><h2>Up next</h2><span class="count">${(recs.length - 1).toLocaleString()} more candidates</span></div><div class="run">${recs.slice(1, 11).map((t, i) => runRowHTML(t, c, i + 2)).join("")}</div></section>`;
  const used = new Set(recs.slice(0, 11).map(t => t.id));
  for (const g of GENRE_ORDER) {
    const items = recs.filter(t => !used.has(t.id) && t.genres.includes(g)).slice(0, 12);
    if (items.length < 4) continue;
    const affA = (c.a.movie.genre[g] || 0) + (c.a.series.genre[g] || 0);
    const affB = (c.b.movie.genre[g] || 0) + (c.b.series.genre[g] || 0);
    let why = "";
    if (!solo() && state.who === "both" && (affA || affB)) why = (affA > 0.3 && affB > 0.3) ? "you both rate this well" : affA > affB ? `more ${nameOf("a")}'s kind of thing` : `more ${nameOf("b")}'s kind of thing`;
    else if (affA > 0.4) why = "you rate this well";
    out += `<section class="sec"><div class="sec-head"><h2>${esc(g)}</h2>${why ? `<span class="why">${esc(why)}</span>` : ""}</div><div class="rail">${items.map(t => cardHTML(t)).join("")}</div></section>`;
  }
  body.innerHTML = out;
}

// ---------------------------------------------------------------- rate
const RATE_GOAL = 20;
function deckQueue() {
  const seat = state.deck.seat;
  const c = profiles();
  const pool = TITLES.filter(t => { const e = getEntry(t.id); return typeOK(t) && kidsOK(t) && !e.w[seat] && !e.skip[seat]; });
  // Best-known first, so people meet titles they can actually judge; once a
  // profile exists, things that fit it rise so the deck stops feeling random.
  // The key is computed once per title: inside the comparator it would run
  // fitFor a few hundred thousand times on a full-size library.
  const p = c[seat];
  const rated = p.movie.n > 0;
  const key = new Map();
  for (const t of pool) key.set(t, recognisable(t) + (rated ? fitFor(t, p[t.t]) * 0.4 : 0));
  pool.sort((x, y) => key.get(y) - key.get(x));
  // Round-robin over lead genre so the first twenty cards are not all one kind.
  const byGenre = {};
  for (const t of pool.slice(0, 600)) (byGenre[t.genres[0] || "—"] || (byGenre[t.genres[0] || "—"] = [])).push(t);
  const keys = Object.keys(byGenre), out = [];
  for (let i = 0; out.length < 120 && i < 60; i++) for (const k of keys) if (byGenre[k][i]) out.push(byGenre[k][i]);
  return out;
}
function renderRate() {
  const seat = state.deck.seat;
  const body = $("#rateBody");
  const queue = deckQueue();
  const count = s => TITLES.reduce((n, t) => n + (getEntry(t.id).w[s] ? 1 : 0), 0);
  const whose = `<div class="deck-whose"><span class="lbl">Rating as</span>
    <div class="seg who" role="group" aria-label="Whose ratings">${seatsOn().map(s => `<button type="button" data-deckseat="${s}" data-who="${s}"${s === seat ? ' class="is-on"' : ""}>${esc(nameOf(s))}</button>`).join("")}</div></div>`;
  const meters = seatsOn().map(s => {
    const n = count(s), w = Math.min(100, n / RATE_GOAL * 100);
    return `<div class="meter-row"><span>${esc(nameOf(s))}</span><span>${n} / ${RATE_GOAL}</span></div><div class="meter-bar"><i style="width:${w}%;background:var(--${s})"></i></div>`;
  }).join("");
  const side = `<aside class="deck-side">
    <div class="meter"><h3>How well it knows you</h3><p>Around ${RATE_GOAL} ratings each and the match stops guessing.</p>${meters}</div>
    <div class="meter"><h3>Shortcuts</h3><p class="keys"><kbd>1</kbd>–<kbd>5</kbd> rate &nbsp; <kbd>→</kbd> haven't seen &nbsp; <kbd>←</kbd> undo<br>On a phone, swipe the card left to skip and right to undo.</p></div>
  </aside>`;
  if (!queue.length) {
    body.innerHTML = `${whose}<div class="deck-wrap"><div class="empty">Nothing left to show ${esc(nameOf(seat))} here. Switch seats, change the film/series filter, or head to <strong>Match</strong>.</div>${side}</div>`;
    return;
  }
  const t = queue[0], L = links(t);
  body.innerHTML = `${whose}
  <div class="deck-wrap">
    <div class="deck">
      <div class="deck-card">
        ${posterHTML(t, { tag: "div", size: "wide" })}
        <div class="deck-body">
          <p class="deck-hook">${t.hook ? esc(t.hook) : state.extraReady ? "<em>No summary recorded for this one.</em>" : "<em>Loading summary…</em>"}</p>
          <div class="deck-meta">${metaSpans(t)}</div>
          <div class="row5" role="group" aria-label="How much did ${esc(nameOf(seat))} like it">
            ${SCALE.map(s => `<button type="button" data-act="rate" data-v="${s.v}" data-id="${t.id}"><span class="n">${s.v}</span><span class="l">${s.label}</span></button>`).join("")}
          </div>
          <div class="deck-skip">
            <button type="button" class="btn" data-act="skip" data-id="${t.id}">Haven't seen it</button>
            ${state.deck.history.length ? `<button type="button" class="btn ghost" data-act="undo"><svg class="ic"><use href="#i-undo"/></svg>Undo</button>` : ""}
            ${trailerBtn(t, "btn ghost")}
          </div>
        </div>
      </div>
    </div>
    ${side}
  </div>`;
}
// Let the card leave before the next one is dealt. A second press during the
// animation is ignored, so a fast double-tap can't rate two titles at once.
function animateDeck(cls, fn) {
  const card = $("#rateBody .deck-card");
  if (state.deck.busy) return;
  if (!card || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return fn();
  state.deck.busy = true;
  card.classList.add(cls);
  setTimeout(() => { state.deck.busy = false; fn(); }, 170);
}

// ---------------------------------------------------------------- browse
function searchText(t) {
  if (t._s) return t._s;
  t._s = [t.title, ...t.director, ...t.cast, ...t.genres, ...t.tags, ...t.country, langName(t.lang), ...t.places.map(p => p.name)].join(" | ").toLowerCase();
  return t._s;
}
function cycle3(f, inKey, outKey, v) {
  const inc = f[inKey], out = f[outKey];
  if (inc.includes(v)) { inc.splice(inc.indexOf(v), 1); out.push(v); }
  else if (out.includes(v)) out.splice(out.indexOf(v), 1);
  else inc.push(v);
}
const chipState = (f, i, o, v) => f[i].includes(v) ? " is-on" : f[o].includes(v) ? " neg is-on" : "";
const chipTitle = (f, i, o, v, noun) => f[i].includes(v) ? `Kept — tap to exclude this ${noun}` : f[o].includes(v) ? "Excluded — tap to clear" : `Tap to keep only this ${noun}`;

function filteredTitles() {
  const f = state.filters, c = profiles(), q = f.q.trim().toLowerCase();
  const out = TITLES.filter(t => {
    if (!typeOK(t)) return false;
    if (q && !searchText(t).includes(q)) return false;
    if (t.year < f.yearFrom || t.year > f.yearTo) return false;
    if (f.genres.length && !f.genres.every(g => t.genres.includes(g))) return false;
    if (f.genresOut.length && f.genresOut.some(g => t.genres.includes(g))) return false;
    if (f.langs.length && !f.langs.includes(t.lang)) return false;
    if (f.langsOut.length && f.langsOut.includes(t.lang)) return false;
    if (f.countries.length && !t.country.some(x => f.countries.includes(x))) return false;
    if (f.countriesOut.length && t.country.some(x => f.countriesOut.includes(x))) return false;
    const chk = (v, min) => min > 0 ? (v == null ? !f.require : v >= min) : true;
    if (!chk(t.rt, f.minRt) || !chk(t.mc, f.minMc)) return false;
    if (f.require && t.rt == null && t.mc == null) return false;
    const e = getEntry(t.id);
    if (f.status === "unrated" && anyRated(e)) return false;
    if (f.status === "rated" && !anyRated(e)) return false;
    if (f.status === "list" && !(e.list.a || e.list.b)) return false;
    if (f.status === "ours" && !onMyServices(t).length) return false;
    if (f.status === "favs") {
      const fv = state.prefs.favorites;
      if (!t.director.some(d => fv.directors.includes(d)) && !t.cast.some(a => fv.actors.includes(a))) return false;
    }
    return true;
  });
  const len = t => t.t === "movie" ? (t.runtime || 999) : (t.seasons ? t.seasons * 400 : 500);
  const by = {
    fit: (a, b) => c.scores[b.id].total - c.scores[a.id].total,
    acclaim: (a, b) => (b.rt != null ? b.rt : b.mc != null ? b.mc : -1) - (a.rt != null ? a.rt : a.mc != null ? a.mc : -1),
    reach: (a, b) => (b.reach || 0) - (a.reach || 0),
    year: (a, b) => b.year - a.year || (b.reach || 0) - (a.reach || 0),
    short: (a, b) => len(a) - len(b),
    title: (a, b) => a.title.localeCompare(b.title)
  };
  return out.sort(by[f.sort] || by.fit);
}
function renderBrowse(keepPage) {
  if (!keepPage) state.browsePage = 1;
  const f = state.filters;
  const gc = {}, lc = {}, cc = {};
  for (const t of TITLES) {
    if (!typeOK(t)) continue;
    for (const g of t.genres) gc[g] = (gc[g] || 0) + 1;
    if (t.lang) lc[t.lang] = (lc[t.lang] || 0) + 1;
    for (const x of t.country) cc[x] = (cc[x] || 0) + 1;
  }
  const genreList = GENRE_ORDER.filter(g => gc[g]).concat(Object.keys(gc).filter(g => !GENRE_ORDER.includes(g)).sort((a, b) => gc[b] - gc[a]).slice(0, 10));
  $("#genreChips").innerHTML = genreList.map(g => `<button type="button" class="chip${chipState(f, "genres", "genresOut", g)}" data-genre="${esc(g)}" title="${chipTitle(f, "genres", "genresOut", g, "genre")}">${esc(g)}<span class="n">${gc[g]}</span></button>`).join("");
  const langOrder = Object.keys(lc).filter(Boolean).sort((a, b) => lc[b] - lc[a]);
  const langShown = state.langsOpen ? langOrder : langOrder.filter((l, i) => i < 12 || f.langs.includes(l) || f.langsOut.includes(l));
  $("#langChips").innerHTML = langShown.map(l => `<button type="button" class="chip${chipState(f, "langs", "langsOut", l)}" data-lang="${esc(l)}" title="${chipTitle(f, "langs", "langsOut", l, "language")}">${esc(langName(l))}<span class="n">${lc[l]}</span></button>`).join("")
    + (langOrder.length > langShown.length ? `<button type="button" class="chip more-chip" data-showall="langs">+${langOrder.length - langShown.length} more</button>` : state.langsOpen ? `<button type="button" class="chip more-chip" data-showall="langs">fewer</button>` : "");
  const cOrder = Object.keys(cc).sort((a, b) => cc[b] - cc[a]);
  const cShown = state.countriesOpen ? cOrder : cOrder.filter((x, i) => i < 14 || f.countries.includes(x) || f.countriesOut.includes(x));
  $("#countryChips").innerHTML = cShown.map(x => `<button type="button" class="chip${chipState(f, "countries", "countriesOut", x)}" data-country="${esc(x)}" title="${chipTitle(f, "countries", "countriesOut", x, "country")}">${esc(x)}<span class="n">${cc[x]}</span></button>`).join("")
    + (cOrder.length > cShown.length ? `<button type="button" class="chip more-chip" data-showall="countries">+${cOrder.length - cShown.length} more</button>` : state.countriesOpen ? `<button type="button" class="chip more-chip" data-showall="countries">fewer</button>` : "");
  const active = f.genres.length + f.genresOut.length + f.langs.length + f.langsOut.length + f.countries.length + f.countriesOut.length + (f.status !== "any") + (f.minRt > 0) + (f.minMc > 0) + (f.yearFrom > 2000) + (f.yearTo < 2026);
  $("#filtersToggle").textContent = active ? `Filters · ${active}` : "Filters";
  $("#sort").value = f.sort; $("#status").value = f.status; $("#q").value = f.q;
  $("#minRt").value = f.minRt; $("#minMc").value = f.minMc; $("#yearFrom").value = f.yearFrom; $("#yearTo").value = f.yearTo;
  $("#requireScores").checked = f.require;
  $("#rtOut").textContent = f.minRt > 0 ? f.minRt + "%" : "any";
  $("#mcOut").textContent = f.minMc > 0 ? f.minMc : "any";
  $("#yearFromOut").textContent = f.yearFrom; $("#yearToOut").textContent = f.yearTo;
  save();
  const list = filteredTitles();
  $("#browseCount").textContent = `${list.length.toLocaleString()} of ${TITLES.filter(typeOK).length.toLocaleString()}` + (f.sort === "fit" ? ` · sorted by fit for ${state.who === "both" ? "both of you" : nameOf(state.who)}` : "");
  const shown = list.slice(0, PAGE * state.browsePage);
  $("#browseGrid").innerHTML = shown.length ? shown.map(cardHTML).join("") : `<div class="empty">Nothing matches. <strong>Reset filters</strong> to start over.</div>`;
  const left = list.length - shown.length;
  $("#browseMore").innerHTML = left > 0 ? `<button type="button" class="btn ghost" data-more="browse">Show ${Math.min(PAGE, left)} more</button><span>${left.toLocaleString()} more match</span>` : "";
}

// ---------------------------------------------------------------- map
function mapPoints() {
  const groups = {};
  for (const t of TITLES) {
    if (!typeOK(t) || !t.places.length) continue;
    const e = getEntry(t.id), rated = anyRated(e);
    if (state.mapSeen === "rated" && !rated) continue;
    if (state.mapSeen === "unrated" && rated) continue;
    for (const p of t.places) {
      if (state.mapKind !== "all" && p.kind !== state.mapKind) continue;
      const key = p.name.toLowerCase().replace(/\s*\(.*\)$/, "");
      const g = groups[key] || (groups[key] = { key, lat: p.lat, lng: p.lng, name: p.name, short: p.name.split(/[,(]/)[0].trim(), titles: [], seenCount: 0 });
      if (!g.titles.some(x => x.t.id === t.id)) { g.titles.push({ t, kind: p.kind, name: p.name }); if (rated) g.seenCount++; }
    }
  }
  return Object.values(groups).map(g => ({ ...g, count: g.titles.length, tone: g.seenCount === 0 ? "" : g.seenCount === g.titles.length ? "rated" : "mixed" }));
}
// About 400 KB the other five tabs never need, so it waits until the map opens.
let mapLibs = null;
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src; el.async = true;
    el.onload = resolve; el.onerror = () => reject(new Error("couldn't load " + src));
    document.head.appendChild(el);
  });
}
function ensureMapLibs() {
  if (!mapLibs) {
    mapLibs = Promise.all([
      loadScript("https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js"),
      loadScript("https://cdnjs.cloudflare.com/ajax/libs/topojson/3.0.2/topojson.min.js"),
      loadScript((window.TS_ASSETS || {}).world || "data/world.js")
    ]).catch(err => { mapLibs = null; throw err; });
  }
  return mapLibs;
}
function setMapNote(text) {
  const frame = $(".map-frame");
  let note = frame.querySelector(".map-loading");
  if (text == null) { if (note) note.hidden = true; return; }
  if (!note) { frame.insertAdjacentHTML("beforeend", `<div class="map-loading"></div>`); note = frame.querySelector(".map-loading"); }
  note.hidden = false;
  note.textContent = text;
}
function renderMap() {
  $$("#mapKind button").forEach(b => b.classList.toggle("is-on", b.dataset.kind === state.mapKind));
  $$("#mapSeen button").forEach(b => b.classList.toggle("is-on", b.dataset.seen === state.mapSeen));
  if (!state.extraReady) { $("#mapSide").innerHTML = `<p class="hint">Loading locations…</p>`; return; }
  if (!window.d3 || !window.topojson || !window.WORLD_TOPO) {
    setMapNote("Loading the map…");
    ensureMapLibs()
      .then(() => { setMapNote(null); if (state.tab === "map") renderMap(); })
      .catch(() => setMapNote("The map couldn't load. The list of places still works."));
    return renderMapSide(mapPoints());
  }
  if (!state.mapReady) {
    window.TSMap.init($("#map"),
      key => { state.mapSel = state.mapSel === key ? null : key; state.mapMulti = null; renderMap(); },
      keys => { state.mapMulti = keys; state.mapSel = null; renderMap(); });
    state.mapReady = true;
  }
  const pts = mapPoints();
  window.TSMap.setPoints(pts, state.mapSel);
  renderMapSide(pts);
}
function renderMapSide(pts) {
  const side = $("#mapSide");
  const legend = `<div class="map-legend"><span><i style="background:var(--a)"></i>not rated</span><span><i style="background:var(--b)"></i>rated</span><span><i style="background:var(--ink)"></i>some rated</span><span><i style="background:var(--ink3)"></i>cluster</span></div>`;
  const sel = pts.find(p => p.key === state.mapSel);
  if (sel) {
    side.innerHTML = `${legend}<h3>${esc(sel.name)}</h3><p class="hint">${sel.count} title${sel.count === 1 ? "" : "s"} · <button type="button" class="link" id="mapClear">show all places</button></p>
      <div class="place-list">${sel.titles.map(x => `<button type="button" class="place-row" data-open="${x.t.id}"><span>${esc(x.t.title)}<small>${yearLabel(x.t)} · ${x.kind === "set" ? "set here" : "filmed here"}${x.name !== sel.name ? " · " + esc(x.name) : ""}</small></span><span class="n">${x.t.rt != null ? x.t.rt + "%" : ""}</span></button>`).join("")}</div>`;
    return;
  }
  const multi = state.mapMulti ? new Set(state.mapMulti) : null;
  const top = pts.filter(p => !multi || multi.has(p.key)).sort((a, b) => b.count - a.count).slice(0, multi ? 200 : 40);
  const noPlace = TITLES.filter(t => typeOK(t) && !t.places.length).length;
  const head = multi
    ? `<h3>${top.length} places here</h3><p class="hint"><button type="button" class="link" id="mapClear">show all places</button></p>`
    : `<h3>Places</h3><p class="hint">${pts.length.toLocaleString()} places · ${noPlace.toLocaleString()} titles have no recorded location · grey circles are clusters, click to zoom in</p>`;
  side.innerHTML = `${legend}${head}<div class="place-list">${top.map(p => `<button type="button" class="place-row" data-place="${esc(p.key)}"><span>${esc(p.name)}<small>${esc(p.titles.slice(0, 3).map(x => x.t.title).join(", "))}${p.count > 3 ? "…" : ""}</small></span><span class="n">${p.count}</span></button>`).join("")}</div>`;
}

// ---------------------------------------------------------------- ask
function renderAskTab() {
  if (!window.TSAsk) { $("#askBody").innerHTML = `<div class="empty">The Ask module didn't load.</div>`; return; }
  window.TSAsk.render({
    titles: TITLES, byId: BY_ID, state, cardHTML, profiles, openFor, getEntry, kidsOK,
    people: ALL_PEOPLE, langName, GENRE_ORDER, esc, toast, nameOf, solo
  });
}

// ---------------------------------------------------------------- seats
function renderYou() {
  const f = state.prefs.favorites, g = state.prefs.genres, st = state.prefs.settings, c = profiles();
  const favList = (kind, arr) => arr.length
    ? `<div class="chips">${arr.map(n => `<button type="button" class="chip is-on" data-unfav="${kind}" data-name="${esc(n)}" title="Remove">${esc(n)} ×</button>`).join("")}</div>`
    : `<p class="hint">None yet. Type a name above, or tap a name on any title.</p>`;
  const bars = seat => {
    const p = c[seat], merged = {};
    for (const k of ["movie", "series"]) for (const name in p[k].genre) merged[name] = (merged[name] || 0) + p[k].genre[name] / 2;
    const rows = Object.entries(merged).sort((x, y) => Math.abs(y[1]) - Math.abs(x[1])).slice(0, 8);
    if (!rows.length) return `<p class="hint">${esc(nameOf(seat))} hasn't rated anything yet.</p>`;
    const max = Math.max(1, ...rows.map(r => Math.abs(r[1])));
    return `<div class="bars">${rows.map(([name, v]) => {
      const w = Math.abs(v) / max * 50, left = v >= 0 ? 50 : 50 - w;
      return `<div class="bar"><span>${esc(name)}</span><div class="track"><div class="fill${seat === "b" ? " b" : ""}${v < 0 ? " neg" : ""}" style="left:${left}%;width:${w}%"></div></div><span class="v">${v >= 0 ? "+" : ""}${v.toFixed(1)}</span></div>`;
    }).join("")}</div>`;
  };
  $("#youBody").innerHTML = `
  <div class="col">
    <div class="block"><h2>Names</h2><p>Names show up on the picks and on the share link. Nothing is sent anywhere.</p>
      <div class="stub-names">
        <label class="seat seat-a"><span class="seat-no">Seat A</span><input type="text" id="editA" maxlength="18" value="${esc(state.people.a.name)}" placeholder="Your name"></label>
        <label class="seat seat-b"><span class="seat-no">Seat B</span><input type="text" id="editB" maxlength="18" value="${esc(state.people.b.name)}" placeholder="Their name"${solo() ? " disabled" : ""}></label>
      </div>
      <label class="check" style="margin-top:10px"><input type="checkbox" id="soloToggle"${solo() ? " checked" : ""}> Just one seat — I'm picking for myself</label>
    </div>
    <div class="block"><h2>Send your ratings to the other phone</h2>
      <p>This link carries ${esc(nameOf(state.shareWho || "a"))}'s ratings and nothing else. Open it on the other device and it fills the second seat, so both tastes end up on one screen.</p>
      <div class="seg" role="group" aria-label="Whose ratings to send" style="margin-bottom:10px">${seatsOn().map(s => `<button type="button" data-sharewho="${s}"${s === (state.shareWho || "a") ? ' class="is-on"' : ""}>${esc(nameOf(s))}'s ratings</button>`).join("")}</div>
      <div class="share-box"><input type="text" id="shareLink" readonly placeholder="Make a link…"><button type="button" class="btn" id="makeShare"><svg class="ic"><use href="#i-link"/></svg>Make link</button></div>
      <p class="hint">Long links are normal — the ratings are in the link itself, after the <code>#</code>, which browsers never send to the server.</p>
    </div>
    <div class="block"><h2>Favourite directors and creators</h2><p>Anything they made gets a strong boost.</p>
      <div class="adder"><input type="text" id="addDirector" placeholder="Start typing a name…" autocomplete="off"><div class="sugg" id="suggDirector" hidden></div></div>${favList("directors", f.directors)}</div>
    <div class="block"><h2>Favourite actors</h2><p>A boost per favourite in the cast, capped so a stacked ensemble can't run away with it.</p>
      <div class="adder"><input type="text" id="addActor" placeholder="Start typing a name…" autocomplete="off"><div class="sugg" id="suggActor" hidden></div></div>${favList("actors", f.actors)}</div>
    <div class="block"><h2>Genres</h2><p>Tap once to favour a genre, twice to avoid it, three times to clear.</p>
      <div class="chips">${GENRE_ORDER.map(x => `<button type="button" class="chip${g.like.includes(x) ? " is-on" : ""}${g.avoid.includes(x) ? " neg is-on" : ""}" data-gtoggle="${esc(x)}">${esc(x)}</button>`).join("")}</div>
      <label class="check" style="margin-top:14px"><input type="checkbox" id="kidsToggle"${state.prefs.kids ? " checked" : ""}> Include children's titles in picks</label>
      <p class="hint" style="margin:6px 0 0">Off by default, so a film night isn't full of cartoons. They're always in Browse, and favouring Family above turns them on too.</p></div>
  </div>
  <div class="col">
    <div class="block"><h2>What your ratings say</h2><p>Genre leaning from what each of you rated. Right of the centre line is positive; 3 of 5 is neutral.</p>
      <div class="legend"><span><i style="background:var(--a)"></i>${esc(nameOf("a"))}</span>${solo() ? "" : `<span><i style="background:var(--b)"></i>${esc(nameOf("b"))}</span>`}</div>
      ${bars("a")}${solo() ? "" : bars("b")}
    </div>
    <div class="block"><h2>Dials</h2>
      <label class="slider">How much series ratings shape film picks, and the other way round<output>${Math.round(st.cross * 100)}%</output><input type="range" data-setting="cross" min="0" max="1" step="0.05" value="${st.cross}"></label>
      <label class="slider">Weight of critics' scores against your own ratings<output>${st.quality.toFixed(1)}×</output><input type="range" data-setting="quality" min="0" max="2" step="0.1" value="${st.quality}"></label>
      <label class="slider">Preference for newer titles<output>${Math.round(st.recency * 100)}%</output><input type="range" data-setting="recency" min="0" max="1" step="0.05" value="${st.recency}"></label>
    </div>
    ${servicesBlock()}
    <div class="block"><h2>How the match is scored</h2>
      <dl class="kv">
        <dt>Fit</dt><dd>Your ratings spread over each title's genres, moods, director and cast. 5 is a strong like, 3 neutral, 1 a dislike.</dd>
        <dt>Together</dt><dd>The mean of both fits, minus 0.35 × how far apart they are. Something one of you would love and the other would hate ranks below something you both merely like.</dd>
        <dt>Quality</dt><dd>Rotten Tomatoes and Metacritic where Wikidata records them. Where it records neither, the fallback is reach — how many Wikipedia language editions cover the title — which says how well known it is, not how good.</dd>
        <dt>Favourites</dt><dd>Direct boosts on top of everything else.</dd>
      </dl>
    </div>
    <div class="block"><h2>Your data</h2><p>Everything lives in this browser. Copy it out as a backup, paste it back on another device, or wipe it.</p>
      <textarea id="exportBox" readonly>${esc(JSON.stringify({ people: state.people, entries: state.entries, prefs: state.prefs }))}</textarea>
      <div class="btn-row"><button type="button" class="btn" id="copyExport">Copy backup</button><button type="button" class="btn" id="importBtn">Import pasted backup</button><button type="button" class="btn ghost" id="wipeBtn">Clear everything</button></div>
      <textarea id="importBox" placeholder="Paste a backup here, then press Import"></textarea>
    </div>
  </div>`;
  wireAdder("#addDirector", "#suggDirector", ALL_PEOPLE.directors, "directors");
  wireAdder("#addActor", "#suggActor", ALL_PEOPLE.actors, "actors");
}
function servicesBlock() {
  const regions = window.TSData.regions();
  if (!regions.length) {
    return `<div class="block"><h2>Where to watch</h2><p>${state.mediaReady === false ? "Streaming availability isn't included in this build." : "Loading streaming availability…"}</p></div>`;
  }
  const cc = state.watch ? state.watch.cc : (state.prefs.region || "").toUpperCase();
  const names = regions.map(r => [r, regionName(r)]).sort((a, b) => a[1].localeCompare(b[1]));
  const mine = state.prefs.services || [];
  const top = state.watch ? state.watch.data.top : [];
  const chip = pid => {
    const logo = providerLogo(pid);
    return `<button type="button" class="chip svc${mine.includes(pid) ? " is-on" : ""}" data-service="${pid}">${logo ? `<img src="${logo}" alt="" width="18" height="18" loading="lazy">` : ""}${esc(providerName(pid))}</button>`;
  };
  return `<div class="block"><h2>Where you watch</h2>
    <p>Pick your country and the services you have. Titles on them are marked, Browse can show only those, and each title says where else it streams.</p>
    <select id="regionSel" aria-label="Your country">${names.map(([r, n]) => `<option value="${r}"${r === cc ? " selected" : ""}>${esc(n)}</option>`).join("")}</select>
    ${top.length ? `<div class="chips" style="margin-top:12px">${top.slice(0, 18).map(chip).join("")}</div>` : `<p class="hint">Loading services…</p>`}
    <p class="d-src">Availability from <a href="https://www.justwatch.com/" target="_blank" rel="noopener">JustWatch</a> via <a href="https://www.themoviedb.org/" target="_blank" rel="noopener">TMDB</a>, refreshed weekly.</p>
  </div>`;
}
function wireAdder(inputSel, suggSel, pool, kind) {
  const input = $(inputSel), sugg = $(suggSel);
  if (!input) return;
  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { sugg.hidden = true; return; }
    const names = Object.keys(pool).filter(n => n.toLowerCase().includes(q)).sort((a, b) => pool[b] - pool[a]).slice(0, 8);
    sugg.innerHTML = names.map(n => `<button type="button" data-fav="${kind}" data-name="${esc(n)}"><span>${esc(n)}</span><span class="n">${pool[n]} title${pool[n] === 1 ? "" : "s"}</span></button>`).join("");
    sugg.hidden = !names.length;
  });
  input.addEventListener("keydown", ev => {
    if (ev.key === "Enter") { ev.preventDefault(); addFav(kind, input.value.trim()); input.value = ""; }
    if (ev.key === "Escape") sugg.hidden = true;
  });
}
function addFav(kind, name) {
  if (!name) return;
  const arr = state.prefs.favorites[kind];
  if (!arr.includes(name)) { arr.push(name); state.recCache = null; save(); toast(`${name} added to favourites`); }
  if (state.tab === "you") renderYou();
  if (state.drawerId) renderDrawer();
}
function removeFav(kind, name) {
  const arr = state.prefs.favorites[kind], i = arr.indexOf(name);
  if (i >= 0) { arr.splice(i, 1); state.recCache = null; save(); }
  if (state.tab === "you") renderYou();
  if (state.drawerId) renderDrawer();
}

// ---------------------------------------------------------------- drawer
function openDrawer(id) { state.drawerId = id; $("#scrim").hidden = false; $("#drawer").hidden = false; renderDrawer(); $("#drawer").scrollTop = 0; }
function closeDrawer() { state.drawerId = null; $("#scrim").hidden = true; $("#drawer").hidden = true; }
function renderDrawer() {
  const t = BY_ID[state.drawerId];
  if (!t) return closeDrawer();
  const e = getEntry(t.id), L = links(t), c = profiles();
  const isFav = (k, n) => state.prefs.favorites[k].includes(n);
  const people = (label, kind, arr) => arr.length
    ? `<div class="people-row"><span>${label}</span><span>${arr.map(n => `<button type="button" class="plink${isFav(kind, n) ? " fav" : ""}" data-favtoggle="${kind}" data-name="${esc(n)}" title="${isFav(kind, n) ? "Remove from favourites" : "Add to favourites"}">${esc(n)}${isFav(kind, n) ? " ★" : ""}</button>`).join(", ")}</span></div>`
    : "";
  const rateBlock = seat => {
    const v = e.s[seat], on = e.w[seat];
    return `<div class="rate-block">
      <div class="rate-who"><span class="dot ${seat}"></span><strong>${esc(nameOf(seat))}</strong><span class="hint">${on ? (v == null ? "seen, not scored" : SCALE[v - 1].label) : "hasn't rated it"}</span></div>
      <div class="row5">${SCALE.map(s => `<button type="button" data-act="rate" data-seat="${seat}" data-v="${s.v}" data-id="${t.id}"${v === s.v ? ' class="is-on"' : ""} title="${s.label}"><span class="n">${s.v}</span><span class="l">${s.label}</span></button>`).join("")}</div>
      ${on ? `<div class="deck-skip"><button type="button" class="btn ghost sm" data-act="clearrate" data-seat="${seat}" data-id="${t.id}">Clear ${esc(nameOf(seat))}'s rating</button></div>` : ""}
    </div>`;
  };
  const sc = c.scores[t.id];
  const why = openFor(e, state.who) ? reasonHTML(t, c) : "";
  const onList = e.list.a || e.list.b;
  $("#drawer").innerHTML = `
    <div class="d-hero">
      ${posterHTML(t, { tag: "div", bare: true, size: "wide" })}
      <button type="button" class="close" data-close aria-label="Close details"><svg class="ic"><use href="#i-x"/></svg></button>
      <div class="d-in">
        <div class="kicker">${t.t === "movie" ? "Film" : "Series"} · ${yearLabel(t)} · ${runtimeLabel(t)}${t.lang ? " · " + esc(langName(t.lang)) : ""}</div>
        <h2>${esc(t.title)}</h2>
        <div class="d-cta">
          ${trailerBtn(t, "btn on-poster solid", t.trailer ? "Play trailer" : "Trailer")}
          ${(() => { const m = onMyServices(t); return m.length ? `<a class="btn on-poster" href="${esc(serviceLink(m[0], t))}" target="_blank" rel="noopener">Watch on ${esc(providerName(m[0]))} <svg class="ic"><use href="#i-ext"/></svg></a>` : ""; })()}
          <button type="button" class="btn on-poster" data-act="list" data-id="${t.id}"><svg class="ic"><use href="#i-bookmark"/></svg>${onList ? "Saved" : "Save"}</button>
        </div>
      </div>
    </div>
    <div class="d-body">
      ${t.hook ? `<div class="d-sec"><div class="d-hook">${esc(t.hook)}</div><p class="d-src">Adapted from the <a href="${L.wiki}" target="_blank" rel="noopener">Wikipedia article</a> under CC BY-SA 4.0.</p></div>` : ""}
      ${why ? `<div class="d-sec"><h3>Why it's here</h3><div class="d-why">${why}</div></div>` : ""}
      ${whereFull(t)}
      <div class="d-sec"><h3>Fit</h3><div class="d-fit">${gaugeHTML(sc, true)}${fitLegendHTML(sc, c)}</div></div>
      <div class="d-sec"><h3>Scores</h3>${scoreChips(t, true)}<p class="d-src">As recorded in Wikidata, which can lag the live sites — each opens the source so you can check today's number.</p></div>
      <div class="d-sec"><h3>Rate it</h3>${seatsOn().map(rateBlock).join("")}
        ${anyRated(e) ? `<div style="margin-top:18px"><h3>What stood out</h3><div class="react">${CHIPS.map(ch => `<button type="button" class="chip${(e.chips || []).includes(ch.id) ? " is-on" : ""}" data-act="chip" data-chip="${ch.id}" data-id="${t.id}">${esc(ch.label)}</button>`).join("")}</div></div>
        <div style="margin-top:18px"><h3>Note</h3><textarea data-act="note" data-id="${t.id}" placeholder="Anything to remember…">${esc(e.note)}</textarea></div>` : ""}
      </div>
      <div class="d-sec"><h3>People</h3>${people(t.t === "movie" ? "Director" : "Creator", "directors", t.director)}${people("Cast", "actors", t.cast)}<p class="hint">Tap a name to make it a favourite.</p></div>
      ${t.places.length ? `<div class="d-sec"><h3>Where it happens</h3><div class="places">${t.places.map(p => `<div><svg class="ic"><use href="#i-pin"/></svg>${esc(p.name)}<span class="kind">${p.kind === "set" ? "setting" : "filmed here"}</span></div>`).join("")}</div></div>` : ""}
      <div class="d-sec"><h3>Details</h3><dl class="kv">
        <dt>Genres</dt><dd>${esc(t.genres.join(", ") || "—")}</dd>
        <dt>Moods</dt><dd>${esc(t.tags.map(x => x.replace(/-/g, " ")).join(", ") || "—")}</dd>
        <dt>Country</dt><dd>${esc(t.country.join(", ") || "—")}</dd>
        <dt>Links</dt><dd><div class="d-links"><a href="${L.imdb}" target="_blank" rel="noopener">IMDb</a><a href="${L.wiki}" target="_blank" rel="noopener">Wikipedia</a><a href="${L.wikidata}" target="_blank" rel="noopener">Wikidata</a><a href="${L.rt}" target="_blank" rel="noopener">Rotten Tomatoes</a><a href="${L.mc}" target="_blank" rel="noopener">Metacritic</a>${L.tmdb ? `<a href="${L.tmdb}" target="_blank" rel="noopener">TMDB</a>` : ""}</div></dd>
      </dl></div>
    </div>`;
}

// ---------------------------------------------------------------- theme
function currentTheme() {
  if (state.prefs.theme) return state.prefs.theme;
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}
function applyTheme() {
  if (state.prefs.theme) document.documentElement.setAttribute("data-theme", state.prefs.theme);
  else document.documentElement.removeAttribute("data-theme");
}

// ---------------------------------------------------------------- events
function afterEdit() {
  if (state.tab === "rate") renderRate();
  else if (state.tab !== "ask") renderTab();
  if (state.drawerId) renderDrawer();
  syncChrome();
}
document.addEventListener("click", ev => {
  const b = ev.target.closest("button, a[data-open], a[data-trailer], [data-open], #player");
  if (!b || b.tagName === "A" && !b.dataset.open && !b.dataset.trailer) return;

  if (b.id === "startBtn") return startFromSetup();
  if (b.id === "soloBtn") { $("#nameB").value = ""; state.people.b.on = false; return startFromSetup(); }
  if (b.id === "themeBtn") { state.prefs.theme = currentTheme() === "dark" ? "light" : "dark"; applyTheme(); save(); syncChrome(); return; }

  if (b.dataset.trailer) { const t = BY_ID[b.dataset.trailer]; if (t && t.trailer) { ev.preventDefault(); openTrailer(t); } return; }
  if (b.hasAttribute("data-closeplayer") || b.id === "player") return closeTrailer();
  if (b.dataset.service) {
    const pid = +b.dataset.service, list = state.prefs.services || (state.prefs.services = []);
    const i = list.indexOf(pid);
    if (i >= 0) list.splice(i, 1); else list.push(pid);
    save(); renderYou();
    return;
  }
  if (b.dataset.open) return openDrawer(b.dataset.open);
  if (b.hasAttribute("data-close") || b.id === "scrim") return closeDrawer();
  if (b.dataset.who && b.closest("#whoSeg")) { state.who = b.dataset.who; state.recCache = null; save(); renderAll(); return; }
  if (b.dataset.deckseat) { state.deck.seat = b.dataset.deckseat; state.deck.history = []; save(); renderRate(); return; }
  if (b.dataset.type) { state.type = b.dataset.type; save(); renderAll(); return; }
  if (b.dataset.tab) { state.tab = b.dataset.tab; renderAll(); return; }
  if (b.dataset.sharewho) { state.shareWho = b.dataset.sharewho; renderYou(); return; }
  if (b.id === "makeShare") return makeShareLink();

  if (b.dataset.genre) { cycle3(state.filters, "genres", "genresOut", b.dataset.genre); renderBrowse(); return; }
  if (b.dataset.lang) { cycle3(state.filters, "langs", "langsOut", b.dataset.lang); renderBrowse(); return; }
  if (b.dataset.country) { cycle3(state.filters, "countries", "countriesOut", b.dataset.country); renderBrowse(); return; }
  if (b.dataset.showall) { const k = b.dataset.showall === "langs" ? "langsOpen" : "countriesOpen"; state[k] = !state[k]; renderBrowse(true); return; }
  if (b.id === "filtersToggle") { $("#filters").classList.toggle("is-open"); return; }
  if (b.id === "resetFilters") { state.filters = DEFAULT_FILTERS(); renderBrowse(); return; }
  if (b.dataset.more === "browse") { state.browsePage++; renderBrowse(true); return; }

  if (b.dataset.kind) { state.mapKind = b.dataset.kind; renderMap(); return; }
  if (b.dataset.seen) { state.mapSeen = b.dataset.seen; renderMap(); return; }
  if (b.dataset.place) { state.mapSel = b.dataset.place; state.mapMulti = null; renderMap(); return; }
  if (b.id === "mapClear") { state.mapSel = null; state.mapMulti = null; renderMap(); return; }
  if (b.id === "zoomIn") return window.TSMap && window.TSMap.zoomBy(1.6);
  if (b.id === "zoomOut") return window.TSMap && window.TSMap.zoomBy(1 / 1.6);
  if (b.id === "zoomReset") return window.TSMap && window.TSMap.reset();

  if (b.dataset.fav) { addFav(b.dataset.fav, b.dataset.name); const i = $(b.dataset.fav === "directors" ? "#addDirector" : "#addActor"); if (i) i.value = ""; return; }
  if (b.dataset.unfav) return removeFav(b.dataset.unfav, b.dataset.name);
  if (b.dataset.favtoggle) {
    const k = b.dataset.favtoggle, n = b.dataset.name;
    state.prefs.favorites[k].includes(n) ? removeFav(k, n) : addFav(k, n);
    return;
  }
  if (b.dataset.gtoggle) {
    const g = state.prefs.genres, x = b.dataset.gtoggle;
    if (g.like.includes(x)) { g.like.splice(g.like.indexOf(x), 1); g.avoid.push(x); }
    else if (g.avoid.includes(x)) g.avoid.splice(g.avoid.indexOf(x), 1);
    else g.like.push(x);
    state.recCache = null; save(); renderYou();
    return;
  }
  if (b.id === "copyExport") { const box = $("#exportBox"); box.select(); copy(box.value); return; }
  if (b.id === "importBtn") return importBackup();
  if (b.id === "wipeBtn") {
    if (!confirm("Delete every rating, note, list entry and favourite in this browser? This can't be undone.")) return;
    state.entries = {};
    state.prefs.favorites = { directors: [], actors: [] };
    state.prefs.genres = { like: [], avoid: [] };
    state.recCache = null; save(); renderAll(); toast("Cleared");
    return;
  }

  const act = b.dataset.act;
  if (!act) return;
  const id = b.dataset.id;
  if (act === "rate") {
    const fromDeck = !b.dataset.seat;
    const seat = b.dataset.seat || state.deck.seat;
    const v = +b.dataset.v;
    const go = () => {
      state.deck.history.push({ id, seat, prev: JSON.parse(JSON.stringify(getEntry(id))) });
      editEntry(id, e => { e.w[seat] = true; e.s[seat] = v; e.skip[seat] = false; });
      afterEdit();
    };
    return fromDeck ? animateDeck("out-up", go) : go();
  }
  if (act === "clearrate") {
    const seat = b.dataset.seat;
    editEntry(id, e => { e.w[seat] = false; e.s[seat] = null; });
    afterEdit();
    return;
  }
  if (act === "skip") {
    const seat = state.deck.seat;
    return animateDeck("out-left", () => {
      state.deck.history.push({ id, seat, prev: JSON.parse(JSON.stringify(getEntry(id))) });
      editEntry(id, e => { e.skip[seat] = true; });
      afterEdit();
    });
  }
  if (act === "undo") {
    const last = state.deck.history.pop();
    if (!last) return;
    const empty = !last.prev.w.a && !last.prev.w.b && !last.prev.skip.a && !last.prev.skip.b && !last.prev.list.a && !last.prev.list.b && !last.prev.note && !last.prev.chips.length;
    if (empty) delete state.entries[last.id]; else state.entries[last.id] = last.prev;
    state.recCache = null; save(); afterEdit();
    return;
  }
  if (act === "chip") {
    editEntry(id, e => { const i = e.chips.indexOf(b.dataset.chip); i >= 0 ? e.chips.splice(i, 1) : e.chips.push(b.dataset.chip); });
    afterEdit();
    return;
  }
  if (act === "list") {
    const seat = state.who === "b" ? "b" : "a";
    editEntry(id, e => {
      const on = e.list.a || e.list.b;
      if (on) { e.list.a = false; e.list.b = false; } else e.list[seat] = true;
    });
    const e = getEntry(id);
    toast(e.list.a || e.list.b ? "Added to our list" : "Removed from our list");
    afterEdit();
    return;
  }
});
document.addEventListener("change", ev => {
  const el = ev.target;
  if (el.id === "soloToggle") {
    state.people.b.on = !el.checked;
    if (solo()) { state.who = "a"; state.deck.seat = "a"; }
    state.recCache = null; save(); renderAll();
    return;
  }
  if (el.id === "kidsToggle") { state.prefs.kids = el.checked; state.recCache = null; save(); toast(el.checked ? "Children's titles now included in picks" : "Children's titles left out of picks"); return; }
  if (el.id === "regionSel") {
    state.prefs.region = el.value; state.prefs.services = []; save();
    toast(`Showing availability in ${regionName(el.value)}`);
    ensureWatch();
    return;
  }
  if (el.dataset.setting) { state.prefs.settings[el.dataset.setting] = +el.value; state.recCache = null; save(); renderYou(); return; }
  if (el.id === "sort") state.filters.sort = el.value;
  else if (el.id === "status") state.filters.status = el.value;
  else if (el.id === "requireScores") state.filters.require = el.checked;
  else return;
  renderBrowse();
});
let noteTimer = null, rangeTimer = null, nameTimer = null;
document.addEventListener("input", ev => {
  const el = ev.target;
  if (el.dataset.act === "note") { clearTimeout(noteTimer); noteTimer = setTimeout(() => editEntry(el.dataset.id, e => { e.note = el.value; }), 500); return; }
  if (el.id === "editA" || el.id === "editB") {
    clearTimeout(nameTimer);
    const seat = el.id === "editA" ? "a" : "b", v = el.value;
    nameTimer = setTimeout(() => { state.people[seat].name = v.trim(); save(); syncChrome(); }, 400);
    return;
  }
  if (el.dataset.setting) {
    const out = el.parentElement.querySelector("output"), v = +el.value, k = el.dataset.setting;
    out.textContent = k === "quality" ? v.toFixed(1) + "×" : Math.round(v * 100) + "%";
    return;
  }
  if (el.id === "q") { state.filters.q = el.value; clearTimeout(rangeTimer); rangeTimer = setTimeout(renderBrowseKeepFocus, 180); return; }
  if (el.type === "range" && el.closest("#filters")) {
    const map = { minRt: "minRt", minMc: "minMc", yearFrom: "yearFrom", yearTo: "yearTo" };
    state.filters[map[el.id]] = +el.value;
    if (state.filters.yearFrom > state.filters.yearTo) {
      if (el.id === "yearFrom") state.filters.yearTo = state.filters.yearFrom;
      else state.filters.yearFrom = state.filters.yearTo;
    }
    clearTimeout(rangeTimer);
    rangeTimer = setTimeout(renderBrowseKeepFocus, 120);
  }
});
function renderBrowseKeepFocus() {
  const a = document.activeElement, id = a && a.id, pos = a && a.selectionStart;
  renderBrowse();
  if (!id) return;
  const el = document.getElementById(id);
  if (!el) return;
  el.focus();
  if (pos != null && el.setSelectionRange) { try { el.setSelectionRange(pos, pos); } catch (e) { /* non-text input */ } }
}
document.addEventListener("keydown", ev => {
  if (ev.key === "Escape" && !$("#player").hidden) return closeTrailer();
  if (ev.key === "Escape" && state.drawerId) return closeDrawer();
  if (state.tab !== "rate" || state.drawerId) return;
  if (/^[1-5]$/.test(ev.key)) {
    const btn = $(`#rateBody .row5 button[data-v="${ev.key}"]`);
    if (btn) btn.click();
  } else if (ev.key === "ArrowRight") {
    const btn = $('#rateBody [data-act="skip"]');
    if (btn) btn.click();
  } else if (ev.key === "ArrowLeft") {
    const btn = $('#rateBody [data-act="undo"]');
    if (btn) btn.click();
  }
});
document.addEventListener("click", ev => { if (!ev.target.closest(".adder")) $$(".sugg").forEach(s => { s.hidden = true; }); }, true);

document.addEventListener("load", ev => {
  const el = ev.target;
  if (!el.classList || !el.classList.contains("p-img")) return;
  LOADED.add(el.getAttribute("src"));   // re-renders show it at once, without a fade
  const poster = el.closest(".poster");
  if (poster) poster.classList.add(el.dataset.kind === "bd" ? "has-bd" : "has-img");
}, true);
document.addEventListener("error", ev => {
  const el = ev.target;
  if (!el.classList || el.tagName !== "IMG") return;
  if (el.classList.contains("p-img")) return el.remove();
  // A service logo that won't load: show the name instead of a broken image.
  const a = el.closest(".where a");
  if (a) { a.textContent = a.title.replace(/ \(free\)$/, ""); a.classList.add("txt"); return; }
  if (el.closest(".wf-svc, .chip.svc")) el.remove();
}, true);

// Swipe the rating card sideways on a touch screen: left moves on to the next
// title, right takes back the last one. Same two actions as the arrow keys.
(function wireSwipe() {
  let x0 = null, y0 = null;
  document.addEventListener("touchstart", ev => {
    const card = ev.target.closest(".deck-card");
    if (!card || ev.touches.length !== 1) { x0 = null; return; }
    x0 = ev.touches[0].clientX;
    y0 = ev.touches[0].clientY;
  }, { passive: true });
  document.addEventListener("touchend", ev => {
    if (x0 == null) return;
    const t = ev.changedTouches[0];
    const dx = t.clientX - x0, dy = t.clientY - y0;
    x0 = null;
    // Ignore anything short, and anything more vertical than horizontal, so
    // scrolling the page never counts as a swipe.
    if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx)) return;
    const btn = $(dx < 0 ? '#rateBody [data-act="skip"]' : '#rateBody [data-act="undo"]');
    if (btn) btn.click();
  }, { passive: true });
})();

// writeText returns a promise, so a blocked clipboard shows up as a rejection,
// not an exception: only say "Copied" once it has actually happened.
function copy(text, done) {
  const ok = () => toast(done || "Copied");
  const fallback = () => {
    let worked = false;
    try { worked = document.execCommand("copy"); } catch (e) { /* unsupported */ }
    if (worked) ok(); else toast("Couldn't copy — the text is selected, so copy it by hand");
  };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, fallback);
  else fallback();
}
async function makeShareLink() {
  const seat = state.shareWho || "a";
  const ratings = {};
  for (const [id, e] of Object.entries(state.entries)) {
    if (!e.w[seat] || e.s[seat] == null) continue;
    const t = BY_ID[id];
    if (t) ratings[t.qid] = e.s[seat];
  }
  const n = Object.keys(ratings).length;
  if (!n) { toast(`${nameOf(seat)} hasn't scored anything yet`); return; }
  const url = await window.TSShare.link({ name: nameOf(seat), ratings });
  $("#shareLink").value = url;
  $("#shareLink").select();
  copy(url, `Link with ${n} rating${n === 1 ? "" : "s"} copied`);
}
function importBackup() {
  try {
    const o = JSON.parse($("#importBox").value);
    if (o.entries) state.entries = o.entries;
    if (o.people) state.people = deepMerge(state.people, o.people);
    if (o.prefs) state.prefs = deepMerge(state.prefs, o.prefs);
    state.recCache = null; save(); applyTheme(); renderAll(); toast("Imported");
  } catch (e) { toast("That isn't a valid backup"); }
}

// ---------------------------------------------------------------- boot
function startFromSetup() {
  state.people.a.name = ($("#nameA").value || "").trim() || "You";
  const bName = ($("#nameB").value || "").trim();
  if (state.shareWelcome) {
    // Someone's ratings are already loaded into seat A, so this is never solo;
    // whoever is at this device takes seat B and rates from there.
    state.people.b.on = true;
    state.people.b.name = bName || "You";
    state.who = "both";
    state.deck.seat = "b";
  } else if (bName) {
    state.people.b.on = true;
    state.people.b.name = bName;
    state.who = "both";
  } else {
    // An empty second name means one seat. Say so rather than inventing a person.
    state.people.b.on = false;
    state.people.b.name = "";
    state.who = "a";
    state.deck.seat = "a";
  }
  save();
  $("#setup").hidden = true;
  $("#app").hidden = false;
  renderAll();
}
// Landing on a shared link with nothing of your own: the sender already holds
// a seat, so ask for the name of the person reading this, not for both.
function welcomeFromShare(seat) {
  state.shareWelcome = true;
  const sender = state.people[seat].name;
  const n = Object.values(state.entries).filter(e => e.w[seat]).length;
  $("#nameA").value = sender;
  $("#setup .stub-h").innerHTML = `${esc(sender)} sent you<br>their ratings.<br>Take the <em>other</em> seat.`;
  $("#setup .stub-p").textContent = `${n} rating${n === 1 ? "" : "s"} from ${sender} ${n === 1 ? "is" : "are"} already loaded. Put your own name in the empty seat and rate a few things — Match then shows what you would both enjoy.`;
  $("#setupSolo").hidden = true;
  $("#startBtn").textContent = "Take the other seat";
}

// Returns the seat the incoming ratings landed in, or null.
async function applyIncomingShare() {
  const code = window.TSShare.pending();
  if (!code) return null;
  const payload = await window.TSShare.decode(code);
  window.TSShare.clearHash();
  if (!payload) { toast("That shared link couldn't be read"); return null; }
  const known = Object.keys(payload.ratings).filter(q => BY_QID[q]).length;
  if (!known) { toast("That link had no titles this library knows"); return null; }
  // The incoming person takes the seat the local user is not using.
  const hasLocal = Object.values(state.entries).some(e => e.w.a);
  const seat = hasLocal ? "b" : "a";
  state.people[seat].name = payload.name || (seat === "a" ? "Seat A" : "Seat B");
  state.people.b.on = true;
  if (seat === "b" && !state.people.a.name) state.people.a.name = "Seat A";
  for (const [q, v] of Object.entries(payload.ratings)) {
    const t = BY_QID[q];
    if (!t) continue;
    const e = JSON.parse(JSON.stringify(getEntry(t.id)));
    e.w[seat] = true; e.s[seat] = v; e.at = new Date().toISOString();
    state.entries[t.id] = e;
  }
  state.who = "both";
  state.recCache = null;
  save();
  toast(`Added ${known} rating${known === 1 ? "" : "s"} from ${state.people[seat].name}`);
  return seat;
}

function countPeople() {
  const d = {}, a = {};
  for (const t of TITLES) { for (const x of t.director) d[x] = (d[x] || 0) + 1; for (const x of t.cast) a[x] = (a[x] || 0) + 1; }
  ALL_PEOPLE = { directors: d, actors: a };
}
async function boot() {
  const hadState = load();
  applyTheme();
  const sharing = !!window.TSShare.pending();
  // Storage is synchronous, so the right first screen can go up before the
  // library has arrived: the app shell with skeletons for a returning visitor,
  // the ticket for a new one. Only an incoming share link has to wait, since
  // it needs the library to know which titles it names.
  if (sharing) $("#boot").hidden = false;
  else if (hadState) { $("#app").hidden = false; syncChrome(); }
  else $("#setup").hidden = false;

  try {
    const lib = await window.TSData.load();
    TITLES = lib.titles;
    BUILT = lib.built || "";
    for (const t of TITLES) { BY_ID[t.id] = t; BY_QID[t.qid] = t; }
    countPeople();
    state.libReady = true;
  } catch (e) {
    const msg = `The library didn't load (${esc(e.message)}). Check the connection and reload. If you opened the file straight from disk, serve the folder over HTTP instead — browsers block fetch on file:// URLs.`;
    $("#boot").hidden = true;
    if (!$("#app").hidden) $("#matchBody").innerHTML = `<div class="empty">${msg}</div>`;
    else toast("The library didn't load — check the connection and reload");
    return;
  }

  const incoming = await applyIncomingShare();
  $("#boot").hidden = true;
  if (incoming === "a" && !hadState) {
    welcomeFromShare("a");
    $("#app").hidden = true;
    $("#setup").hidden = false;
    $("#nameB").focus();
  } else if (hadState || incoming || !$("#app").hidden) {
    // Includes someone who pressed "Take our seats" while the library loaded.
    $("#setup").hidden = true;
    $("#app").hidden = false;
    renderAll();
  }

  // Posters, trailers and availability from TMDB, when this build has them.
  window.TSData.loadMedia(TITLES).then(ok => {
    state.mediaReady = ok;
    if (ok) ensureWatch();
    rerenderAll();
  }).catch(() => { state.mediaReady = false; });

  // The rest of the library: summaries, locations, article names.
  window.TSData.loadExtra(TITLES).then(() => {
    state.extraReady = true;
    countPeople();                       // full credits have just arrived
    for (const t of TITLES) t._s = null;
    state.recCache = null;
    if (!$("#app").hidden) { syncChrome(); if (state.tab !== "ask") renderTab(); if (state.drawerId) renderDrawer(); }
  }).catch(() => { state.extraReady = true; syncChrome(); });

  // Offline support and instant repeat visits, in the built site only: a
  // service worker in development would serve stale files after every edit.
  const sw = (window.TS_ASSETS || {}).sw;
  if (sw && "serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register(sw).catch(() => {}));
  }
}
boot();
})();
