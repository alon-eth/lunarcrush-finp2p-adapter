/**
 * Stand-in for an Ownera Router's ingest endpoint so the adapter can be tested locally.
 * Validates the IngestAssetDataRequest shape, stores the latest item per (identifier, dataType),
 * and exposes GET /assetDatas so you can see what a consumer Router would surface via GraphQL.
 *
 * Mirrors two behaviours of the real Router observed by Ownera on 2026-09-29 so regressions are
 * caught locally: the Idempotency-Key must be 32 bytes hex whose last 8 bytes are a recent epoch
 * (422 "expired idempotency key" otherwise), and assetHeader items are rejected with
 * "assetClass is required" because a data provider must not send catalog records.
 */
import express from "express";
import { renderView } from "./view.js";

const store = new Map<string, unknown>();
const app = express();
app.use(express.json({ limit: "5mb" }));

const IDEMPOTENCY_WINDOW_S = 300;
function idempotencyError(key: string | undefined): string | undefined {
  if (!key || !/^[0-9a-f]{64}$/i.test(key)) return "idempotency key must be 32 bytes hex";
  const ts = Number(BigInt("0x" + key.slice(48)));
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > IDEMPOTENCY_WINDOW_S) return "expired idempotency key";
  return undefined;
}

app.post("/data/assets/ingest", (req, res) => {
  const b = req.body ?? {};
  const idem = idempotencyError(req.header("idempotency-key"));
  if (idem) return res.status(422).json({ errors: [{ code: 1003, message: idem }] });
  if (!Array.isArray(b.assets) || !b.assets.length) return res.status(400).json({ errors: [{ code: 1002, message: "assets required" }] });
  const results = [];
  for (const a of b.assets) {
    const id = a?.identifier;
    for (const d of a?.data ?? []) {
      const shapeOk = id?.identifierType && id?.identifierValue && d?.dataType && typeof d?.data === "object";
      const error = !shapeOk ? { code: 1002, message: "invalid item" }
        : d.dataType === "assetHeader" ? { code: 1002, message: "assetClass is required" } : undefined;
      if (!error) store.set(`${id.identifierType}:${id.identifierValue}#${d.dataType}`, { ...d, receivedAt: Date.now(), corr: b.requestId ?? b.subscriptionId });
      results.push({ identifier: id, dataType: d?.dataType, status: error ? "rejected" : "accepted", ...(error ? { error } : {}) });
    }
  }
  console.log(`[mock-router] ingest source=${b.source} corr=${b.requestId ?? b.subscriptionId} items=${results.length}`);
  res.json({ results });
});

app.get("/", (_q, r) => r.type("html").send(renderView(store)));
app.get("/assetDatas", (_q, r) => r.json(Object.fromEntries(store)));
app.listen(Number(process.env.MOCK_PORT ?? 4101), () => console.log("[mock-router] ingest endpoint on :4101"));
