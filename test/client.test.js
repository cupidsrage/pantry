// The front end is one big inline <script type="module"> in index.html, so
// nothing type-checks or even parses it — a stray bracket ships silently and
// the page renders blank. These tests are the cheapest guard against that.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { writeFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, "public", "index.html"), "utf8");
const blocks = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];

test("index.html has exactly one inline script, and it is a module", () => {
  assert.equal(blocks.length, 1);
  assert.match(blocks[0][1], /type="module"/, "imports from /lib need type=module");
});

test("the inline script parses", () => {
  const dir = mkdtempSync(join(tmpdir(), "pantry-client-"));
  const file = join(dir, "inline.mjs");
  writeFileSync(file, blocks[0][2]);
  // node --check reports the line and column of a syntax error, which is what
  // makes this worth running: the failure names the spot.
  execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
});

test("everything the script imports from /lib actually exists and exports it", async () => {
  const imports = [...blocks[0][2].matchAll(/import\s*\{([^}]+)\}\s*from\s*"(\/lib\/[^"]+)"/g)];
  assert.ok(imports.length, "expected the page to import shared logic");
  for (const [, names, path] of imports) {
    const mod = await import(join(root, path.replace(/^\//, "")));
    for (const raw of names.split(",")) {
      // handles both `norm` and `recipeCoverage as coverageOf`
      const name = raw.trim().split(/\s+as\s+/)[0].trim();
      assert.ok(name in mod, `${path} does not export ${name}`);
    }
  }
});

test("the service worker precaches the shared modules", async () => {
  // They are ES module imports, so a cold offline start fails without them.
  const sw = readFileSync(join(root, "public", "sw.js"), "utf8");
  const imports = [...blocks[0][2].matchAll(/from\s*"(\/lib\/[^"]+)"/g)].map((m) => m[1]);
  const shell = sw.match(/const SHELL = \[([^\]]+)\]/);
  assert.ok(shell, "sw.js should declare a SHELL list");
  for (const path of imports) {
    assert.ok(shell[1].includes(`"${path}"`), `sw.js SHELL is missing ${path}`);
  }
});
