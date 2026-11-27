// The page and its /lib modules must always be from the same deploy: a new
// page next to an old cached module doesn't start at all. The server tags
// every import with its version so they can't be mixed.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("the page and its modules are served tagged with one version", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "pantry-ver-"));
  const port = 31000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: { ...process.env, PORT: String(port), DB_PATH: join(dir, "t.db"), RAILWAY_GIT_COMMIT_SHA: "abc1234def" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => { child.kill(); rmSync(dir, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server did not start")), 5000);
    child.stdout.on("data", (c) => { if (String(c).includes("Pantry running")) { clearTimeout(timer); resolve(); } });
    child.once("exit", (code) => reject(new Error(`server exited ${code}`)));
  });
  const get = (p) => fetch(`http://127.0.0.1:${port}${p}`);

  const page = await (await get("/")).text();
  assert.match(page, /const PAGE_VERSION = "abc1234"/);
  const imports = [...page.matchAll(/from\s*"(\/lib\/[^"]+)"/g)].map((m) => m[1]);
  assert.ok(imports.length > 5);
  for (const u of imports) assert.match(u, /\?v=abc1234$/, u);
  assert.equal((await (await get("/api/version")).json()).version, "abc1234");

  // Imports between modules are tagged too, so they resolve to the same URLs.
  const offline = await (await get("/lib/offline.js?v=abc1234")).text();
  assert.match(offline, /from "\.\/aisles\.js\?v=abc1234"/);
  const res = await get("/lib/units.js");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /javascript/);
  assert.equal((await get("/lib/nope.js")).status, 404);
  assert.notEqual((await get("/lib/..%2Fserver.js")).status, 200);
});
