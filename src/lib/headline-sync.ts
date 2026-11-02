import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ROOT, env, envNum } from "./env.js";
import { REMOTE_FILE, isHeadlineArray } from "./headlines.js";

/**
 * Pulls the published-headline ledger from the machine that writes it.
 *
 * The jobs that publish to Telegram run on the droplet, so that is where
 * recordHeadlines() writes. The overlay server runs beside OBS on the laptop
 * and reads its own copy, which is why the ticker sat empty while a perfectly
 * good ledger existed a hundred miles away.
 *
 * This is a read-only `ssh host cat file`. No port is opened, nothing is
 * pushed, and the droplet is untouched — the laptop already holds a key for
 * the deploy path, and this reuses it.
 *
 * The pull lands in its own file rather than over data/headlines.json, so a
 * ledger written locally can never be clobbered by a sync; the two are merged
 * at read time instead.
 */

const TMP = REMOTE_FILE + ".tmp";

export const SYNC_MS = envNum("HEADLINE_SYNC_MINUTES", 5) * 60_000;

let timer: NodeJS.Timeout | null = null;
let failures = 0;

function host(): string | null {
  const h = process.env.HEADLINE_SYNC_HOST?.trim();
  return h ? h : null;
}

function remotePath(): string {
  return env("HEADLINE_SYNC_PATH", "/opt/tg-broadcast/data/headlines.json");
}

/** One pull. Resolves to the number of entries fetched, or null on failure. */
export function syncOnce(): Promise<number | null> {
  const h = host();
  if (!h) return Promise.resolve(null);

  return new Promise((resolve) => {
    execFile(
      "ssh",
      [
        "-o", "BatchMode=yes",              // never sit waiting for a passphrase
        "-o", "ConnectTimeout=8",
        "-o", "StrictHostKeyChecking=accept-new",
        h, "cat", remotePath(),
      ],
      // Arguments are passed as an array, not a shell string, so a hostile
      // value in the env cannot become a command.
      { timeout: 20_000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          failures++;
          console.error(`[HEADLINE-SYNC] pull failed (${failures} in a row): ${err.message.split("\n")[0]}`);
          return resolve(null);
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(stdout);
        } catch {
          failures++;
          console.error("[HEADLINE-SYNC] remote file was not valid JSON, keeping the last good copy");
          return resolve(null);
        }

        // Shape-checked before it is written. A truncated or half-written
        // remote file must not replace a good local copy with rubbish.
        if (!isHeadlineArray(parsed)) {
          failures++;
          console.error("[HEADLINE-SYNC] remote file was not a headline ledger, ignoring");
          return resolve(null);
        }

        try {
          fs.mkdirSync(path.dirname(REMOTE_FILE), { recursive: true });
          // Written then renamed, so a reader never sees a partial file.
          fs.writeFileSync(TMP, JSON.stringify(parsed, null, 2));
          fs.renameSync(TMP, REMOTE_FILE);
        } catch (e) {
          console.error("[HEADLINE-SYNC] could not persist:", (e as Error).message);
          return resolve(null);
        }

        if (failures) console.log("[HEADLINE-SYNC] recovered");
        failures = 0;
        resolve(parsed.length);
      }
    );
  });
}

export function failureCount(): number {
  return failures;
}

/** Starts the pull loop. No-op when HEADLINE_SYNC_HOST is unset. */
export function startHeadlineSync(): void {
  if (timer) return;
  if (!host()) {
    console.log("[HEADLINE-SYNC] HEADLINE_SYNC_HOST not set, ticker will use local headlines only");
    return;
  }
  void syncOnce().then((n) => {
    if (n !== null) console.log(`[HEADLINE-SYNC] pulled ${n} headline(s) from ${host()}`);
  });
  timer = setInterval(() => void syncOnce(), SYNC_MS);
  timer.unref?.();
}

export function stopHeadlineSync(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
