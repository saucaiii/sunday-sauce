import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";

/**
 * The endpoint's job is to be boring under failure. A podcast does not get to
 * pause while an aggregator recovers, so every test here is about what is on
 * screen when something upstream has gone wrong.
 */

const TEST_SECRET = "test-secret-long-enough-to-pass-validation";

const ROOT = path.resolve(import.meta.dirname, "..");
const HEADLINES = path.join(ROOT, "data", "headlines.json");
// The ticker merges this with whatever was pulled from the publishing
// machine, so a test asserting on its contents has to isolate both.
const REMOTE = path.join(ROOT, "data", "headlines.remote.json");

/** Real state files must survive a test run. */
let saved: string | null = null;
let savedRemote: string | null = null;

before(async () => {
  // env.ts loads .env with override:true, so a real OVERLAY_SECRET on this
  // machine would replace anything set here at import time. Import it first,
  // then take the variable back. Setting it before the import is what made
  // these tests pass only on machines whose .env had no secret in it.
  await import("../src/lib/env.js");
  process.env.OVERLAY_SECRET = TEST_SECRET;
  saved = fs.existsSync(HEADLINES) ? fs.readFileSync(HEADLINES, "utf8") : null;
  savedRemote = fs.existsSync(REMOTE) ? fs.readFileSync(REMOTE, "utf8") : null;
});

after(() => {
  if (saved === null) fs.rmSync(HEADLINES, { force: true });
  else fs.writeFileSync(HEADLINES, saved);
  if (savedRemote === null) fs.rmSync(REMOTE, { force: true });
  else fs.writeFileSync(REMOTE, savedRemote);
});

function get(server: http.Server, urlPath: string): Promise<{ status: number; body: string }> {
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: urlPath }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    }).on("error", reject);
  });
}

async function withServer<T>(fn: (s: http.Server) => Promise<T>): Promise<T> {
  const { createServer } = await import("../src/server.js");
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    return await fn(server);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

test("serves last-good prices while upstream is failing", async () => {
  const prices = await import("../src/lib/prices.js");
  const { buildState } = await import("../src/server.js");

  const captured = new Date().toISOString();
  prices.__setCache({
    capturedAt: captured,
    source: "coingecko",
    rows: [{ symbol: "BTC", raw: 64231.5, change24h: -1.42 }],
  });

  // Upstream is now completely broken.
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("simulated CoinGecko outage");
  }) as typeof fetch;

  try {
    const after = await prices.refresh();
    // The failed refresh returns the previous snapshot rather than nothing.
    assert.equal(after?.rows[0]?.raw, 64231.5);

    const state = buildState();
    assert.equal(state.prices.length, 1);
    assert.equal(state.prices[0].display.price, "$64,232");
    assert.equal(state.prices[0].display.change, "▼ 1.42%");
    // ...and it says so, so the overlay can warn rather than lie.
    assert.equal(state.stale, true, "a failing refresh must mark the payload stale");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("a cold start with nothing cached yields no prices, not zeros", async () => {
  const prices = await import("../src/lib/prices.js");
  const { buildState } = await import("../src/server.js");

  prices.__setCache(null);
  // peek() falls back to disk; make sure there is nothing to find.
  const file = path.join(ROOT, "data", "prices.json");
  const had = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  fs.rmSync(file, { force: true });

  try {
    const state = buildState();
    assert.deepEqual(state.prices, [], "an empty strip, never a row of $0.00");
    assert.equal(state.priceCapturedAt, null);
    assert.equal(state.stale, true);
  } finally {
    if (had !== null) fs.writeFileSync(file, had);
  }
});

test("the ticker carries only what was recorded as published", async () => {
  const { recordHeadlines, recentHeadlines } = await import("../src/lib/headlines.js");
  const prices = await import("../src/lib/prices.js");
  const { buildState } = await import("../src/server.js");
  // Manual ticker lines deliberately override the published feed, so this
  // test has to start from an operator who has not set any.
  (await import("../src/lib/broadcast.js")).__reset();

  fs.rmSync(HEADLINES, { force: true });
  fs.rmSync(REMOTE, { force: true });
  prices.__setCache({
    capturedAt: new Date().toISOString(),
    source: "coingecko",
    rows: [{ symbol: "BTC", raw: 1, change24h: 0 }],
  });

  recordHeadlines("alert", [
    { title: "A story that actually went out", link: "https://example.com/published", source: "reuters" },
  ]);

  const state = buildState();
  assert.deepEqual(state.ticker, ["A story that actually went out"]);

  // Nothing that was merely considered appears anywhere.
  assert.equal(recentHeadlines(24).length, 1);
});

test("a dry run rehearses without putting anything on the overlay", async () => {
  const { recordHeadlines } = await import("../src/lib/headlines.js");

  fs.rmSync(HEADLINES, { force: true });
  process.env.DRY_RUN = "1";
  try {
    recordHeadlines("log", [
      { title: "Draft that was never published", link: "https://example.com/draft", source: "x" },
    ]);
  } finally {
    delete process.env.DRY_RUN;
  }

  assert.equal(fs.existsSync(HEADLINES), false, "a dry run must not create the ledger");
});

test("headlines outside the window drop off the ticker", async () => {
  const { recentHeadlines } = await import("../src/lib/headlines.js");

  const old = Date.now() - 30 * 3600_000;
  fs.rmSync(REMOTE, { force: true });
  fs.mkdirSync(path.dirname(HEADLINES), { recursive: true });
  fs.writeFileSync(HEADLINES, JSON.stringify([
    { title: "Yesterday's news, twice over", link: "https://example.com/old", source: "", job: "log", at: old },
    { title: "Still current", link: "https://example.com/new", source: "", job: "log", at: Date.now() },
  ]));

  const titles = recentHeadlines(24).map((h) => h.title);
  assert.deepEqual(titles, ["Still current"]);
});

test("the wrong secret is indistinguishable from a missing page", async () => {
  await withServer(async (server) => {
    const good = await get(server, `/overlay/${TEST_SECRET}/state`);
    assert.equal(good.status, 200);

    // Same length, wrong value: the timing-safe compare must still reject it.
    const bad = await get(server, "/overlay/test-secret-long-enough-to-pass-XXXXXXXXX/state");
    assert.equal(bad.status, 404);

    const short = await get(server, "/overlay/nope/state");
    assert.equal(short.status, 404);

    const bare = await get(server, "/state");
    assert.equal(bare.status, 404);
  });
});

test("the static route cannot escape the overlay directory", async () => {
  await withServer(async (server) => {
    for (const attempt of [
      `/overlay/${TEST_SECRET}/../../.env`,
      `/overlay/${TEST_SECRET}/..%2F..%2F.env`,
      `/overlay/${TEST_SECRET}/../package.json`,
    ]) {
      const res = await get(server, attempt);
      assert.equal(res.status, 404, `${attempt} must not resolve`);
      assert.ok(!res.body.includes("TELEGRAM_BOT_TOKEN"), "never serve .env");
    }
  });
});

test("the overlay itself is served from the same origin as its state", async () => {
  await withServer(async (server) => {
    const page = await get(server, `/overlay/${TEST_SECRET}/`);
    assert.equal(page.status, 200);
    assert.ok(page.body.includes("<x-dc>"), "should be the overlay document");
    // Same origin is the whole reason this route exists: a relative ./state
    // from that page resolves to the endpoint with no CORS involved.
    assert.ok(page.body.includes('fetch("./state"'), "overlay must poll a relative path");
  });
});

test("the secret never appears in the served page", async () => {
  await withServer(async (server) => {
    const page = await get(server, `/overlay/${TEST_SECRET}/`);
    assert.ok(
      !page.body.includes(TEST_SECRET),
      "the page must not embed its own URL secret"
    );
  });
});
