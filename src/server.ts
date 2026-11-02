import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { ROOT, env, envNum, envBool } from "./lib/env.js";
import { peek, failureCount, startPriceCache, type PriceSnapshot } from "./lib/prices.js";
import { recentHeadlines } from "./lib/headlines.js";
import * as broadcast from "./lib/broadcast.js";
import * as obs from "./lib/obs.js";
import { startHeadlineSync } from "./lib/headline-sync.js";
import { price as fmtPrice, pctArrow } from "./lib/format.js";
import { fixtureSnapshot, fixtureHeadlines } from "./lib/fixtures.js";

/**
 * The overlay server.
 *
 * Serves two things under one secret path: the state the OBS browser source
 * polls, and the overlay itself. Same origin for both, which is the whole
 * reason the overlay is served from here rather than opened as a local file —
 * there is no CORS to configure because there is no cross origin.
 *
 * Binds to loopback by default. This process is not meant to face the internet
 * directly; a tunnel or a reverse proxy in front of it is, and that is a
 * deployment decision made outside this file.
 */

const OVERLAY_DIR = path.join(ROOT, "overlay");
const PORT = envNum("OVERLAY_PORT", 8787);
const HOST = env("OVERLAY_HOST", "127.0.0.1");

/**
 * How old the cached prices may be before the payload says so.
 *
 * The overlay also watches its own polling, but that only catches "the server
 * is unreachable". This catches the other failure, where the server is fine
 * and answering promptly with prices that stopped updating an hour ago, which
 * looks identical from the browser and is far more dangerous on air.
 */
const STALE_AFTER_MS = envNum("OVERLAY_STALE_SECONDS", 120) * 1000;

/**
 * Fixture mode: serve believable data and never call an aggregator.
 *
 * This is how the overlay gets worked on — on a laptop, on a plane, during a
 * CoinGecko outage — without the design work being blocked on a live API.
 */
const FIXTURES = envBool("OVERLAY_FIXTURES");

function secret(): string {
  const s = process.env.OVERLAY_SECRET?.trim();
  if (!s || s.length < 24) {
    throw new Error(
      "OVERLAY_SECRET must be set to a random string of at least 24 characters. " +
      "Generate one with: node -e \"console.log(require('crypto').randomBytes(24).toString('base64url'))\""
    );
  }
  return s;
}

/**
 * Constant-time comparison.
 *
 * The path segment is a credential, and a plain === leaks its prefix through
 * response timing to anyone willing to measure. Cheap to do properly.
 */
function secretMatches(candidate: string, expected: string): boolean {
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export interface StatePayload {
  updatedAt: string;
  priceCapturedAt: string | null;
  priceSource: string | null;
  /** True when the prices below are older than the staleness bound. */
  stale: boolean;
  prices: Array<{
    symbol: string;
    raw: number;
    change24h: number;
    display: { price: string; change: string };
  }>;
  ticker: string[];
  /**
   * Operator-set text. Empty strings mean "not set" and the overlay keeps its
   * own default, so clearing a field hands the value back rather than blanking
   * the lower third.
   */
  text: {
    headline: string; kicker: string; breaking: boolean;
    showName: string; showKicker: string; sponsor1: string; sponsor2: string;
    hostName: string; coHostName: string; guestName: string;
    /**
     * The operator's own ticker lines, separate from `ticker` above, which may
     * instead be the published feed. The control page needs to tell those
     * apart to prefill its textarea without a write.
     */
    tickerManual: string[];
  };
  /** Segments and position for the rundown panel. Times are ISO or empty. */
  rundown: {
    items: broadcast.RundownItem[];
    index: number;
    segmentStartedAt: string;
    showStartedAt: string;
  };
  /** The switcher, for the control page. The overlay ignores it. */
  obs: obs.ObsStatus;
}

/**
 * Builds the payload.
 *
 * Every display string is produced here, by the same functions that render the
 * Telegram post. The overlay renders them verbatim and owns no rounding rule
 * of its own, because two rounding rules is precisely how the two surfaces
 * would drift apart again.
 */
export function buildState(now = Date.now()): StatePayload {
  const snap: PriceSnapshot | null = FIXTURES ? fixtureSnapshot() : peek();
  const headlines = FIXTURES ? fixtureHeadlines() : recentHeadlines(24).map((h) => h.title);

  const b = broadcast.get();
  const capturedAt = snap?.capturedAt ?? null;
  const ageMs = capturedAt ? now - Date.parse(capturedAt) : Infinity;

  return {
    updatedAt: new Date(now).toISOString(),
    priceCapturedAt: capturedAt,
    priceSource: snap?.source ?? null,
    // Either the snapshot has aged out, or refreshes are actively failing.
    stale: ageMs > STALE_AFTER_MS || failureCount() > 0,
    prices: (snap?.rows ?? []).map((r) => ({
      symbol: r.symbol,
      raw: r.raw,
      change24h: r.change24h,
      display: { price: fmtPrice(r.raw), change: pctArrow(r.change24h) },
    })),
    // Manual lines win when present, so the operator can always override the
    // feed; clearing the box falls back to what the channel actually published.
    ticker: b.ticker.length ? b.ticker : headlines,
    text: {
      headline: b.headline, kicker: b.kicker, breaking: b.breaking,
      showName: b.showName, showKicker: b.showKicker,
      sponsor1: b.sponsor1, sponsor2: b.sponsor2,
      hostName: b.hostName, coHostName: b.coHostName, guestName: b.guestName,
      tickerManual: b.ticker,
    },
    rundown: {
      items: b.rundown, index: b.rundownIndex,
      segmentStartedAt: b.segmentStartedAt, showStartedAt: b.showStartedAt,
    },
    obs: obs.status(),
  };
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

/**
 * Resolves a request path inside the overlay directory.
 *
 * Returns null for anything that escapes it. The check is on the resolved
 * absolute path rather than on the raw string, so ".." and its encodings are
 * all handled by the same test.
 */
function resolveStatic(rel: string): string | null {
  const clean = rel.replace(/^\/+/, "");
  const full = path.resolve(OVERLAY_DIR, clean === "" ? "index.html" : clean);
  const root = path.resolve(OVERLAY_DIR);
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  return full;
}

function notFound(res: http.ServerResponse): void {
  // A wrong secret and a genuinely missing file answer identically. Anything
  // else confirms the shape of the URL to someone guessing at it.
  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("Not found\n");
}

function sendFile(req: http.IncomingMessage, res: http.ServerResponse, file: string): void {
  fs.readFile(file, (err, data) => {
    if (err) return notFound(res);
    const type = TYPES[path.extname(file)] ?? "application/octet-stream";
    res.writeHead(200, {
      "content-type": type,
      // Fonts and the runtime never change without a redeploy; the HTML must
      // not be cached or an edit would not show up until OBS was restarted.
      "cache-control": file.endsWith(".html") ? "no-store" : "public, max-age=3600",
    });
    res.end(req.method === "HEAD" ? undefined : data);
  });
}

/** Body cap. This endpoint takes a lower third, not an upload. */
const MAX_BODY = 64 * 1024;

function handleControlPost(req: http.IncomingMessage, res: http.ServerResponse): void {
  let body = "";
  let tooBig = false;

  req.on("data", (chunk) => {
    if (tooBig) return;
    body += chunk;
    if (body.length > MAX_BODY) {
      tooBig = true;
      body = "";
      // Answer and close, but drain rather than destroy: tearing the socket
      // down here can beat the response out and the client sees a hang-up
      // instead of the 413 it should be reading.
      res.writeHead(413, { "content-type": "text/plain; charset=utf-8", connection: "close" });
      res.end("Too large\n");
      req.resume();
    }
  });

  req.on("end", () => {
    if (tooBig) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(body || "{}");
    } catch {
      res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      res.end("Invalid JSON\n");
      return;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      res.end("Expected an object\n");
      return;
    }

    const input = parsed as Record<string, unknown>;
    const before = broadcast.get().rundownIndex;
    const next = broadcast.patch(input);

    // The cut rides on the same press that moved the rundown, so the host
    // hits one button between segments, not one here and another in OBS.
    let want = "";
    if (typeof input.obsScene === "string") want = input.obsScene;
    else if ("rundownStep" in input && next.rundownIndex !== before && next.rundownIndex >= 0) {
      want = next.rundown[next.rundownIndex]?.scene ?? "";
    }

    const reply = (cut: { switched?: string; error?: string }) => {
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      // The rundown has already moved either way, so a failed cut is reported
      // alongside it rather than as an error status.
      res.end(JSON.stringify({ ...next, obs: { ...obs.status(), ...cut } }));
    };

    if (!want) return reply({});
    obs.switchTo(want).then(
      (scene) => reply({ switched: scene }),
      (err) => reply({ error: (err as Error).message }),
    );
  });
}

export function createServer(): http.Server {
  const expected = secret();

  return http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const parts = url.pathname.split("/").filter(Boolean);

    const method = req.method ?? "GET";
    if (method !== "GET" && method !== "HEAD" && method !== "POST") return notFound(res);
    if (parts[0] !== "overlay" || parts.length < 2) return notFound(res);
    if (!secretMatches(decodeURIComponent(parts[1]), expected)) return notFound(res);

    const rest = parts.slice(2);

    if (rest[0] === "control" && rest.length === 1) {
      if (method === "POST") return handleControlPost(req, res);
      // The page lives beside the overlay so it is reached through the same
      // secret and posts to a relative ./control — the secret never appears
      // in the page itself.
      return sendFile(req, res, path.join(OVERLAY_DIR, "control.html"));
    }

    // Past this point nothing is writable. /control above is the sole exception.
    if (method === "POST") return notFound(res);

    if (rest[0] === "state" && rest.length === 1) {
      const body = JSON.stringify(buildState());
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        // The overlay polls this every few seconds and OBS's cache is not
        // something we want deciding what is on screen.
        "cache-control": "no-store",
      });
      res.end(req.method === "HEAD" ? undefined : body);
      return;
    }

    const file = resolveStatic(rest.join("/"));
    if (!file) return notFound(res);

    sendFile(req, res, file);
  });
}

export function start(): http.Server {
  if (!FIXTURES) {
    startPriceCache();
    // The ticker's source of truth is on whichever machine runs the jobs.
    startHeadlineSync();
  }
  obs.start();

  const server = createServer();
  server.listen(PORT, HOST, () => {
    // The secret is never logged. Printing the path here would put a
    // credential into journalctl, where it would outlive any rotation.
    console.log(`🎥 overlay server on http://${HOST}:${PORT}/overlay/<OVERLAY_SECRET>/`);
    console.log(`   state at .../state · ${FIXTURES ? "FIXTURE MODE, no upstream calls" : "live prices"}`);
    // Listening beyond loopback is for running the control page from a phone.
    // The .local name survives the router handing the Mac a new address, so it
    // is the one worth bookmarking.
    if (HOST !== "127.0.0.1" && HOST !== "localhost") {
      const lan = Object.values(os.networkInterfaces()).flat()
        .filter((a) => a && a.family === "IPv4" && !a.internal).map((a) => a!.address);
      for (const h of [os.hostname(), ...lan]) {
        console.log(`   phone: http://${h}:${PORT}/overlay/<OVERLAY_SECRET>/control`);
      }
    }
  });
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  start();
}
