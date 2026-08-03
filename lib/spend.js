// Grocery spending: monthly totals, biggest-spend items, and price movement.

import { norm } from "./units.js";

// `rows` are purchase records ordered newest first. Everything is scoped to the
// most recent `months` months that actually contain purchases, so a gap in
// shopping shifts the window instead of blanking the panel out.
export function summarizeSpend(rows, months = 6) {
  if (!rows.length) return { months: [], top: [], changes: [] };

  const recentYms = [...new Set(rows.map((r) => r.ym))].sort().reverse().slice(0, months);
  const inWindow = rows.filter((r) => recentYms.includes(r.ym));

  const monthTotals = recentYms.map((ym) => {
    const rs = inWindow.filter((r) => r.ym === ym);
    return { ym, total: +rs.reduce((s, r) => s + r.price, 0).toFixed(2), n: rs.length };
  });

  const byName = new Map();
  for (const r of inWindow) {
    const k = norm(r.name);
    if (!byName.has(k)) byName.set(k, { name: r.name, total: 0, n: 0 });
    const g = byName.get(k);
    g.total = +(g.total + r.price).toFixed(2);
    g.n++;
  }
  const top = [...byName.values()].sort((a, b) => b.total - a.total).slice(0, 8);

  // Compare unit price (line total / packages), so buying two of something
  // doesn't read as a price hike. Uses the full history, not just the window,
  // so an item bought rarely still gets a comparison.
  const recent = new Map();
  for (const r of rows) {
    const k = norm(r.name);
    if (!recent.has(k)) recent.set(k, []);
    const list = recent.get(k);
    if (list.length < 2) list.push(r);
  }
  const changes = [];
  for (const [, list] of recent) {
    if (list.length < 2) continue;
    const [cur, prev] = list;
    const unit = +(cur.price / Math.max(1, cur.packages)).toFixed(2);
    const was = +(prev.price / Math.max(1, prev.packages)).toFixed(2);
    if (!(unit > 0) || !(was > 0) || unit === was) continue;
    changes.push({ name: cur.name, unit, was, ym: cur.ym, wasYm: prev.ym,
      pct: +(((unit - was) / was) * 100).toFixed(0) });
  }
  changes.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));

  return { months: monthTotals, top, changes: changes.slice(0, 8) };
}
