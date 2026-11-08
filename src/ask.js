// Ask — natural-language picks that run entirely in the browser.
//
// Two engines, both local. The instant one is a rule parser plus a similarity
// ranker: it is always on, works offline, and handles "like X", people,
// genres, moods, negations, languages, countries, years and length. The
// optional one is a small language model (WebLLM + Qwen 2.5 over WebGPU,
// downloaded once and cached by the browser) that reads free-form wording and
// turns it into the same structured search.
//
// Nothing is sent to a server in either case. There is no API key anywhere in
// this app, and there is no cloud model behind it.
(function () {
"use strict";

const WEBLLM_URL = "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.85/+esm";
const MODELS = [
  { base: "Qwen2.5-0.5B-Instruct", label: "Qwen 2.5 0.5B — about 350 MB; fastest, least accurate (phones)" },
  { base: "Qwen2.5-1.5B-Instruct", label: "Qwen 2.5 1.5B — about 1 GB; the one to pick on a laptop" },
  { base: "Qwen2.5-3B-Instruct", label: "Qwen 2.5 3B — about 2 GB; best answers, wants a real GPU" }
];
const EXAMPLES = [
  "something close to Money Heist that Leonardo DiCaprio has played",
  "cosy British comedy series with short episodes",
  "Iranian films from the 2010s",
  "mind-bending sci-fi like Inception but no superheroes",
  "a funny feel-good film for the two of us tonight",
  "Korean thrillers directed by Park Chan-wook"
];
const LS = "two-seats-public:ask";

const GENRE_WORDS = [
  [/\b(drama|dramas)\b/, "Drama"], [/\b(comedy|comedies)\b/, "Comedy"], [/\b(thriller|thrillers)\b/, "Thriller"], [/\bcrime\b/, "Crime"],
  [/\b(mystery|mysteries)\b/, "Mystery"], [/\b(sci-?fi|science fiction)\b/, "Science fiction"], [/\bfantasy\b/, "Fantasy"], [/\bhorror\b/, "Horror"],
  [/\baction\b/, "Action"], [/\badventure\b/, "Adventure"], [/\b(romance|romances)\b/, "Romance"], [/\b(animation|animated|cartoons?)\b/, "Animation"],
  [/\b(documentary|documentaries|docs?)\b/, "Documentary"], [/\b(history|historical)\b/, "History"], [/\bwar\b/, "War"], [/\b(biography|biographies|biopics?)\b/, "Biography"],
  [/\b(musical|musicals)\b/, "Musical"], [/\b(sport|sports)\b/, "Sport"], [/\b(family-?friendly|for (?:the )?(?:whole )?family|kids|children)\b/, "Family"], [/\b(western|westerns)\b/, "Western"]
];
const GENERIC_WORDS = new Set(["family", "love", "life", "home", "war", "crime", "drama", "comedy", "thriller", "horror", "action", "mystery", "romance", "fantasy", "history", "music", "sport", "sports", "friends", "friendship", "food", "space", "time", "money", "heist", "movie", "film", "series", "show", "tonight", "something", "anything"]);
const MOOD_WORDS = [
  [/\b(funny|laugh|hilarious|light-?hearted|lighthearted|silly)\b/, ["funny"]], [/\b(scary|creepy|terrifying|frightening|spooky)\b/, ["scary"]],
  [/\b(cozy|cosy|comfort|comforting|wholesome|gentle|relaxing|easy)\b/, ["cozy", "feel-good"]], [/\b(feel-?good|uplifting|heart-?warming|happy|hopeful)\b/, ["feel-good"]],
  [/\b(dark|bleak|grim|disturbing|depressing)\b/, ["dark"]], [/\b(tense|gripping|suspense|suspenseful|thrilling|intense)\b/, ["tense"]],
  [/\b(twisty|twists?|mind-?bending|plot twist)\b/, ["twisty"]], [/\b(slow|slow-?burn|meditative|quiet|contemplative)\b/, ["slow-burn"]],
  [/\b(romantic|love story)\b/, ["romantic"]], [/\b(epic|grand|sweeping)\b/, ["epic"]], [/\b(smart|clever|thought-?provoking|cerebral|intelligent)\b/, ["cerebral"]],
  [/\b(emotional|moving|tear-?jerker|cry|sad|touching)\b/, ["emotional"]], [/\b(heist|heists|robbery|bank job)\b/, ["heist"]], [/\b(spy|spies|espionage)\b/, ["spy"]],
  [/\bzombies?\b/, ["zombies"]], [/\bvampires?\b/, ["vampires"]], [/\b(superheroes?|marvel|dc)\b/, ["superhero"]], [/\b(time travel|time-?loop)\b/, ["time-travel"]],
  [/\b(space|astronauts?|outer space)\b/, ["space"]], [/\b(dystopian|dystopia|post-?apocalyptic|apocalypse)\b/, ["dystopian"]],
  [/\b(true story|true stories|based on (a )?true|real events|real story)\b/, ["true-story"]], [/\b(coming-?of-?age|growing up)\b/, ["coming-of-age"]], [/\b(teen|teenage|teenagers?)\b/, ["teen"]],
  [/\broad trip\b/, ["road-trip"]], [/\brevenge\b/, ["revenge"]], [/\bserial killers?\b/, ["serial-killer"]], [/\b(courtroom|legal|lawyers?)\b/, ["legal"]],
  [/\b(food|cooking|chefs?|restaurants?)\b/, ["food"]], [/\b(music|musicians?|bands?)\b/, ["music"]], [/\b(gangsters?|mafia|mob|cartel)\b/, ["gangster"]],
  [/\b(whodunit|detectives?|murder mystery)\b/, ["whodunit"]], [/\b(survival|stranded)\b/, ["survival"]], [/\b(soldiers?|battle|battles)\b/, ["war"]],
  [/\banime\b/, ["anime"]], [/\b(family-?friendly|for kids|with kids|children)\b/, ["family-friendly"]], [/\b(family|families|parents?|siblings?|brothers?|sisters?|father|mother)\b/, ["family"]], [/\b(political|politics)\b/, ["political"]],
  [/\b(period|historical)\b/, ["period"]], [/\b(sitcom|short episodes?|20 minutes?)\b/, ["sitcom", "short-episodes"]], [/\b(medical|hospital|doctors?)\b/, ["medical"]],
  [/\b(workplace|office)\b/, ["workplace"]], [/\b(martial arts|kung fu|samurai)\b/, ["martial-arts"]], [/\b(monsters?|kaiju|godzilla)\b/, ["monster"]],
  [/\b(robots?|androids?|artificial intelligence)\b/, ["robots"]], [/\baliens?\b/, ["aliens"]], [/\bmultiverse\b/, ["multiverse"]], [/\b(christmas|holiday)\b/, ["christmas"]],
  [/\bprison\b/, ["prison"]], [/\b(lgbtq?|gay|queer)\b/, ["lgbtq"]], [/\bfriendship\b/, ["friendship"]], [/\b(grief|loss)\b/, ["grief"]], [/\b(hackers?|startups?|tech)\b/, ["tech"]],
  [/\bnoir\b/, ["noir"]], [/\b(satire|satirical)\b/, ["satire"]], [/\bpsychological\b/, ["psychological"]], [/\bpirates?\b/, ["pirates"]], [/\b(assassins?|hitman)\b/, ["assassin"]]
];
const LANG_WORDS = { english: "en", persian: "fa", farsi: "fa", korean: "ko", japanese: "ja", french: "fr", spanish: "es", hindi: "hi", bollywood: "hi", turkish: "tr", german: "de", italian: "it", chinese: "zh", mandarin: "zh", cantonese: "yue", portuguese: "pt", russian: "ru", arabic: "ar", danish: "da", swedish: "sv", norwegian: "no", finnish: "fi", dutch: "nl", polish: "pl", hebrew: "he", thai: "th", tamil: "ta", telugu: "te", malayalam: "ml", bengali: "bn", greek: "el", hungarian: "hu", czech: "cs", ukrainian: "uk", vietnamese: "vi", icelandic: "is" };
const COUNTRY_WORDS = { iranian: "Iran", iran: "Iran", american: "United States", hollywood: "United States", british: "United Kingdom", uk: "United Kingdom", french: "France", korean: "South Korea", japanese: "Japan", indian: "India", canadian: "Canada", german: "Germany", italian: "Italy", spanish: "Spain", mexican: "Mexico", brazilian: "Brazil", chinese: "China", turkish: "Turkey", australian: "Australia", irish: "Ireland", danish: "Denmark", swedish: "Sweden", norwegian: "Norway", finnish: "Finland", dutch: "Netherlands", belgian: "Belgium", polish: "Poland", russian: "Russia", argentine: "Argentina", argentinian: "Argentina", israeli: "Israel", egyptian: "Egypt", nigerian: "Nigeria", taiwanese: "Taiwan", thai: "Thailand", indonesian: "Indonesia", filipino: "Philippines", greek: "Greece", hungarian: "Hungary", czech: "Czechia", romanian: "Romania", ukrainian: "Ukraine", chilean: "Chile", colombian: "Colombia", lebanese: "Lebanon", pakistani: "Pakistan", afghan: "Afghanistan", scandinavian: "Sweden|Denmark|Norway|Finland|Iceland", nordic: "Sweden|Denmark|Norway|Finland|Iceland" };

let api = null, webllm = null, engine = null, engineId = null, loading = false, loadErr = "", progress = 0, progressText = "";
let prefs = { model: "Qwen2.5-1.5B-Instruct", auto: false };
try { Object.assign(prefs, JSON.parse(localStorage.getItem(LS) || "{}")); } catch (e) { /* fine */ }
let last = null, thinking = false, wired = false, built = false;

const $ = s => document.querySelector(s);
const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
const uniq = a => a.filter((x, i) => a.indexOf(x) === i);
function savePrefs() { try { localStorage.setItem(LS, JSON.stringify(prefs)); } catch (e) { /* fine */ } }

// Words that mean "the pair of us", including whatever the two seats are called.
function usWords() {
  const base = ["we", "us", "our", "together", "both of us", "both", "couple", "date night"];
  if (!api.solo()) { base.push(norm(api.nameOf("a")), norm(api.nameOf("b"))); }
  return base.filter(w => w && w.length > 1);
}

// ---------------------------------------------------------------- resolving names
function bigrams(s) { const out = new Set(); for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2)); return out; }
function dice(a, b) { const A = bigrams(a), B = bigrams(b); let n = 0; for (const x of A) if (B.has(x)) n++; return (2 * n) / (A.size + B.size || 1); }
const reach = t => t.reach || 0;
function resolveTitle(phrase) {
  const n = norm(phrase).replace(/^(the|a|an) /, "");
  if (n.length < 2) return null;
  const T = api.titles, nt = t => (t._n || (t._n = norm(t.title).replace(/^(the|a|an) /, "")));
  let pool = T.filter(t => nt(t) === n);
  if (!pool.length) pool = T.filter(t => nt(t).startsWith(n + " ") || nt(t).startsWith(n));
  if (!pool.length) pool = T.filter(t => nt(t).includes(n));
  if (!pool.length) {
    const scored = T.map(t => [dice(n, nt(t)), t]).filter(x => x[0] >= 0.62).sort((a, b) => b[0] - a[0]);
    pool = scored.slice(0, 5).map(x => x[1]);
  }
  return pool.sort((a, b) => reach(b) - reach(a))[0] || null;
}
function allNames() {
  // Rebuilt when the app swaps in the full credits from the second file.
  if (!allNames.cache || allNames.src !== api.people) {
    allNames.src = api.people;
    const m = {};
    for (const [n, c] of Object.entries(api.people.directors)) m[n] = (m[n] || 0) + c;
    for (const [n, c] of Object.entries(api.people.actors)) m[n] = (m[n] || 0) + c;
    allNames.cache = Object.entries(m).map(([name, count]) => ({ name, lower: name.toLowerCase(), count }));
  }
  return allNames.cache;
}
function resolvePerson(phrase) {
  const p = norm(phrase);
  if (p.length < 3) return null;
  const names = allNames();
  const exact = names.filter(x => norm(x.name) === p);
  if (exact.length) return exact.sort((a, b) => b.count - a.count)[0].name;
  const toks = p.split(" ").filter(t => t.length > 1);
  const byTokens = names.filter(x => { const nt = norm(x.name).split(" "); return toks.every(t => nt.includes(t)); });
  if (byTokens.length) return byTokens.sort((a, b) => b.count - a.count)[0].name;
  const fuzzy = names.filter(x => x.count >= 2).map(x => [dice(p, norm(x.name)), x]).filter(x => x[0] >= 0.72).sort((a, b) => b[0] - a[0] || b[1].count - a[1].count);
  return fuzzy.length ? fuzzy[0][1].name : null;
}
function namesInText(text) {
  const q = " " + norm(text) + " ", hits = [];
  for (const x of allNames()) if (x.lower.length >= 7 && q.includes(" " + norm(x.name) + " ")) hits.push(x);
  return uniq(hits.sort((a, b) => b.name.length - a.name.length || b.count - a.count).map(x => x.name)).slice(0, 4);
}

// ---------------------------------------------------------------- the instant parser
function emptyQuery() {
  return { like: [], people: [], type: "any", genres: [], excludeGenres: [], moods: [], excludeMoods: [], origin: { langs: [], countries: [] }, yearFrom: null, yearTo: null, minScore: null, maxRuntime: null, minRuntime: null, includeRated: false, forUs: false, summary: "", suggestions: [] };
}
const HEAVY_RX = /\b(nothing|not|no|without)\s+(too\s+)?(heavy|serious|grim|depressing|sad|dark|violent|scary)\b/;
const STOP = "(?:\\s+(?:with|that|which|where|starring|featuring|by|from|but|and|in|for|about|without|no|not|,|\\.|$))";
function parseRules(text) {
  const q = emptyQuery(), raw = " " + text.trim() + " ", low = raw.toLowerCase();
  if (/\b(movies?|films?|cinema)\b/.test(low) && !/\b(series|shows?|tv|season|episodes?)\b/.test(low)) q.type = "movie";
  else if (/\b(series|shows?|tv|seasons?|episodes?|sitcoms?)\b/.test(low) && !/\b(movies?|films?)\b/.test(low)) q.type = "series";
  const likeRx = new RegExp("(?:^|\\b(?:something|anything|things|movies?|films?|series|shows?|stuff|one|ones))?\\s*(?:like|similar to|close to|in the (?:vein|style|spirit) of|reminds? me of|comparable to|along the lines of)\\s+(.+?)" + STOP, "gi");
  let m;
  while ((m = likeRx.exec(raw))) {
    const phrase = m[1].trim();
    if (phrase && !/^(i|we|to|it|this|that|you)$/i.test(phrase)) q.like.push(phrase);
  }
  const peopleRx = new RegExp("\\b(?:starring|featuring|with|has|where|that|which|played by|acted by|directed by|made by|created by|by|from|of)\\s+([A-Za-zÀ-ÿ'.\\-]+(?:\\s+[A-Za-zÀ-ÿ'.\\-]+){0,3}?)\\s+(?:has\\s+played|has\\s+acted|played|plays|acted|acts|stars|starred|is\\s+in|appears|in\\s+it|directed|made)\\b", "gi");
  const phrases = [];
  while ((m = peopleRx.exec(raw))) phrases.push(m[1]);
  const byRx = /\b(?:directed by|made by|created by|from director|by director|starring|featuring)\s+([A-Z][A-Za-zÀ-ÿ'.\-]+(?:\s+[A-Z][A-Za-zÀ-ÿ'.\-]+){1,2})/g;
  while ((m = byRx.exec(raw))) phrases.push(m[1]);
  for (const n of namesInText(raw)) q.people.push(n);
  for (const ph of phrases) { const r = resolvePerson(ph); if (r) q.people.push(r); }
  q.people = uniq(q.people);
  // Negations first, so their words don't also register as positives.
  const negRx = /\b(?:no|not|without|nothing|avoid|except|minus|isn't|isnt|aren't)\s+(?:too\s+)?([a-z][a-z\- ]{2,24}?)(?=\s+(?:and|or|but|,|\.|$)|\s*$)/g;
  let rest = low;
  while ((m = negRx.exec(low))) {
    const phrase = m[1].trim();
    for (const [rx, g] of GENRE_WORDS) if (rx.test(phrase)) q.excludeGenres.push(g);
    for (const [rx, tags] of MOOD_WORDS) if (rx.test(phrase)) q.excludeMoods.push(...tags);
    rest = rest.replace(m[0], " ");
  }
  if (HEAVY_RX.test(low)) { q.excludeMoods.push("dark", "bleak"); rest = rest.replace(HEAVY_RX, " "); }
  if (/\b(witty|banter|sharp dialogue|clever dialogue|dialogue)\b/.test(rest)) q.moods.push("funny", "cerebral");
  if (/\b(rainy|lazy|sunday|evening|tonight|weeknight|comfort)\b/.test(rest)) q.moods.push("cozy");
  for (const [rx, g] of GENRE_WORDS) if (rx.test(rest)) q.genres.push(g);
  for (const [rx, tags] of MOOD_WORDS) if (rx.test(rest)) q.moods.push(...tags);
  if (/\bromantic comed(y|ies)|rom-?coms?\b/.test(rest)) q.genres.push("Romance", "Comedy");
  for (const w of Object.keys(LANG_WORDS)) if (new RegExp("\\b" + w + "\\b").test(rest)) q.origin.langs.push(LANG_WORDS[w]);
  for (const w of Object.keys(COUNTRY_WORDS)) if (new RegExp("\\b" + w + "\\b").test(rest)) q.origin.countries.push(...COUNTRY_WORDS[w].split("|"));
  const years = [...rest.matchAll(/\b(19[89]\d|20[0-2]\d)s?\b/g)].map(x => +x[1]);
  if ((m = /\b(after|since|from|post)\s+(19[89]\d|20[0-2]\d)\b/.exec(rest))) q.yearFrom = +m[2];
  if ((m = /\b(before|until|up to|pre)\s+(19[89]\d|20[0-2]\d)\b/.exec(rest))) q.yearTo = +m[2];
  if ((m = /\b(20[0-2]0)s\b/.exec(rest))) { q.yearFrom = +m[1]; q.yearTo = +m[1] + 9; }
  if (!q.yearFrom && !q.yearTo && years.length === 1 && /\b(in|of)\s+(19|20)\d\d\b/.test(rest)) { q.yearFrom = years[0]; q.yearTo = years[0]; }
  if (/\b(recent|new|newest|latest|this year|last year)\b/.test(rest)) q.yearFrom = new Date().getFullYear() - 2;
  if (/\b(classic|old|older)\b/.test(rest)) q.yearTo = 2012;
  if ((m = /\b(?:under|less than|shorter than|max|at most)\s+(\d{2,3})\s*(?:min|mins|minutes)\b/.exec(rest))) q.maxRuntime = +m[1];
  if ((m = /\b(?:under|less than|shorter than)\s+(\d)\s*(?:hours?|hrs?)\b/.exec(rest))) q.maxRuntime = +m[1] * 60;
  if (/\bshort\b/.test(rest) && !q.maxRuntime) q.maxRuntime = 100;
  if (/\b(long|epic length|three hours?)\b/.test(rest)) q.minRuntime = 150;
  if ((m = /\b(?:rotten tomatoes|rt|rated|rating|score)\s*(?:above|over|at least|of|>|higher than)?\s*(\d{2})\s*%?\b/.exec(rest))) q.minScore = +m[1];
  if (/\b(highly rated|top rated|best|acclaimed|masterpiece|great)\b/.test(rest) && !q.minScore) q.minScore = 80;
  if (/\b(seen|watched|rewatch|re-watch|rated)\b/.test(rest) && /\b(even if|including|already|again|rewatch|re-watch)\b/.test(rest)) q.includeRated = true;
  for (const w of usWords()) if (new RegExp("\\b" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b").test(rest)) { q.forUs = true; break; }
  q.genres = uniq(q.genres); q.moods = uniq(q.moods); q.excludeGenres = uniq(q.excludeGenres); q.excludeMoods = uniq(q.excludeMoods);
  q.origin.langs = uniq(q.origin.langs); q.origin.countries = uniq(q.origin.countries);
  return q;
}

// ---------------------------------------------------------------- ranking
function overlap(a, b) { return a.filter(x => b.includes(x)); }
function sim(t, ref) {
  let s = 0.5 * overlap(t.genres, ref.genres).length + 0.45 * overlap(t.tags, ref.tags).length
        + 1.5 * overlap(t.director, ref.director).length + 0.5 * overlap(t.cast, ref.cast).length;
  if (t.t === ref.t) s += 0.2;
  if (t.lang && t.lang === ref.lang) s += 0.15;
  return s;
}
// The hard filters of a request. Shared by the search itself and by anything
// the local model suggests, so a suggestion cannot ignore "Persian" or
// "series" just because the model was confident about it.
function passesQuery(t, q, who, people) {
  if (q.type !== "any" && t.t !== q.type) return false;
  if (api.state.type !== "all" && t.t !== api.state.type) return false;
  // Children's titles only when the request or the household asks for them.
  if (!api.kidsOK(t) && !q.genres.includes("Family") && !q.moods.includes("family-friendly")) return false;
  if (!q.includeRated && !api.openFor(api.getEntry(t.id), who)) return false;
  if (q.genres.length && !q.genres.every(g => t.genres.includes(g))) return false;
  if (q.excludeGenres.some(g => t.genres.includes(g))) return false;
  if (q.excludeMoods.some(x => t.tags.includes(x))) return false;
  if (q.origin.langs.length || q.origin.countries.length) {
    if (!(q.origin.langs.includes(t.lang) || t.country.some(x => q.origin.countries.includes(x)))) return false;
  }
  if (q.yearFrom && t.year < q.yearFrom) return false;
  if (q.yearTo && t.year > q.yearTo) return false;
  if (q.minScore && (t.rt == null || t.rt < q.minScore)) return false;
  if (q.maxRuntime && t.t === "movie" && (!t.runtime || t.runtime > q.maxRuntime)) return false;
  if (q.minRuntime && t.t === "movie" && (!t.runtime || t.runtime < q.minRuntime)) return false;
  if (q.maxRuntime && t.t === "series" && t.runtime && t.runtime > q.maxRuntime) return false;
  if (people.length && !people.some(p => t.cast.includes(p) || t.director.includes(p))) return false;
  return true;
}
function runQuery(q) {
  const who = q.forUs && !api.solo() ? "both" : api.state.who;
  const refs = q.like.map(resolveTitle).filter(Boolean);
  const refIds = new Set(refs.map(r => r.id));
  const people = q.people.map(resolvePerson).filter(Boolean);
  const c = api.profiles();
  const notes = [];
  if (q.like.length && !refs.length) notes.push(`Couldn't find "${q.like.join('", "')}" in the library.`);
  const missing = q.people.filter(p => !resolvePerson(p));
  if (missing.length) notes.push(`No one called "${missing.join('", "')}" appears in the library's credits.`);
  const cands = api.titles.filter(t => !refIds.has(t.id) && passesQuery(t, q, who, people));
  const scored = cands.map(t => {
    const base = c.scores[t.id];
    let s = 0.55 * base.q + 0.45 * (who === "both" && base.joint != null ? base.joint : base.fa);
    let simTotal = 0;
    const shared = [];
    for (const r of refs) {
      const v = sim(t, r);
      simTotal += v;
      if (v > 0) shared.push({ r, g: overlap(t.genres, r.genres), tg: overlap(t.tags, r.tags), d: overlap(t.director, r.director), a: overlap(t.cast, r.cast) });
    }
    s += simTotal * 1.6;
    const moodHits = overlap(q.moods, t.tags);
    s += moodHits.length * 0.6;
    if (refs.length && simTotal <= 0) s = null;   // "like X" has to actually share something with X
    return { t, s, shared, moodHits, people: people.filter(p => t.cast.includes(p) || t.director.includes(p)) };
  }).filter(x => x.s != null).sort((a, b) => b.s - a.s);
  return { who, refs, people, notes, results: scored };
}
function reasonFor(x) {
  const parts = [];
  for (const sh of x.shared.slice(0, 2)) {
    const bits = uniq([...sh.d.map(n => "director " + n), ...sh.a, ...sh.g.map(g => g.toLowerCase()), ...sh.tg.map(t => t.replace(/-/g, " "))]).slice(0, 3);
    if (bits.length) parts.push(`shares ${bits.join(", ")} with ${sh.r.title}`);
  }
  if (x.people.length) parts.push((x.t.director.some(d => x.people.includes(d)) ? "directed by " : "stars ") + x.people.join(", "));
  if (x.moodHits.length) parts.push(x.moodHits.map(m => m.replace(/-/g, " ")).join(", "));
  return parts.join(" · ");
}

// ---------------------------------------------------------------- small language model
const SCHEMA = { type: "object", properties: {
  like: { type: "array", items: { type: "string" } }, people: { type: "array", items: { type: "string" } },
  type: { type: "string", enum: ["movie", "series", "any"] }, genres: { type: "array", items: { type: "string" } }, excludeGenres: { type: "array", items: { type: "string" } },
  moods: { type: "array", items: { type: "string" } }, excludeMoods: { type: "array", items: { type: "string" } }, languages: { type: "array", items: { type: "string" } }, countries: { type: "array", items: { type: "string" } },
  yearFrom: { type: "integer" }, yearTo: { type: "integer" }, minScore: { type: "integer" }, maxRuntime: { type: "integer" },
  includeRated: { type: "boolean" }, forUs: { type: "boolean" }, suggestions: { type: "array", items: { type: "string" } }, summary: { type: "string" } },
  required: ["like", "people", "type", "genres", "excludeGenres", "moods", "excludeMoods", "languages", "countries", "yearFrom", "yearTo", "minScore", "maxRuntime", "includeRated", "forUs", "suggestions", "summary"] };

function instructions() {
  const us = api.solo() ? "we/us/together" : `we/us/together/${api.nameOf("a")}/${api.nameOf("b")}`;
  return `You turn a request for films or TV series into a JSON search. Output only JSON matching the schema. Set a field only when the request itself says so; otherwise use [], 0 or false. Never copy values from the examples.
Fields: like = titles the person wants something similar to (exact title names only, never people). people = actors or directors who must be involved. type = "movie", "series" or "any". genres from this list only: Drama, Comedy, Thriller, Crime, Mystery, Science fiction, Fantasy, Horror, Action, Adventure, Romance, Animation, Documentary, History, War, Biography, Musical, Sport, Family, Western. excludeGenres = genres the request rules out. moods = short lowercase mood words the request implies, like funny, cozy, dark, tense, twisty, slow, romantic, epic, cerebral, emotional, heist, spy, zombies, superhero, space, dystopian, true story, coming of age, revenge, food, music, gangster, whodunit, survival, war, anime, family friendly. excludeMoods = moods the request rules out ("nothing heavy" = dark). languages = original language names in English. countries = countries of origin. yearFrom/yearTo, minScore (a Rotten Tomatoes percentage), maxRuntime (minutes): 0 unless a number or period is stated. includeRated = true only if they explicitly want things already rated. forUs = true only if they say ${us}. suggestions = up to 6 well-known titles that fit, from your own knowledge. summary = one short sentence saying what you understood.
Example request: "a movie like Money Heist that Leonardo DiCaprio has played"
Example JSON: {"like":["Money Heist"],"people":["Leonardo DiCaprio"],"type":"movie","genres":[],"excludeGenres":[],"moods":["heist"],"excludeMoods":[],"languages":[],"countries":[],"yearFrom":0,"yearTo":0,"minScore":0,"maxRuntime":0,"includeRated":false,"forUs":false,"suggestions":["Inception","Catch Me If You Can","The Departed"],"summary":"Heist-style films starring Leonardo DiCaprio."}
Example request: "gentle british comedy series, nothing dark"
Example JSON: {"like":[],"people":[],"type":"series","genres":["Comedy"],"excludeGenres":[],"moods":["cozy"],"excludeMoods":["dark"],"languages":[],"countries":["United Kingdom"],"yearFrom":0,"yearTo":0,"minScore":0,"maxRuntime":0,"includeRated":false,"forUs":false,"suggestions":["Detectorists","Ghosts","Ted Lasso"],"summary":"Gentle British comedy series without darkness."}`;
}

async function loadModel() {
  if (loading || engine) return;
  loadErr = ""; progress = 0; progressText = "Starting…"; loading = true; renderEngine();
  try {
    if (!navigator.gpu) throw new Error("WebGPU isn't available in this browser. Chrome, Edge, or Safari 26 and newer can run it.");
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("No GPU adapter available for WebGPU.");
    const f16 = adapter.features && adapter.features.has("shader-f16");
    webllm = webllm || await import(WEBLLM_URL);
    const id = `${prefs.model}-q4f${f16 ? "16" : "32"}_1-MLC`;
    engine = await webllm.CreateMLCEngine(id, { initProgressCallback: r => { progress = r.progress || 0; progressText = r.text || ""; renderEngine(); } });
    engineId = id;
  } catch (e) {
    engine = null;
    loadErr = (e && e.message) || String(e);
  }
  loading = false; renderEngine();
}
async function unloadModel() {
  if (engine) { try { await engine.unload(); } catch (e) { /* fine */ } }
  engine = null; engineId = null; renderEngine();
}
async function askModel(text) {
  const r = await engine.chat.completions.create({
    messages: [{ role: "system", content: instructions() }, { role: "user", content: text }],
    temperature: 0, max_tokens: 500, response_format: { type: "json_object", schema: JSON.stringify(SCHEMA) }
  });
  return JSON.parse(r.choices[0].message.content);
}
// Small models cheerfully copy values out of the examples, so anything the
// model adds has to be backed by a cue in the request itself. Its real
// contribution is paraphrase (moods, negations, languages), the summary, and
// title suggestions from its own memory.
function mergeModel(q, m, text) {
  const out = JSON.parse(JSON.stringify(q)), low = " " + norm(text) + " ";
  const arr = v => Array.isArray(v) ? v.filter(x => typeof x === "string" && x.trim()) : [];
  const inText = s => { const n = norm(s); return n.length >= 3 && low.includes(" " + n + " "); };
  const wordy = s => GENRE_WORDS.some(([rx]) => rx.test(s)) || MOOD_WORDS.some(([rx]) => rx.test(s)) || LANG_WORDS[s] || COUNTRY_WORDS[s];
  const okTitle = s => { const n = norm(s).replace(/^(the|a|an) /, ""); return n.length >= 5 && !GENERIC_WORDS.has(n) && !wordy(n) && low.includes(" " + n + " "); };
  // Strict: the phrase has to BE a title, not merely begin one, so "Korean"
  // cannot be stretched into "A Korean Odyssey". No fuzzy matching here.
  const strictTitle = s => {
    const n = norm(s).replace(/^(the|a|an) /, "");
    if (n.length < 5) return null;
    const pool = api.titles.filter(t => {
      const tn = norm(t.title).replace(/^(the|a|an) /, "");
      return tn === n || (tn.startsWith(n + " ") && n.length >= 0.7 * tn.length);
    });
    return pool.sort((a, b) => reach(b) - reach(a))[0] || null;
  };
  const surnameInText = name => norm(name).split(" ").some(tok => tok.length >= 4 && low.includes(" " + tok + " "));
  const likeIds = new Set(out.like.map(x => (resolveTitle(x) || {}).id).filter(Boolean));
  for (const x of arr(m.like).concat(arr(m.people))) {
    const p = resolvePerson(x);
    if (p && surnameInText(p) && !out.people.includes(p)) { out.people.push(p); continue; }
    const t = okTitle(x) ? strictTitle(x) : null;
    if (t && !likeIds.has(t.id)) { out.like.push(t.title); likeIds.add(t.id); }
  }
  const negated = /\b(no|not|without|nothing|avoid|except|minus|isn t|aren t|don t)\b/.test(low);
  for (const g of arr(m.excludeGenres)) if (api.GENRE_ORDER.includes(g) && negated) out.excludeGenres.push(g);
  for (const mood of arr(m.moods)) for (const [rx, tags] of MOOD_WORDS) if (rx.test(mood.toLowerCase())) out.moods.push(...tags);
  if (negated) for (const mood of arr(m.excludeMoods)) for (const [rx, tags] of MOOD_WORDS) if (rx.test(mood.toLowerCase())) out.excludeMoods.push(...tags);
  out.excludeMoods = out.excludeMoods.filter(x => !out.moods.includes(x));
  out.excludeGenres = out.excludeGenres.filter(x => !out.genres.includes(x));
  if (/\b(heavy|serious|grim|depressing|sad)\b/.test(low) && /\b(nothing|not|no|without)\b/.test(low)) out.excludeMoods.push("dark");
  for (const l of arr(m.languages)) {
    const code = LANG_WORDS[l.toLowerCase()] || Object.keys(window.TSData.LANG_NAMES).find(k => window.TSData.LANG_NAMES[k].toLowerCase() === l.toLowerCase());
    if (code && (inText(l) || Object.keys(LANG_WORDS).some(w => LANG_WORDS[w] === code && inText(w)))) out.origin.langs.push(code);
  }
  for (const cn of arr(m.countries)) if (inText(cn) || Object.keys(COUNTRY_WORDS).some(w => COUNTRY_WORDS[w].split("|").includes(cn) && inText(w))) out.origin.countries.push(cn);
  const hasDigits = /\d/.test(low);
  if (hasDigits && +m.yearFrom > 1900 && !out.yearFrom && low.includes(String(m.yearFrom).slice(0, 3))) out.yearFrom = +m.yearFrom;
  if (hasDigits && +m.yearTo > 1900 && !out.yearTo && low.includes(String(m.yearTo).slice(0, 3))) out.yearTo = +m.yearTo;
  if (hasDigits && +m.minScore > 0 && !out.minScore && /\b(rotten|tomatoes|rt|rating|rated|score)\b/.test(low)) out.minScore = +m.minScore;
  if (+m.maxRuntime > 0 && !out.maxRuntime && /\b(minutes?|mins?|hours?|short|quick|under)\b/.test(low)) out.maxRuntime = +m.maxRuntime;
  if (m.includeRated === true && /\b(seen|watched|again|rewatch|rated)\b/.test(low)) out.includeRated = true;
  if (m.forUs === true && usWords().some(w => low.includes(" " + w + " "))) out.forUs = true;
  out.suggestions = uniq(arr(m.suggestions)).slice(0, 8);
  out.summary = typeof m.summary === "string" ? m.summary.slice(0, 200) : "";
  for (const k of ["like", "people", "genres", "excludeGenres", "moods", "excludeMoods"]) out[k] = uniq(out[k]);
  out.origin.langs = uniq(out.origin.langs); out.origin.countries = uniq(out.origin.countries);
  return out;
}

// ---------------------------------------------------------------- rendering
function scaffold() {
  if (built) return;
  built = true;
  $("#askBody").innerHTML = `
    <form class="ask-form" id="askForm">
      <label class="search"><svg class="ic" aria-hidden="true"><use href="#i-search"/></svg><input type="text" id="askInput" placeholder="Something like Chernobyl, but less bleak…" autocomplete="off" aria-label="Describe what you want to watch"></label>
      <button type="submit" class="btn primary">Find it</button>
    </form>
    <div class="ask-ex" id="askExamples"></div>
    <details class="engines"><summary><svg class="ic" aria-hidden="true"><use href="#i-chev"/></svg>How this works, and the optional on-device model</summary><div class="ask-read" id="askEngine"></div></details>
    <div id="askResult"></div>`;
}
function renderEngine() {
  const box = $("#askEngine");
  if (!box) return;
  const esc = api.esc;
  const gpu = !!navigator.gpu;
  const modelSel = `<select id="askModelSel"${loading || engine ? " disabled" : ""}>${MODELS.map(m => `<option value="${m.base}"${prefs.model === m.base ? " selected" : ""}>${esc(m.label)}</option>`).join("")}</select>`;
  let model;
  if (engine) model = `<span class="pill b">Local model ready</span><span class="hint">${esc(engineId.replace(/-q4f\d+_1-MLC$/, "").replace(/-/g, " "))}</span><button type="button" class="btn sm ghost" id="askUnload">Unload</button>`;
  else if (loading) model = `<span class="pill">Loading model</span><span class="hint">${esc(progressText).slice(0, 90)}</span>`;
  else if (!gpu) model = `<span class="pill">Local model unavailable</span><span class="hint">This browser has no WebGPU. Chrome, Edge or Safari 26+ can run it; the instant engine works everywhere.</span>`;
  else model = `<span class="pill">Local model not loaded</span>${modelSel}<button type="button" class="btn sm" id="askLoad">Download and load</button>`;
  box.innerHTML = `
    <h3>Engines</h3>
    <div class="pills" style="margin-bottom:8px"><span class="pill a">Instant engine ready</span><span class="hint">understands "like X", actors, directors, genres, moods, languages, countries, years, length</span></div>
    <div class="pills">${model}</div>
    ${loading ? `<div class="track" style="height:6px;background:var(--bg3);border-radius:99px;margin-top:9px"><div style="height:6px;border-radius:99px;background:var(--b);width:${Math.round(progress * 100)}%"></div></div>` : ""}
    ${loadErr ? `<p class="hint" style="color:var(--a)">${esc(loadErr)}</p>` : ""}
    ${gpu && !engine && !loading ? `<label class="check" style="margin-top:8px"><input type="checkbox" id="askAuto"${prefs.auto ? " checked" : ""}> Load it automatically next time — it's fast once cached</label>` : ""}
    <p class="hint" style="margin-top:8px">The model runs on this device and only reads your request to turn it into a search; nothing is uploaded. Its own title suggestions are shown only where they satisfy every part of the request. The 0.5B model is weak at this; 1.5B and 3B are much better.</p>`;
}
function renderResult() {
  const out = $("#askResult");
  if (!out) return;
  const esc = api.esc;
  if (!last) { out.innerHTML = ""; return; }
  const { q, run, page, fromModel } = last;
  const chips = [];
  if (run.refs.length) chips.push(["like", run.refs.map(r => r.title).join(", ")]);
  if (run.people.length) chips.push(["with", run.people.join(", ")]);
  chips.push(["type", q.type === "any" ? (api.state.type === "all" ? "films & series" : api.state.type === "movie" ? "films" : "series") : q.type === "movie" ? "films" : "series"]);
  if (q.genres.length) chips.push(["genre", q.genres.join(", ")]);
  if (q.excludeGenres.length) chips.push(["not", q.excludeGenres.join(", ")]);
  if (q.moods.length) chips.push(["mood", q.moods.map(m => m.replace(/-/g, " ")).join(", ")]);
  if (q.excludeMoods.length) chips.push(["avoid", q.excludeMoods.join(", ")]);
  if (q.origin.langs.length) chips.push(["language", q.origin.langs.map(l => api.langName(l)).join(", ")]);
  if (q.origin.countries.length) chips.push(["country", q.origin.countries.join(", ")]);
  if (q.yearFrom || q.yearTo) chips.push(["years", `${q.yearFrom || 2000}–${q.yearTo || 2026}`]);
  if (q.minScore) chips.push(["RT", "≥ " + q.minScore + "%"]);
  if (q.maxRuntime) chips.push([q.type === "series" ? "episodes" : "length", "≤ " + q.maxRuntime + " min"]);
  if (q.minRuntime) chips.push(["length", "≥ " + q.minRuntime + " min"]);
  chips.push(["for", run.who === "both" ? `${api.nameOf("a")} & ${api.nameOf("b")}` : api.nameOf(run.who === "b" ? "b" : "a")]);
  if (q.includeRated) chips.push(["rated", "included"]);
  const shown = run.results.slice(0, 24 * page);
  let html = `<div class="ask-read"><h3>${fromModel ? "Local model and instant engine understood" : "Understood"}</h3><div class="pills">${chips.map(([k, v]) => `<span class="pill"><b>${esc(k)}</b> ${esc(v)}</span>`).join("")}${thinking ? `<span class="pill b">local model thinking…</span>` : ""}</div>${q.summary ? `<p style="margin:9px 0 0">${esc(q.summary)}</p>` : ""}</div>`;
  for (const n of run.notes) html += `<p class="hint">${esc(n)}</p>`;
  if (!run.results.length) {
    html += `<div class="empty">Nothing in the library matches all of that${q.includeRated ? "" : " among titles you haven't rated"}. Try fewer conditions${q.includeRated ? "" : `, or <button type="button" class="link" id="askIncludeRated">include things you've rated</button>`}.</div>`;
  } else {
    html += `<section class="shelf"><div class="shelf-head"><h2>${run.refs.length ? "Closest matches" : "Best fits"}</h2><span class="count">${run.results.length.toLocaleString()}</span><span class="why">ranked by similarity, your ratings and critics' scores</span></div><div class="grid">${shown.map(x => api.cardHTML(x.t, { reason: reasonFor(x) })).join("")}</div>`;
    if (run.results.length > shown.length) html += `<div class="more"><button type="button" class="btn ghost" data-askmore="1">Show ${Math.min(24, run.results.length - shown.length)} more</button><span>${(run.results.length - shown.length).toLocaleString()} more</span></div>`;
    html += `</section>`;
  }
  if (q.suggestions && q.suggestions.length) {
    const seen = new Set(shown.map(x => x.t.id));
    run.refs.forEach(r => seen.add(r.id));
    // Has to exist in the library, not already be shown, and satisfy every
    // hard filter of the request — otherwise the model's memory wins over
    // what was actually asked for.
    const found = uniq(q.suggestions.map(s => resolveTitle(s)).filter(t => t && !seen.has(t.id) && passesQuery(t, q, run.who, run.people)));
    if (found.length) html += `<section class="shelf"><div class="shelf-head"><h2>The local model also suggests</h2><span class="count">${found.length}</span><span class="why">from its own memory, kept only where it fits the request</span></div><div class="grid">${found.map(t => api.cardHTML(t)).join("")}</div></section>`;
  }
  out.innerHTML = html;
}
async function ask(text) {
  text = (text || "").trim();
  if (!text) return;
  const input = $("#askInput");
  if (input && input.value !== text) input.value = text;
  const q = parseRules(text);
  last = { q, run: runQuery(q), text, page: 1, fromModel: false };
  renderResult();
  if (!engine) return;
  thinking = true; renderResult();
  try {
    const m = await askModel(text);
    if (!last || last.text !== text) return;
    const merged = mergeModel(q, m, text);
    last = { q: merged, run: runQuery(merged), text, page: 1, fromModel: true };
  } catch (e) {
    api.toast("The local model couldn't answer: " + ((e && e.message) || e).toString().slice(0, 80));
  }
  thinking = false; renderResult();
}
function wire() {
  if (wired) return;
  wired = true;
  document.addEventListener("submit", ev => {
    if (ev.target.id !== "askForm") return;
    ev.preventDefault();
    ask($("#askInput").value);
  });
  document.addEventListener("click", ev => {
    const b = ev.target.closest("button, input");
    if (!b) return;
    if (b.dataset.example) return ask(b.dataset.example);
    if (b.id === "askLoad") return loadModel();
    if (b.id === "askUnload") return unloadModel();
    if (b.id === "askIncludeRated" && last) { last.q.includeRated = true; last.run = runQuery(last.q); renderResult(); return; }
    if (b.dataset.askmore && last) { last.page++; renderResult(); return; }
    if (b.id === "askAuto") { prefs.auto = b.checked; savePrefs(); return; }
  });
  document.addEventListener("change", ev => { if (ev.target.id === "askModelSel") { prefs.model = ev.target.value; savePrefs(); } });
}
function render(providedApi) {
  api = providedApi;
  scaffold();
  wire();
  const ex = $("#askExamples");
  if (ex && !ex.children.length) ex.innerHTML = EXAMPLES.map(e => `<button type="button" class="chip" data-example="${api.esc(e)}">${api.esc(e)}</button>`).join("");
  renderEngine();
  if (last) last.run = runQuery(last.q);
  renderResult();
  if (prefs.auto && !engine && !loading && navigator.gpu) loadModel();
}

window.TSAsk = { render, ask };
})();
