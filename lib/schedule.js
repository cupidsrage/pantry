// Meal timing: when to eat, when to start cooking, when to pull something out
// of the freezer, and whether a reminder is due right now.
//
// A planned meal is stored as a local wall-clock date + time ('2026-08-03',
// '18:00') because that's what the shopper means — dinner is at six wherever
// they are. Turning that into a real instant needs their timezone.

// Don't fire a reminder that's more than this late. If the server was asleep
// through the moment, "start cooking" an hour after dinner is just noise.
export const REMINDER_WINDOW_MS = 30 * 60 * 1000;

// `tzOffset` is the device's Date.getTimezoneOffset(): minutes to ADD to local
// wall-clock time to get UTC. It is positive west of Greenwich — California in
// summer reports 420 (UTC-7), so 6pm local is 01:00Z the next day.
export function eatAtMs(date, time, tzOffset = 0) {
  const [y, mo, d] = String(date || "").split("-").map(Number);
  const [h, mn] = String(time || "").split(":").map(Number);
  if (![y, mo, d, h, mn].every(Number.isFinite)) return null;
  return Date.UTC(y, mo - 1, d, h, mn) + tzOffset * 60000;
}

// Everything a meal implies, or null if the date/time can't be read.
// cookStart is null for a recipe with no prep or cook time — there's nothing to
// start, so there's nothing to remind about.
export function mealTimes({ date, time, tzOffset = 0, prepMin = 0, cookMin = 0 }) {
  const eatAt = eatAtMs(date, time, tzOffset);
  if (eatAt == null) return null;
  const totalMin = (prepMin || 0) + (cookMin || 0);
  return { eatAt, totalMin, cookStart: totalMin > 0 ? eatAt - totalMin * 60000 : null };
}

// Pull it out this far ahead of the deadline (cooking start, or mealtime if
// there's no cooking to do).
export function thawAtMs(deadline, thawHours) {
  return deadline - thawHours * 3600000;
}

// Due means the moment has arrived but hasn't gone stale.
export function isDue(fireAt, now, windowMs = REMINDER_WINDOW_MS) {
  return fireAt <= now && now - fireAt <= windowMs;
}
