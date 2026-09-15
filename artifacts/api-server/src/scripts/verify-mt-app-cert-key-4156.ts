// Git #4156 — live verification that MT_APP_CERT_PRIVATE_KEY (single-line base64 of the PEM)
// decodes and authenticates through the REAL sharepoint-admin.ts certificate path.
//
//   node artifacts/api-server/run-script.mjs src/scripts/verify-mt-app-cert-key-4156.ts [tenantRowId]
//
// Read-only: acquires an app-only SharePoint admin token for the testbed tenant (tenants.id = 1
// by default) and reads the tenant sharing capability. Prints only the env var's shape, the
// decoded key type, and the call outcome — never the key, the assertion, or the token.

import { createPrivateKey } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, tenantsTable } from "@workspace/db";
import { readMtAppCertPrivateKeyPem } from "../lib/mt-app-cert-key.ts";
import { getSharePointToken, getTenantSharingCapability } from "../lib/sharepoint-admin.ts";

const tenantRowId = Number(process.argv[2] ?? "1");
const raw = process.env.MT_APP_CERT_PRIVATE_KEY ?? "";

console.log(
  `env shape: set=${raw.length > 0} singleLine=${!/[\r\n]/.test(raw)} rawPem=${raw.includes("-----BEGIN")}`,
);
const pem = readMtAppCertPrivateKeyPem();
if (!pem) {
  console.log("FAIL: MT_APP_CERT_PRIVATE_KEY not set");
  process.exit(1);
}
const key = createPrivateKey(pem);
console.log(`decoded: ${key.asymmetricKeyType}/${key.asymmetricKeyDetails?.modulusLength}`);

const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantRowId));
if (!tenant?.tenantId || !tenant.domain) {
  console.log(`FAIL: tenant row ${tenantRowId} missing tenant_id/domain`);
  process.exit(1);
}
const prefix = tenant.domain.split(".")[0];

const token = await getSharePointToken(tenant.tenantId, `${prefix}-admin.sharepoint.com`);
console.log(`token: acquired=${token.length > 0}`);

const sharing = await getTenantSharingCapability({ aadTenantId: tenant.tenantId, sharePointTenantPrefix: prefix });
console.log(`tenant sharing capability read: ${JSON.stringify(sharing)}`);
process.exit(0);
