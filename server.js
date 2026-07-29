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
    name TEXT NOT NULL, qty REAL NOT NULL DEFAULT 0, unit TEXT DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS list (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL, qty REAL NOT NULL DEFAULT 0, unit TEXT DEFAULT '',
    checked INTEGER NOT NULL DEFAULT 0
  );
`);

// ---------- pantry API ----------
app.get("/api/pantry", (_, res) => res.json(db.prepare("SELECT * FROM pantry ORDER BY name").all()));
app.post("/api/pantry", (req, res) => {
  const { name, qty = 1, unit = "" } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "name required" });
  const info = db.prepare("INSERT INTO pantry (name,qty,unit) VALUES (?,?,?)").run(name.trim(), qty, unit);
  res.json({ id: info.lastInsertRowid, name: name.trim(), qty, unit });
});
app.patch("/api/pantry/:id", (req, res) => {
  const { qty } = req.body;
  db.prepare("UPDATE pantry SET qty=? WHERE id=?").run(qty, req.params.id);
  res.json({ ok: true });
});
app.delete("/api/pantry/:id", (req, res) => {
  db.prepare("DELETE FROM pantry WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

// ---------- list API ----------
app.get("/api/list", (_, res) => res.json(db.prepare("SELECT * FROM list ORDER BY id").all()));
app.post("/api/list", (req, res) => {
  const { name, qty = 1, unit = "" } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "name required" });
  const info = db.prepare("INSERT INTO list (name,qty,unit,checked) VALUES (?,?,?,0)").run(name.trim(), qty, unit);
  res.json({ id: info.lastInsertRowid, name: name.trim(), qty, unit, checked: 0 });
});
app.patch("/api/list/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM list WHERE id=?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "not found" });
  const qty = req.body.qty ?? row.qty;
  const checked = req.body.checked ?? row.checked;
  db.prepare("UPDATE list SET qty=?, checked=? WHERE id=?").run(qty, checked ? 1 : 0, req.params.id);
  res.json({ ok: true });
});
app.delete("/api/list/:id", (req, res) => {
  db.prepare("DELETE FROM list WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

// move all checked list items into pantry, then clear them from the list
app.post("/api/purchase", (_, res) => {
  const bought = db.prepare("SELECT * FROM list WHERE checked=1").all();
  const norm = (s) => s.toLowerCase().trim().replace(/s$/, "");
  const upsert = db.transaction(() => {
    const pantry = db.prepare("SELECT * FROM pantry").all();
    for (const b of bought) {
      const match = pantry.find((p) => norm(p.name) === norm(b.name));
      if (match) db.prepare("UPDATE pantry SET qty=? WHERE id=?").run(+(match.qty + b.qty).toFixed(2), match.id);
      else db.prepare("INSERT INTO pantry (name,qty,unit) VALUES (?,?,?)").run(b.name, b.qty, b.unit);
    }
    db.prepare("DELETE FROM list WHERE checked=1").run();
  });
  upsert();
  res.json({ ok: true, moved: bought.length });
});

// subtract cooked recipe amounts from pantry stock
app.post("/api/cook", (req, res) => {
  const items = req.body.items || [];
  const norm = (s) => s.toLowerCase().trim().replace(/s$/, "");
  const tx = db.transaction(() => {
    const pantry = db.prepare("SELECT * FROM pantry").all();
    for (const it of items) {
      let remaining = it.qty;
      const matches = pantry.filter((p) => norm(p.name) === norm(it.name));
      for (const m of matches) {
        if (remaining <= 0) break;
        const take = Math.min(m.qty, remaining);
        db.prepare("UPDATE pantry SET qty=? WHERE id=?").run(+(m.qty - take).toFixed(2), m.id);
        remaining = +(remaining - take).toFixed(2);
      }
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
          content: `Extract the shopping ingredients from this recipe. Return ONLY a JSON array, no prose, no markdown fences. Each element: {"name": string (singular, generic grocery name e.g. "onion" not "1 large yellow onion, diced"), "qty": number, "unit": string (e.g. "cup","tbsp","g","oz","clove","","whole")}. Combine duplicates. Ignore water/salt-to-taste if no amount.\n\nRECIPE:\n${recipe}`,
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
