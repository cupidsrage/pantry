// The grocery list has to keep working in the store, which is where phone
// signal is worst. So every change to the list is an "op": the phone applies it
// to its own copy straight away, keeps it in an outbox, and sends the outbox to
// /api/list/sync whenever the server can be reached. The server applies the
// same ops in order and answers with the real list; the phone then lays any ops
// that were queued in the meantime back on top of that answer.
//
// The ops:
//   { op: "add",      ref, name, packages, base_unit, pkg_label, pkg_base, section? }
//   { op: "set",      ref, checked?, packages?, section? }   section: lib/aisles.js key, "" = back to the guess
//   { op: "delete",   ref }
//   { op: "purchase", refs: [ref, ...] }   move these (if checked) into the pantry
//
// A ref is either a server id (a number) or, for an item made on the phone
// before the server has seen it, a client id string ("c_..."). The server
// stores that client id on the row, so an op queued against the client id
// still finds the item after it has synced — and a batch sent twice (the reply
// was lost on the way back) doesn't add the item twice.

import { isSection } from "./aisles.js";

export const MAX_OPS = 500;

export function newRef() {
  const rnd = Math.random().toString(36).slice(2, 10);
  return `c_${Date.now().toString(36)}${rnd}`;
}

const isRef = (r) =>
  (Number.isInteger(r) && r > 0) || (typeof r === "string" && /^c_[a-z0-9]{4,40}$/.test(r));

// Does this list row answer to this ref?
export function matches(item, ref) {
  if (item.id === ref) return true;
  return typeof ref === "string" && !!item.client_id && item.client_id === ref;
}

const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);

// Check and tidy ops arriving from a phone. Anything malformed is dropped
// rather than failing the batch: one bad op must never wedge an outbox that
// would otherwise sync. Returns null when the body isn't a list of ops at all.
export function cleanOps(ops) {
  if (!Array.isArray(ops)) return null;
  const out = [];
  for (const o of ops.slice(0, MAX_OPS)) {
    if (!o || typeof o !== "object") continue;
    if (o.op === "add") {
      const name = String(o.name || "").trim().slice(0, 200);
      if (!name || typeof o.ref !== "string" || !isRef(o.ref)) continue;
      out.push({
        op: "add", ref: o.ref, name,
        packages: Math.max(1, Math.round(num(o.packages, 1))),
        base_unit: String(o.base_unit || "count").slice(0, 40),
        pkg_label: String(o.pkg_label || "each").slice(0, 80),
        pkg_base: num(o.pkg_base, 1),
        section: isSection(o.section) ? o.section : "",
      });
    } else if (o.op === "set") {
      if (!isRef(o.ref)) continue;
      const s = { op: "set", ref: o.ref };
      if (o.checked !== undefined) s.checked = o.checked ? 1 : 0;
      if (o.packages !== undefined) s.packages = Math.max(1, Math.round(num(o.packages, 1)));
      if (o.section !== undefined && (o.section === "" || isSection(o.section))) s.section = o.section;
      if (s.checked === undefined && s.packages === undefined && s.section === undefined) continue;
      out.push(s);
    } else if (o.op === "delete") {
      if (isRef(o.ref)) out.push({ op: "delete", ref: o.ref });
    } else if (o.op === "purchase") {
      const refs = Array.isArray(o.refs) ? o.refs.filter(isRef) : [];
      if (refs.length) out.push({ op: "purchase", refs });
    }
  }
  return out;
}

// Apply one op to a list (an array of rows) and return the new list. The
// phone uses this to show a change the moment it's made; it mirrors what the
// server does with the same op.
export function applyOp(list, op) {
  if (op.op === "add") {
    if (list.some((x) => matches(x, op.ref))) return list; // already there (a replay)
    return [...list, {
      id: op.ref, client_id: op.ref, name: op.name, packages: op.packages,
      base_unit: op.base_unit, pkg_label: op.pkg_label, pkg_base: op.pkg_base, checked: 0, section: op.section || "",
    }];
  }
  if (op.op === "set") {
    return list.map((x) => {
      if (!matches(x, op.ref)) return x;
      const y = { ...x };
      if (op.checked !== undefined) y.checked = op.checked ? 1 : 0;
      if (op.packages !== undefined) y.packages = op.packages;
      if (op.section !== undefined) y.section = op.section;
      return y;
    });
  }
  if (op.op === "delete") return list.filter((x) => !matches(x, op.ref));
  if (op.op === "purchase") {
    return list.filter((x) => !(x.checked && op.refs.some((r) => matches(x, r))));
  }
  return list;
}

export const applyOps = (list, ops) => ops.reduce(applyOp, list);

// How many list rows the queued ops touch — the number the phone shows as
// "N changes waiting to sync". Ticking the same item on and off is one change.
export function pendingChanges(ops) {
  const touched = new Set();
  for (const o of ops) {
    if (o.op === "purchase") o.refs.forEach((r) => touched.add(String(r)));
    else touched.add(String(o.ref));
  }
  return touched.size;
}
