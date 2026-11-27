// The natural voice: /api/tts asks OpenAI for a clip once per (text, voice),
// keeps it on disk, and serves it the way Safari needs (byte ranges). A fake
// OpenAI stands in so the test is free and offline.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLIP = Buffer.from("ID3fake-mp3-bytes-" + "x".repeat(200));

async function startPantry(t, env) {
  const dir = mkdtempSync(join(tmpdir(), "pantry-tts-"));
  const port = 31000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: { ...process.env, OPENAI_API_KEY: "", PORT: String(port), DB_PATH: join(dir, "t.db"), ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => { child.kill(); rmSync(dir, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server did not start")), 5000);
    child.stdout.on("data", (c) => { if (String(c).includes("Pantry running")) { clearTimeout(timer); resolve(); } });
    child.once("exit", (code) => reject(new Error(`server exited ${code}`)));
  });
  const base = `http://127.0.0.1:${port}`;
  const reg = await fetch(base + "/api/register", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "cook", password: "secret1" }),
  });
  const cookie = reg.headers.get("set-cookie").split(";")[0];
  const get = (path, headers = {}) => fetch(base + path, { headers: { cookie, ...headers } });
  return { base, dir, get };
}

test("natural voice: one OpenAI call per clip, cached, range-friendly", async (t) => {
  const calls = [];
  let mode = "ok";
  const fake = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      calls.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(body) });
      if (mode === "broke") {
        res.writeHead(429, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: { code: "credit_balance_exhausted" } }));
      }
      res.writeHead(200, { "content-type": "audio/mpeg" });
      res.end(CLIP);
    });
  });
  await new Promise((r) => fake.listen(0, "127.0.0.1", r));
  t.after(() => fake.close());
  const { base, dir, get } = await startPantry(t, {
    OPENAI_API_KEY: "sk-test", OPENAI_BASE_URL: `http://127.0.0.1:${fake.address().port}/v1`,
  });

  const status = await (await get("/api/tts/status")).json();
  assert.equal(status.enabled, true);
  assert.equal(status.voice, "coral");
  assert.equal((await fetch(base + "/api/tts?t=hi")).status, 401); // needs a login

  const q = "/api/tts?v=nova&t=" + encodeURIComponent("Whisk 1 1/2 cups flour.");
  const first = await get(q);
  assert.equal(first.status, 200);
  assert.match(first.headers.get("content-type"), /audio\/mpeg/);
  assert.deepEqual(Buffer.from(await first.arrayBuffer()), CLIP);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/v1/audio/speech");
  assert.equal(calls[0].auth, "Bearer sk-test");
  assert.equal(calls[0].body.voice, "nova");
  assert.equal(calls[0].body.model, "gpt-4o-mini-tts");
  assert.equal(calls[0].body.input, "Whisk 1 and a half cups flour."); // shorthand spelled out first
  assert.ok(calls[0].body.instructions);

  // Again, and as Safari asks for audio (a byte range): from disk, no new call.
  assert.equal((await get(q)).status, 200);
  const range = await get(q, { range: "bytes=0-1" });
  assert.equal(range.status, 206);
  assert.equal((await range.arrayBuffer()).byteLength, 2);
  assert.equal(calls.length, 1);
  assert.equal(readdirSync(join(dir, "tts-cache")).filter((f) => f.endsWith(".mp3")).length, 1);

  // An unknown voice gets the default; nothing to read is refused.
  await get("/api/tts?v=robot&t=Stir.");
  assert.equal(calls.at(-1).body.voice, "coral");
  assert.equal((await get("/api/tts?t=")).status, 400);

  // Out of credit: this clip fails, and the next is refused at once without
  // asking OpenAI again, so the phone falls back to its own voice quickly.
  mode = "broke";
  const n = calls.length;
  assert.equal((await get("/api/tts?t=Bake.")).status, 502);
  assert.equal(calls.length, n + 1);
  assert.equal((await get("/api/tts?t=Serve.")).status, 503);
  assert.equal(calls.length, n + 1);
  assert.equal((await get(q)).status, 200); // clips already made still play
});

test("natural voice is off without a key", async (t) => {
  const { get } = await startPantry(t, {});
  assert.equal((await (await get("/api/tts/status")).json()).enabled, false);
  assert.equal((await get("/api/tts?t=hi")).status, 503);
});
