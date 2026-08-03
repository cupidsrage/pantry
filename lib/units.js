// Amounts and item names.
//
// Shared by both sides: server.js imports this directly, and the browser gets it
// from /lib (mounted in server.js). Keeping one copy matters most for norm() —
// the browser uses it to decide whether a recipe shows "✓ can make", and the
// server uses it to decide which pantry batch to subtract when you cook. If the
// two rules ever drifted apart, nothing would break loudly; the badge would just
// quietly disagree with the stock math.

// Purchase units the user can pick, each mapping to a base unit (g / ml / count)
// with a factor: amount * factor = base amount. label is what shows in the dropdown.
export const UNITS = [
  { key: "count",  label: "count / each", base: "count", factor: 1 },
  { key: "g",      label: "grams (g)",    base: "g",     factor: 1 },
  { key: "kg",     label: "kilograms (kg)", base: "g",   factor: 1000 },
  { key: "oz",     label: "ounces (oz)",  base: "g",     factor: 28.35 },
  { key: "lb",     label: "pounds (lb)",  base: "g",     factor: 453.6 },
  { key: "ml",     label: "milliliters (ml)", base: "ml", factor: 1 },
  { key: "l",      label: "liters (L)",   base: "ml",    factor: 1000 },
  { key: "floz",   label: "fluid oz",     base: "ml",    factor: 29.57 },
  { key: "cup",    label: "cups",         base: "ml",    factor: 236.6 },
  { key: "tbsp",   label: "tablespoons",  base: "ml",    factor: 14.79 },
  { key: "tsp",    label: "teaspoons",    base: "ml",    factor: 4.93 },
  { key: "stick",  label: "sticks butter", base: "g",   factor: 113 },
  { key: "can",    label: "cans (~400g)", base: "g",     factor: 400 },
  { key: "clove",  label: "cloves",       base: "count", factor: 1 },
];

// Unknown keys fall back to "count / each" rather than throwing — a bad unit
// should degrade to a sane default, not break the page.
export const unitByKey = (k) => UNITS.find((u) => u.key === k) || UNITS[0];

export function showBase(base, unit) {
  if (unit === "count") return `${+base.toFixed(1)}`;
  if (unit === "g") return base >= 1000 ? `${(base / 1000).toFixed(2)} kg` : `${Math.round(base)} g`;
  if (unit === "ml") return base >= 1000 ? `${(base / 1000).toFixed(2)} L` : `${Math.round(base)} ml`;
  return `${+base.toFixed(1)} ${unit}`;
}

export function pkgsFromBase(base, pkgBase) {
  return pkgBase > 0 ? base / pkgBase : 0;
}

// Item names match loosely: lowercased, trimmed, and de-pluralized, so
// "Tomatoes" in a recipe finds "tomato" in the pantry.
//
// The "-oes" and "-ies" cases have to come first: chopping a bare trailing "s"
// turns "tomatoes" into "tomatoe" and "berries" into "berrie", neither of which
// matches its own singular — so a recipe calling for tomatoes would not see the
// tomatoes sitting in the pantry.
//
// It stays deliberately crude beyond that. "hummus" -> "hummu" and "peaches" ->
// "peache" are wrong as English, but harmless here: every comparison runs both
// sides through this function, so a name only has to match itself.
export const norm = (s) => String(s).toLowerCase().trim()
  .replace(/ies$/, "y")
  .replace(/oes$/, "o")
  .replace(/s$/, "");
