/**
 * Pushes data into the Router's POST /data/assets/ingest (Ownera Data Provider Adapter API).
 *
 * Auth (confirmed by Ownera, 2026-09-29): the ingest path accepts the one-time RS256 JWT only.
 * Claims: aud=orgId, sub=apiKey, apiKey=apiKey (the auth service reads `apiKey`), iat,
 * exp=iat+30s, nonce=timestampedNonce(). The legacy base64 bearer is kept for reference but the
 * Router rejects it; ROUTER_AUTH defaults to jwt.
 *
 * Idempotency-Key must use the same format as the JWT nonce: 24 random bytes followed by the
 * epoch seconds as an 8-byte big-endian integer, hex-encoded. The Router reads the trailing 8
 * bytes as a timestamp; a purely random key reads as an expired one about half the time.
 *
 * Connector mode: installed inside a Router, push to http://finp2p-node/data/assets/ingest with
 * ROUTER_AUTH=none. The JWT is only for pushing from outside the Router.
 */
import { createSign, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
import type { AssetIdentifier } from "./mapping.js";

export interface AssetDataItem {
  dataType: string; schemaRef?: string; data: Record<string, unknown>; source?: string; timestamp?: number;
}
export interface IngestRequest {
  requestId?: string; subscriptionId?: string; source: string;
  assets: Array<{ identifier: AssetIdentifier; data: AssetDataItem[] }>;
}
export interface IngestResult {
  results: Array<{ identifier: AssetIdentifier; dataType: string; status: "accepted" | "rejected"; error?: { code: string | number; message: string } }>;
}

function b64url(b: Buffer | string) { return Buffer.from(b).toString("base64url"); }

/** 24 random bytes + epoch seconds (8-byte big-endian), hex. Used for the JWT nonce and the Idempotency-Key. */
export function timestampedNonce(now = Date.now()): string {
  const n = Buffer.concat([randomBytes(24), Buffer.alloc(8)]);
  n.writeBigUInt64BE(BigInt(Math.floor(now / 1000)), 24);
  return n.toString("hex");
}

export function routerJwt(orgId: string, apiKey: string, privateKeyPem: string): string {
  const iat = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  // `apiKey` is the claim the auth service reads; `sub` kept for the documented shape.
  const payload = b64url(JSON.stringify({ aud: orgId, sub: apiKey, apiKey, iat, exp: iat + 30, nonce: timestampedNonce(iat * 1000) }));
  const sig = createSign("RSA-SHA256").update(`${header}.${payload}`).sign(privateKeyPem);
  return `${header}.${payload}.${b64url(sig)}`;
}

/**
 * Base64 bearer from the ingest reference page. Ownera confirmed the ingest path does NOT accept
 * it (401); kept only so ROUTER_AUTH=legacy still produces something inspectable.
 */
export function routerLegacyBearer(orgId: string, apiKey: string, privateKeyPem: string): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = Buffer.concat([randomBytes(24), Buffer.alloc(8)]);
  nonce.writeBigUInt64BE(BigInt(timestamp), 24);
  const nonceHex = nonce.toString("hex");
  const accessToken = createSign("RSA-SHA256").update(`${apiKey}${nonceHex}${timestamp}`).sign(privateKeyPem).toString("base64");
  return Buffer.from(JSON.stringify({ organization: orgId, apiKey, nonce: nonceHex, timestamp, accessToken })).toString("base64");
}

export type RouterAuth = "jwt" | "legacy" | "none";

export function loadPrivateKey(): string {
  const inline = process.env.ROUTER_PRIVATE_KEY_PEM ?? "";
  if (inline.trim()) return inline.replace(/\\n/g, "\n");
  const file = process.env.ROUTER_PRIVATE_KEY_FILE ?? "";
  if (file) { try { return require("node:fs").readFileSync(file, "utf8"); } catch { /* fallthrough */ } }
  return "";
}

export class RouterIngest {
  constructor(
    private url = process.env.ROUTER_INGEST_URL ?? "http://localhost:4101/data/assets/ingest",
    private orgId = process.env.ROUTER_ORG_ID ?? "",
    private apiKey = process.env.ROUTER_API_KEY ?? "",
    private pem = loadPrivateKey(),
    private auth: RouterAuth = ((process.env.ROUTER_AUTH as RouterAuth) || (process.env.ROUTER_ORG_ID ? "jwt" : "none")),
  ) {}

  authHeader(): string | undefined {
    if (this.auth === "none" || !this.orgId || !this.apiKey || !this.pem) return undefined;
    return `Bearer ${this.auth === "legacy" ? routerLegacyBearer(this.orgId, this.apiKey, this.pem) : routerJwt(this.orgId, this.apiKey, this.pem)}`;
  }

  async push(body: IngestRequest): Promise<IngestResult> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "idempotency-key": timestampedNonce(),
    };
    const auth = this.authHeader(); if (auth) headers.authorization = auth;
    const res = await fetch(this.url, { method: "POST", headers, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`ingest ${res.status}: ${await res.text()}`);
    return res.json() as Promise<IngestResult>;
  }
}
