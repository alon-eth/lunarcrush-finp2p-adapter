# Social and Market Data SuperApp: LunarCrush adapter for FinP2P

A FinP2P **Data Provider Adapter** that serves LunarCrush social and market intelligence to Ownera Routers. It implements the adapter side of Ownera's [Data Provider Adapter API](https://finp2p-docs.ownera.io/reference/data-provider-adapter-api-introduction) (`POST /assets/data`, `/assets/data/subscribe`, `/assets/data/unsubscribe`) and pushes `assetHeader` and `socialSentiment` items into a Router's `POST /data/assets/ingest`.

Product page, demo and FAQ: https://www.alongoren.com/superapp/
Schema proposal: [owneraio/finp2p-certificates-spec PR](https://github.com/owneraio/finp2p-certificates-spec/pulls) adding `schemas/data/socialSentiment.schema.json` (a copy lives in `schemas/`).

## Run the image

```bash
docker run --rm -p 4100:4100 \
  -e ROUTER_INGEST_URL=https://<router>/data/assets/ingest \
  -e ROUTER_ORG_ID=<org> -e ROUTER_API_KEY=<key> \
  -e ROUTER_PRIVATE_KEY_PEM="$(cat keys/private.pem)" \
  -e LUNARCRUSH_API_KEY=<optional, fixtures without it> \
  ghcr.io/alon-eth/lunarcrush-finp2p-adapter:latest
```

`GET /health` reports mode, coverage, ingest target and whether auth is armed. Bind the adapter on the Router with `POST /dataprovider/bind` and create data rules for `socialSentiment`; the Router then pulls or subscribes on its own schedule.

Local end to end with a mock Router: `docker compose up --build`, then

```bash
curl -X POST localhost:4100/assets/data -H 'content-type: application/json' \
  -d '{"filter":{"assets":{"type":"byType","identifierType":"ISIN"},"dataTypes":["assetHeader","socialSentiment"]}}'
curl localhost:4101/assetDatas
```

## Test the ingest against a real Router

This is the first step Ownera asked for. No adapter server needed; the CLI builds a payload and POSTs it once.

```bash
npm install
npm run keygen                      # writes keys/private.pem (keep) and keys/public.pem (send to Ownera)
npm run push -- --dry-run           # print the exact payload, send nothing

ROUTER_INGEST_URL=https://<router>/finapi/data/assets/ingest \
ROUTER_ORG_ID=<org> ROUTER_API_KEY=<key> ROUTER_PRIVATE_KEY_FILE=keys/private.pem \
ROUTER_AUTH=jwt npm run push -- --assets COIN,BTC,USDC
```

The CLI prints the Router's per-item `accepted` / `rejected` results and exits non-zero if everything was rejected.

What the real Router enforces (confirmed by Ownera against production Routers, 29 Sep 2026):

- **Auth:** the one-time RS256 JWT only. Claims `aud` = org ID, `sub` and `apiKey` = API key (the auth service reads `apiKey`), `iat`, `exp` = `iat` + 30 s, `nonce`. The base64 bearer on the ingest reference page is rejected. `ROUTER_AUTH=jwt` is the default; `none` is for connector mode or a test Router with auth off.
- **Idempotency-Key:** same format as the JWT nonce, 24 random bytes then the epoch seconds as an 8-byte big-endian integer, hex-encoded. The Router reads the trailing 8 bytes as a timestamp. `src/ingest.ts#timestampedNonce` produces both.
- **Data types:** a data provider sends only its own type. `socialSentiment` is the only type this adapter emits. Routers subscribe every bound provider to `assetHeader` and pricing by default; those subscriptions are accepted and nothing is pushed for them.
- **Schema:** `socialSentiment` validates against the schema in [owneraio/finp2p-certificates-spec#45](https://github.com/owneraio/finp2p-certificates-spec/pull/45). A standard Router accepts the type once that PR is merged.

## Connector mode

Installed inside a Router (Ownera's install-connector template), the adapter pushes straight to the node with no credentials:

```
ROUTER_INGEST_URL=http://finp2p-node/data/assets/ingest
ROUTER_AUTH=none
SUBSCRIPTIONS_FILE=/app/data/subscriptions.json   # mount /app/data so subscriptions survive restarts
```

Subscriptions are written to `SUBSCRIPTIONS_FILE` on subscribe/unsubscribe and re-armed on startup, so a pod restart does not leave the Router believing in a subscription the adapter has forgotten.

## Payload shape

One `socialSentiment` item per asset per push, following the proposed spec: top-level `timestamp` (epoch ms), `window`, `topic`, `symbol`, `methodology`, and a `values` map keyed by metric (`sentiment`, `engagements`, `mentions`, `creators`, `socialDominance`, `marketDominance`, `galaxyScore`, `altRank`) with `value`, `decimal` and `unit`. Assets are addressed by ISIN or CAIP-19; the mapping table is `src/mapping.ts`.

## Layout

- `src/server.ts` adapter HTTP surface (pull, subscribe, unsubscribe, health); subscriptions persisted to `SUBSCRIPTIONS_FILE`
- `src/payload.ts` builds ingest payloads in the spec shape
- `src/ingest.ts` Router ingest client, RS256 JWT + timestamped Idempotency-Key
- `src/push.ts` one-shot ingest CLI; `src/keygen.ts` RSA-4096 keypair
- `src/mapping.ts` ISIN / CAIP-19 to LunarCrush symbols; `src/lunarcrush.ts` v4 client with fixture fallback
- `mock-router/` local stand-in for a Router's ingest endpoint with an HTML view; enforces the real idempotency-key format and rejects `assetHeader`
- `schemas/socialSentiment.schema.json` the proposed data schema
- `Dockerfile`, `compose.yaml`, `.github/workflows/docker.yml` (publishes `ghcr.io/alon-eth/lunarcrush-finp2p-adapter` on push to main)

## Not done yet

Full-catalog mode (bulk LunarCrush list endpoints, OpenFIGI ISIN lookup, coin-metadata contract lookup), `socialNarrative` / `socialTimeSeries` / `creatorInfluence` data types, and batch signing for provenance. All wait on a LunarCrush key (fixture mode until then).

Apache-2.0. Built by the Draper Goren Blockchain venture studio.
