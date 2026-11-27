// /api/list/sync against a real server: the phone's outbox has to land the
// same however many times it's sent, and a purchase only moves what it names.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("list sync: replays are harmless, client ids resolve, purchases are exact", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "pantry-sync-"));
  const port = 31000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: { ...process.env, PORT: String(port), DB_PATH: join(dir, "test.db") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => { child.kill(); rmSync(dir, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server did not start")), 5000);
    child.stdout.on("data", (chunk) => {
      if (String(chunk).includes("Pantry running")) { clearTimeout(timer); resolve(); }
    });
    child.once("exit", (code) => reject(new Error(`server exited ${code}`)));
  });

  const base = `http://127.0.0.1:${port}/api`;
  const reg = await fetch(base + "/register", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "shopper", password: "secret1" }),
  });
  const cookie = reg.headers.get("set-cookie").split(";")[0];
  const call = async (path, method = "GET", body) => {
    const res = await fetch(base + path, {
      method, headers: { cookie, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  };
  const sync = (ops) => call("/list/sync", "POST", { ops });

  // An item already on the list from before, plus a batch made with no signal.
  const old = (await call("/list", "POST", { name: "bread" })).body.id;
  const batch = [
    { op: "add", ref: "c_eggs1", name: "eggs", packages: 2, section: "dairy" },
    { op: "add", ref: "c_milk1", name: "milk" },
    { op: "set", ref: "c_eggs1", checked: true },      // ticked before it ever synced
    { op: "set", ref: old, checked: true },
    { op: "delete", ref: "c_milk1" },
  ];
  const first = await sync(batch);
  assert.equal(first.status, 200);
  const names = (l) => l.map((x) => `${x.name}${x.checked ? "✓" : ""}`).sort();
  assert.deepEqual(names(first.body.list), ["bread✓", "eggs✓"]);
  const eggs = first.body.list.find((x) => x.name === "eggs");
  assert.equal(eggs.client_id, "c_eggs1");
  assert.equal(eggs.section, "dairy");
  assert.equal(eggs.packages, 2);

  // The reply was lost; the phone sends the same batch again. Nothing doubles.
  const again = await sync(batch);
  assert.deepEqual(names(again.body.list), names(first.body.list));

  // Another device ticks something meanwhile; this phone's purchase names only its own.
  const other = (await call("/list", "POST", { name: "jam" })).body.id;
  await call(`/list/${other}`, "PATCH", { checked: true });
  const bought = await sync([{ op: "purchase", refs: ["c_eggs1", old, "c_eggs1"] }]);
  assert.equal(bought.body.moved, 2);
  assert.deepEqual(names(bought.body.list), ["jam✓"]);
  const pantry = (await call("/pantry")).body;
  assert.deepEqual(pantry.map((p) => p.name).sort(), ["bread", "eggs"]); // eggs once, not twice
  assert.equal(pantry.find((p) => p.name === "eggs").base, 2);

  // Bought again (another lost reply): already gone, so nothing more moves.
  assert.equal((await sync([{ op: "purchase", refs: ["c_eggs1", old] }])).body.moved, 0);
  assert.equal((await call("/pantry")).body.length, 2);

  // A body that isn't a list of ops is refused; junk inside one is skipped.
  assert.equal((await sync("nope")).status, 400);
  assert.equal((await sync([{ op: "bogus" }, { op: "set", ref: other, packages: 4 }])).body.list[0].packages, 4);

  // Another account can't touch this one's rows, by id or by client id.
  const reg2 = await fetch(base + "/register", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "intruder", password: "secret1" }),
  });
  const cookie2 = reg2.headers.get("set-cookie").split(";")[0];
  const res2 = await fetch(base + "/list/sync", {
    method: "POST", headers: { cookie: cookie2, "content-type": "application/json" },
    body: JSON.stringify({ ops: [{ op: "delete", ref: other }, { op: "add", ref: "c_eggs1", name: "x" }] }),
  });
  assert.deepEqual((await res2.json()).list.map((x) => x.name), ["x"]); // its own row, same client id is fine
  assert.equal((await call("/list")).body.length, 1);
});
