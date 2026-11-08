// Handing one person's ratings to the other person, with no server in between.
//
// Everything needed to merge a second taste into the match sits in the URL
// after the "#", which the browser never sends to the host. The payload is a
// name plus (title id, score) pairs, packed as varints, deflated when the
// browser can, then base64url encoded.
//
// Ids are Wikidata item numbers, which are stable for ever, so a link keeps
// working after the library is rebuilt. A title the current library no longer
// carries is skipped rather than breaking the import.
(function () {
  "use strict";

  const VERSION = 1;
  const RAW = 0, DEFLATED = 1;

  function putVarint(out, n) {
    n = n >>> 0;
    while (n > 0x7f) { out.push((n & 0x7f) | 0x80); n >>>= 7; }
    out.push(n);
  }

  function readVarint(bytes, cursor) {
    let n = 0, shift = 0, b;
    do {
      if (cursor.i >= bytes.length) throw new Error("truncated");
      b = bytes[cursor.i++];
      n |= (b & 0x7f) << shift;
      shift += 7;
    } while (b & 0x80);
    return n >>> 0;
  }

  function toBase64Url(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function fromBase64Url(str) {
    const s = str.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(s + "=".repeat((4 - s.length % 4) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function squeeze(bytes, mode) {
    const Stream = mode === "deflate-raw" ? window.CompressionStream : window.DecompressionStream;
    if (!Stream) return null;
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new Stream("deflate-raw"));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch (e) {
      return null;
    }
  }

  // { name, ratings: { qid: 1..5 } } → a string for the URL fragment
  async function encode(obj) {
    const body = [];
    const name = (obj.name || "").slice(0, 24);
    const nameBytes = new TextEncoder().encode(name);
    body.push(nameBytes.length);
    for (const b of nameBytes) body.push(b);
    const ids = Object.keys(obj.ratings || {}).map(Number).filter(n => n > 0).sort((x, y) => x - y);
    putVarint(body, ids.length);
    let prev = 0;
    for (const id of ids) {
      putVarint(body, id - prev);   // deltas on a sorted list pack smaller than raw ids
      prev = id;
      body.push(Math.max(1, Math.min(5, obj.ratings[id] | 0)));
    }
    const raw = new Uint8Array(body);
    const packed = await squeeze(raw, "deflate-raw");
    const useDeflate = packed && packed.length < raw.length;
    const payload = useDeflate ? packed : raw;
    const out = new Uint8Array(payload.length + 2);
    out[0] = VERSION;
    out[1] = useDeflate ? DEFLATED : RAW;
    out.set(payload, 2);
    return toBase64Url(out);
  }

  async function decode(str) {
    try {
      const all = fromBase64Url(str);
      if (all.length < 3 || all[0] !== VERSION) return null;
      let bytes = all.subarray(2);
      if (all[1] === DEFLATED) {
        bytes = await squeeze(bytes, "inflate-raw");
        if (!bytes) return null;
      }
      const cursor = { i: 0 };
      const nameLen = bytes[cursor.i++];
      const name = new TextDecoder().decode(bytes.subarray(cursor.i, cursor.i + nameLen));
      cursor.i += nameLen;
      const count = readVarint(bytes, cursor);
      const ratings = {};
      let prev = 0;
      for (let k = 0; k < count; k++) {
        prev += readVarint(bytes, cursor);
        const score = bytes[cursor.i++];
        if (score >= 1 && score <= 5) ratings[prev] = score;
      }
      return { name, ratings };
    } catch (e) {
      return null;
    }
  }

  window.TSShare = {
    encode,
    decode,
    // The incoming payload, if this page was opened from a shared link.
    pending() {
      const m = /[#&]s=([A-Za-z0-9\-_]+)/.exec(location.hash || "");
      return m ? m[1] : null;
    },
    clearHash() {
      if (location.hash) history.replaceState(null, "", location.pathname + location.search);
    },
    async link(obj) {
      const code = await encode(obj);
      return location.origin + location.pathname + "#s=" + code;
    }
  };
})();
