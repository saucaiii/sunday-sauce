import fs from "fs";
import path from "path";
import { ROOT, envNum } from "./env.js";
import { tickers } from "../config/tickers.js";

/**
 * One price fetch, shared by every surface.
 *
 * Before this, three places called CoinGecko on three unrelated clocks: the
 * market post at 9:30/16:00/21:00, the price alert every 15 minutes, and the
 * OBS overlay every 90 seconds straight from the browser. All keyless, all
 * from the same droplet IP, against a quota that coingecko.ts already records
 * failing after three calls in a ten-call burst.
 *
 * Now there is one fetch on one interval and everything reads the result. The
 * overlay never touches an aggregator again, which is what removes it from the
 * rate-limit budget entirely rather than merely reducing its share.
 *
 * The cache is in memory with a write-through to disk. Disk is not for speed;
 * it is so a restart in the middle of a show repaints the ticker with the last
 * known prices instead of blanking it while the first fetch lands.
 */

const CG = "https://api.coingecko.com/api/v3/simple/price";
const FILE = path.join(ROOT, "data", "prices.json");

/** How often the cache refreshes upstream while the server is running. */
export const REFRESH_MS = envNum("PRICE_CACHE_SECONDS", 30) * 1000;

/**
 * How old a snapshot may be before a caller that needs a fresh one goes
 * upstream itself. Generous relative to REFRESH_MS so a single failed refresh
 * does not send the Telegram job out on its own; it is a fallback for "the
 * cache loop is not running at all", which is the case for every job invoked
 * by hand from the CLI.
 */
const FRESH_ENOUGH_MS = 90_000;

export interface PriceRow {
  symbol: string;
  raw: number;
  change24h: number;
}

export interface PriceSnapshot {
  /** When the upstream response was received. */
  capturedAt: string;
  source: "coingecko" | "fixture";
  rows: PriceRow[];
}

let cache: PriceSnapshot | null = null;
let timer: NodeJS.Timeout | null = null;
/** Consecutive upstream failures, so callers can tell "stale" from "never". */
let failures = 0;

function loadFromDisk(): PriceSnapshot | null {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, "utf8")) as PriceSnapshot;
    if (!Array.isArray(raw?.rows) || !raw.capturedAt) return null;
    return raw;
  } catch {
    return null;
  }
}

function saveToDisk(snap: PriceSnapshot): void {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(snap, null, 2));
  } catch (err) {
    // A cache that cannot persist is still a working cache. Never let a disk
    // problem take down the fetch loop or a market post.
    console.error("[PRICES] could not persist snapshot:", (err as Error).message);
  }
}

/** One upstream call. Throws; callers decide whether to keep the last good. */
async function fetchUpstream(): Promise<PriceSnapshot> {
  const ids = tickers.map((t) => t.id).join(",");
  const res = await fetch(`${CG}?ids=${ids}&vs_currencies=usd&include_24hr_change=true`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
  const data: Record<string, { usd: number; usd_24h_change?: number }> = await res.json();

  const rows: PriceRow[] = [];
  for (const t of tickers) {
    const row = data[t.id];
    // A symbol CoinGecko does not price is dropped, not zero-filled. The
    // overlay renders the strip without it rather than showing a $0.00 column,
    // which is the failure mode that put a permanent dash on stream for ABS.
    if (!row || typeof row.usd !== "number") {
      console.warn(`[PRICES] no quote for ${t.symbol} (${t.id})`);
      continue;
    }
    rows.push({ symbol: t.symbol, raw: row.usd, change24h: row.usd_24h_change ?? 0 });
  }
  if (!rows.length) throw new Error("CoinGecko returned no usable quotes");

  return { capturedAt: new Date().toISOString(), source: "coingecko", rows };
}

/** Refreshes the cache, keeping the previous snapshot if upstream fails. */
export async function refresh(): Promise<PriceSnapshot | null> {
  try {
    const snap = await fetchUpstream();
    cache = snap;
    failures = 0;
    saveToDisk(snap);
    return snap;
  } catch (err) {
    failures++;
    // Logged once per failure, but the caller sees only the last good data.
    // Losing a refresh is normal; losing the ticker mid-show is not.
    console.error(`[PRICES] refresh failed (${failures} in a row): ${(err as Error).message}`);
    return cache;
  }
}

/** The current snapshot, or null if nothing has ever been fetched or restored. */
export function peek(): PriceSnapshot | null {
  if (!cache) cache = loadFromDisk();
  return cache;
}

/** Consecutive failed refreshes. Zero means the last attempt succeeded. */
export function failureCount(): number {
  return failures;
}

/**
 * A snapshot fresh enough to publish, fetching if the cache loop is not
 * running or has fallen behind. Used by the Telegram jobs, which must not
 * depend on the server being up.
 */
export async function getFreshSnapshot(): Promise<PriceSnapshot> {
  const current = peek();
  if (current && Date.now() - Date.parse(current.capturedAt) < FRESH_ENOUGH_MS) return current;

  const refreshed = await refresh();
  if (refreshed) return refreshed;
  throw new Error("no price data available: upstream failed and nothing is cached");
}

/** Starts the refresh loop. Safe to call twice; the second call is a no-op. */
export function startPriceCache(): void {
  if (timer) return;
  peek(); // restore last known prices before the first fetch lands
  void refresh();
  timer = setInterval(() => void refresh(), REFRESH_MS);
  // Never hold the process open on this alone.
  timer.unref?.();
}

export function stopPriceCache(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Test and fixture seam: install a snapshot without touching the network. */
export function __setCache(snap: PriceSnapshot | null): void {
  cache = snap;
  failures = 0;
}
