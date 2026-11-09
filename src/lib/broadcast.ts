import fs from "fs";
import path from "path";
import { ROOT } from "./env.js";

/**
 * What the operator is putting on screen.
 *
 * Until now the overlay's text came from URL parameters baked into each OBS
 * browser source. That works for setup and is unusable live: every scene has
 * its own source, so changing the headline meant editing it in nine places
 * while on air.
 *
 * This is the one place it lives instead. The control page writes here, the
 * overlay reads it through the state endpoint it already polls, and every
 * scene picks up the same value because there is only one.
 *
 * Held in memory and written through to disk, so a restart mid-show comes back
 * with the same lower third rather than a default one.
 */

const FILE = path.join(ROOT, "data", "broadcast.json");

export interface BroadcastState {
  headline: string;
  kicker: string;
  breaking: boolean;
  /** Manual ticker lines. When empty, the published-headline ledger is used. */
  ticker: string[];
  showName: string;
  showKicker: string;
  sponsor1: string;
  sponsor2: string;
  hostName: string;
  coHostName: string;
  guestName: string;
  /** The show's segments in running order. Empty hides the rundown panel. */
  rundown: RundownItem[];
  /** Index into `rundown` of the segment on air; -1 before the show starts. */
  rundownIndex: number;
  /** When the current segment and the show began. Empty until the first step. */
  segmentStartedAt: string;
  showStartedAt: string;
  updatedAt: string;
}

export interface RundownItem {
  title: string;
  /** Planned length. 0 means untimed, and the panel counts up instead. */
  minutes: number;
  sub: string;
  /** Ad reads. Drawn as their own row and left out of the numbering. */
  isBreak: boolean;
  /**
   * OBS scene to cut to when this segment goes on air, by name or number
   * prefix ("07"). Empty leaves the scene alone.
   */
  scene: string;
}

const DEFAULTS: BroadcastState = {
  headline: "",
  kicker: "",
  breaking: false,
  ticker: [],
  showName: "",
  showKicker: "",
  sponsor1: "",
  sponsor2: "",
  hostName: "",
  coHostName: "",
  guestName: "",
  rundown: [],
  rundownIndex: -1,
  segmentStartedAt: "",
  showStartedAt: "",
  updatedAt: new Date(0).toISOString(),
};

/**
 * Empty string means "not set", and the overlay falls back to its own default.
 * That is deliberate: clearing a field in the control page should hand the
 * value back rather than blank the lower third.
 */
let cache: BroadcastState | null = null;

function read(): BroadcastState {
  if (cache) return cache;
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, "utf8")) as Partial<BroadcastState>;
    cache = {
      ...DEFAULTS, ...raw,
      ticker: Array.isArray(raw.ticker) ? raw.ticker : [],
      rundown: Array.isArray(raw.rundown) ? raw.rundown : [],
    };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}

export function get(): BroadcastState {
  return read();
}

/** Applies a partial update. Unknown keys are ignored rather than stored. */
export function patch(input: Record<string, unknown>): BroadcastState {
  const cur = read();
  const next: BroadcastState = { ...cur };

  for (const key of Object.keys(DEFAULTS) as Array<keyof BroadcastState>) {
    if (key === "updatedAt" || !(key in input)) continue;
    // Position and timing move only through rundownStep below, so a client
    // cannot set a start time that the clock would then count from.
    if (key === "rundownIndex" || key === "segmentStartedAt" || key === "showStartedAt") continue;
    const v = input[key];

    if (key === "breaking") {
      next.breaking = v === true || v === "true" || v === "1";
    } else if (key === "ticker") {
      // Accepts either an array or the control page's textarea, one per line.
      const lines = Array.isArray(v) ? v : String(v ?? "").split("\n");
      next.ticker = lines.map((l) => String(l).trim()).filter(Boolean).slice(0, 40);
    } else if (key === "rundown") {
      next.rundown = parseRundown(v);
      // An edit mid-show keeps the position, but never past the end of the list.
      next.rundownIndex = Math.min(next.rundownIndex, next.rundown.length - 1);
    } else {
      // Trimmed and bounded: this text goes straight onto a 1920px stage and a
      // pasted essay would push the lower third off the side of the screen.
      next[key] = String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 300) as never;
    }
  }

  if ("rundownStep" in input) step(next, input.rundownStep);

  next.updatedAt = new Date().toISOString();
  cache = next;

  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(next, null, 2));
  } catch (err) {
    // An unwritable disk must not stop the headline reaching the screen; it
    // only costs persistence across a restart.
    console.error("[BROADCAST] could not persist:", (err as Error).message);
  }
  return next;
}

/**
 * Reads the control page's rundown box, one segment per line:
 *
 *   Trenches Recap | 10 | What's hot, my bags
 *   * Sauce Break: Toy Shoppe
 *
 * Minutes and subtitle are optional. A leading `*` marks an ad read, and a
 * field starting with `@` names the OBS scene to cut to (`@07`). Also
 * accepts an array of items, which is what a saved state file holds.
 */
export function parseRundown(v: unknown): RundownItem[] {
  const clip = (x: unknown, n: number) => String(x ?? "").replace(/\s+/g, " ").trim().slice(0, n);
  const toMinutes = (x: unknown) => {
    const n = Math.round(Number(x));
    return Number.isFinite(n) && n > 0 ? Math.min(n, 240) : 0;
  };

  const items: RundownItem[] = [];
  if (Array.isArray(v)) {
    for (const r of v) {
      if (!r || typeof r !== "object") continue;
      const o = r as Record<string, unknown>;
      const title = clip(o.title, 60);
      if (title) items.push({
        title, minutes: toMinutes(o.minutes), sub: clip(o.sub, 80),
        isBreak: o.isBreak === true, scene: clip(o.scene, 60),
      });
    }
  } else {
    for (const raw of String(v ?? "").split("\n")) {
      let line = raw.trim();
      const isBreak = line.startsWith("*");
      if (isBreak) line = line.slice(1);
      const [title, mins, ...rest] = line.split("|");
      const t = clip(title, 60);
      // The scene can sit in any field after the minutes, so a subtitle can
      // still contain a pipe.
      const sceneField = rest.filter((f) => f.trim().startsWith("@")).pop();
      const sub = rest.filter((f) => !f.trim().startsWith("@")).join("|");
      const scene = sceneField ? clip(sceneField.trim().slice(1), 60) : "";
      if (t) items.push({ title: t, minutes: toMinutes(mins), sub: clip(sub, 80), isBreak, scene });
    }
  }
  // The panel has room for about eight rows at once and scrolls past that;
  // this only stops a paste from turning into hundreds.
  return items.slice(0, 30);
}

/** Moves the on-air segment. Anything unrecognised is ignored. */
function step(s: BroadcastState, how: unknown): void {
  const now = new Date().toISOString();
  const last = s.rundown.length - 1;

  if (how === "reset") {
    s.rundownIndex = -1;
    s.segmentStartedAt = "";
    s.showStartedAt = "";
    return;
  }
  let target = s.rundownIndex;
  if (how === "next") target += 1;
  else if (how === "prev") target -= 1;
  else if (typeof how === "number" && Number.isInteger(how)) target = how;
  else return;

  target = Math.max(-1, Math.min(target, last));
  if (target === s.rundownIndex) return;

  s.rundownIndex = target;
  if (target === -1) {
    s.segmentStartedAt = "";
    s.showStartedAt = "";
    return;
  }
  // Going back restarts that segment's timer; the show clock keeps running.
  s.segmentStartedAt = now;
  if (!s.showStartedAt) s.showStartedAt = now;
}

/** Test seam. */
export function __reset(): void {
  cache = { ...DEFAULTS };
}
