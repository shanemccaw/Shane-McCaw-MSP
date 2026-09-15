// Decoding for the MT app registration's certificate private key env var
// (`MT_APP_CERT_PRIVATE_KEY`), shared by every consumer so there is exactly one
// place that knows its wire format.
//
// Canonical format (Git #4156): a SINGLE-LINE base64 encoding of the whole PEM
// (`-----BEGIN PRIVATE KEY----- … -----END PRIVATE KEY-----`, newlines included).
// A raw multi-line PEM in `.env.local` was structurally unsafe: the repo's own line
// loaders (scripts/dev-all.mjs, run-script.mjs) read only the first line, and a
// `bash source .env.local` executed every following base64 line as a command and
// printed the key material into stderr. A single base64 line has neither problem.
//
// Legacy format, still accepted: a PEM containing `-----BEGIN` with real newlines or
// literal `\n` escapes. Deployed environments (Replit Secrets — see #855) may still
// hold that form, and rejecting it would break SharePoint-admin auth there on the
// next deploy with no agent able to update the secret.
//
// Never logs or echoes the value, decoded or encoded — errors name the env var only.

const ENV_VAR = "MT_APP_CERT_PRIVATE_KEY";

/** Decode a raw `MT_APP_CERT_PRIVATE_KEY` value (base64-of-PEM or legacy PEM) to PEM text. */
export function decodeMtAppCertPrivateKey(raw: string): string {
  const value = raw.trim();
  if (value.includes("-----BEGIN")) {
    return value.replace(/\\n/g, "\n");
  }
  const compact = value.replace(/\s+/g, "");
  if (!compact || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
    throw new Error(
      `${ENV_VAR} is neither a PEM nor a base64-encoded PEM. Expected a single-line ` +
        "base64 encoding of the private key PEM (Git #4156).",
    );
  }
  const pem = Buffer.from(compact, "base64").toString("utf8");
  if (!pem.includes("-----BEGIN")) {
    throw new Error(
      `${ENV_VAR} base64-decodes but the result is not a PEM (no -----BEGIN marker). ` +
        "Expected base64 of the full PEM text, markers and newlines included (Git #4156).",
    );
  }
  return pem;
}

/** Read and decode `MT_APP_CERT_PRIVATE_KEY` from the environment; undefined when unset/empty. */
export function readMtAppCertPrivateKeyPem(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw = env[ENV_VAR];
  if (!raw || !raw.trim()) return undefined;
  return decodeMtAppCertPrivateKey(raw);
}
