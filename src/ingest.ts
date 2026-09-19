/**
 * Pushes data into the Router's POST /data/assets/ingest (Ownera Data Provider Adapter API).
 * Auth: Ownera's docs describe a one-time RS256 JWT (aud=orgId, sub=apiKey, iat, exp=iat+30s,
 * nonce=24 random bytes + 8 byte epoch). We implement that. The ingest page also describes an
 * older base64 bearer; confirm with Ownera which one the ingest path enforces.
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

export function routerJwt(orgId: string, apiKey: string, privateKeyPem: string): string {
  const iat = Math.floor(Date.now() / 1000);
  const nonce = Buffer.concat([randomBytes(24), Buffer.alloc(8)]);
  nonce.writeBigUInt64BE(BigInt(iat), 24);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ aud: orgId, sub: apiKey, iat, exp: iat + 30, nonce: nonce.toString("hex") }));
  const sig = createSign("RSA-SHA256").update(`${header}.${payload}`).sign(privateKeyPem);
  return `${header}.${payload}.${b64url(sig)}`;
}

/**
 * Alternative bearer described on the ingest reference page: base64 JSON with
 * organization, apiKey, nonce, timestamp and an accessToken = sign("{apiKey}{nonce}{timestamp}").
 * Kept so either scheme can be selected with ROUTER_AUTH=jwt|legacy|none.
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
      "idempotency-key": randomBytes(32).toString("hex"),
    };
    const auth = this.authHeader(); if (auth) headers.authorization = auth;
    const res = await fetch(this.url, { method: "POST", headers, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`ingest ${res.status}: ${await res.text()}`);
    return res.json() as Promise<IngestResult>;
  }
}
