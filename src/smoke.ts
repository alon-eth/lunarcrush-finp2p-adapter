/** End-to-end smoke: asks the adapter for data, waits, reads it back from the mock router. */
const A = process.env.ADAPTER_URL ?? "http://localhost:4100";
const R = process.env.MOCK_ROUTER_URL ?? "http://localhost:4101";
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const pull = await fetch(`${A}/assets/data`, { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ filter: { assets: { type: "byIdentifiers", identifiers: [
    { identifierType: "CAIP19", identifierValue: "bip122:000000000019d6689c085ae165831e93/slip44:0" },
    { identifierType: "CAIP19", identifierValue: "eip155:1/erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" },
    { identifierType: "ISIN", identifierValue: "US19260Q1076" } ] }, dataTypes: ["assetHeader", "socialSentiment"] } }) });
console.log("pull ->", pull.status, await pull.json());

const sub = await fetch(`${A}/assets/data/subscribe`, { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ filter: { assets: { type: "byType", identifierType: "ISIN" }, dataTypes: ["socialSentiment"] } }) });
const { subscriptionId } = await sub.json() as { subscriptionId: string };
console.log("subscribe ->", sub.status, subscriptionId);

await sleep(1500);
const stored = await (await fetch(`${R}/assetDatas`)).json() as Record<string, any>;
const keys = Object.keys(stored);
console.log(`mock router now holds ${keys.length} items`);
for (const k of keys.slice(0, 4)) console.log(" ", k, JSON.stringify(stored[k].data).slice(0, 160));

const un = await fetch(`${A}/assets/data/unsubscribe`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ subscriptionId }) });
console.log("unsubscribe ->", un.status);
if (keys.length < 12) { console.error("FAIL: expected at least 12 items"); process.exit(1); }
console.log("SMOKE OK");

export {};
