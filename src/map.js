// World map of story locations with zoom-dependent clustering. Needs d3 + topojson
// globals and window.WORLD_TOPO. window.TSMap = { init(svg, onPick, onPickMany),
// setPoints(points, selectedKey), zoomBy(k), reset() }.
(function () {
  let svg, g, pinLayer, path, projection, zoom, onPick = null, onPickMany = null;
  const width = 960, height = 560;
  let points = [], selectedKey = null, projected = [];

  function init(svgEl, pick, pickMany) {
    onPick = pick; onPickMany = pickMany;
    svg = d3.select(svgEl).attr("viewBox", `0 0 ${width} ${height}`).attr("preserveAspectRatio", "xMidYMid meet");
    svg.selectAll("*").remove();
    g = svg.append("g");
    projection = d3.geoNaturalEarth1();
    const land = topojson.feature(window.WORLD_TOPO, window.WORLD_TOPO.objects.countries);
    projection.fitExtent([[6, 6], [width - 6, height - 6]], { type: "Sphere" });
    path = d3.geoPath(projection);
    g.append("path").attr("class", "sphere").attr("d", path({ type: "Sphere" }));
    g.append("g").selectAll("path").data(land.features).join("path").attr("class", "land").attr("d", path)
      .append("title").text(d => (d.properties && d.properties.name) || "");
    pinLayer = g.append("g");
    let raf = null;
    zoom = d3.zoom().scaleExtent([1, 24]).translateExtent([[0, 0], [width, height]])
      .on("zoom", ev => { g.attr("transform", ev.transform); if (raf) cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { raf = null; draw(); }); });
    svg.call(zoom);
  }

  function radius(count) { return 3.5 + Math.min(11, Math.sqrt(count) * 2.2); }

  function cluster(k) {
    const cell = 34 / k; const cells = new Map();
    for (const p of projected) {
      const key = Math.floor(p.x / cell) + ":" + Math.floor(p.y / cell);
      let c = cells.get(key);
      if (!c) { c = { key: "c" + key, x: 0, y: 0, count: 0, seen: 0, places: [] }; cells.set(key, c); }
      c.places.push(p); c.count += p.count; c.seen += p.seenCount; c.x += p.x * p.count; c.y += p.y * p.count;
    }
    return [...cells.values()].map(c => {
      const single = c.places.length === 1 ? c.places[0] : null;
      return { key: single ? single.key : c.key, x: c.x / c.count, y: c.y / c.count, count: c.count, places: c.places, single,
        tone: c.seen === 0 ? "" : c.seen === c.count ? "seen" : "mixed",
        selected: c.places.some(p => p.key === selectedKey) };
    }).sort((a, b) => b.count - a.count);
  }

  function draw() {
    if (!pinLayer) return;
    const t = d3.zoomTransform(svg.node()); const k = t.k || 1; const s = 1 / Math.sqrt(k);
    const data = cluster(k);
    const sel = pinLayer.selectAll("g.pt").data(data, d => d.key);
    sel.exit().remove();
    const enter = sel.enter().append("g").attr("class", "pt");
    enter.append("circle");
    enter.append("text").attr("class", "lbl").attr("text-anchor", "middle");
    enter.append("text").attr("class", "cnt").attr("text-anchor", "middle").attr("dominant-baseline", "central");
    enter.append("title");
    const all = enter.merge(sel).attr("transform", d => `translate(${d.x},${d.y})`);
    all.select("circle")
      .attr("class", d => "pin " + d.tone + (d.selected ? " is-on" : "") + (d.single ? "" : " multi"))
      .attr("r", d => radius(d.count) * s).attr("stroke-width", 1.2 * s)
      .on("click", (ev, d) => {
        ev.stopPropagation();
        if (d.single) { onPick && onPick(d.single.key); return; }
        if (k < 10) { svg.transition().duration(450).call(zoom.transform, d3.zoomIdentity.translate(width / 2, height / 2).scale(k * 2.6).translate(-d.x, -d.y)); }
        else onPickMany && onPickMany(d.places.map(p => p.key));
      });
    all.select("text.lbl").text(d => d.single && d.count >= 4 ? d.single.short : "").attr("font-size", 9 * s).attr("dy", d => -(radius(d.count) * s) - 3 * s);
    all.select("text.cnt").text(d => d.single ? "" : d.places.length).attr("font-size", 8.5 * s);
    all.select("title").text(d => d.single ? `${d.single.name} — ${d.count} title${d.count === 1 ? "" : "s"}` : `${d.places.length} places, ${d.count} titles — click to zoom in`);
  }

  function setPoints(pts, selKey) {
    points = pts; selectedKey = selKey;
    projected = points.map(p => { const xy = projection([p.lng, p.lat]) || [0, 0]; return { ...p, x: xy[0], y: xy[1] }; });
    draw();
  }

  function zoomBy(f) { svg.transition().duration(300).call(zoom.scaleBy, f); }
  function reset() { svg.transition().duration(400).call(zoom.transform, d3.zoomIdentity); }

  window.TSMap = { init, setPoints, zoomBy, reset };
})();
