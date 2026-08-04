// Times written into recipe steps: "bake for 45-50 minutes" -> 45 minutes.
//
// Two things read this. Cook mode turns each duration into a one-tap countdown,
// and the cook-along scheduler in cookalong.js uses the same numbers to work out
// when a step has to start for everything to land at once. They have to agree:
// a step whose timer says 45 minutes but whose schedule assumes 10 would put the
// chicken in the oven half an hour late.

import { niceQty } from "./units.js";

export const DUR_UNITS = {
  h: 3600, hr: 3600, hrs: 3600, hour: 3600, hours: 3600,
  m: 60, min: 60, mins: 60, minute: 60, minutes: 60,
  s: 1, sec: 1, secs: 1, second: 1, seconds: 1,
};
const DUR_FRACS = { "½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3 };
const DUR_RE = /(\d+(?:\.\d+)?|[½¼¾⅓⅔])\s*(?:(?:to|or|–|—|-)\s*(\d+(?:\.\d+)?))?\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/gi;
const shortUnit = (u) => (DUR_UNITS[u.toLowerCase()] === 3600 ? "hr" : DUR_UNITS[u.toLowerCase()] === 60 ? "min" : "sec");

// Durations mentioned in a step, e.g. "bake 45-50 minutes" -> one 45 min timer.
// Ranges start at the low end so you check the food before it overcooks.
export function parseDurations(text) {
  const raw = [];
  let m;
  DUR_RE.lastIndex = 0;
  while ((m = DUR_RE.exec(String(text || "")))) {
    const unit = DUR_UNITS[m[3].toLowerCase()];
    const lo = DUR_FRACS[m[1]] != null ? DUR_FRACS[m[1]] : parseFloat(m[1]);
    const hi = m[2] ? parseFloat(m[2]) : null;
    if (!(lo > 0)) continue;
    raw.push({
      start: m.index, end: m.index + m[0].length, unit, ranged: hi != null,
      secs: Math.round(lo * unit),
      label: `${niceQty(lo)}${hi != null ? `–${niceQty(hi)}` : ""} ${shortUnit(m[3])}`,
    });
  }
  // "1 hour 30 minutes" is one timer, not two.
  const merged = [];
  for (const d of raw) {
    const prev = merged[merged.length - 1];
    const between = prev ? String(text).slice(prev.end, d.start).trim().replace(/^(and|,|&)$/i, "") : null;
    if (prev && between === "" && d.unit < prev.unit && !prev.ranged && !d.ranged) {
      prev.secs += d.secs; prev.label += ` ${d.label}`; prev.end = d.end;
    } else merged.push(d);
  }
  return merged
    .filter((d) => d.secs >= 10 && d.secs <= 12 * 3600)
    .filter((d, i, a) => a.findIndex((x) => x.secs === d.secs) === i);
}

// The longest duration in a step, in minutes (0 if the step gives no time).
// The longest rather than the first: "stir for 30 seconds, then simmer 20
// minutes" is a step that occupies the stove for twenty minutes, not thirty
// seconds, and the schedule has to reserve the twenty.
export function longestMinutes(text) {
  const durs = parseDurations(text);
  if (!durs.length) return 0;
  return Math.max(...durs.map((d) => d.secs)) / 60;
}
