/* Overhead background calculator: finds visible, high passes for long lists
   (bright satellites, recent launches) without slowing the app down. */
importScripts('core.js');
const O = self.Orbit;
const MIN = 60000;

onmessage = (e) => {
  const { items, loc, from, to, minPeak } = e.data;
  const obs = O.observer(loc.lat, loc.lon, (loc.h || 0) / 1000);

  // Only search while the sky is dark enough (Sun below -4°, sampled every 5 minutes)
  const wins = [];
  let a = null;
  for (let t = from; t <= to; t += 5 * MIN) {
    const dark = O.sunAltitude(obs, t) <= -4;
    if (dark && a == null) a = t;
    if (!dark && a != null) { wins.push([a, t]); a = null; }
  }
  if (a != null) wins.push([a, to]);

  let batch = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    let rec;
    try { rec = O.init(O.fromOMM(it.omm)); } catch { continue; }
    if (rec.error) continue;
    const found = [];
    for (const [wa, wb] of wins) {
      let ps;
      try { ps = O.findPasses(rec, obs, wa - 15 * MIN, wb + 15 * MIN, { step: MIN }); } catch { continue; }
      for (const p of ps) {
        if (!p.visible || p.visible.max.el < minPeak || p.visible.end < from) continue;
        if (found.some((q) => Math.abs(q.all.start - p.all.start) < 2 * MIN)) continue;
        p.name = it.name;
        p.kind = it.kind;
        found.push(p);
      }
    }
    batch.push(...found);
    if ((i + 1) % 15 === 0) {
      postMessage({ type: 'batch', passes: batch, done: i + 1, total: items.length });
      batch = [];
    }
  }
  postMessage({ type: 'done', passes: batch, done: items.length, total: items.length });
};
