/** Generates the RSA-4096 keypair Ownera expects. Send keys/public.pem to Ownera; keep private.pem. */
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
const dir = process.argv[2] ?? "keys";
if (existsSync(`${dir}/private.pem`)) { console.error(`${dir}/private.pem exists, not overwriting`); process.exit(1); }
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 4096, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/private.pem`, privateKey, { mode: 0o600 });
writeFileSync(`${dir}/public.pem`, publicKey);
console.log(`wrote ${dir}/private.pem (keep) and ${dir}/public.pem (send to Ownera)`);
