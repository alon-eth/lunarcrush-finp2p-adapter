/**
 * LunarCrush v4 client with three data modes:
 *   own-key  LUNARCRUSH_API_KEY set: talks to lunarcrush.com directly, no cap, DGB not in the path. Production.
 *   trial    no key: talks to DGB's trial gateway, which holds DGB's key server-side and meters calls per
 *            Router org (X-FinP2P-Org). Demo and testing within the published cap; see /health for quota.
 *   fixture  LUNARCRUSH_MODE=fixture, or the gateway is not enabled yet: deterministic per-symbol values so
 *            the FinP2P plumbing can be exercised end to end.
 * Social fields need Builder tier or above on a real key.
 */
import type { LcTarget } from "./mapping.js";

const DIRECT = "https://lunarcrush.com/api4";
export const TRIAL_GATEWAY = process.env.LUNARCRUSH_TRIAL_GATEWAY ?? "https://lc-trial-gateway.alon-d6b.workers.dev";
export type DataMode = "own-key" | "trial" | "fixture";

export interface Snapshot {
  symbol: string; topic: string; galaxyScore?: number; altRank?: number; sentiment: number;
  interactions24h: number; postsActive24h?: number; contributorsActive24h?: number;
  socialDominance?: number; marketDominance?: number; asOf: number;
}
export interface TrialState { enabled: boolean; exhausted: boolean; cap?: number; remaining?: number; assetCap?: number; resetsAt?: string; terms?: string; upgrade?: string; }

export class TrialExhausted extends Error { constructor(public info: Record<string, unknown>) { super("trial quota exceeded"); } }

export class LunarCrush {
  readonly mode: DataMode;
  trial: TrialState = { enabled: true, exhausted: false };
  private warned = false;
  constructor(private apiKey = process.env.LUNARCRUSH_API_KEY ?? "",
              private org = process.env.ROUTER_ORG_ID ?? "",
              forced = process.env.LUNARCRUSH_MODE ?? "") {
    this.mode = forced === "fixture" ? "fixture" : apiKey ? "own-key" : "trial";
  }
  /** true when values come from LunarCrush (directly or via the trial gateway) rather than fixtures */
  get live() { return this.mode !== "fixture" && !(this.mode === "trial" && !this.trial.enabled); }

  /** Trial mode only: pull cap/remaining/assetCap for this org from the gateway. Safe to call at startup. */
  async refreshTrialStatus(): Promise<TrialState> {
    if (this.mode !== "trial") return this.trial;
    try {
      const r = await fetch(`${TRIAL_GATEWAY}/trial/status?org=${encodeURIComponent(this.org || "unknown")}`);
      const s = await r.json() as Record<string, any>;
      this.trial = { ...this.trial, enabled: Boolean(s.enabled), cap: s.cap, remaining: s.remaining, assetCap: s.assetCap, resetsAt: s.resetsAt, terms: s.terms, exhausted: s.remaining === 0 };
    } catch (e) { if (!this.warned) { console.error("[lunarcrush] trial gateway unreachable, using fixtures:", (e as Error).message); this.warned = true; } this.trial.enabled = false; }
    return this.trial;
  }

  async snapshot(t: LcTarget): Promise<Snapshot> {
    if (this.mode === "fixture" || (this.mode === "trial" && !this.trial.enabled)) return fixture(t);
    if (this.mode === "trial" && this.trial.exhausted) throw new TrialExhausted({ ...this.trial });
    const path = t.kind === "coin" ? `/public/coins/${encodeURIComponent(t.symbol)}/v1` : `/public/stocks/${encodeURIComponent(t.symbol)}/v1`;
    const url = (this.mode === "own-key" ? DIRECT : `${TRIAL_GATEWAY}/api4`) + path;
    const headers: Record<string, string> = this.mode === "own-key" ? { Authorization: `Bearer ${this.apiKey}` } : { "X-FinP2P-Org": this.org || "unknown" };
    const res = await fetch(url, { headers });
    if (this.mode === "trial") {
      const h = (k: string) => res.headers.get(k);
      if (h("x-trial-cap")) this.trial = { ...this.trial, cap: Number(h("x-trial-cap")), remaining: Number(h("x-trial-remaining")), assetCap: Number(h("x-trial-asset-cap")), resetsAt: h("x-trial-resets-at") ?? undefined };
      if (res.status === 503) { // gateway has no key yet: degrade to fixtures, say so once
        if (!this.warned) { console.error("[lunarcrush] trial not enabled on the gateway yet; serving fixtures"); this.warned = true; }
        this.trial.enabled = false; return fixture(t);
      }
      if (res.status === 429) { const info = await res.json().catch(() => ({})) as Record<string, unknown>; this.trial = { ...this.trial, exhausted: true, remaining: 0, upgrade: info.upgrade as string, terms: info.terms as string }; throw new TrialExhausted(info); }
    }
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
