// Generated posters.
//
// Real poster art is not available under a licence that allows a public site
// (IMDb's terms rule it out, and Wikipedia's posters are non-free fair-use
// uploads), so every title gets a typeset poster instead: one of six Swiss-
// style compositions, chosen and positioned deterministically from the title
// id, in a palette hand-tuned for its lead genre. The same title always gets
// the same poster, and neighbouring titles rarely look alike.
//
// Everything is CSS background layers on one element — no images, no canvas,
// nothing to download — so a grid of a hundred posters costs almost nothing.
(function () {
  "use strict";

  // [ground, mid, accent] per genre. Grounds are dark enough that white type
  // always sits on them comfortably; accents carry the genre's character.
  const PALETTES = {
    "Drama":           ["#24131c", "#5e2738", "#e8836b"],
    "Comedy":          ["#1f1a0b", "#6e520f", "#f6c445"],
    "Thriller":        ["#0c1626", "#1c3657", "#7cb1e6"],
    "Crime":           ["#1a0f11", "#521b1c", "#e2584b"],
    "Mystery":         ["#131027", "#352a63", "#a597ea"],
    "Science fiction": ["#06181f", "#0d4655", "#5cd6e2"],
    "Fantasy":         ["#0d1f17", "#285638", "#9edc88"],
    "Horror":          ["#120909", "#390d10", "#d23a32"],
    "Action":          ["#211108", "#70300e", "#ff8b3d"],
    "Adventure":       ["#191c0b", "#4e5a18", "#d7e25a"],
    "Romance":         ["#260e1c", "#71254b", "#f38dbb"],
    "Animation":       ["#22110a", "#803f14", "#ffb46a"],
    "Documentary":     ["#10171b", "#344b56", "#bcd0d9"],
    "History":         ["#1d170d", "#614a21", "#e5c47a"],
    "War":             ["#14170f", "#40482f", "#b8bf8c"],
    "Biography":       ["#1c150f", "#56412e", "#e2b68b"],
    "Musical":         ["#1f0e27", "#632776", "#e79bf2"],
    "Sport":           ["#0b1c14", "#1b623d", "#6fe49b"],
    "Family":          ["#0c1c1f", "#1f5e63", "#8fe4dc"],
    "Western":         ["#21150a", "#724519", "#f2a45e"]
  };
  const FALLBACK = ["#121619", "#343e47", "#c8d2d9"];

  function hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  // A small deterministic stream of numbers in [0, 1) per title.
  function stream(seed) {
    let x = seed || 1;
    return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) % 10000) / 10000; };
  }
  function rgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
  }
  const pct = v => (v * 100).toFixed(1) + "%";

  const LAYOUTS = [
    // sun: one large disc, the classic festival-poster move
    (p, r) => {
      const x = 22 + r() * 56, y = 16 + r() * 34, s = 26 + r() * 16;
      return [`radial-gradient(circle at ${x}% ${y}%, ${p[2]} 0 ${s}%, transparent ${s + 0.4}%)`,
              `linear-gradient(170deg, ${p[1]} 0%, ${p[0]} 78%)`];
    },
    // rings: concentric circles radiating from an off-canvas point
    (p, r) => {
      const x = r() < 0.5 ? -8 : 108, y = 10 + r() * 40, gap = 9 + Math.round(r() * 6);
      return [`repeating-radial-gradient(circle at ${x}% ${y}%, ${rgba(p[2], 0.55)} 0 2px, transparent 2px ${gap}px)`,
              `linear-gradient(180deg, ${p[1]} 0%, ${p[0]} 70%)`];
    },
    // band: one diagonal stripe across the frame
    (p, r) => {
      const a = 18 + Math.round(r() * 50) * (r() < 0.5 ? 1 : -1), at = 22 + r() * 30, w = 9 + r() * 8;
      return [`linear-gradient(${a}deg, transparent ${at}%, ${p[2]} ${at}% ${at + w}%, ${rgba(p[2], 0.35)} ${at + w}% ${at + w + 3}%, transparent ${at + w + 3}%)`,
              `linear-gradient(165deg, ${p[1]} 0%, ${p[0]} 80%)`];
    },
    // horizon: two fields and a low sun sitting on the line
    (p, r) => {
      const h = 38 + r() * 18, x = 25 + r() * 50;
      return [`radial-gradient(circle at ${x}% ${h}%, ${p[2]} 0 13%, transparent 13.4%)`,
              `linear-gradient(180deg, ${p[1]} 0 ${h}%, ${p[0]} ${h}% 100%)`];
    },
    // stripes: a vertical rhythm, faded toward the type
    (p, r) => {
      const w = 5 + Math.round(r() * 4), g = w + 10 + Math.round(r() * 10);
      return [`linear-gradient(180deg, transparent 0 30%, ${p[0]} 82%)`,
              `repeating-linear-gradient(90deg, ${rgba(p[2], 0.5)} 0 ${w}px, transparent ${w}px ${g}px)`,
              `linear-gradient(180deg, ${p[1]}, ${p[0]})`];
    },
    // quarter: a disc rising from one corner
    (p, r) => {
      const left = r() < 0.5, s = 52 + r() * 18;
      return [`radial-gradient(circle at ${left ? "0%" : "100%"} 0%, ${p[2]} 0 ${s}%, ${rgba(p[2], 0.25)} ${s}% ${s + 8}%, transparent ${s + 8.4}%)`,
              `linear-gradient(200deg, ${p[1]} 0%, ${p[0]} 70%)`];
    }
  ];

  const cache = new Map();

  // The inline style for a title's poster.
  function style(t) {
    if (cache.has(t.id)) return cache.get(t.id);
    const p = PALETTES[t.genres[0]] || FALLBACK;
    const seed = hash(t.id);
    const r = stream(seed);
    const layers = LAYOUTS[seed % LAYOUTS.length](p, r);
    const css = `background:${layers.join(",")};--pa:${p[2]}`;
    cache.set(t.id, css);
    return css;
  }

  // The accent colour, for small marks that should match the poster.
  function accent(t) { return (PALETTES[t.genres[0]] || FALLBACK)[2]; }

  window.TSPoster = { style, accent };
})();
