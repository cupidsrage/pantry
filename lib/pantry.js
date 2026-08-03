// Pantry stock: grouping batches for display, and drawing them down when you cook.

import { norm } from "./units.js";
import { expiryLabel } from "./expiry.js";

// Collapse batches (multiple purchases of the same item) into one group per
// item. The group sums the total, keeps every batch, and surfaces the
// soonest-expiring batch so the row can warn about it.
//
// Ordering note: an `added` of 0 means a legacy row with no purchase date. Here
// those sort LAST, so a batch with a real date wins the "oldest" slot and the
// row shows a real expiry instead of nothing. planConsumption below deliberately
// orders them the other way — see the comment there.
export function groupBatches(items, now = Date.now()) {
  const groups = [];
  for (const it of items) {
    let g = groups.find((x) => norm(x.name) === norm(it.name));
    if (!g) {
      g = { name: it.name, base: 0, base_unit: it.base_unit, pkg_label: it.pkg_label,
        pkg_base: it.pkg_base, batches: [] };
      groups.push(g);
    }
    g.base = +(g.base + it.base).toFixed(2);
    g.batches.push(it);
  }
  for (const g of groups) {
    g.batches.sort((a, b) => (a.added || Infinity) - (b.added || Infinity) || a.id - b.id);
    g.oldest = g.batches[0];
    g.expLabel = g.batches.map((b) => expiryLabel(b, now)).filter(Boolean)
      .sort((a, b) => a.days - b.days)[0] || null;
  }
  return groups;
}

// Work out how to take `need` base-units out of stock, oldest batch first,
// without touching the database. Returns what was actually removed (less than
// asked if you're short), which batches to update, and which to delete.
//
// Ordering note: this matches the SQL it replaced (`ORDER BY added ASC, id ASC`),
// so an undated legacy row sorts FIRST and gets used up before dated stock —
// the opposite of groupBatches above. That's deliberate: for display you want a
// real expiry date to win, but for eating you want the genuinely oldest food
// gone first, and an undated row is most likely the oldest thing in there.
export function planConsumption(batches, need) {
  const ordered = [...batches].sort((a, b) => (a.added || 0) - (b.added || 0) || a.id - b.id);
  let want = +need;
  let removed = 0;
  const updates = [];
  const deletes = [];
  for (const b of ordered) {
    if (want <= 0) break;
    const take = Math.min(b.base, want);
    const left = +(b.base - take).toFixed(2);
    want = +(want - take).toFixed(2);
    removed = +(removed + take).toFixed(2);
    if (left <= 0) deletes.push(b.id);
    else updates.push({ id: b.id, left });
  }
  return { removed, updates, deletes };
}
