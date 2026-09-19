/**
 * FinP2P Data Provider Adapter for LunarCrush.
 * Implements the adapter side of Ownera's Data Provider Adapter API:
 *   POST /assets/data              (async pull)  -> 202 {requestId}, then push to Router ingest
 *   POST /assets/data/subscribe    (push)        -> 200 {subscriptionId}, periodic pushes
 *   POST /assets/data/unsubscribe                -> 200
 *   GET  /health
 */
import express from "express";
import { randomUUID } from "node:crypto";
import { coverage, type AssetIdentifier } from "./mapping.js";
import { LunarCrush } from "./lunarcrush.js";
import { RouterIngest } from "./ingest.js";
import { build, SOURCE, type Filter } from "./payload.js";

const lc = new LunarCrush();
const router = new RouterIngest();
const subs = new Map<string, { filter: Filter; timer: NodeJS.Timeout }>();

async function deliver(corr: { requestId?: string; subscriptionId?: string }, filter: Filter) {
  const assets = await build(lc, filter);
  if (!assets.length) return;
  const res = await router.push({ ...corr, source: SOURCE, assets });
  const rejected = res.results.filter(r => r.status === "rejected");
  console.log(`[adapter] pushed ${assets.length} assets for ${JSON.stringify(corr)}; rejected=${rejected.length}` +
    (rejected.length ? " " + JSON.stringify(rejected.slice(0, 3)) : ""));
}

const app = express();
app.use(express.json());

app.get("/health", (_q, r) => r.json({ status: "ok", provider: SOURCE, live: lc.live, subscriptions: subs.size, coverage: coverage().length, ingest: process.env.ROUTER_INGEST_URL ?? "mock", auth: router.authHeader() ? "on" : "off" }));

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
  const subscriptionId = randomUUID();
  const every = Number(process.env.REFRESH_SECONDS ?? 3600) * 1000;
  const timer = setInterval(() => deliver({ subscriptionId }, filter).catch(e => console.error("[adapter] push failed", e)), every);
  subs.set(subscriptionId, { filter, timer });
  res.json({ subscriptionId });
  deliver({ subscriptionId }, filter).catch(e => console.error("[adapter] initial push failed", e));
});

app.post("/assets/data/unsubscribe", (req, res) => {
  const id = req.body?.subscriptionId as string | undefined;
  const s = id ? subs.get(id) : undefined;
  if (!s) return res.status(404).json({ code: "1100", message: "subscription not found" });
  clearInterval(s.timer); subs.delete(id!);
  res.json({ ok: true });
});

const port = Number(process.env.PORT ?? 4100);
app.listen(port, () => console.log(`[adapter] LunarCrush FinP2P data adapter on :${port} (${lc.live ? "LIVE" : "fixture"} mode)`));
