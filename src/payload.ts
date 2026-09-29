/**
 * Builds Router ingest payloads. socialSentiment follows the schema proposed to
 * owneraio/finp2p-certificates-spec (schemas/data/socialSentiment.schema.json):
 * one snapshot per (asset, source), a `values` map keyed by metric name.
 */
import { coverage, resolve, type AssetIdentifier } from "./mapping.js";
import type { LunarCrush, Snapshot } from "./lunarcrush.js";
import type { AssetDataItem, IngestRequest } from "./ingest.js";

export const SOURCE = "lunarcrush";
export const SCHEMA_REF = process.env.SCHEMA_REF ?? "https://ownera.io/certificates/data/socialSentiment.schema.json";
export const METHODOLOGY = "https://lunarcrush.com/about/metrics";
/**
 * A data provider sends only its own data type. assetHeader and pricing come from the asset's
 * catalog/pricing providers; Routers subscribe every bound provider to those by default, so we
 * accept such subscriptions and push nothing for them (build() returns no items).
 */
export const SUPPORTED = new Set(["socialSentiment"]);

export type Scope = { type: "byType"; identifierType: "ISIN" | "CAIP19" } | { type: "byIdentifiers"; identifiers: AssetIdentifier[] };
export interface Filter { assets?: Scope; dataTypes: string[]; }

export function selectAssets(scope?: Scope) {
  const all = coverage();
  if (!scope) return all;
  if (scope.type === "byType") return all.filter(a => a.identifier.identifierType === scope.identifierType);
  return scope.identifiers.map(id => ({ identifier: id, target: resolve(id) })).filter(a => a.target) as typeof all;
}

const v = (value: number | undefined, unit: "count" | "percent" | "score" | "rank", decimal = 0) =>
  value === undefined || Number.isNaN(value) ? undefined : { value: decimal ? Math.round(value * 10 ** decimal) : Math.round(value), decimal, unit };

export function toSocialSentiment(s: Snapshot) {
  const values: Record<string, unknown> = {};
  const put = (k: string, o: unknown) => { if (o) values[k] = o; };
  put("sentiment", v(s.sentiment, "percent"));
  put("engagements", v(s.interactions24h, "count"));
  put("mentions", v(s.postsActive24h, "count"));
  put("creators", v(s.contributorsActive24h, "count"));
  put("socialDominance", v(s.socialDominance, "percent", 3));
  put("marketDominance", v(s.marketDominance, "percent", 3));
  put("galaxyScore", v(s.galaxyScore, "score", 1));
  put("altRank", v(s.altRank, "rank"));
  return { timestamp: s.asOf, window: "24h", topic: s.topic, symbol: s.symbol, methodology: METHODOLOGY, values };
}

export async function build(lc: LunarCrush, filter: Filter): Promise<IngestRequest["assets"]> {
  const types = filter.dataTypes.filter(t => SUPPORTED.has(t));
  const out: IngestRequest["assets"] = [];
  for (const { identifier, target } of selectAssets(filter.assets)) {
    const data: AssetDataItem[] = [];
    if (types.includes("socialSentiment")) {
      const s = await lc.snapshot(target);
      data.push({ dataType: "socialSentiment", schemaRef: SCHEMA_REF, source: SOURCE, timestamp: s.asOf, data: toSocialSentiment(s) });
    }
    if (data.length) out.push({ identifier, data });
  }
  return out;
}
