import express from "express";
import Database from "better-sqlite3";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(join(__dirname, "public")));

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
`);

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

// ---------- recipe parsing (Anthropic proxied, key stays server-side) ----------
app.post("/api/parse", async (req, res) => {
  const { recipe } = req.body;
  if (!recipe?.trim()) return res.status(400).json({ error: "recipe required" });
  if (!process.env.ANTHROPIC_API_KEY)
    return res.status(500).json({ error: "ANTHROPIC_API_KEY not set on the server" });
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        messages: [{
          role: "user",
          content: `You convert a recipe into grocery-shopping data. Return ONLY a JSON array, no prose, no markdown fences.

For each ingredient, output an object:
{
  "name": string,              // singular generic grocery name, e.g. "flour", "garlic", "chicken breast"
  "use_qty": number,           // amount the recipe uses
  "use_unit": string,          // the recipe's unit: "tbsp","cup","clove","whole","g","oz", etc.
  "base_unit": "g" | "ml" | "count",   // g for solids, ml for liquids, count for whole items (eggs, lemons)
  "use_base": number,          // use_qty converted into base_unit (e.g. 1 tbsp flour -> 8 (g); 2 cloves garlic -> 2 (count); 1 lemon -> 1 (count))
  "pkg_label": string,         // what you actually buy at the store, e.g. "5 lb bag", "head", "bunch", "1 lb", "stick", "each"
  "pkg_base": number           // how much base_unit is in ONE package (e.g. 5 lb bag flour -> 2265 (g); head of garlic -> 10 (count); bunch parsley -> 30 (g); lemon -> 1 (count); stick butter -> 113 (g))
}

Rules:
- Use realistic US grocery package sizes for pkg_base.
- For whole items sold individually (lemon, egg, onion), base_unit="count", pkg_base=1, pkg_label="each".
- For garlic, base_unit="count" (cloves), a head ~10 cloves, pkg_label="head".
- Combine duplicate ingredients. Skip water and plain "salt/pepper to taste" with no measured amount.

RECIPE:
${recipe}`,
        }],
      }),
    });
    const data = await r.json();
    const text = (data.content || []).filter((i) => i.type === "text").map((i) => i.text).join("").replace(/```json|```/g, "").trim();
    res.json({ items: JSON.parse(text) });
  } catch (e) {
    res.status(500).json({ error: "parse failed" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Pantry running on ${PORT}`));
