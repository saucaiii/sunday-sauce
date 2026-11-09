import fs from "fs";
import path from "path";
import { ROOT, envBool } from "./env.js";

/**
 * What the channel published, with the text, so the overlay can scroll it.
 *
 * The existing `pub:` ledger in seen.json already records every published
 * story, but it stores a link and a timestamp and nothing else — enough to
 * stop a story running twice, not enough to put on screen. Rather than change
 * the shape of that ledger and with it the meaning of isPublished(), this is a
 * parallel record written next to it. Dedupe semantics do not move.
 *
 * Everything here has already gone out to the Telegram channel, so the overlay
 * is showing a strict subset of what is public. That is what makes the ticker
 * safe without an approval gate of its own: the gate is upstream, where it
 * already was.
 */

const FILE = path.join(ROOT, "data", "headlines.json");

/**
 * Ledger pulled from the machine that publishes, kept separate from the local
 * one. Two files rather than one so a sync can never overwrite something
 * written here; they are merged when read.
 */
export const REMOTE_FILE = path.join(ROOT, "data", "headlines.remote.json");

/** Kept longer than the 24h the ticker asks for, so the window is a query. */
const RETAIN_HOURS = 48;
/** Hard ceiling, so a runaway job cannot grow the file without bound. */
const MAX_ENTRIES = 200;

export interface Headline {
  title: string;
  link: string;
  /** The publisher, for a future "per Reuters" style credit on screen. */
  source: string;
  /** Which job put it out, so a bad ticker can be traced to its producer. */
  job: string;
  /** Epoch ms. */
  at: number;
}

/** Validates shape before anything trusts a file written by another machine. */
export function isHeadlineArray(v: unknown): v is Headline[] {
  return Array.isArray(v) && v.every(
    (r) => r && typeof r === "object"
      && typeof (r as Headline).title === "string"
      && typeof (r as Headline).link === "string"
      && typeof (r as Headline).at === "number"
  );
}

function readFile(file: string): Headline[] {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    return isHeadlineArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function read(): Headline[] {
  return readFile(FILE);
}

function write(rows: Headline[]): void {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(rows, null, 2));
  } catch (err) {
    console.error("[HEADLINES] could not persist:", (err as Error).message);
  }
}

/**
 * Records headlines that just went out to the channel.
 *
 * Called beside markPublished at each site rather than inside it, because
 * markPublished takes links alone and several callers hold the title under a
 * different name — item.title, picks[].title, synthesis.headline. Passing the
 * text explicitly keeps each call site honest about what it is putting on air.
 */
export function recordHeadlines(job: string, items: Array<{ title: string; link: string; source?: string }>): void {
  // A preview or dry run must not put anything on the overlay. Same guard as
  // markSeen, and for the same reason: rehearsing a post is not publishing it.
  if (envBool("DRY_RUN")) {
    console.log(`[DRY_RUN] would record ${items.length} headline(s) for ${job}`);
    return;
  }

  const now = Date.now();
  const rows = read();
  const known = new Set(rows.map((r) => r.link));

  for (const item of items) {
    const title = (item.title ?? "").trim();
    if (!title || !item.link || known.has(item.link)) continue;
    rows.push({ title, link: item.link, source: item.source ?? "", job, at: now });
    known.add(item.link);
  }

  const cutoff = now - RETAIN_HOURS * 3600_000;
  const kept = rows.filter((r) => r.at >= cutoff).slice(-MAX_ENTRIES);
  write(kept);
}

/**
 * Published headlines inside a window, newest first.
 *
 * Merges what was recorded here with what was pulled from the publishing
 * machine. The merge is additive and deduplicated by link, so running the
 * pipeline locally and syncing from the droplet cannot double up a story, and
 * neither source can erase the other.
 */
export function recentHeadlines(hours = 24): Headline[] {
  const cutoff = Date.now() - hours * 3600_000;
  const byLink = new Map<string, Headline>();

  // Ascending first, so the entry kept for a link is the earliest sighting —
  // the time it actually published, not the time a sync happened to see it.
  for (const r of [...read(), ...readFile(REMOTE_FILE)].sort((a, b) => a.at - b.at)) {
    if (r.at >= cutoff && !byLink.has(r.link)) byLink.set(r.link, r);
  }

  return [...byLink.values()].sort((a, b) => b.at - a.at);
}
