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
async function callClaude(prompt, maxTokens = 2000) {
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
  return (data.content || []).filter((i) => i.type === "text").map((i) => i.text).join("");
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

// Most recipe sites embed a schema.org/Recipe as JSON-LD. Pull it out directly
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
Rules: realistic US package sizes for pkg_base. Whole items sold individually -> base_unit "count", pkg_base 1, pkg_label "each". Garlic -> count in cloves, head ~10. Combine duplicate ingredients. Skip water and plain salt/pepper "to taste" with no amount. If the text has no clear cooking steps, use an empty steps array.

RECIPE:
${recipeText}`;

// ---------- recipe parsing: accepts pasted text OR a url ----------
app.post("/api/parse", async (req, res) => {
  let { recipe, url } = req.body;
  if (!process.env.ANTHROPIC_API_KEY)
    return res.status(500).json({ error: "ANTHROPIC_API_KEY not set on the server" });

  try {
    let sourceUrl = "";
    if (url?.trim()) {
      sourceUrl = url.trim();
      let page, status;
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 12000); // don't hang forever
        const pr = await fetch(sourceUrl, {
          headers: {
            "user-agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
            "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "accept-language": "en-US,en;q=0.9",
          },
          redirect: "follow",
          signal: ctrl.signal,
        });
        clearTimeout(timer);
        status = pr.status;
        page = await pr.text();
      } catch {
        return res.status(400).json({ error: "Couldn't reach that link. Paste the recipe text instead." });
      }
      if (status === 403 || status === 429 || status >= 500) {
        return res.status(400).json({
          error: "That site blocked the fetch (many big recipe sites do). Copy the recipe text and paste it instead.",
        });
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
      if (recipe.replace(/\s/g, "").length < 40)
        return res.status(400).json({ error: "Couldn't find a recipe on that page. Paste the text instead." });
    }
    if (!recipe?.trim()) return res.status(400).json({ error: "recipe or url required" });

    const text = (await callClaude(PARSE_PROMPT(recipe))).replace(/```json|```/g, "").trim();
    const obj = JSON.parse(text);
    res.json({
      title: obj.title || "Untitled recipe",
      items: obj.ingredients || [],
      steps: obj.steps || [],
      source_url: sourceUrl,
    });
  } catch (e) {
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
app.listen(PORT, () => console.log(`Pantry running on ${PORT}`));
