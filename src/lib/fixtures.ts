import type { PriceSnapshot } from "./prices.js";

/**
 * Fixture data for working on the overlay without live APIs.
 *
 * Enabled with OVERLAY_FIXTURES=1. Deliberately plausible rather than round:
 * the point is to catch layout that only breaks on real values — an eight
 * character price, a negative change, a symbol nobody sized the column for.
 *
 * The source field says "fixture" so a payload can never be mistaken for live
 * data by whatever is reading it, including a person reading it over someone's
 * shoulder during a rehearsal.
 */

/** Prices drift a little per call, so a poll visibly updates while testing. */
export function fixtureSnapshot(): PriceSnapshot {
  const wobble = (base: number, pct: number) => base * (1 + (Math.sin(Date.now() / 60_000) * pct) / 100);

  return {
    capturedAt: new Date().toISOString(),
    source: "fixture",
    rows: [
      { symbol: "BTC",   raw: wobble(94231.5, 0.4),  change24h: -1.42 },
      { symbol: "ETH",   raw: wobble(3182.44, 0.6),  change24h: 2.08 },
      { symbol: "SOL",   raw: wobble(188.21, 0.9),   change24h: 4.63 },
      { symbol: "PENGU", raw: wobble(0.0314, 1.8),   change24h: -6.71 },
      { symbol: "HYPE",  raw: wobble(41.07, 1.1),    change24h: 8.24 },
      { symbol: "ZEC",   raw: wobble(58.93, 0.7),    change24h: -0.38 },
      { symbol: "LINK",  raw: wobble(21.66, 0.8),    change24h: 1.19 },
      { symbol: "NEAR",  raw: wobble(4.72, 1.0),     change24h: -2.55 },
    ],
  };
}

/** Headlines in the register the channel actually publishes in. */
export function fixtureHeadlines(): string[] {
  return [
    "SEC seeks White House review of sweeping crypto custody rewrite",
    "Spot ether ETFs post ninth straight day of inflows, $242M Tuesday",
    "Hyperliquid enters US market through Kraken parent acquisition",
    "XRPL sets $5B transaction record on $1.9B tokenized RWA wave",
    "Clearing firm RQD raises $74M as Wall Street preps for 24/7 settlement",
    "Bitfinex Securities raises $50M in push to offer tokenized bonds",
    "FCA opens consultation on stablecoin backing requirements",
  ];
}
