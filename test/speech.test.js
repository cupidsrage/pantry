import test from "node:test";
import assert from "node:assert/strict";
import { speakable, chunks, rankVoices, scoreVoice, voiceLabel } from "../lib/speech.js";

const said = {
  "Add 1 1/2 cups flour.": "Add 1 and a half cups flour.",
  "Add 1½ cups stock.": "Add 1 and a half cups stock.",
  "Stir in 1/2 tsp salt.": "Stir in half a teaspoon salt.",
  "Add 1/4 cup milk.": "Add a quarter of a cup milk.",
  "Add 2/3 cup sugar.": "Add two thirds of a cup sugar.",
  "Add ¾ cup cream.": "Add three quarters of a cup cream.",
  "Use 1 1/2 onions.": "Use 1 and a half onions.",
  "Cut 1/2 the dough.": "Cut half the dough.",
  "Add 2 tbsp butter and 1 tsp vanilla.": "Add 2 tablespoons butter and 1 teaspoon vanilla.",
  "Add 1 T oil and 1 t salt.": "Add 1 tablespoon oil and 1 teaspoon salt.",
  "Add 1 tsp. salt and 2 tbsp. sugar.": "Add 1 teaspoon salt and 2 tablespoons sugar.",
  "Add 1 lb beef and 10oz spinach.": "Add 1 pound beef and 10 ounces spinach.",
  "Preheat oven to 350°F.": "Preheat oven to 350 degrees.",
  "Bake at 180 °C.": "Bake at 180 degrees Celsius.",
  "Bake 25-30 min.": "Bake 25 to 30 minutes.",
  "Simmer for 1 hr, stirring every 5 mins.": "Simmer for 1 hour, stirring every 5 minutes.",
  "Brown it (about 5 minutes) & drain.": "Brown it, about 5 minutes, and drain.",
  "Add 1 egg and 1 cup rice.": "Add 1 egg and 1 cup rice.",
};
for (const [step, want] of Object.entries(said)) {
  test(`reads "${step}" as "${want}"`, () => assert.equal(speakable(step), want));
}

test("plain words that look like units are left alone", () => {
  assert.equal(speakable("Toss the salad in a bowl."), "Toss the salad in a bowl.");
  assert.equal(speakable("Let it rest in the fridge."), "Let it rest in the fridge.");
});

test("long steps are split into sentences, and very long sentences at commas", () => {
  assert.deepEqual(chunks("Mix it. Bake it! Eat."), ["Mix it.", "Bake it!", "Eat."]);
  const long = chunks("a, ".repeat(120).trim());
  assert.ok(long.length > 1);
  assert.ok(long.every((c) => c.length <= 220));
});

const V = (name, lang = "en-US", extra = {}) => ({ name, lang, ...extra });

test("natural and premium voices come first, novelty and other languages never", () => {
  const ranked = rankVoices([
    V("Bubbles"), V("Samantha (Compact)"), V("Ava (Premium)"), V("Microsoft Aria Online (Natural) - English (United States)"),
    V("Google US English"), V("Thomas", "fr-FR"), V("eSpeak English"),
  ], "en-US").map((v) => v.name);
  assert.deepEqual(ranked.slice(0, 2).sort(), ["Ava (Premium)", "Microsoft Aria Online (Natural) - English (United States)"].sort());
  assert.ok(!ranked.includes("Thomas"));
  assert.equal(ranked.at(-1), "Bubbles");
  assert.ok(scoreVoice(V("Bubbles")) < 0);
});

test("the reader's own accent wins between otherwise equal voices", () => {
  const ranked = rankVoices([V("Google US English", "en-US"), V("Google UK English Female", "en-GB")], "en-GB");
  assert.equal(ranked[0].lang, "en-GB");
});

test("an iPhone voice's quality is read from its id when the name leaves it out", () => {
  const enhanced = V("Zoe", "en-US", { voiceURI: "com.apple.voice.enhanced.en-US.Zoe" });
  const compact = V("Samantha", "en-US", { voiceURI: "com.apple.voice.compact.en-US.Samantha" });
  assert.equal(rankVoices([compact, enhanced], "en-US")[0].name, "Zoe");
  assert.ok(scoreVoice(enhanced) >= 40);
  assert.equal(voiceLabel(enhanced), "Zoe (Enhanced)");
  assert.equal(voiceLabel(V("Ava (Premium)", "en-US", { voiceURI: "com.apple.voice.premium.en-US.Ava" })), "Ava (Premium)");
  assert.equal(voiceLabel(V("Google US English")), "Google US English");
});
