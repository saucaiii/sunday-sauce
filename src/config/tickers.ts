/** Coins in the daily market post, in display order. CoinGecko ids verified. */
export interface Ticker {
  id: string;
  symbol: string;
  /**
   * Matches a headline that is genuinely about this asset.
   *
   * Written per coin rather than generated from the symbol because several
   * symbols are ordinary English. Matching NEAR loosely pulled in "Tokenized
   * Asset Usage Could Be Near 20%", and LINK would take every "link" in a
   * headline, so those require the project name or a cashtag.
   */
  match: RegExp;
}

export const tickers: Ticker[] = [
  { id: "bitcoin",        symbol: "BTC",   match: /\bbitcoin\b|\bbtc\b|\$BTC\b/i },
  { id: "ethereum",       symbol: "ETH",   match: /\bethereum\b|\bether\b|\beth\b|\$ETH\b/i },
  { id: "solana",         symbol: "SOL",   match: /\bsolana\b|\$SOL\b/i },
  { id: "pudgy-penguins", symbol: "PENGU", match: /\bpudgy penguins?\b|\bpengu\b|\$PENGU\b/i },
  { id: "hyperliquid",    symbol: "HYPE",  match: /\bhyperliquid\b|\$HYPE\b/i },
  { id: "zcash",          symbol: "ZEC",   match: /\bzcash\b|\$ZEC\b/i },
  { id: "chainlink",      symbol: "LINK",  match: /\bchainlink\b|\$LINK\b/i },
  { id: "near",           symbol: "NEAR",  match: /\bnear protocol\b|\$NEAR\b/i },
  // CoinGecko and TrueNorth both key this as avalanche-2, not avalanche; the
  // bare name returns nothing from the derivatives endpoint.
  { id: "avalanche-2",    symbol: "AVAX",  match: /\bavalanche\b|\bavax\b|\$AVAX\b/i },
];
