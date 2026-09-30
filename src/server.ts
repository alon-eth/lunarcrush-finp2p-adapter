/**
 * FinP2P Data Provider Adapter for LunarCrush.
 * Implements the adapter side of Ownera's Data Provider Adapter API:
 *   POST /assets/data              (async pull)  -> 202 {requestId}, then push to Router ingest
 *   POST /assets/data/subscribe    (push)        -> 200 {subscriptionId}, periodic pushes
 *   POST /assets/data/unsubscribe                -> 200
 *   GET  /health
 *
 * Subscriptions are persisted to SUBSCRIPTIONS_FILE (default data/subscriptions.json) and
 * resumed on startup, so a pod restart does not silently drop a Router's subscription.
 *
 * Connector mode (installed inside a Router): ROUTER_INGEST_URL=http://finp2p-node/data/assets/ingest
 * and ROUTER_AUTH=none. External mode: the Router's public URL plus ROUTER_ORG_ID/ROUTER_API_KEY
 * and the RS256 private key (ROUTER_AUTH=jwt).
 */
import express from "express";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { coverage } from "./mapping.js";
import { LunarCrush } from "./lunarcrush.js";
import { RouterIngest } from "./ingest.js";
import { build, SOURCE, SUPPORTED, type Filter } from "./payload.js";

const lc = new LunarCrush();
const router = new RouterIngest();
lc.refreshTrialStatus().then(t => { if (lc.mode === "trial") console.log(`[adapter] trial tier for org ${process.env.ROUTER_ORG_ID ?? "unknown"}: enabled=${t.enabled} cap=${t.cap} remaining=${t.remaining} assetCap=${t.assetCap}`); });
const SUBS_FILE = process.env.SUBSCRIPTIONS_FILE ?? "data/subscriptions.json";
const REFRESH_MS = Number(process.env.REFRESH_SECONDS ?? 3600) * 1000;

interface Sub { id: string; filter: Filter; createdAt: number; }
const subs = new Map<string, { sub: Sub; timer: NodeJS.Timeout }>();

function persist() {
  const list = [...subs.values()].map(s => s.sub);
  try {
    mkdirSync(dirname(SUBS_FILE), { recursive: true });
    const tmp = `${SUBS_FILE}.tmp`;
    writeFileSync(tmp, JSON.stringify(list, null, 2));
    renameSync(tmp, SUBS_FILE);
  } catch (e) { console.error(`[adapter] could not persist subscriptions to ${SUBS_FILE}`, (e as Error).message); }
}

function serves(filter: Filter) { return filter.dataTypes.some(t => SUPPORTED.has(t)); }

async function deliver(corr: { requestId?: string; subscriptionId?: string }, filter: Filter) {
  const assets = await build(lc, filter);
  if (!assets.length) return; // subscription for types we don't serve (assetHeader, pricing): accepted, nothing pushed
  const res = await router.push({ ...corr, source: SOURCE, assets });
  const rejected = res.results.filter(r => r.status === "rejected");
  console.log(`[adapter] pushed ${assets.length} assets for ${JSON.stringify(corr)}; rejected=${rejected.length}` +
    (rejected.length ? " " + JSON.stringify(rejected.slice(0, 3)) : ""));
}

function arm(sub: Sub, initialPush: boolean) {
  const timer = setInterval(() => deliver({ subscriptionId: sub.id }, sub.filter).catch(e => console.error("[adapter] push failed", e)), REFRESH_MS);
  subs.set(sub.id, { sub, timer });
  if (initialPush) deliver({ subscriptionId: sub.id }, sub.filter).catch(e => console.error("[adapter] initial push failed", e));
}

function resume() {
  if (!existsSync(SUBS_FILE)) return;
  try {
    const list = JSON.parse(readFileSync(SUBS_FILE, "utf8")) as Sub[];
    for (const sub of list) if (sub?.id && sub.filter?.dataTypes) arm(sub, serves(sub.filter));
    console.log(`[adapter] resumed ${subs.size} subscription(s) from ${SUBS_FILE}`);
  } catch (e) { console.error(`[adapter] could not read ${SUBS_FILE}`, (e as Error).message); }
}

const app = express();
app.use(express.json());

app.get("/health", (_q, r) => r.json({
  status: "ok", provider: SOURCE, live: lc.live, dataMode: lc.mode, trial: lc.mode === "trial" ? lc.trial : undefined, dataTypes: [...SUPPORTED], subscriptions: subs.size,
  coverage: coverage().length, ingest: process.env.ROUTER_INGEST_URL ?? "mock", auth: router.authHeader() ? "on" : "off",
}));

app.post("/assets/data", (req, res) => {
  const filter = req.body?.filter as Filter | undefined;
  if (!filter?.dataTypes?.length) return res.status(400).json({ code: "1002", message: "filter.dataTypes required" });
  const requestId = randomUUID();
  res.status(202).json({ requestId });
  deliver({ requestId }, filter).catch(e => console.error("[adapter] pull failed", e));
});

app.post("/assets/data/subscribe", (req, res) => {
  const filter = req.body?.filter as Filter | undefined;
  if (!filter?.dataTypes?.length) return res.status(400).json({ code: "1002", message: "filter.dataTypes required" });
  const sub: Sub = { id: randomUUID(), filter, createdAt: Date.now() };
  arm(sub, serves(filter));
  persist();
  res.json({ subscriptionId: sub.id });
});

app.post("/assets/data/unsubscribe", (req, res) => {
  const id = req.body?.subscriptionId as string | undefined;
  const s = id ? subs.get(id) : undefined;
  if (!s) return res.status(404).json({ code: "1100", message: "subscription not found" });
  clearInterval(s.timer); subs.delete(id!);
  persist();
  res.json({ ok: true });
});

resume();
const port = Number(process.env.PORT ?? 4100);
app.listen(port, () => console.log(`[adapter] LunarCrush FinP2P data adapter on :${port} (data=${lc.mode}${lc.live ? "" : "/fixture"}, ingest=${process.env.ROUTER_INGEST_URL ?? "mock"}, auth=${router.authHeader() ? "jwt" : "none"})`));
