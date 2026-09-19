/**
 * Minimal LunarCrush v4 client. Base https://lunarcrush.com/api4, Bearer auth.
 * Without LUNARCRUSH_API_KEY it returns deterministic fixtures so the FinP2P plumbing can be
 * exercised end to end. Social fields need Builder tier or above on a real key.
 */
import type { LcTarget } from "./mapping.js";

const BASE = "https://lunarcrush.com/api4";

export interface Snapshot {
  symbol: string; topic: string; galaxyScore?: number; altRank?: number; sentiment: number;
  interactions24h: number; postsActive24h?: number; contributorsActive24h?: number;
  socialDominance?: number; marketDominance?: number; asOf: number;
}

export class LunarCrush {
  constructor(private apiKey = process.env.LUNARCRUSH_API_KEY ?? "") {}
  get live() { return this.apiKey.length > 0; }

  async snapshot(t: LcTarget): Promise<Snapshot> {
    if (!this.live) return fixture(t);
    const path = t.kind === "coin" ? `/public/coins/${encodeURIComponent(t.symbol)}/v1`
                                   : `/public/stocks/${encodeURIComponent(t.symbol)}/v1`;
    const res = await fetch(BASE + path, { headers: { Authorization: `Bearer ${this.apiKey}` } });
    if (!res.ok) throw new Error(`LunarCrush ${res.status} for ${path}: ${await res.text()}`);
    const { data: d } = await res.json() as { data: Record<string, number> };
    return {
      symbol: t.symbol, topic: t.topic,
      galaxyScore: d.galaxy_score, altRank: d.alt_rank, sentiment: d.sentiment ?? 0,
      interactions24h: d.interactions_24h ?? 0, postsActive24h: d.posts_active,
      contributorsActive24h: d.contributors_active, socialDominance: d.social_dominance,
      marketDominance: d.market_dominance, asOf: Date.now(),
    };
  }
}

function fixture(t: LcTarget): Snapshot {
  // Stable per-symbol pseudo values so repeated runs are comparable.
  let h = 0; for (const c of t.symbol) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return {
    symbol: t.symbol, topic: t.topic,
    galaxyScore: 40 + (h % 55), altRank: 1 + (h % 500), sentiment: 55 + (h % 40),
    interactions24h: 10_000 + (h % 5_000_000), postsActive24h: 100 + (h % 20_000),
    contributorsActive24h: 50 + (h % 8_000), socialDominance: (h % 1000) / 100,
    marketDominance: (h % 600) / 100, asOf: Date.now(),
  };
}
