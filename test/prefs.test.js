import test from "node:test";
import assert from "node:assert/strict";
import { defaultPrefs, normalizePrefs, visibleTabs, effectiveTheme, accentColors, moveTab, toggleTab, withTheme, isHolidaySeason, tabLabel, tabIcon, ACCENTS, TABS } from "../lib/prefs.js";

test("the old one-switch theme carries over", () => {
  assert.equal(defaultPrefs("daylight").theme, "light");
  assert.equal(defaultPrefs("daylight").wording, "plain");
  assert.equal(defaultPrefs("dracula").theme, "dark");
  assert.equal(defaultPrefs(null).wording, "gothic");
});

test("anything stored comes out complete and valid", () => {
  for (const junk of [null, "x", 5, [], { theme: "neon", textSize: 99, tabs: "no", vibrate: "yes" }]) {
    const p = normalizePrefs(junk);
    assert.deepEqual(Object.keys(p).sort(), Object.keys(defaultPrefs()).sort());
    assert.equal(p.theme, "dark");
    assert.equal(p.textSize, "m");
    assert.equal(p.vibrate, true);
    assert.equal(p.tabs.length, TABS.length);
  }
  const p = normalizePrefs({ theme: "auto", accent: "blue", textSize: "xl", bigButtons: true, tabsAt: "top" });
  assert.equal(p.theme, "auto"); assert.equal(p.accent, "blue"); assert.equal(p.textSize, "xl");
  assert.equal(p.bigButtons, true); assert.equal(p.tabsAt, "top");
});

test("tab order is kept, duplicates and unknowns dropped, new tabs added at the end", () => {
  const p = normalizePrefs({ tabs: [{ key: "list" }, { key: "list" }, { key: "moon" }, { key: "pantry", show: false }] });
  assert.deepEqual(p.tabs.slice(0, 2), [{ key: "list", show: true }, { key: "pantry", show: false }]);
  assert.equal(p.tabs.length, TABS.length);
  assert.deepEqual(visibleTabs(p).map((t) => t.key).slice(0, 2), ["list", "recipe"]);
});

test("at least one tab always shows, and the app never opens on a hidden one", () => {
  const none = normalizePrefs({ tabs: TABS.map((t) => ({ key: t.key, show: false })) });
  assert.equal(visibleTabs(none).length, 1);
  const p = normalizePrefs({ startTab: "plan", tabs: [{ key: "plan", show: false }] });
  assert.equal(p.startTab, "last");
  let q = defaultPrefs();
  for (const t of TABS.slice(1)) q = toggleTab(q, t.key);
  assert.equal(visibleTabs(q).length, 1);
  assert.equal(toggleTab(q, TABS[0].key), q, "the last tab showing can't be hidden");
});

test("tabs move up and down, not off either end", () => {
  const p = defaultPrefs();
  const first = p.tabs[0].key;
  assert.equal(moveTab(p, first, -1), p);
  assert.equal(moveTab(p, first, 1).tabs[1].key, first);
});

test("theme and accent resolve for both themes", () => {
  assert.equal(effectiveTheme({ theme: "auto" }, true), "dark");
  assert.equal(effectiveTheme({ theme: "auto" }, false), "light");
  assert.equal(effectiveTheme({ theme: "light" }, true), "light");
  assert.equal(accentColors({ accent: "default" }, "dark"), null);
  for (const [k, a] of Object.entries(ACCENTS)) {
    if (k === "default") continue;
    for (const th of ["dark", "light"]) {
      for (const f of ["accent", "hover", "ink", "soft", "softBorder", "focus"]) assert.match(a[th][f], /^#[0-9a-f]{6}$/, `${k}.${th}.${f}`);
    }
  }
});

// White on the accent fill and the ink on the background must stay readable.
const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
test("accent colours are readable on both themes", () => {
  for (const [k, a] of Object.entries(ACCENTS)) {
    if (k === "default") continue;
    assert.ok(contrast(a.dark.accent, "#ffffff") >= 4.5, `${k} dark fill`);
    assert.ok(contrast(a.light.accent, "#ffffff") >= 4.5, `${k} light fill`);
    assert.ok(contrast(a.dark.ink, "#161014") >= 4.5, `${k} dark ink`);
    assert.ok(contrast(a.light.ink, "#ffffff") >= 4.5, `${k} light ink`);
  }
});

test("Christmas: a theme of its own, bringing its wording with it and taking it away again", () => {
  const p = withTheme(defaultPrefs("daylight"), "christmas");
  assert.equal(p.theme, "christmas");
  assert.equal(p.wording, "festive");
  assert.equal(effectiveTheme(p, false), "christmas");
  const back = withTheme(p, "light");
  assert.equal(back.wording, "plain");
  // someone who chose spooky words for their Christmas keeps them
  const spooky = withTheme({ ...p, wording: "gothic" }, "dark");
  assert.equal(spooky.wording, "gothic");
  // and an accent on Christmas uses the dark tuning
  assert.equal(accentColors({ accent: "blue" }, "christmas"), ACCENTS.blue.dark);
});

test("festive tab names and icons", () => {
  const list = TABS.find((t) => t.key === "list");
  assert.equal(tabLabel(list, "festive"), "Santa's List");
  assert.equal(tabLabel(list, "gothic"), "Hunt");
  assert.equal(tabLabel(list, "plain"), "List");
  assert.equal(tabIcon(list, "plain"), "🛒");
  for (const t of TABS) { assert.ok(t.festive && t.festiveIcon, t.key); assert.ok(t.festive.length <= 14, t.festive); }
});

test("the holiday season runs 20 November to 6 January", () => {
  const d = (m, day) => new Date(2026, m - 1, day);
  assert.equal(isHolidaySeason(d(11, 19)), false);
  assert.equal(isHolidaySeason(d(11, 20)), true);
  assert.equal(isHolidaySeason(d(12, 25)), true);
  assert.equal(isHolidaySeason(d(1, 6)), true);
  assert.equal(isHolidaySeason(d(1, 7)), false);
  assert.equal(isHolidaySeason(d(7, 4)), false);
});
