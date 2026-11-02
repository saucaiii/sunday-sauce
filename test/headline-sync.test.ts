import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * The ledger is written on the droplet and read on the laptop, so the risky
 * parts are the merge and the shape check — a truncated or foreign file must
 * never replace good data, and a story must never appear twice because two
 * machines both know about it.
 */

const ROOT = path.resolve(import.meta.dirname, "..");
const LOCAL = path.join(ROOT, "data", "headlines.json");
const REMOTE = path.join(ROOT, "data", "headlines.remote.json");

let savedLocal: string | null = null;
let savedRemote: string | null = null;

const h = (title: string, link: string, hoursAgo: number, job = "alert") => ({
  title, link, source: "reuters", job, at: Date.now() - hoursAgo * 3600_000,
});

function write(file: string, rows: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(rows));
}

before(async () => {
  await import("../src/lib/env.js");
  savedLocal = fs.existsSync(LOCAL) ? fs.readFileSync(LOCAL, "utf8") : null;
  savedRemote = fs.existsSync(REMOTE) ? fs.readFileSync(REMOTE, "utf8") : null;
});

after(() => {
  for (const [file, saved] of [[LOCAL, savedLocal], [REMOTE, savedRemote]] as const) {
    if (saved === null) fs.rmSync(file, { force: true });
    else fs.writeFileSync(file, saved);
  }
});

beforeEach(() => {
  fs.rmSync(LOCAL, { force: true });
  fs.rmSync(REMOTE, { force: true });
});

test("the pulled ledger reaches the ticker", async () => {
  const { recentHeadlines } = await import("../src/lib/headlines.js");
  write(REMOTE, [h("From the droplet", "https://example.com/a", 2)]);
  assert.deepEqual(recentHeadlines(24).map((r) => r.title), ["From the droplet"]);
});

test("a story known to both machines appears once", async () => {
  const { recentHeadlines } = await import("../src/lib/headlines.js");
  write(LOCAL, [h("Same story", "https://example.com/dup", 3)]);
  write(REMOTE, [h("Same story", "https://example.com/dup", 1)]);

  const out = recentHeadlines(24);
  assert.equal(out.length, 1, "deduplicated by link");
  // The earlier sighting wins: that is when it actually published, not when a
  // sync happened to notice it.
  assert.ok(Date.now() - out[0].at > 2.5 * 3600_000, "kept the original publish time");
});

test("neither source erases the other", async () => {
  const { recentHeadlines } = await import("../src/lib/headlines.js");
  write(LOCAL, [h("Recorded here", "https://example.com/local", 2)]);
  write(REMOTE, [h("Pulled from there", "https://example.com/remote", 1)]);

  const titles = recentHeadlines(24).map((r) => r.title);
  assert.deepEqual(titles, ["Pulled from there", "Recorded here"], "newest first, both present");
});

test("the window applies across both ledgers", async () => {
  const { recentHeadlines } = await import("../src/lib/headlines.js");
  write(LOCAL, [h("Too old here", "https://example.com/old-l", 30)]);
  write(REMOTE, [h("Too old there", "https://example.com/old-r", 26),
                 h("Current", "https://example.com/new", 5)]);
  assert.deepEqual(recentHeadlines(24).map((r) => r.title), ["Current"]);
});

test("a malformed remote file is ignored rather than trusted", async () => {
  const { recentHeadlines, isHeadlineArray } = await import("../src/lib/headlines.js");

  assert.equal(isHeadlineArray([{ title: "x", link: "y", at: 1 }]), true);
  assert.equal(isHeadlineArray([{ title: "x" }]), false, "missing fields");
  assert.equal(isHeadlineArray({ not: "an array" }), false);
  assert.equal(isHeadlineArray([null]), false);

  write(LOCAL, [h("Good local row", "https://example.com/keep", 1)]);
  fs.writeFileSync(REMOTE, '{"half written');            // truncated mid-sync
  assert.deepEqual(recentHeadlines(24).map((r) => r.title), ["Good local row"]);

  write(REMOTE, [{ something: "else" }]);                 // wrong shape
  assert.deepEqual(recentHeadlines(24).map((r) => r.title), ["Good local row"]);
});

test("sync is a no-op when no host is configured", async () => {
  const sync = await import("../src/lib/headline-sync.js");
  const had = process.env.HEADLINE_SYNC_HOST;
  delete process.env.HEADLINE_SYNC_HOST;
  try {
    assert.equal(await sync.syncOnce(), null);
    assert.equal(fs.existsSync(REMOTE), false, "must not create a file it never fetched");
  } finally {
    if (had !== undefined) process.env.HEADLINE_SYNC_HOST = had;
  }
});
