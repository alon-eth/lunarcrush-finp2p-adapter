/**
 * Stand-in for an Ownera Router's ingest endpoint so the adapter can be tested locally.
 * Validates the IngestAssetDataRequest shape, stores the latest item per (identifier, dataType),
 * and exposes GET /assetDatas so you can see what a consumer Router would surface via GraphQL.
 */
import express from "express";
import { renderView } from "./view.js";

const store = new Map<string, unknown>();
const app = express();
app.use(express.json({ limit: "5mb" }));

app.post("/data/assets/ingest", (req, res) => {
  const b = req.body ?? {};
  if (!Array.isArray(b.assets) || !b.assets.length) return res.status(400).json({ errors: [{ code: 1002, message: "assets required" }] });
  const results = [];
  for (const a of b.assets) {
    const id = a?.identifier;
    for (const d of a?.data ?? []) {
      const ok = id?.identifierType && id?.identifierValue && d?.dataType && typeof d?.data === "object";
      if (ok) store.set(`${id.identifierType}:${id.identifierValue}#${d.dataType}`, { ...d, receivedAt: Date.now(), corr: b.requestId ?? b.subscriptionId });
      results.push({ identifier: id, dataType: d?.dataType, status: ok ? "accepted" : "rejected", ...(ok ? {} : { error: { code: 1002, message: "invalid item" } }) });
    }
  }
  console.log(`[mock-router] ingest source=${b.source} corr=${b.requestId ?? b.subscriptionId} items=${results.length}`);
  res.json({ results });
});

app.get("/", (_q, r) => r.type("html").send(renderView(store)));
app.get("/assetDatas", (_q, r) => r.json(Object.fromEntries(store)));
app.listen(Number(process.env.MOCK_PORT ?? 4101), () => console.log("[mock-router] ingest endpoint on :4101"));
