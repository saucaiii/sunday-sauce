import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";

/**
 * The control endpoint is the only writable surface on this server, so most of
 * these are about what it refuses rather than what it accepts.
 */

const TEST_SECRET = "test-secret-long-enough-to-pass-validation";
const ROOT = path.resolve(import.meta.dirname, "..");
const FILE = path.join(ROOT, "data", "broadcast.json");

let saved: string | null = null;

before(async () => {
  // env.ts loads .env with override:true, so claim the variable after import.
  await import("../src/lib/env.js");
  process.env.OVERLAY_SECRET = TEST_SECRET;
  saved = fs.existsSync(FILE) ? fs.readFileSync(FILE, "utf8") : null;
});

after(() => {
  if (saved === null) fs.rmSync(FILE, { force: true });
  else fs.writeFileSync(FILE, saved);
});

function request(
  server: http.Server, method: string, urlPath: string, body?: string
): Promise<{ status: number; body: string }> {
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: urlPath, method,
        headers: body ? { "content-type": "application/json" } : {} },
      (res) => {
        let out = "";
        res.on("data", (c) => (out += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: out }));
      }
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function withServer<T>(fn: (s: http.Server) => Promise<T>): Promise<T> {
  const { createServer } = await import("../src/server.js");
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try { return await fn(server); } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

const CONTROL = `/overlay/${TEST_SECRET}/control`;
const STATE = `/overlay/${TEST_SECRET}/state`;

test("a posted headline reaches the state the overlay polls", async () => {
  const b = await import("../src/lib/broadcast.js");
  b.__reset();
  await withServer(async (server) => {
    const post = await request(server, "POST", CONTROL,
      JSON.stringify({ headline: "A headline", kicker: "News", breaking: true }));
    assert.equal(post.status, 200);

    const state = JSON.parse((await request(server, "GET", STATE)).body);
    assert.equal(state.text.headline, "A headline");
    assert.equal(state.text.breaking, true);
  });
});

test("clearing a field hands the value back rather than blanking the screen", async () => {
  const b = await import("../src/lib/broadcast.js");
  b.__reset();
  b.patch({ headline: "Something" });
  assert.equal(b.get().headline, "Something");

  // Empty means "not set", so the overlay falls back to its own default.
  b.patch({ headline: "" });
  assert.equal(b.get().headline, "");
});

test("manual ticker lines override the published feed, and clearing restores it", async () => {
  const b = await import("../src/lib/broadcast.js");
  const { recordHeadlines } = await import("../src/lib/headlines.js");
  const { buildState } = await import("../src/server.js");
  const prices = await import("../src/lib/prices.js");

  const HEADLINES = path.join(ROOT, "data", "headlines.json");
  const REMOTE = path.join(ROOT, "data", "headlines.remote.json");
  const hadHeadlines = fs.existsSync(HEADLINES) ? fs.readFileSync(HEADLINES, "utf8") : null;
  const hadRemote = fs.existsSync(REMOTE) ? fs.readFileSync(REMOTE, "utf8") : null;
  fs.rmSync(HEADLINES, { force: true });
  // The published feed is a merge of both ledgers now.
  fs.rmSync(REMOTE, { force: true });
  prices.__setCache({
    capturedAt: new Date().toISOString(), source: "coingecko",
    rows: [{ symbol: "BTC", raw: 1, change24h: 0 }],
  });

  try {
    recordHeadlines("alert", [
      { title: "Published story", link: "https://example.com/a", source: "reuters" },
    ]);
    b.__reset();
    assert.deepEqual(buildState().ticker, ["Published story"]);

    b.patch({ ticker: "Manual one\nManual two" });
    assert.deepEqual(buildState().ticker, ["Manual one", "Manual two"]);

    b.patch({ ticker: "" });
    assert.deepEqual(buildState().ticker, ["Published story"],
      "clearing the box must fall back to what was actually published");
  } finally {
    if (hadHeadlines !== null) fs.writeFileSync(HEADLINES, hadHeadlines);
    else fs.rmSync(HEADLINES, { force: true });
    if (hadRemote !== null) fs.writeFileSync(REMOTE, hadRemote);
    else fs.rmSync(REMOTE, { force: true });
  }
});

test("blank lines and stray whitespace do not become ticker entries", async () => {
  const b = await import("../src/lib/broadcast.js");
  b.__reset();
  b.patch({ ticker: "  One  \n\n\n   \n Two \n" });
  assert.deepEqual(b.get().ticker, ["One", "Two"]);
});

test("text is bounded, so a paste cannot push the lower third off the stage", async () => {
  const b = await import("../src/lib/broadcast.js");
  b.__reset();
  b.patch({ headline: "x".repeat(5000) });
  assert.equal(b.get().headline.length, 300);
});

test("unknown keys are ignored rather than stored", async () => {
  const b = await import("../src/lib/broadcast.js");
  b.__reset();
  b.patch({ headline: "Kept", somethingElse: "dropped", __proto__: "nope" } as never);
  assert.equal(b.get().headline, "Kept");
  assert.equal((b.get() as Record<string, unknown>).somethingElse, undefined);
});

test("the control endpoint refuses everything it should", async () => {
  await withServer(async (server) => {
    // Wrong secret, same length: indistinguishable from a missing page.
    const wrong = await request(server, "POST",
      "/overlay/test-secret-long-enough-to-pass-XXXXXXXXX/control", "{}");
    assert.equal(wrong.status, 404);

    const malformed = await request(server, "POST", CONTROL, "not json");
    assert.equal(malformed.status, 400);

    const notAnObject = await request(server, "POST", CONTROL, "[1,2,3]");
    assert.equal(notAnObject.status, 400);

    const huge = await request(server, "POST", CONTROL,
      JSON.stringify({ headline: "x".repeat(70_000) }));
    assert.equal(huge.status, 413);

    // The rest of the server stays read-only.
    const staticPost = await request(server, "POST",
      `/overlay/${TEST_SECRET}/vendor/react.js`, "{}");
    assert.equal(staticPost.status, 404);

    const statePost = await request(server, "POST", STATE, "{}");
    assert.equal(statePost.status, 404);
  });
});

test("the control page is served and does not embed the secret", async () => {
  await withServer(async (server) => {
    const page = await request(server, "GET", CONTROL);
    assert.equal(page.status, 200);
    assert.ok(page.body.includes("Sunday Sauce"), "should be the control page");
    assert.ok(!page.body.includes(TEST_SECRET), "must not embed its own URL secret");
    // It reaches the endpoint by relative path, which is what keeps the secret
    // out of the markup.
    assert.ok(page.body.includes('fetch("control"'), "should post to a relative path");
  });
});

test("the rundown box parses minutes, subtitles and ad reads", async () => {
  const b = await import("../src/lib/broadcast.js");
  b.__reset();
  b.patch({ rundown: "Welcome In | 10\n* Sauce Break: Captain's Log\n\nTrenches Recap | 10 | Hot | my bags\nMailbag" });
  assert.deepEqual(b.get().rundown, [
    { title: "Welcome In", minutes: 10, sub: "", isBreak: false, scene: "" },
    { title: "Sauce Break: Captain's Log", minutes: 0, sub: "", isBreak: true, scene: "" },
    { title: "Trenches Recap", minutes: 10, sub: "Hot | my bags", isBreak: false, scene: "" },
    { title: "Mailbag", minutes: 0, sub: "", isBreak: false, scene: "" },
  ]);
  assert.equal(b.get().rundownIndex, -1, "nothing is on air until the first step");
});

test("stepping the rundown starts the show clock once and restarts segment timers", async () => {
  const b = await import("../src/lib/broadcast.js");
  b.__reset();
  b.patch({ rundown: "One\nTwo\nThree" });

  b.patch({ rundownStep: "prev" });
  assert.equal(b.get().rundownIndex, -1, "cannot step before the start");

  b.patch({ rundownStep: "next" });
  const started = b.get().showStartedAt;
  assert.equal(b.get().rundownIndex, 0);
  assert.ok(started && b.get().segmentStartedAt);

  b.patch({ rundownStep: "next" });
  b.patch({ rundownStep: "next" });
  b.patch({ rundownStep: "next" });
  assert.equal(b.get().rundownIndex, 2, "stops at the last segment");
  assert.equal(b.get().showStartedAt, started, "the show clock never restarts mid-show");

  // Shortening the list mid-show keeps the position inside it.
  b.patch({ rundown: "One\nTwo" });
  assert.equal(b.get().rundownIndex, 1);

  b.patch({ rundownStep: "reset" });
  assert.equal(b.get().rundownIndex, -1);
  assert.equal(b.get().showStartedAt, "");
});

test("rundown position cannot be written directly", async () => {
  const b = await import("../src/lib/broadcast.js");
  b.__reset();
  b.patch({ rundown: "One\nTwo", rundownIndex: 1, showStartedAt: "2000-01-01T00:00:00Z" });
  assert.equal(b.get().rundownIndex, -1);
  assert.equal(b.get().showStartedAt, "");
});

test("the rundown reaches the state the overlay polls", async () => {
  const b = await import("../src/lib/broadcast.js");
  const { buildState } = await import("../src/server.js");
  b.__reset();
  b.patch({ rundown: "One | 5\nTwo", rundownStep: "next" });
  const r = buildState().rundown;
  assert.equal(r.items.length, 2);
  assert.equal(r.index, 0);
  assert.ok(r.segmentStartedAt);
});
