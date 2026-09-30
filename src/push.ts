/**
 * One-shot ingest test against a Router. This is the "start with testing the ingest" step.
 *
 *   npm run push -- --dry-run                      print the payload, send nothing
 *   npm run push -- --assets COIN,BTC              push only these symbols
 *   npm run push -- --types socialSentiment        (default; the only type this provider serves)
 *   ROUTER_INGEST_URL=https://<router>/data/assets/ingest ROUTER_ORG_ID=... ROUTER_API_KEY=... \
 *   ROUTER_PRIVATE_KEY_FILE=keys/private.pem ROUTER_AUTH=jwt npm run push
 */
import { LunarCrush } from "./lunarcrush.js";
import { RouterIngest } from "./ingest.js";
import { build, SOURCE } from "./payload.js";
import { coverage } from "./mapping.js";
import { randomUUID } from "node:crypto";

const args = process.argv.slice(2);
const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const dry = args.includes("--dry-run");
const symbols = flag("--assets")?.split(",").map(x => x.trim().toUpperCase());
const types = flag("--types")?.split(",").map(x => x.trim()) ?? ["socialSentiment"];

const chosen = coverage().filter(a => !symbols || symbols.includes(a.target.symbol));
if (!chosen.length) { console.error("no assets matched", symbols); process.exit(2); }

const lc = new LunarCrush(); await lc.refreshTrialStatus();
const assets = await build(lc, { assets: { type: "byIdentifiers", identifiers: chosen.map(a => a.identifier) }, dataTypes: types });
const body = { requestId: randomUUID(), source: SOURCE, assets };
const router = new RouterIngest();

console.error(`[push] ${assets.length} assets, types=${types.join(",")}, data=${lc.mode}${lc.live ? "" : "/fixture"}${lc.mode === "trial" && lc.live ? ` (trial remaining ${lc.trial.remaining}/${lc.trial.cap})` : ""}, target=${process.env.ROUTER_INGEST_URL ?? "mock"}, auth=${router.authHeader() ? (process.env.ROUTER_AUTH ?? "jwt") : "none"}`);
if (dry) { console.log(JSON.stringify(body, null, 2)); process.exit(0); }

try {
  const res = await router.push(body);
  const acc = res.results.filter(r => r.status === "accepted").length, rej = res.results.filter(r => r.status === "rejected");
  console.log(JSON.stringify(res, null, 2));
  console.error(`[push] accepted=${acc} rejected=${rej.length}`);
  process.exit(rej.length && !acc ? 1 : 0);
} catch (e) {
  console.error("[push] FAILED", (e as Error).message); process.exit(1);
}
