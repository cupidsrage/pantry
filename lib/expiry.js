// How long something lasts, and how that reads to a human.
//
// Every function takes `now` so the day-boundary arithmetic can be tested at a
// fixed instant instead of whenever the suite happens to run.

export const STORAGE_STATES = ["pantry", "fridge", "freezer", "thawed"];

// Days of shelf life for an item's current storage state (null if unknown).
export function shelfDaysFor(it) {
  const sl = it.shelf_life;
  if (!sl) return null;
  const state = it.storage || sl.where || "pantry";
  const d = sl[state];
  return typeof d === "number" ? d : null;
}

// Expiration timestamp, or null if we can't compute one.
export function expiresAt(it) {
  if (!it.added) return null;
  const days = shelfDaysFor(it);
  if (days == null) return null;
  return it.added + days * 86400000;
}

// Human status: "3d left", "use today", "expired 2d ago". Comparison is by
// calendar day, not elapsed hours, so something expiring at 11pm tonight reads
// "use today" rather than "0.9d left".
export function expiryLabel(it, now = Date.now()) {
  const exp = expiresAt(it);
  if (exp == null) return null;
  const dayMs = 86400000;
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const expDay = new Date(exp); expDay.setHours(0, 0, 0, 0);
  const diff = Math.round((expDay - today) / dayMs);
  const base = (text, tone) => ({ text, tone, days: diff });
  if (diff < 0) return base(`expired ${-diff}d ago`, "bad");
  if (diff === 0) return base("use today", "warn");
  if (diff <= 3) return base(`${diff}d left`, "warn");
  if (diff <= 14) return base(`${diff}d left`, "ok");
  if (diff < 60) return base(`~${Math.round(diff / 7)}wk left`, "ok");
  return base(`~${Math.round(diff / 30)}mo left`, "ok");
}
