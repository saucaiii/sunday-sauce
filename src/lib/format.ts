/**
 * The single formatter for prices and percentages.
 *
 * Two surfaces render these numbers: the Telegram market post and the OBS
 * overlay. They used to hold separate copies of the rounding rule and had
 * already drifted — the overlay had no sub-cent branch, so anything under a
 * penny showed four decimals in Telegram and four in the overlay where the
 * post showed six. Nobody would notice until a coin fell below $0.01 live on
 * stream, which is exactly when the two would disagree on screen.
 *
 * So: one rounding rule, two renderers over it. The renderers differ on
 * purpose. Telegram is monospaced plain text inside <pre>, where a signed
 * number lines up in a column; the overlay is a broadcast strip where an arrow
 * reads at a glance from across a room. Those are different jobs and forcing
 * them to emit the same string would make one of them worse.
 */

/**
 * Sub-dollar coins need more precision than BTC does.
 *
 * Lifted verbatim from the market post, which is the stricter of the two
 * originals. Changing the thresholds changes both surfaces at once, which is
 * the entire point of this file.
 */
export function price(n: number): string {
  if (n >= 1000) return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(6)}`;
}

/** Telegram: signed, so a column of them scans vertically. */
export function pctSigned(n: number): string {
  const s = n >= 0 ? "+" : "";
  return `${s}${n.toFixed(2)}%`;
}

/** Overlay: arrow plus magnitude, legible at broadcast distance. */
export function pctArrow(n: number): string {
  return `${n >= 0 ? "▲" : "▼"} ${Math.abs(n).toFixed(2)}%`;
}

/**
 * Both renderers round identically; only the sign presentation differs.
 * Exported so the test can assert that property rather than assert two
 * strings are equal, which they are deliberately not.
 */
export function pctMagnitude(n: number): string {
  return Math.abs(n).toFixed(2);
}
