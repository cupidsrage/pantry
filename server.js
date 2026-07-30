import express from "express";
import Database from "better-sqlite3";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "25mb" })); // photos arrive as base64 in the body
app.use(
  express.static(join(__dirname, "public"), {
    setHeaders(res, path) {
      if (path.endsWith(".webmanifest")) res.setHeader("Content-Type", "application/manifest+json");
      // Let the service worker update promptly instead of being cached hard by the browser.
      if (path.endsWith("sw.js")) res.setHeader("Cache-Control", "no-cache");
    },
  })
);

// ---------- database ----------
// Railway wipes the container filesystem on redeploy. Mount a volume and set
// DB_PATH to a path inside it (e.g. /data/pantry.db) for durable storage.
const DB_PATH = process.env.DB_PATH || join(__dirname, "pantry.db");
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS pantry (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    base REAL NOT NULL DEFAULT 0,      -- amount on hand in base_unit
    base_unit TEXT NOT NULL DEFAULT 'count',
    pkg_label TEXT DEFAULT 'each',     -- what one package looks like
    pkg_base REAL NOT NULL DEFAULT 1   -- base_unit per package
  );
  CREATE TABLE IF NOT EXISTS list (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    packages REAL NOT NULL DEFAULT 1,  -- whole packages to buy
    base_unit TEXT NOT NULL DEFAULT 'count',
    pkg_label TEXT DEFAULT 'each',
    pkg_base REAL NOT NULL DEFAULT 1,
    checked INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS recipes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    source_url TEXT DEFAULT '',
    ingredients TEXT NOT NULL,   -- JSON array of parsed ingredient objects
    steps TEXT NOT NULL,         -- JSON array of step strings
    created INTEGER NOT NULL
  );
`);

// ---------- migration ----------
// Earlier versions of this app created `pantry`/`list` with a qty/unit schema.
// CREATE TABLE IF NOT EXISTS won't alter an existing table, so a database from
// an old deploy is missing the new columns. Detect that and rebuild.
function columns(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}
function migrate() {
  // list: needs `packages`; old schema had `qty`
  const listCols = columns("list");
  if (!listCols.includes("packages")) {
    db.exec("ALTER TABLE list RENAME TO list_old");
    db.exec(`CREATE TABLE list (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      packages REAL NOT NULL DEFAULT 1,
      base_unit TEXT NOT NULL DEFAULT 'count',
      pkg_label TEXT DEFAULT 'each',
      pkg_base REAL NOT NULL DEFAULT 1,
      checked INTEGER NOT NULL DEFAULT 0
    )`);
    // carry over names + checked state; old qty/unit don't map cleanly to packages, so default to 1 pkg
    const oldCols = columns("list_old");
    if (oldCols.includes("name")) {
      const rows = db.prepare("SELECT * FROM list_old").all();
      const ins = db.prepare("INSERT INTO list (name,packages,base_unit,pkg_label,pkg_base,checked) VALUES (?,?,?,?,?,?)");
      for (const r of rows) ins.run(r.name, 1, "count", r.unit || "each", 1, r.checked ? 1 : 0);
    }
    db.exec("DROP TABLE list_old");
  }
  // pantry: needs `base`; old schema had `qty`
  const pantryCols = columns("pantry");
  if (!pantryCols.includes("base")) {
    db.exec("ALTER TABLE pantry RENAME TO pantry_old");
    db.exec(`CREATE TABLE pantry (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      base REAL NOT NULL DEFAULT 0,
      base_unit TEXT NOT NULL DEFAULT 'count',
      pkg_label TEXT DEFAULT 'each',
      pkg_base REAL NOT NULL DEFAULT 1
    )`);
    const oldCols = columns("pantry_old");
    if (oldCols.includes("name")) {
      const rows = db.prepare("SELECT * FROM pantry_old").all();
      const ins = db.prepare("INSERT INTO pantry (name,base,base_unit,pkg_label,pkg_base) VALUES (?,?,?,?,?)");
      // old qty becomes base in a generic unit; pkg_base=1 so it still reads sensibly
      for (const r of rows) ins.run(r.name, Number(r.qty) || 0, "count", r.unit || "each", 1);
    }
    db.exec("DROP TABLE pantry_old");
  }
  // recipes: add nutrition column (JSON) if missing — ALTER is safe, keeps data
  if (!columns("recipes").includes("nutrition")) {
    db.exec("ALTER TABLE recipes ADD COLUMN nutrition TEXT DEFAULT ''");
  }
}
migrate();

// ---------- pantry API ----------
app.get("/api/pantry", (_, res) => res.json(db.prepare("SELECT * FROM pantry ORDER BY name").all()));
app.post("/api/pantry", (req, res) => {
  const { name, base = 0, base_unit = "count", pkg_label = "each", pkg_base = 1 } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "name required" });
  const info = db.prepare("INSERT INTO pantry (name,base,base_unit,pkg_label,pkg_base) VALUES (?,?,?,?,?)")
    .run(name.trim(), base, base_unit, pkg_label, pkg_base);
  res.json({ id: info.lastInsertRowid });
});
app.patch("/api/pantry/:id", (req, res) => {
  db.prepare("UPDATE pantry SET base=? WHERE id=?").run(req.body.base, req.params.id);
  res.json({ ok: true });
});
app.delete("/api/pantry/:id", (req, res) => {
  db.prepare("DELETE FROM pantry WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

// ---------- list API ----------
app.get("/api/list", (_, res) => res.json(db.prepare("SELECT * FROM list ORDER BY id").all()));
app.post("/api/list", (req, res) => {
  const { name, packages = 1, base_unit = "count", pkg_label = "each", pkg_base = 1 } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "name required" });
  const info = db.prepare("INSERT INTO list (name,packages,base_unit,pkg_label,pkg_base,checked) VALUES (?,?,?,?,?,0)")
    .run(name.trim(), packages, base_unit, pkg_label, pkg_base);
  res.json({ id: info.lastInsertRowid });
});
app.patch("/api/list/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM list WHERE id=?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "not found" });
  const packages = req.body.packages ?? row.packages;
  const checked = req.body.checked ?? row.checked;
  db.prepare("UPDATE list SET packages=?, checked=? WHERE id=?").run(packages, checked ? 1 : 0, req.params.id);
  res.json({ ok: true });
});
app.delete("/api/list/:id", (req, res) => {
  db.prepare("DELETE FROM list WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

// move all checked list items into pantry (adds packages * pkg_base to stock), then clear them
app.post("/api/purchase", (_, res) => {
  const bought = db.prepare("SELECT * FROM list WHERE checked=1").all();
  const norm = (s) => s.toLowerCase().trim().replace(/s$/, "");
  const tx = db.transaction(() => {
    for (const b of bought) {
      const addBase = +(b.packages * b.pkg_base).toFixed(2);
      const match = db.prepare("SELECT * FROM pantry").all().find((p) => norm(p.name) === norm(b.name));
      if (match) db.prepare("UPDATE pantry SET base=? WHERE id=?").run(+(match.base + addBase).toFixed(2), match.id);
      else db.prepare("INSERT INTO pantry (name,base,base_unit,pkg_label,pkg_base) VALUES (?,?,?,?,?)")
        .run(b.name, addBase, b.base_unit, b.pkg_label, b.pkg_base);
    }
    db.prepare("DELETE FROM list WHERE checked=1").run();
  });
  tx();
  res.json({ ok: true, moved: bought.length });
});

// subtract cooked recipe usage (in base units) from pantry stock
app.post("/api/cook", (req, res) => {
  const items = req.body.items || []; // [{name, use_base}]
  const norm = (s) => s.toLowerCase().trim().replace(/s$/, "");
  const tx = db.transaction(() => {
    const pantry = db.prepare("SELECT * FROM pantry").all();
    for (const it of items) {
      const match = pantry.find((p) => norm(p.name) === norm(it.name));
      if (match) db.prepare("UPDATE pantry SET base=? WHERE id=?")
        .run(Math.max(0, +(match.base - it.use_base).toFixed(2)), match.id);
    }
  });
  tx();
  res.json({ ok: true });
});

// ---------- shared Anthropic call ----------
// Text extraction runs on Haiku (cheap, plenty for clean text). Photos run on
// Sonnet 5, which reads handwriting best — worth the extra fraction of a cent.
const TEXT_MODEL = "claude-haiku-4-5-20251001";
const VISION_MODEL = "claude-sonnet-5";
const PRICING = {
  "claude-haiku-4-5-20251001": { in: 1.0, out: 5.0 },
  "claude-sonnet-5": { in: 2.0, out: 10.0 }, // intro pricing through Aug 31, 2026 ($3/$15 after)
};
let sessionCost = 0;
let sessionCalls = 0;

// Build the right content block for an uploaded file: PDFs go in a `document`
// block, everything else is treated as an image. Both are read by the vision model.
function mediaBlock(data, mediaType) {
  const media = mediaType || "image/jpeg";
  if (media === "application/pdf") {
    return { type: "document", source: { type: "base64", media_type: "application/pdf", data } };
  }
  return { type: "image", source: { type: "base64", media_type: media, data } };
}

async function callClaude(prompt, maxTokens = 1500, model = TEXT_MODEL) {
  // prompt is either a string (text only) or an array of content blocks (for images);
  // the Anthropic API accepts either directly as the message content.
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await r.json();
  if (data.error) {
    console.error("Anthropic API error:", JSON.stringify(data.error).slice(0, 300));
    throw new Error("anthropic: " + (data.error.message || data.error.type || "unknown"));
  }
  // Log token usage and dollar cost to the console.
  const u = data.usage || {};
  const inTok = u.input_tokens || 0;
  const outTok = u.output_tokens || 0;
  const price = PRICING[model] || PRICING[TEXT_MODEL];
  const cost = (inTok / 1e6) * price.in + (outTok / 1e6) * price.out;
  sessionCost += cost;
  sessionCalls += 1;
  const shortModel = model.includes("haiku") ? "haiku" : model.includes("sonnet") ? "sonnet" : model;
  console.log(
    `[cost] ${shortModel} in=${inTok} out=${outTok} tok | this call $${cost.toFixed(5)} | ` +
    `session $${sessionCost.toFixed(4)} over ${sessionCalls} call(s)`
  );
  const text = (data.content || []).filter((i) => i.type === "text").map((i) => i.text).join("");
  if (!text) {
    console.error("Anthropic returned no text. stop_reason:", data.stop_reason);
    if (data.stop_reason === "max_tokens") throw new Error("max_tokens");
  }
  return text;
}

// strip a fetched HTML page down to readable text for the model
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 12000); // keep the prompt bounded
}

// Fetch a page's HTML. Tries a direct browser-style request first (free), and
// falls back to a scraping service if the site blocks us AND SCRAPER_API_KEY is set.
// Throws Error("blocked") when the page can't be retrieved by any available path.
async function directFetch(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(url, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: ctrl.signal,
    });
    const body = await r.text();
    return { status: r.status, body };
  } finally {
    clearTimeout(timer);
  }
}

// Provider-agnostic scraping. Set SCRAPER_URL to a template containing {url}
// (and optionally {key}); the target URL is inserted URL-encoded. Examples:
//   ScraperAPI:  https://api.scraperapi.com/?api_key={key}&render=true&url={url}
//   ScrapingBee: https://app.scrapingbee.com/api/v1/?api_key={key}&url={url}
//   any proxy:   https://example.com/get?token={key}&target={url}
// SCRAPER_KEY holds the API key. If SCRAPER_URL isn't set but the legacy
// SCRAPER_API_KEY is, default to the ScraperAPI template for backward compat.
function scraperConfigured() {
  return Boolean(process.env.SCRAPER_URL || process.env.SCRAPER_API_KEY);
}
function buildScraperEndpoint(url) {
  const key = process.env.SCRAPER_KEY || process.env.SCRAPER_API_KEY || "";
  // Default: ScraperAPI WITHOUT render — allrecipes & most recipe sites put the
  // full recipe in the initial HTML as JSON-LD, so we want raw HTML, not the
  // JS-rendered text (which strips tags and returns mostly navigation).
  const template =
    process.env.SCRAPER_URL ||
    "https://api.scraperapi.com/?api_key={key}&url={url}";
  return template
    .replace("{key}", encodeURIComponent(key))
    .replace("{url}", encodeURIComponent(url));
}
async function scraperFetch(url) {
  const endpoint = buildScraperEndpoint(url);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60000); // rendering can be slow
  try {
    const r = await fetch(endpoint, { signal: ctrl.signal });
    const body = await r.text();
    return { status: r.status, body };
  } finally {
    clearTimeout(timer);
  }
}

const isBlocked = (status) => status === 403 || status === 429 || status === 401 || status >= 500;

// A response can be HTTP 200 but still be a block/challenge/access-denied page.
// Real recipe pages are large and contain recipe markers; block pages are tiny
// and often mention "access", "denied", "blocked", "captcha", etc.
function looksLikeRealPage(body) {
  if (!body || body.length < 2000) return false; // block pages are small
  const head = body.slice(0, 4000).toLowerCase();
  const blockSignals = ["access issue", "access denied", "are you a robot", "captcha",
    "verify you are human", "unusual traffic", "request blocked", "cloudflare",
    "please contact support", "enable javascript and cookies"];
  if (blockSignals.some((s) => head.includes(s))) return false;
  // prefer pages that actually smell like a recipe / rich HTML
  const good = ['application/ld+json', 'recipeingredient', 'recipe', 'ingredient', '<!doctype html'];
  return good.some((s) => head.includes(s));
}

async function fetchPage(url) {
  // 1) direct — accept only if it clearly looks like a real page, not a block screen
  let direct;
  try {
    direct = await directFetch(url);
    if (!isBlocked(direct.status) && looksLikeRealPage(direct.body)) return direct.body;
  } catch {
    /* fall through to scraper */
  }
  // 2) scraper fallback (only if configured)
  if (scraperConfigured()) {
    try {
      const scraped = await scraperFetch(url);
      if (!isBlocked(scraped.status) && scraped.body && scraped.body.length > 200) return scraped.body;
    } catch {
      /* fall through to error */
    }
  }
  // last resort: a direct body that at least had real size, even if unsure
  if (direct && looksLikeRealPage(direct.body)) return direct.body;
  throw new Error("blocked");
}


// so we get clean ingredients/steps instead of guessing from page text.
function extractRecipeJsonLd(html) {
  const blocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const isRecipe = (o) => {
    const t = o && o["@type"];
    return t === "Recipe" || (Array.isArray(t) && t.includes("Recipe"));
  };
  const findRecipe = (data) => {
    if (!data) return null;
    if (Array.isArray(data)) { for (const d of data) { const r = findRecipe(d); if (r) return r; } return null; }
    if (isRecipe(data)) return data;
    if (data["@graph"]) return findRecipe(data["@graph"]);
    return null;
  };
  for (const b of blocks) {
    let data;
    try { data = JSON.parse(b[1].trim()); } catch { continue; }
    const r = findRecipe(data);
    if (!r) continue;
    // recipeInstructions can be strings, HowToStep objects, or HowToSection groups
    const steps = [];
    const walkInstr = (ins) => {
      if (!ins) return;
      if (typeof ins === "string") { steps.push(ins); return; }
      if (Array.isArray(ins)) { ins.forEach(walkInstr); return; }
      if (ins["@type"] === "HowToSection" && ins.itemListElement) { walkInstr(ins.itemListElement); return; }
      if (ins.text) steps.push(ins.text);
    };
    walkInstr(r.recipeInstructions);
    const ingredients = [].concat(r.recipeIngredient || r.ingredients || []);
    const clean = (s) => String(s).replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
    return {
      name: r.name ? clean(r.name) : "",
      ingredients: ingredients.map(clean).filter(Boolean),
      instructions: steps.map(clean).filter(Boolean),
    };
  }
  return null;
}

// Compact output keys keep the model's response small (output tokens cost 5x input).
// Keys: n=name, q=use_qty, u=use_unit, b=base_unit, ub=use_base, pl=pkg_label, pb=pkg_base
// srv=servings the recipe makes, cal/pro/carb/fat = per-serving nutrition estimate
const PARSE_PROMPT = (recipeText, includeSteps) => `Extract this recipe as MINIFIED JSON. Return ONLY the JSON, no prose, no markdown, no whitespace/newlines between tokens.
Shape: {"t":title,"srv":servings,"cal":kcal,"pro":g,"carb":g,"fat":g,"i":[{"n":name,"q":use_qty,"u":unit,"b":base_unit,"ub":use_base,"pl":pkg_label,"pb":pkg_base}]${includeSteps ? ',"s":[step,...]' : ""}}
Field meaning:
- srv: how many servings the recipe makes (estimate a sensible number if not stated)
- cal/pro/carb/fat: estimated nutrition PER SERVING — calories (kcal), protein (g), carbs (g), fat (g), whole numbers
- n: singular generic grocery name ("flour","garlic","chicken breast")
- q: amount recipe uses (number); u: its unit ("tbsp","cup","clove","whole","g","oz")
- b: "g" (solids) | "ml" (liquids) | "count" (whole items)
- ub: q converted to b (1 tbsp flour=8 g; 2 cloves garlic=2 count; 1 lemon=1 count)
- pl: what you buy ("5 lb bag","head","bunch","1 lb","stick","each")
- pb: amount of b in ONE package (5 lb bag flour=2265; head garlic=10; bunch parsley=30; lemon=1; stick butter=113)
${includeSteps ? "- s: ordered cooking steps, each a short plain sentence\n" : ""}Rules: realistic US package sizes. Whole items sold individually -> b "count", pb 1, pl "each". Garlic -> count in cloves, head ~10. Combine duplicates. Skip water and plain salt/pepper "to taste". Nutrition is a reasonable estimate from the ingredients, not a lab value. Ignore any site navigation/ads/reviews in the text. If no recipe found, return {"t":"","i":[]}.

RECIPE:
${recipeText}`;

// Expand the compact keys back into the full shape the rest of the app expects.
function expandParsed(obj, fallbackSteps) {
  const items = Array.isArray(obj.i) ? obj.i : [];
  const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);
  const nutrition = (num(obj.cal) || num(obj.pro) || num(obj.carb) || num(obj.fat))
    ? { servings: num(obj.srv) || null, calories: num(obj.cal), protein: num(obj.pro), carbs: num(obj.carb), fat: num(obj.fat) }
    : null;
  return {
    title: obj.t || "Untitled recipe",
    servings: num(obj.srv) || null,
    nutrition,
    ingredients: items.map((x) => ({
      name: x.n,
      use_qty: x.q,
      use_unit: x.u,
      base_unit: x.b,
      use_base: x.ub,
      pkg_label: x.pl,
      pkg_base: x.pb,
    })),
    steps: Array.isArray(obj.s) ? obj.s : (fallbackSteps || []),
  };
}

// ---------- pantry item from a photo ----------
// Identify a grocery item and estimate how much is present (fullness / count).
const PANTRY_PHOTO_PROMPT = `Identify the single main grocery item in this photo and estimate how much is present. Return ONLY MINIFIED JSON, no prose, no markdown.
Shape: {"n":name,"b":base_unit,"amt":amount_present,"pl":pkg_label,"pb":pkg_full}
- n: generic grocery name, singular ("milk","egg","flour","orange juice")
- b: "g" solids | "ml" liquids | "count" whole/countable items (eggs, apples, cans)
- amt: how much is PRESENT now, in b. Estimate from what you can see:
  * a liquid container (milk jug, juice): estimate fullness and convert to ml (gallon=3785 ml, half gallon=1893, quart=946, liter=1000). A jug that looks ~half full of a gallon = ~1900.
  * a carton/box of countable items: COUNT the visible items (eggs in a carton, etc.) and use that number with b="count".
  * a bag/box of solid (flour, sugar, rice): estimate remaining weight in g from the package size and how full it looks.
- pl: the package label ("gallon","dozen","5 lb bag","each")
- pb: amount of b in a FULL package (gallon milk=3785; dozen eggs=12; 5 lb bag=2265)
If you cannot identify a grocery item, return {"n":""}.`;

app.post("/api/pantry-photo", async (req, res) => {
  const { image, image_type } = req.body;
  if (!process.env.ANTHROPIC_API_KEY)
    return res.status(500).json({ error: "ANTHROPIC_API_KEY not set on the server" });
  if (!image) return res.status(400).json({ error: "image required" });
  let raw;
  try {
    raw = (await callClaude([
      mediaBlock(image, image_type),
      { type: "text", text: PANTRY_PHOTO_PROMPT },
    ], 500, VISION_MODEL)).replace(/```json|```/g, "").trim();
  } catch (e) {
    return res.status(422).json({ error: "Couldn't read that photo. Try a clearer, well-lit picture." });
  }
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    const f = raw.indexOf("{"), l = raw.lastIndexOf("}");
    try { obj = JSON.parse(raw.slice(f, l + 1)); }
    catch { return res.status(422).json({ error: "Couldn't identify the item. Try a clearer picture." }); }
  }
  if (!obj.n) return res.status(422).json({ error: "Couldn't identify a grocery item in that photo." });
  res.json({
    name: obj.n,
    base: typeof obj.amt === "number" ? obj.amt : 0,
    base_unit: ["g", "ml", "count"].includes(obj.b) ? obj.b : "count",
    pkg_label: obj.pl || "each",
    pkg_base: typeof obj.pb === "number" && obj.pb > 0 ? obj.pb : 1,
  });
});

// ---------- pantry items from a grocery receipt photo ----------
const RECEIPT_PROMPT = `This is a grocery store receipt (a photo or PDF). Extract the FOOD/GROCERY items purchased. Return ONLY MINIFIED JSON, no prose, no markdown.
Shape: {"items":[{"n":name,"qty":count,"b":base_unit,"amt":amount_bought,"pl":pkg_label,"pb":pkg_full}]}
For each grocery line:
- n: expand abbreviations into a plain generic item name ("GV MLK 1GAL" -> "milk", "LG EGG 18CT" -> "egg", "BNLS CHKN BRST" -> "chicken breast"). singular.
- qty: how many of that package were bought (the quantity column; default 1)
- b: "g" solids | "ml" liquids | "count" whole/countable items
- amt: total amount bought in b, across all qty (e.g. two 1-gallon milks -> 7570 ml; one 18-ct eggs -> 18 count; one 5 lb flour -> 2265 g)
- pl: package label ("gallon","18-ct","5 lb bag","each")
- pb: amount of b in ONE package (gallon=3785; dozen eggs=12; 18-ct eggs=18; 5 lb bag=2265)
Rules: SKIP non-food lines — tax, subtotal, total, change, bags, payment, loyalty/discount lines, store info. If you can't tell what a line is, skip it. If no grocery items are found, return {"items":[]}.`;

app.post("/api/receipt", async (req, res) => {
  const { image, image_type } = req.body;
  if (!process.env.ANTHROPIC_API_KEY)
    return res.status(500).json({ error: "ANTHROPIC_API_KEY not set on the server" });
  if (!image) return res.status(400).json({ error: "image required" });
  // A PDF receipt is clean digital text — Haiku reads it well and far cheaper.
  // A photographed receipt can have glare/creases, so use the stronger vision model.
  const model = image_type === "application/pdf" ? TEXT_MODEL : VISION_MODEL;
  let raw;
  try {
    raw = (await callClaude([
      mediaBlock(image, image_type),
      { type: "text", text: RECEIPT_PROMPT },
    ], 4000, model)).replace(/```json|```/g, "").trim();
  } catch (e) {
    if (e && e.message === "max_tokens")
      return res.status(422).json({ error: "That receipt has a lot of items — try photographing it in two halves and adding each." });
    return res.status(422).json({ error: "Couldn't read that receipt. Try a clearer, flatter photo." });
  }
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    const f = raw.indexOf("{"), l = raw.lastIndexOf("}");
    try { obj = JSON.parse(raw.slice(f, l + 1)); }
    catch { return res.status(422).json({ error: "Couldn't read the receipt. Try a clearer photo." }); }
  }
  const items = (Array.isArray(obj.items) ? obj.items : [])
    .filter((x) => x && x.n)
    .map((x) => ({
      name: x.n,
      base: typeof x.amt === "number" ? x.amt : 0,
      base_unit: ["g", "ml", "count"].includes(x.b) ? x.b : "count",
      pkg_label: x.pl || "each",
      pkg_base: typeof x.pb === "number" && x.pb > 0 ? x.pb : 1,
    }));
  if (!items.length) return res.status(422).json({ error: "No grocery items found on that receipt. Try a clearer photo." });
  res.json({ items });
});

// ---------- recipe parsing: accepts pasted text, a url, OR photo(s) ----------
app.post("/api/parse", async (req, res) => {
  let { recipe, url, image, image_type, images } = req.body;
  if (!process.env.ANTHROPIC_API_KEY)
    return res.status(500).json({ error: "ANTHROPIC_API_KEY not set on the server" });

  try {
    // Photo(s) or PDF of a recipe: send to the vision model to read.
    // Accept a single `image`, an array `images` (multi-page), or a PDF as `image`.
    const imgs = Array.isArray(images) && images.length
      ? images.map((im) => ({ data: im.data, media: im.media_type || "image/jpeg" }))
      : image ? [{ data: image, media: image_type || "image/jpeg" }] : [];
    if (imgs.length) {
      const blocks = imgs.map((im) => mediaBlock(im.data, im.media));
      const isPdf = imgs.length === 1 && imgs[0].media === "application/pdf";
      const note = isPdf
        ? "(the recipe is in the attached PDF — read it and extract the recipe)"
        : imgs.length > 1
        ? `(the recipe spans the ${imgs.length} attached images/pages — read them all in order and combine into ONE recipe)`
        : "(the recipe is in the attached image — read the handwriting/text and extract it)";
      let raw;
      try {
        raw = (await callClaude(
          [...blocks, { type: "text", text: PARSE_PROMPT(note, true) }],
          4000,
          VISION_MODEL
        )).replace(/```json|```/g, "").trim();
      } catch (e) {
        if (e && e.message === "max_tokens")
          return res.status(422).json({ error: "That recipe is very long — try splitting it or typing it in." });
        return res.status(422).json({ error: "Couldn't read those photos. Try clearer, well-lit pictures." });
      }
      let obj;
      try {
        obj = JSON.parse(raw);
      } catch {
        const f = raw.indexOf("{"), l = raw.lastIndexOf("}");
        try { obj = JSON.parse(raw.slice(f, l + 1)); }
        catch { return res.status(422).json({ error: "Couldn't read the recipe from those photos. Try clearer pictures, or type it in." }); }
      }
      const full = expandParsed(obj, []);
      if (!full.ingredients.length)
        return res.status(422).json({ error: "No ingredients found in those photos. Try clearer pictures, or type it in." });
      return res.json({ title: full.title, items: full.ingredients, steps: full.steps, servings: full.servings, nutrition: full.nutrition, source_url: "" });
    }

    let sourceUrl = "";
    let jsonldSteps = [];
    if (url?.trim()) {
      sourceUrl = url.trim();
      let page;
      try {
        page = await fetchPage(sourceUrl);
      } catch (e) {
        const msg = e && e.message === "blocked"
          ? "That site blocked the fetch. Paste the recipe text instead" +
            (scraperConfigured() ? "." : ", or configure a scraper (SCRAPER_URL/SCRAPER_KEY) to fetch protected sites.")
          : "Couldn't reach that link. Paste the recipe text instead.";
        return res.status(400).json({ error: msg });
      }

      // Best path: most recipe sites embed the full recipe as schema.org JSON-LD.
      const jsonld = extractRecipeJsonLd(page);
      if (jsonld) {
        // We already have clean steps from JSON-LD — send only ingredients to the
        // model and keep the steps ourselves, so the model doesn't re-emit them
        // (that was the bulk of the output-token cost).
        jsonldSteps = jsonld.instructions || [];
        recipe =
          `TITLE: ${jsonld.name || ""}\n\nINGREDIENTS:\n` +
          (jsonld.ingredients || []).join("\n");
      } else {
        recipe = htmlToText(page);
      }
      recipe = recipe.slice(0, 8000); // keep the prompt well within token limits
      if (recipe.replace(/\s/g, "").length < 40)
        return res.status(400).json({ error: "Couldn't find a recipe on that page. Paste the text instead." });
    }
    if (!recipe?.trim()) return res.status(400).json({ error: "recipe or url required" });

    // Ask the model for steps only when we don't already have them from JSON-LD.
    const needSteps = jsonldSteps.length === 0;
    const raw = (await callClaude(PARSE_PROMPT(recipe, needSteps), 4000)).replace(/```json|```/g, "").trim();
    // The model should return only JSON, but guard against stray prose around it.
    let obj;
    try {
      obj = JSON.parse(raw);
    } catch {
      const first = raw.indexOf("{"), last = raw.lastIndexOf("}");
      if (first === -1 || last === -1) {
        console.error("parse: model returned no JSON:", raw.slice(0, 200));
        return res.status(422).json({ error: "The recipe reader returned an unexpected response. Try again, or paste cleaner text." });
      }
      try {
        obj = JSON.parse(raw.slice(first, last + 1));
      } catch (e2) {
        console.error("parse: JSON still invalid:", raw.slice(0, 200));
        return res.status(422).json({ error: "Couldn't read the recipe structure. Try again, or paste the ingredient list plainly." });
      }
    }
    const full = expandParsed(obj, jsonldSteps);
    res.json({
      title: full.title,
      items: full.ingredients,
      steps: full.steps,
      servings: full.servings,
      nutrition: full.nutrition,
      source_url: sourceUrl,
    });
  } catch (e) {
    console.error("parse failed:", e && e.message);
    res.status(500).json({ error: "parse failed" });
  }
});

// ---------- saved recipes ----------
app.get("/api/recipes", (_, res) =>
  res.json(db.prepare("SELECT id,title,source_url,created,ingredients FROM recipes ORDER BY created DESC").all()
    .map((r) => ({ ...r, ingredients: JSON.parse(r.ingredients || "[]") }))));
app.get("/api/recipes/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM recipes WHERE id=?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "not found" });
  res.json({ ...row, ingredients: JSON.parse(row.ingredients), steps: JSON.parse(row.steps),
    nutrition: row.nutrition ? JSON.parse(row.nutrition) : null });
});
app.post("/api/recipes", (req, res) => {
  const { title, source_url = "", ingredients = [], steps = [], nutrition = null } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: "title required" });
  const info = db.prepare("INSERT INTO recipes (title,source_url,ingredients,steps,created,nutrition) VALUES (?,?,?,?,?,?)")
    .run(title.trim(), source_url, JSON.stringify(ingredients), JSON.stringify(steps), Date.now(),
      nutrition ? JSON.stringify(nutrition) : "");
  res.json({ id: info.lastInsertRowid });
});
app.delete("/api/recipes/:id", (req, res) => {
  db.prepare("DELETE FROM recipes WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.get("/api/version", (_, res) => res.json({ version: "pantry-2026-07-29z" }));

app.listen(PORT, () => console.log(`Pantry running on ${PORT} [pantry-2026-07-29z]`));
