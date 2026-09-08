// Scratch verification harness for Git #3150 -- deleted before the session ends.
import { many, one, query, closePool } from "./src/db.mjs";
import * as vault from "./src/core/vault.mjs";

const USER = "66ddf602-8103-4c15-bfc6-8914eeeb4e7a"; // the real shanemccaw@gmail.com row
const SECRET = "Acct 0041 2339 1482 1";
const created = [];
const fail = (m) => {
  console.log("  FAIL:", m);
  process.exitCode = 1;
};

console.log("keyIsConfigured:", vault.keyIsConfigured());

// 1. create + list
const a = await vault.createEntry(USER, {
  label: "3150 verify · mortgage",
  site: "mrcooper.com",
  secret: SECRET,
});
const b = await vault.createEntry(USER, {
  label: "3150 verify · second row",
  site: "chryslercapital.com",
  secret: "Card 4400 1200 5581 0231",
  masked: "Card •••• 0231",
});
created.push(a.id, b.id);
console.log("1. created:", JSON.stringify({ id: a.id, masked: a.masked, keyId: a.keyId, position: a.position }));
console.log("   auto-derived mask:", a.masked, "| hand-written mask kept:", b.masked);
if (a.masked !== "•••• 4821") fail(`auto mask wrong: ${a.masked}`);
if (b.masked !== "Card •••• 0231") fail("hand-written mask was overwritten");

const list = await vault.listEntries(USER);
const listed = list.find((e) => e.id === a.id);
console.log("2. listEntries keys:", Object.keys(listed).join(","));
if (JSON.stringify(list).includes("1482 1")) fail("listEntries leaked plaintext");
if (JSON.stringify(list).includes("ciphertext")) fail("listEntries returned ciphertext");

// 2. what is actually ON DISK
const raw = await one("SELECT ciphertext, iv, auth_tag, key_id FROM vault WHERE id = $1", [a.id]);
const rawHex = raw.ciphertext.toString("hex");
console.log("3. stored ciphertext (hex):", rawHex);
console.log("   iv bytes:", raw.iv.length, "| auth_tag bytes:", raw.auth_tag.length, "| key_id:", raw.key_id);
if (raw.ciphertext.toString("utf8").includes("1482")) fail("plaintext is readable in the column");
if (raw.iv.length !== 12 || raw.auth_tag.length !== 16) fail("iv/tag lengths are not GCM's");
// A dump on its own decrypts nothing: prove the DB holds no copy of the key.
const keyHunt = await many(
  `SELECT count(*)::int AS n FROM information_schema.columns
    WHERE column_name ILIKE '%vault%key%' OR column_name ILIKE '%encryption_key%'`,
);
console.log("   columns in this DB that could hold a vault key:", keyHunt[0].n);
if (keyHunt[0].n !== 0) fail("something in the database looks like it stores the key");

// 3. reveal requires a credential id
try {
  await vault.reveal(USER, a.id, {});
  fail("reveal() decrypted without a credential id");
} catch (err) {
  console.log("4. reveal without a credential refused:", err.message);
}

const revealed = await vault.reveal(USER, a.id, {
  credentialId: "verify-3150-credential",
  ip: "127.0.0.1",
  userAgent: "vault-verify",
});
console.log("5. reveal ->", JSON.stringify({
  value: revealed.value,
  windowSeconds: revealed.windowSeconds,
  clipboardClearSeconds: revealed.clipboardClearSeconds,
  revealedAt: revealed.revealedAt,
  expiresAt: revealed.expiresAt,
}));
if (revealed.value !== SECRET) fail("round-trip did not return the original value");
const windowMs = new Date(revealed.expiresAt) - new Date(revealed.revealedAt);
if (windowMs !== 20000) fail(`display window is ${windowMs}ms, not 20000ms`);

// 4. audit row per reveal
const history = await vault.revealHistory(USER, a.id);
console.log("6. vault_reveals rows:", history.length, JSON.stringify(history[0]));
if (history.length !== 1) fail("no audit row was written");
await vault.reveal(USER, a.id, { credentialId: "verify-3150-credential-2" });
const history2 = await vault.revealHistory(USER, a.id);
console.log("   after a second reveal:", history2.length, "rows");
if (history2.length !== 2) fail("second reveal did not write its own audit row");

// 5. AAD binding: b's ciphertext lifted into a's row must NOT decrypt
const bRaw = await one("SELECT ciphertext, iv, auth_tag FROM vault WHERE id = $1", [b.id]);
await query("UPDATE vault SET ciphertext = $2, iv = $3, auth_tag = $4 WHERE id = $1", [
  a.id,
  bRaw.ciphertext,
  bRaw.iv,
  bRaw.auth_tag,
]);
try {
  const r = await vault.reveal(USER, a.id, { credentialId: "verify-3150-swap" });
  fail(`a swapped ciphertext decrypted anyway: ${r.value}`);
} catch (err) {
  console.log("7. ciphertext lifted from another row refused:", err.message.slice(0, 80));
}
const afterSwap = await vault.revealHistory(USER, a.id);
console.log("   audit rows after the refused reveal:", afterSwap.length, "(rolled back, still 2)");
if (afterSwap.length !== 2) fail("a failed reveal still wrote an audit row");

// 6. cross-user isolation
const other = "11a03f0c-b6f5-4d02-9bb9-5faa67538ea2";
const stolen = await vault.reveal(other, b.id, { credentialId: "verify-3150-other-user" });
console.log("8. another user revealing this row:", stolen);
if (stolen !== null) fail("cross-user reveal succeeded");

// 7. update without a secret leaves the ciphertext alone
const beforeEdit = await one("SELECT ciphertext FROM vault WHERE id = $1", [b.id]);
await vault.updateEntry(USER, b.id, { label: "3150 verify · renamed" });
const afterEdit = await one("SELECT ciphertext, label FROM vault WHERE id = $1", [b.id]);
console.log("9. rename kept ciphertext byte-identical:", beforeEdit.ciphertext.equals(afterEdit.ciphertext), "| label:", afterEdit.label);
if (!beforeEdit.ciphertext.equals(afterEdit.ciphertext)) fail("a rename re-encrypted the value");

// 8. re-encrypting on a real secret change
await vault.updateEntry(USER, b.id, { secret: "Card 4400 1200 5581 9999" });
const rotated = await vault.reveal(USER, b.id, { credentialId: "verify-3150-rotate" });
console.log("10. after a secret change ->", rotated.value, "| mask:", rotated.masked);
if (rotated.value !== "Card 4400 1200 5581 9999") fail("secret change did not take");
if (rotated.masked !== "Card •••• 0231") fail("hand-written mask was clobbered on a secret change");

// cleanup -- this harness leaves nothing behind in the real database
for (const id of created) await vault.deleteEntry(USER, id);
const left = await many("SELECT count(*)::int n FROM vault WHERE user_id = $1", [USER]);
const leftReveals = await many("SELECT count(*)::int n FROM vault_reveals", []);
console.log("11. cleaned up. vault rows left:", left[0].n, "| vault_reveals left:", leftReveals[0].n);
if (left[0].n !== 0) fail("verification rows were left behind");
if (leftReveals[0].n !== 0) fail("audit rows were left behind (cascade did not fire)");

console.log(process.exitCode ? "\nRESULT: FAILURES ABOVE" : "\nRESULT: all vault checks passed");
await closePool();
