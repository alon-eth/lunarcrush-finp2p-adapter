/**
 * FinP2P addresses asset data by ISIN or CAIP-19. LunarCrush addresses by symbol/topic.
 * This is the curated bridge. Extend the table; fall back to OpenFIGI (ISIN->ticker) and
 * LunarCrush coins meta (contract address->coin) in a later phase.
 */
export type IdentifierType = "ISIN" | "CAIP19";
export interface AssetIdentifier { identifierType: IdentifierType; identifierValue: string; }
export interface LcTarget { kind: "coin" | "stock"; symbol: string; topic: string; name: string; }

const CAIP19: Record<string, LcTarget> = {
  // Layer 1 native assets
  "bip122:000000000019d6689c085ae165831e93/slip44:0": { kind: "coin", symbol: "BTC", topic: "bitcoin", name: "Bitcoin" },
  "eip155:1/slip44:60": { kind: "coin", symbol: "ETH", topic: "ethereum", name: "Ethereum" },
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp/slip44:501": { kind: "coin", symbol: "SOL", topic: "solana", name: "Solana" },
  // Stablecoins and collateral assets seen on FinP2P
  "eip155:1/erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": { kind: "coin", symbol: "USDC", topic: "usd coin", name: "USD Coin" },
  "eip155:1/erc20:0xdac17f958d2ee523a2206206994597c13d831ec7": { kind: "coin", symbol: "USDT", topic: "tether", name: "Tether" },
  "eip155:1/erc20:0x8292bb45bf1ee4d140127049757c2e0ff06317ed": { kind: "coin", symbol: "RLUSD", topic: "rlusd", name: "Ripple USD" },
  "eip155:1/erc20:0x6c3ea9036406852006290770bedfcaba0e23a0e8": { kind: "coin", symbol: "PYUSD", topic: "paypal usd", name: "PayPal USD" },
  // Tokenized MMFs: no social signal on the fund itself. Map to issuer topic and label it in payload.
  "eip155:1/erc20:0x7712c34205737192402172409a8f7ccef8aa2aec": { kind: "coin", symbol: "BUIDL", topic: "blackrock", name: "BlackRock USD Institutional Digital Liquidity Fund" },
};

const ISIN: Record<string, LcTarget> = {
  // Equities and ETFs likely to appear as tokenized wrappers (Backed, Ondo, DTCC H2 2026)
  "US0378331005": { kind: "stock", symbol: "AAPL", topic: "$aapl", name: "Apple" },
  "US5949181045": { kind: "stock", symbol: "MSFT", topic: "$msft", name: "Microsoft" },
  "US67066G1040": { kind: "stock", symbol: "NVDA", topic: "$nvda", name: "NVIDIA" },
  "US88160R1014": { kind: "stock", symbol: "TSLA", topic: "$tsla", name: "Tesla" },
  "US19260Q1076": { kind: "stock", symbol: "COIN", topic: "$coin", name: "Coinbase" },
  "US5949724083": { kind: "stock", symbol: "MSTR", topic: "$mstr", name: "Strategy" },
  "US78462F1030": { kind: "stock", symbol: "SPY", topic: "$spy", name: "SPDR S&P 500 ETF" },
  "US46438F1012": { kind: "stock", symbol: "IBIT", topic: "$ibit", name: "iShares Bitcoin Trust" },
  "US09290C1053": { kind: "stock", symbol: "BLK", topic: "$blk", name: "BlackRock" },
};

export function resolve(id: AssetIdentifier): LcTarget | undefined {
  if (id.identifierType === "CAIP19") return CAIP19[id.identifierValue.toLowerCase()] ?? CAIP19[id.identifierValue];
  if (id.identifierType === "ISIN") return ISIN[id.identifierValue.toUpperCase()];
  return undefined;
}

/** Everything we can serve, for assetHeader coverage advertisement. */
export function coverage(): Array<{ identifier: AssetIdentifier; target: LcTarget }> {
  return [
    ...Object.entries(CAIP19).map(([v, t]) => ({ identifier: { identifierType: "CAIP19" as const, identifierValue: v }, target: t })),
    ...Object.entries(ISIN).map(([v, t]) => ({ identifier: { identifierType: "ISIN" as const, identifierValue: v }, target: t })),
  ];
}
