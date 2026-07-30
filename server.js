import express from "express";
import Database from "better-sqlite3";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "1mb" }));
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
async function callClaude(prompt, maxTokens = 4000) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await r.json();
  if (data.error) {
    console.error("Anthropic API error:", JSON.stringify(data.error).slice(0, 300));
    throw new Error("anthropic: " + (data.error.message || data.error.type || "unknown"));
  }
  const text = (data.content || []).filter((i) => i.type === "text").map((i) => i.text).join("");
  if (!text) console.error("Anthropic returned no text. stop_reason:", data.stop_reason);
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

const PARSE_PROMPT = (recipeText) => `You extract a recipe into structured data. Return ONLY a JSON object, no prose, no markdown fences:
{
  "title": string,             // the recipe's name
  "ingredients": [ {
     "name": string,           // singular generic grocery name, e.g. "flour", "garlic", "chicken breast"
     "use_qty": number,        // amount the recipe uses
     "use_unit": string,       // recipe unit: "tbsp","cup","clove","whole","g","oz", etc.
     "base_unit": "g" | "ml" | "count",   // g solids, ml liquids, count for whole items
     "use_base": number,       // use_qty in base_unit (1 tbsp flour->8 g; 2 cloves garlic->2 count; 1 lemon->1 count)
     "pkg_label": string,      // what you actually buy: "5 lb bag","head","bunch","1 lb","stick","each"
     "pkg_base": number        // base_unit in ONE package (5 lb bag flour->2265 g; head garlic->10 count; bunch parsley->30 g; lemon->1 count; stick butter->113 g)
  } ],
  "steps": [ string ]          // ordered cooking steps, each a short plain sentence
}
Rules: realistic US package sizes for pkg_base. Whole items sold individually -> base_unit "count", pkg_base 1, pkg_label "each". Garlic -> count in cloves, head ~10. Combine duplicate ingredients. Skip water and plain salt/pepper "to taste" with no amount. If the text has no clear cooking steps, use an empty steps array. The text may include website navigation, ads, reviews, or comments — ignore all of that and extract only the actual recipe. If you truly cannot find a recipe, return {"title":"","ingredients":[],"steps":[]}.

RECIPE:
${recipeText}`;

// Diagnostic: /api/debug-parse?url=... runs the real pipeline and shows what the
// model was given and what it returned. Remove once things work.
app.get("/api/debug-parse", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: "add ?url=..." });
  const out = {};
  try {
    const page = await fetchPage(url);
    out.page_bytes = page.length;
    const jsonld = extractRecipeJsonLd(page);
    out.jsonld_found = Boolean(jsonld);
    if (jsonld) {
      out.jsonld_name = jsonld.name;
      out.jsonld_ingredient_count = (jsonld.ingredients || []).length;
      out.jsonld_step_count = (jsonld.instructions || []).length;
    }
    let recipe = jsonld
      ? `TITLE: ${jsonld.name || ""}\n\nINGREDIENTS:\n${(jsonld.ingredients || []).join("\n")}\n\nINSTRUCTIONS:\n${(jsonld.instructions || []).join("\n")}`
      : htmlToText(page);
    recipe = recipe.slice(0, 8000);
    out.assembled_head = recipe.slice(0, 400);
    out.assembled_len = recipe.length;
    const raw = (await callClaude(PARSE_PROMPT(recipe))).replace(/```json|```/g, "").trim();
    out.model_raw_head = raw.slice(0, 500);
    try {
      const obj = JSON.parse(raw);
      out.parsed_title = obj.title;
      out.parsed_ingredient_count = Array.isArray(obj.ingredients) ? obj.ingredients.length : "not-array";
      out.parsed_step_count = Array.isArray(obj.steps) ? obj.steps.length : "not-array";
    } catch (e) {
      out.json_parse_error = String(e.message);
    }
  } catch (e) {
    out.error = String(e && e.message || e);
  }
  res.json(out);
});

// ---------- recipe parsing: accepts pasted text OR a url ----------
app.post("/api/parse", async (req, res) => {
  let { recipe, url } = req.body;
  if (!process.env.ANTHROPIC_API_KEY)
    return res.status(500).json({ error: "ANTHROPIC_API_KEY not set on the server" });

  try {
    let sourceUrl = "";
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
        recipe =
          `TITLE: ${jsonld.name || ""}\n\nINGREDIENTS:\n` +
          (jsonld.ingredients || []).join("\n") +
          `\n\nINSTRUCTIONS:\n` +
          (jsonld.instructions || []).join("\n");
      } else {
        recipe = htmlToText(page);
      }
      recipe = recipe.slice(0, 8000); // keep the prompt well within token limits
      if (recipe.replace(/\s/g, "").length < 40)
        return res.status(400).json({ error: "Couldn't find a recipe on that page. Paste the text instead." });
    }
    if (!recipe?.trim()) return res.status(400).json({ error: "recipe or url required" });

    const raw = (await callClaude(PARSE_PROMPT(recipe))).replace(/```json|```/g, "").trim();
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
    res.json({
      title: obj.title || "Untitled recipe",
      items: Array.isArray(obj.ingredients) ? obj.ingredients : [],
      steps: Array.isArray(obj.steps) ? obj.steps : [],
      source_url: sourceUrl,
    });
  } catch (e) {
    console.error("parse failed:", e && e.message);
    res.status(500).json({ error: "parse failed" });
  }
});

// ---------- saved recipes ----------
app.get("/api/recipes", (_, res) =>
  res.json(db.prepare("SELECT id,title,source_url,created FROM recipes ORDER BY created DESC").all()));
app.get("/api/recipes/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM recipes WHERE id=?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "not found" });
  res.json({ ...row, ingredients: JSON.parse(row.ingredients), steps: JSON.parse(row.steps) });
});
app.post("/api/recipes", (req, res) => {
  const { title, source_url = "", ingredients = [], steps = [] } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: "title required" });
  const info = db.prepare("INSERT INTO recipes (title,source_url,ingredients,steps,created) VALUES (?,?,?,?,?)")
    .run(title.trim(), source_url, JSON.stringify(ingredients), JSON.stringify(steps), Date.now());
  res.json({ id: info.lastInsertRowid });
});
app.delete("/api/recipes/:id", (req, res) => {
  db.prepare("DELETE FROM recipes WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.get("/api/version", (_, res) => res.json({ version: "pantry-2026-07-29j" }));

// Diagnostic: /api/debug-fetch?url=... reports exactly what each fetch path does.
// Safe to leave in — it never exposes your key, only whether one is present.
app.get("/api/debug-fetch", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: "add ?url=..." });
  const out = {
    scraper_configured: scraperConfigured(),
    has_SCRAPER_KEY: Boolean(process.env.SCRAPER_KEY),
    has_SCRAPER_URL: Boolean(process.env.SCRAPER_URL),
    has_legacy_SCRAPER_API_KEY: Boolean(process.env.SCRAPER_API_KEY),
  };
  try {
    const d = await directFetch(url);
    out.direct = { status: d.status, bytes: d.body ? d.body.length : 0, jsonld: Boolean(extractRecipeJsonLd(d.body)) };
  } catch (e) {
    out.direct = { error: String(e && e.message || e) };
  }
  if (scraperConfigured()) {
    try {
      const s = await scraperFetch(url);
      out.scraper = { status: s.status, bytes: s.body ? s.body.length : 0, jsonld: Boolean(extractRecipeJsonLd(s.body)) };
      out.scraper_body_head = (s.body || "").slice(0, 300);
    } catch (e) {
      out.scraper = { error: String(e && e.message || e) };
    }
  }
  res.json(out);
});

app.listen(PORT, () => console.log(`Pantry running on ${PORT} [pantry-2026-07-29j]`));
