// Reading recipe steps out loud. Two things make phone speech sound bad, and
// both are fixed here rather than in the page:
//
// 1. Recipe shorthand. A speech engine reads "1/2 tsp" as "one slash two t s
//    p" and "350°F" as "three hundred fifty degree f". speakable() rewrites a
//    step into the words a person would say: "half a teaspoon", "350 degrees".
// 2. The voice. Browsers often default to a compact, robotic voice even when a
//    natural one is installed, and iPhones ship novelty voices ("Bubbles",
//    "Zarvox") alongside the good ones. rankVoices() puts the natural-sounding
//    ones first.

const FRACTION_WORDS = {
  "1/2": ["half", "halves"], "1/3": ["third", "thirds"], "2/3": ["two thirds", "two thirds"],
  "1/4": ["quarter", "quarters"], "3/4": ["three quarters", "three quarters"],
  "1/8": ["eighth", "eighths"], "3/8": ["three eighths", "three eighths"],
};
const UNICODE_FRACTIONS = { "½": "1/2", "⅓": "1/3", "⅔": "2/3", "¼": "1/4", "¾": "3/4", "⅛": "1/8", "⅜": "3/8" };

// [pattern after a number, singular, plural]. Only ever matched straight after
// a quantity, so "t" and "c" can't eat an ordinary word.
const UNITS = [
  ["tbsps?|tbs|tbl|T", "tablespoon", "tablespoons"],
  ["tsps?|t", "teaspoon", "teaspoons"],
  ["cups?|c", "cup", "cups"],
  ["oz", "ounce", "ounces"],
  ["fl\\.? ?oz", "fluid ounce", "fluid ounces"],
  ["lbs?", "pound", "pounds"],
  ["kg", "kilogram", "kilograms"],
  ["g|grams?", "gram", "grams"],
  ["mg", "milligram", "milligrams"],
  ["ml|mL", "millilitre", "millilitres"],
  ["l|L", "litre", "litres"],
  ["qts?", "quart", "quarts"],
  ["pts?", "pint", "pints"],
  ["pkgs?", "package", "packages"],
  ["mins?", "minute", "minutes"],
  ["hrs?", "hour", "hours"],
  ["secs?", "second", "seconds"],
  ["cm", "centimetre", "centimetres"],
  ["mm", "millimetre", "millimetres"],
  ["in", "inch", "inches"],
];

// A quantity as it appears in the text after fractions are normalised:
// "2", "1.5", "1 1/2", "1/2", "2-3".
const QTY = String.raw`(\d+(?:\.\d+)?(?:\s+\d\/\d)?|\d\/\d)`;

// How a quantity is said, and whether the unit after it is singular.
function sayQty(q) {
  q = q.trim();
  const mixed = q.match(/^(\d+)\s+(\d\/\d)$/);
  if (mixed && FRACTION_WORDS[mixed[2]]) {
    const [one] = FRACTION_WORDS[mixed[2]];
    // "1 1/2 cups" → "1 and a half cups"
    const frac = /^(half|third|quarter|eighth)$/.test(one) ? `a ${one}` : one;
    return { words: `${mixed[1]} and ${frac}`, singular: false };
  }
  if (FRACTION_WORDS[q]) return { words: FRACTION_WORDS[q][0], singular: true, fraction: true };
  return { words: q, singular: q === "1" };
}

// "third" → "a third"; "two thirds" stays as it is.
const aFraction = (w) => (/^(third|quarter|eighth)$/.test(w) ? `a ${w}` : w);

export function speakable(text) {
  let s = String(text || "");
  for (const [u, f] of Object.entries(UNICODE_FRACTIONS)) {
    s = s.replace(new RegExp(`(\\d)\\s*${u}`, "g"), `$1 ${f}`).replace(new RegExp(u, "g"), f);
  }
  s = s.replace(/[–—]/g, "-");

  // Temperatures: 350°F, 180 °C, 400F, 200 degrees F
  s = s.replace(/(\d+)\s*(?:°|º|degrees?)\s*F\b(?:\.(?=\s+[a-z]))?/gi, "$1 degrees")
       .replace(/(\d+)\s*(?:°|º|degrees?)\s*C\b(?:\.(?=\s+[a-z]))?/gi, "$1 degrees Celsius")
       .replace(/(\d{3})\s*F\b/g, "$1 degrees")
       .replace(/(\d+)\s*°/g, "$1 degrees");

  // Ranges: "3-4 minutes" → "3 to 4 minutes"
  s = s.replace(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/g, "$1 to $2");

  // Quantity + unit, e.g. "1/2 tsp", "2 tbsp", "1 1/2 cups", "10oz"
  for (const [pat, one, many] of UNITS) {
    const re = new RegExp(`${QTY}\\s*(?:${pat})\\b(?:\\.(?=\\s+[a-z]))?(?!['’]\\w)`, "g");
    s = s.replace(re, (m, q) => {
      const { words, singular, fraction } = sayQty(q);
      // "half a teaspoon", "a third of a cup", "three quarters of a cup"
      if (fraction) return words === "half" ? `half a ${one}` : `${aFraction(words)} of a ${one}`;
      return `${words} ${singular ? one : many}`;
    });
  }
  // Fractions with no unit after them: "1 1/2 onions", "1/2 the dough"
  s = s.replace(/(\d+)\s+(\d\/\d)(?![\d/])/g, (m, w, f) =>
    FRACTION_WORDS[f] ? sayQty(`${w} ${f}`).words : `${w} and ${f.replace("/", " over ")}`);
  s = s.replace(/(^|[^\d/])(\d)\/(\d)(?![\d/])/g, (m, pre, a, b) => {
    const w = FRACTION_WORDS[`${a}/${b}`];
    return `${pre}${w ? (w[0] === "half" ? "half" : aFraction(w[0])) : `${a} over ${b}`}`;
  });

  s = s.replace(/\bapprox\.?(?=\s)/gi, "about")
       .replace(/\bw\/(?=\s)/gi, "with")
       .replace(/\s&\s/g, " and ")
       .replace(/\be\.g\./gi, "for example")
       .replace(/\bi\.e\./gi, "that is")
       .replace(/\bea\.(?=\s)/gi, "each");
  // Brackets make engines pause oddly or say "open paren"; commas read naturally.
  s = s.replace(/\s*\(\s*/g, ", ").replace(/\s*\)\s*/g, ", ").replace(/,\s*([,.;:!?])/g, "$1");
  return s.replace(/\s+/g, " ").replace(/\s+([,.;:!?])/g, "$1").replace(/^[,\s]+|[,\s]+$/g, "").trim();
}

// Split into sentences. Chrome stops a single utterance after about 15
// seconds, which cut long steps off mid-word; short ones queue cleanly.
export function chunks(text) {
  // No lookbehind in these patterns: iPhones before iOS 16.4 can't parse it,
  // and a regex they can't parse stops the whole app from loading.
  const sentences = [];
  const bits = String(text).split(/([.!?;])\s+/);
  for (let i = 0; i < bits.length; i += 2) sentences.push(bits[i] + (bits[i + 1] || ""));
  const out = [];
  for (const part of sentences) {
    if (part.length <= 220) { if (part.trim()) out.push(part.trim()); continue; }
    // A very long sentence: break at commas into pieces of a sensible size.
    let cur = "";
    const pieces = part.split(/,\s+/);
    pieces.forEach((p, j) => {
      const bit = j < pieces.length - 1 ? `${p},` : p;
      if (cur && (cur + " " + bit).length > 220) { out.push(cur); cur = bit; }
      else cur = cur ? `${cur} ${bit}` : bit;
    });
    if (cur.trim()) out.push(cur.trim());
  }
  return out;
}

// macOS/iOS novelty voices: the worst possible thing to read a recipe in.
const NOVELTY = /^(albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|pipe organ|superstar|trinoids|whisper|wobble|zarvox|fred|junior|ralph|kathy|bruce|agnes|princess|hysterical|deranged|grandma|grandpa|rocko|shelley|sandy|flo|eddy|reed)\b/i;

// Score a voice for reading recipes in `lang` (e.g. "en-US"). Higher is better;
// below zero means "don't pick this unless asked".
export function scoreVoice(v, lang = "en-US") {
  const vl = String(v.lang || "").replace("_", "-").toLowerCase();
  const want = String(lang || "en-US").toLowerCase();
  const name = String(v.name || "");
  // iPhones often name a voice plain "Zoe" and keep its quality in the id
  // (com.apple.voice.enhanced.en-US.Zoe), so look at both.
  const both = `${name} ${v.voiceURI || ""}`;
  if (vl.split("-")[0] !== want.split("-")[0]) return -100;     // wrong language
  let s = 0;
  if (vl === want) s += 10;
  if (NOVELTY.test(name)) return -50;
  if (/natural|neural|wavenet|journey|studio/i.test(both)) s += 60; // Edge / Chrome OS cloud voices
  if (/premium/i.test(both)) s += 55;                              // iOS: Settings → Accessibility → Spoken Content
  if (/enhanced/i.test(both)) s += 45;
  if (/siri/i.test(both)) s += 40;
  if (/^google\b/i.test(name)) s += 25;                            // Chrome's online voices beat the old local ones
  if (/^(samantha|ava|allison|susan|zoe|evan|nathan|tom|serena|daniel|karen|moira|tessa|kate|oliver|aaron|nicky)\b/i.test(name)) s += 15;
  if (/compact/i.test(both)) s -= 20;
  if (/espeak|pico/i.test(both)) s -= 30;                          // old Android / Linux engines
  if (v.default) s += 3;
  return s;
}

// What the voice picker shows: the name, plus the quality when only the id says it.
export function voiceLabel(v) {
  const name = String(v.name || "");
  const q = /premium/i.test(v.voiceURI || "") ? "Premium" : /enhanced/i.test(v.voiceURI || "") ? "Enhanced" : "";
  return q && !new RegExp(q, "i").test(name) ? `${name} (${q})` : name;
}

export function rankVoices(voices, lang = "en-US") {
  return voices
    .map((v) => ({ v, s: scoreVoice(v, lang) }))
    .filter((x) => x.s > -100)
    .sort((a, b) => b.s - a.s || String(a.v.name).localeCompare(String(b.v.name)))
    .map((x) => x.v);
}
