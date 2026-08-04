// Cooking several recipes at once, on one pair of hands.
//
// Cooking two dishes is not twice one dish. The hard part isn't the work, it's
// the interleaving: the rice needs starting before the curry, the chicken has to
// go in early enough that its 40 minutes are over when everything else is done,
// and you can only chop one thing at a time. Doing that in your head is what
// makes it stressful, and it's arithmetic — so do the arithmetic here.
//
// The model is deliberately small:
//
//   * Every step costs some ACTIVE minutes (you, at the counter) and possibly
//     some UNATTENDED minutes afterwards (the oven, with you elsewhere).
//   * There is one cook. Active stretches may never overlap.
//   * Unattended stretches may overlap anything — that's the whole point of
//     them, and it's where the time saving comes from.
//
// Everything is then scheduled BACKWARDS from when you want to eat, so each dish
// is finished at the same moment rather than one going cold while the other
// cooks. Where two dishes want your hands at once, the one that can afford to
// move goes earlier — which shows up honestly in the plan as food that's ready
// early and waits, not as a step that silently overruns.

import { longestMinutes } from "./durations.js";
import { norm, showBase } from "./units.js";

// Steps that cook without you. "Bake 40 minutes" costs a minute of your time and
// then 40 minutes of the oven's. Anything not on this list is assumed to need
// you for its whole duration, which is the safe way round to be wrong: the plan
// reserves hands you might not have needed rather than double-booking them.
const UNATTENDED_RE = /\b(bake|baked|baking|roast|roasted|roasting|simmer|simmers|simmered|simmering|braise|braised|braising|broil|broiling|chill|chilled|chilling|refrigerate|refrigerated|marinate|marinated|marinating|rest|rests|rested|resting|rise|rising|proof|proofing|soak|soaked|soaking|steep|steeping|cool|cooled|cooling|freeze|freezing|thaw|thawing|preheat|preheating|oven|slow.?cooker|pressure.?cooker|instant.?pot|ferment|fermenting|reduce|reducing|steam|steaming|boil|boiling|toast|toasting|stand)\b/i;

export const SETUP_MIN = 2;      // hands-on cost of starting an unattended step
export const DEFAULT_STEP_MIN = 5; // a step that names no time and whose recipe has no total
export const MIN_STEP_MIN = 2;
export const MAX_STEP_MIN = 25;

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const MIN = 60000;

// True when a step's text says the cooking happens without you.
export const isUnattended = (text) => UNATTENDED_RE.test(String(text || ""));

// Split a recipe's steps into active and unattended minutes.
//
// Steps that state a time are believed. Steps that don't share out whatever is
// left of the recipe's own prep+cook estimate, so a recipe that says "35 min"
// still adds up to about 35 even though only two of its steps name a number.
export function timedSteps(recipe) {
  const rows = (recipe.steps || [])
    .map((s) => String(s == null ? "" : s))
    .filter((s) => s.trim())
    .map((text, index) => {
      const mins = longestMinutes(text);
      if (mins > 0 && isUnattended(text))
        return { index, text, activeMin: SETUP_MIN, passiveMin: Math.max(1, Math.round(mins)), timed: true };
      if (mins > 0)
        return { index, text, activeMin: Math.max(1, Math.round(mins)), passiveMin: 0, timed: true };
      return { index, text, activeMin: 0, passiveMin: 0, timed: false };
    });

  const untimed = rows.filter((r) => !r.timed);
  if (untimed.length) {
    const spoken = rows.reduce((s, r) => s + r.activeMin + r.passiveMin, 0);
    const total = (Number(recipe.prep_min) || 0) + (Number(recipe.cook_min) || 0);
    const spare = Math.max(0, total - spoken);
    const each = spare > 0
      ? clamp(Math.round(spare / untimed.length), MIN_STEP_MIN, MAX_STEP_MIN)
      : DEFAULT_STEP_MIN;
    for (const r of untimed) r.activeMin = each;
  }
  return rows;
}

const overlaps = (a1, a2, b1, b2) => a1 < b2 && b1 < a2;

// Build one interleaved timeline for a set of dishes.
//
// Pass `serveAt` to cook towards a time ("everything on the table at 7"), or
// `startAt` to start now and be told when dinner lands. Times are epoch ms;
// everything is scheduled relative, so the caller's clock is the only clock.
//
// The scheduler is a backwards pass. Each dish is laid out as late as it can
// be — last step ending at the serve time, each earlier step ending where the
// next one begins. Steps are then committed one at a time, latest first, and
// when an active stretch lands on one already committed it slides earlier until
// it fits, dragging the rest of that dish's earlier steps with it. Only active
// stretches collide; unattended ones are allowed to pile up.
export function planCookAlong({ dishes = [], serveAt = null, startAt = null } = {}) {
  const prepared = dishes
    .map((d, i) => ({
      id: d.id != null ? d.id : i,
      title: d.title || `Dish ${i + 1}`,
      order: i,
      servings: Number(d.servings) > 0 ? Number(d.servings) : 1,
      steps: timedSteps(d),
    }))
    .filter((d) => d.steps.length);

  const anchor = Number.isFinite(serveAt) ? serveAt : 0;
  const state = prepared.map((d) => ({ d, i: d.steps.length - 1, deadline: anchor }));
  const committed = []; // active stretches already fixed in place
  const events = [];

  for (;;) {
    const live = state.filter((s) => s.i >= 0);
    if (!live.length) break;

    // Whichever step could run latest is placed first — working right to left
    // means a step never has to move once it's down.
    let best = null, bestEnd = -Infinity;
    for (const s of live) {
      const st = s.d.steps[s.i];
      const end = s.deadline - st.passiveMin * MIN;
      if (end > bestEnd || (end === bestEnd && best && s.d.order < best.d.order)) { best = s; bestEnd = end; }
    }

    const st = best.d.steps[best.i];
    let activeEnd = bestEnd;
    let activeStart = activeEnd - st.activeMin * MIN;
    if (st.activeMin > 0) {
      // Slide earlier until this stretch has the cook to itself. Each pass moves
      // strictly earlier and there are finitely many committed stretches, so
      // this settles; the guard is only there to make that obvious.
      for (let guard = 0; guard < 500; guard++) {
        const clash = committed.filter((c) => overlaps(activeStart, activeEnd, c.start, c.end));
        if (!clash.length) break;
        activeEnd = Math.min(...clash.map((c) => c.start));
        activeStart = activeEnd - st.activeMin * MIN;
      }
      committed.push({ start: activeStart, end: activeEnd });
    }

    // Anything the step was pushed back by moves its unattended tail back too —
    // the roast doesn't cook longer because it went in early, it just comes out
    // early and waits.
    const shift = bestEnd - activeEnd;
    events.push({
      key: `${best.d.id}:${st.index}`,
      dishId: best.d.id, dishTitle: best.d.title, dishIndex: best.d.order,
      stepIndex: st.index, text: st.text,
      activeMin: st.activeMin, passiveMin: st.passiveMin,
      start: activeStart,
      handsFreeAt: activeEnd,
      readyAt: best.deadline - shift,
      waitMin: 0, // filled in below, once the following step's start is known
    });
    best.deadline = activeStart;
    best.i--;
  }

  events.sort((a, b) => a.start - b.start || a.dishIndex - b.dishIndex);

  // How long each step's output sits before the dish moves on (or before you
  // eat). This is the number that tells you the plan is honest — a long wait on
  // the last step of a dish means it will be lukewarm.
  for (const d of prepared) {
    const mine = events.filter((e) => e.dishId === d.id).sort((a, b) => a.stepIndex - b.stepIndex);
    mine.forEach((e, i) => {
      const next = i + 1 < mine.length ? mine[i + 1].start : anchor;
      e.waitMin = Math.max(0, Math.round((next - e.readyAt) / MIN));
    });
  }

  const firstStart = events.length ? Math.min(...events.map((e) => e.start)) : anchor;
  // "Start now" mode: slide the whole thing so the first step is at startAt.
  const delta = (!Number.isFinite(serveAt) && Number.isFinite(startAt)) ? startAt - firstStart : 0;
  if (delta) for (const e of events) { e.start += delta; e.handsFreeAt += delta; e.readyAt += delta; }

  const begin = firstStart + delta;
  const eat = anchor + delta;
  return {
    events,
    startAt: begin,
    serveAt: eat,
    spanMin: Math.round((eat - begin) / MIN),
    handsOnMin: events.reduce((s, e) => s + e.activeMin, 0),
    dishes: prepared.map((d) => {
      const mine = events.filter((e) => e.dishId === d.id);
      return {
        id: d.id, title: d.title, order: d.order, servings: d.servings,
        steps: d.steps.length,
        startAt: mine.length ? Math.min(...mine.map((e) => e.start)) : eat,
        readyAt: mine.length ? Math.max(...mine.map((e) => e.readyAt)) : eat,
      };
    }),
    conflicts: ovenConflicts(events),
  };
}

// The oven temperature a step calls for, or null. "Bake at 425°F" -> 425.
// Celsius is kept as written; nobody wants a converted number they then have to
// convert back to find the dial.
export function ovenTemp(text) {
  const s = String(text || "");
  // With a unit letter ("425F", "220 °C"), with only degrees ("400 degrees"), or
  // bare after the word that introduces it ("preheat the oven to 425"). The last
  // one refuses a number followed by a letter so "reduce to 200 ml" isn't a
  // temperature.
  const m = /(\d{2,3})\s*(?:°|degrees?)?\s*([FC])\b/i.exec(s)
    || /(\d{2,3})\s*(?:°|\bdegrees?\b)/i.exec(s)
    || /\b(?:to|at)\s+(\d{3})(?!\s*[a-z])/i.exec(s);
  if (!m) return null;
  const deg = Number(m[1]);
  if (!(deg >= 50)) return null;
  // No letter given: an oven set above 250 is being read in Fahrenheit.
  const unit = m[2] ? m[2].toUpperCase() : deg >= 250 ? "F" : "C";
  return { deg, unit, label: `${deg}°${unit}` };
}

// Two dishes wanting the oven at different temperatures at the same time is the
// one clash the schedule cannot fix by moving things around, so it's reported
// rather than silently planned. Same temperature is fine — that's just a full
// oven.
export function ovenConflicts(events) {
  const oven = events
    .filter((e) => e.passiveMin > 0 && /\b(bake|baking|roast|roasting|oven|broil)\b/i.test(e.text))
    .map((e) => ({ e, temp: ovenTemp(e.text) }))
    .filter((x) => x.temp);
  const out = [];
  for (let i = 0; i < oven.length; i++) {
    for (let j = i + 1; j < oven.length; j++) {
      const a = oven[i], b = oven[j];
      if (a.e.dishId === b.e.dishId) continue;
      if (a.temp.deg === b.temp.deg && a.temp.unit === b.temp.unit) continue;
      if (!overlaps(a.e.start, a.e.readyAt, b.e.start, b.e.readyAt)) continue;
      out.push({
        from: Math.max(a.e.start, b.e.start),
        to: Math.min(a.e.readyAt, b.e.readyAt),
        a: { dishTitle: a.e.dishTitle, temp: a.temp.label },
        b: { dishTitle: b.e.dishTitle, temp: b.temp.label },
      });
    }
  }
  return out;
}

// Everything the whole session needs, totalled per ingredient and scaled by each
// dish's servings — so you chop all the onion once instead of finding out at
// step 9 that the other recipe wanted some too.
//
// `parts` keeps the per-dish amounts in their original written units, because
// "500 g onion" is a worse instruction than "2 for the curry, 1 for the soup".
export function mergeIngredients(dishes) {
  const byName = new Map();
  for (const d of dishes) {
    const mult = Number(d.servings) > 0 ? Number(d.servings) : 1;
    for (const ing of (d.ingredients || [])) {
      if (!ing || !ing.name) continue;
      const key = norm(ing.name);
      if (!byName.has(key)) {
        byName.set(key, {
          name: ing.name, base_unit: ing.base_unit || "count",
          pkg_label: ing.pkg_label || "each",
          pkg_base: Number(ing.pkg_base) > 0 ? Number(ing.pkg_base) : 1,
          use_base: 0, parts: [],
        });
      }
      const g = byName.get(key);
      g.use_base = +(g.use_base + (Number(ing.use_base) || 0) * mult).toFixed(2);
      g.parts.push({
        title: d.title || "",
        qty: (Number(ing.use_qty) || 0) * mult,
        unit: ing.use_unit || "",
      });
    }
  }
  const out = [...byName.values()];
  for (const g of out) g.amount = showBase(g.use_base, g.base_unit);
  // Shared ingredients first — those are the ones worth prepping in one go.
  return out.sort((a, b) => b.parts.length - a.parts.length || a.name.localeCompare(b.name));
}

// What to subtract from the pantry when the whole session is done: one line per
// ingredient, servings already applied. Same shape /api/cook takes.
export function cookItems(dishes) {
  return mergeIngredients(dishes).map((g) => ({ name: g.name, use_base: g.use_base }));
}
