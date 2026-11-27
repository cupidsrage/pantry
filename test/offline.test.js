import test from "node:test";
import assert from "node:assert/strict";
import { applyOp, applyOps, cleanOps, newRef, pendingChanges, matches } from "../lib/offline.js";

const row = (id, name, over = {}) =>
  ({ id, name, packages: 1, base_unit: "count", pkg_label: "each", pkg_base: 1, checked: 0, client_id: "", ...over });

test("a new ref is a client id the server will accept", () => {
  const r = newRef();
  assert.match(r, /^c_[a-z0-9]+$/);
  assert.notEqual(r, newRef());
  assert.equal(cleanOps([{ op: "delete", ref: r }]).length, 1);
});

test("an item added offline shows at once, unchecked", () => {
  const ref = newRef();
  const [op] = cleanOps([{ op: "add", ref, name: " eggs ", packages: 2 }]);
  const out = applyOp([], op);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, ref);
  assert.equal(out[0].name, "eggs");
  assert.equal(out[0].packages, 2);
  assert.equal(out[0].checked, 0);
});

test("adding the same ref twice (a replayed batch) adds it once", () => {
  const ref = newRef();
  const ops = cleanOps([{ op: "add", ref, name: "milk" }, { op: "add", ref, name: "milk" }]);
  assert.equal(applyOps([], ops).length, 1);
});

test("ops against a client id still find the row after it has synced", () => {
  const ref = newRef();
  // the server's answer: a real id, carrying the phone's id along
  const synced = [row(7, "milk", { client_id: ref })];
  assert.ok(matches(synced[0], ref));
  const out = applyOps(synced, cleanOps([{ op: "set", ref, checked: true }]));
  assert.equal(out[0].checked, 1);
});

test("set changes only the fields it names", () => {
  const out = applyOp([row(1, "bread", { packages: 3 })], { op: "set", ref: 1, checked: 1 });
  assert.equal(out[0].packages, 3);
  assert.equal(out[0].checked, 1);
});

test("purchase removes only the named rows that are checked", () => {
  const list = [row(1, "a", { checked: 1 }), row(2, "b", { checked: 1 }), row(3, "c")];
  const out = applyOp(list, { op: "purchase", refs: [1, 3] });
  assert.deepEqual(out.map((x) => x.id), [2, 3]); // 2 wasn't named, 3 wasn't checked
});

test("malformed ops are dropped, not fatal", () => {
  assert.equal(cleanOps("nope"), null);
  const ops = cleanOps([
    null, { op: "bogus" }, { op: "add", ref: "c_abcd", name: "" }, { op: "add", ref: 5, name: "x" },
    { op: "set", ref: 1 }, { op: "set", ref: "'; drop", checked: 1 }, { op: "purchase", refs: [] },
    { op: "delete", ref: 4 },
  ]);
  assert.deepEqual(ops, [{ op: "delete", ref: 4 }]);
});

test("quantities are whole packages of at least one", () => {
  const [a, s] = cleanOps([{ op: "add", ref: "c_abcd", name: "x", packages: -3 }, { op: "set", ref: 1, packages: 2.6 }]);
  assert.equal(a.packages, 1);
  assert.equal(s.packages, 3);
});

test("a section must be a known one, or empty to go back to the guess", () => {
  const [a, b] = cleanOps([{ op: "set", ref: 1, section: "dairy" }, { op: "set", ref: 1, section: "" }]);
  assert.equal(a.section, "dairy");
  assert.equal(b.section, "");
  assert.deepEqual(cleanOps([{ op: "set", ref: 1, section: "moon" }]), []);
});

test("pending changes counts items, not taps", () => {
  assert.equal(pendingChanges([
    { op: "set", ref: 1, checked: 1 }, { op: "set", ref: 1, checked: 0 }, { op: "set", ref: 1, checked: 1 },
    { op: "add", ref: "c_abcd", name: "x" }, { op: "purchase", refs: [1, 2] },
  ]), 3);
});
