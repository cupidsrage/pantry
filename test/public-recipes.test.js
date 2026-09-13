import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("an owner can publish only selected recipes for other accounts", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "pantry-public-"));
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
  async function register(username) {
    const res = await fetch(base + "/register", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password: "secret1" }),
    });
    assert.equal(res.status, 200);
    return res.headers.get("set-cookie").split(";")[0];
  }
  async function request(path, cookie, method = "GET", body) {
    const res = await fetch(base + path, {
      method, headers: { cookie, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  }

  const owner = await register("owner");
  const viewer = await register("viewer");
  const created = await request("/recipes", owner, "POST", {
    title: "Public soup", ingredients: [{ name: "lentils", use_qty: 1, use_unit: "cup" }],
    steps: ["Simmer."],
  });
  const privateRecipe = await request("/recipes", owner, "POST", {
    title: "Secret cake", ingredients: [], steps: [],
  });

  assert.deepEqual((await request("/public-recipes", viewer)).body, []);
  assert.equal((await request(`/recipes/${created.body.id}/public`, owner, "PATCH", { is_public: true })).status, 200);

  const list = (await request("/public-recipes", viewer)).body;
  assert.equal(list.length, 1);
  assert.equal(list[0].title, "Public soup");
  assert.equal(list[0].owner_username, "owner");
  assert.equal(list[0].is_owner, false);
  const detail = await request(`/public-recipes/${created.body.id}`, viewer);
  assert.equal(detail.status, 200);
  assert.deepEqual(detail.body.steps, ["Simmer."]);
  assert.equal((await request(`/public-recipes/${privateRecipe.body.id}`, viewer)).status, 404);
  assert.equal((await request(`/recipes/${created.body.id}/public`, viewer, "PATCH", { is_public: false })).status, 404);

  await request(`/recipes/${created.body.id}/public`, owner, "PATCH", { is_public: false });
  assert.deepEqual((await request("/public-recipes", viewer)).body, []);
});
