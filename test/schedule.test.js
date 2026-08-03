import test from "node:test";
import assert from "node:assert/strict";
import { eatAtMs, mealTimes, thawAtMs, isDue, REMINDER_WINDOW_MS } from "../lib/schedule.js";

// Date.getTimezoneOffset() returns minutes to ADD to local time to reach UTC,
// so it is POSITIVE west of Greenwich.
const LA = 420;    // UTC-7, California in summer
const BERLIN = -120; // UTC+2, Germany in summer
const UTC = 0;

const iso = (ms) => new Date(ms).toISOString();

test("a meal time is anchored to the shopper's timezone, not the server's", () => {
  // 6pm dinner in California is 01:00Z the NEXT day. Getting the sign of the
  // offset backwards would land on 11:00Z the same day — 14 hours out.
  assert.equal(iso(eatAtMs("2026-08-03", "18:00", LA)), "2026-08-04T01:00:00.000Z");
  assert.equal(iso(eatAtMs("2026-08-03", "18:00", BERLIN)), "2026-08-03T16:00:00.000Z");
  assert.equal(iso(eatAtMs("2026-08-03", "18:00", UTC)), "2026-08-03T18:00:00.000Z");
});

test("the same wall-clock dinner is a different instant in each timezone", () => {
  const la = eatAtMs("2026-08-03", "18:00", LA);
  const berlin = eatAtMs("2026-08-03", "18:00", BERLIN);
  assert.equal((la - berlin) / 3600000, 9, "California eats 9 hours after Berlin");
});

test("a meal time crossing midnight lands on the right day", () => {
  // 11pm in Berlin is 21:00Z the same day; 11pm in LA is 06:00Z the next.
  assert.equal(iso(eatAtMs("2026-08-03", "23:00", BERLIN)), "2026-08-03T21:00:00.000Z");
  assert.equal(iso(eatAtMs("2026-08-03", "23:00", LA)), "2026-08-04T06:00:00.000Z");
  // And midnight-ish in the other direction.
  assert.equal(iso(eatAtMs("2026-08-03", "00:30", BERLIN)), "2026-08-02T22:30:00.000Z");
});

test("an unreadable date or time yields nothing rather than a wrong instant", () => {
  assert.equal(eatAtMs("", "18:00", LA), null);
  assert.equal(eatAtMs("2026-08-03", "", LA), null);
  assert.equal(eatAtMs("not-a-date", "18:00", LA), null);
  assert.equal(mealTimes({ date: "2026-08-03", time: "", tzOffset: LA }), null);
});

test("cooking starts prep + cook minutes before eating", () => {
  const t = mealTimes({ date: "2026-08-03", time: "18:00", tzOffset: LA, prepMin: 15, cookMin: 30 });
  assert.equal(t.totalMin, 45);
  assert.equal(iso(t.eatAt), "2026-08-04T01:00:00.000Z");
  assert.equal(iso(t.cookStart), "2026-08-04T00:15:00.000Z");
});

test("a no-cook recipe has no start time to remind about", () => {
  const t = mealTimes({ date: "2026-08-03", time: "18:00", tzOffset: LA, prepMin: 0, cookMin: 0 });
  assert.equal(t.cookStart, null);
  assert.equal(t.totalMin, 0);
});

test("a long cook time can push the start into the previous day", () => {
  const t = mealTimes({ date: "2026-08-03", time: "12:00", tzOffset: UTC, prepMin: 60, cookMin: 720 });
  assert.equal(iso(t.cookStart), "2026-08-02T23:00:00.000Z");
});

test("thawing starts far enough ahead of the deadline", () => {
  const deadline = Date.UTC(2026, 7, 4, 0, 15);
  assert.equal(iso(thawAtMs(deadline, 12)), "2026-08-03T12:15:00.000Z");
  assert.equal(iso(thawAtMs(deadline, 24)), "2026-08-03T00:15:00.000Z");
  assert.equal(iso(thawAtMs(deadline, 72)), "2026-08-01T00:15:00.000Z", "a whole turkey");
});

test("a reminder is due once its moment arrives", () => {
  const at = Date.UTC(2026, 7, 3, 18, 0);
  assert.equal(isDue(at, at - 60000), false, "a minute early");
  assert.equal(isDue(at, at), true, "on the dot");
  assert.equal(isDue(at, at + 60000), true, "a minute late");
});

test("a reminder goes stale rather than firing hours after the fact", () => {
  // If the server was asleep through dinner, "start cooking" at midnight is noise.
  const at = Date.UTC(2026, 7, 3, 18, 0);
  assert.equal(isDue(at, at + REMINDER_WINDOW_MS), true, "still inside the window");
  assert.equal(isDue(at, at + REMINDER_WINDOW_MS + 1), false, "just past it");
  assert.equal(isDue(at, at + 6 * 3600000), false, "six hours later");
});
