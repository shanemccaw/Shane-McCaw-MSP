/**
 * Git #4515 — the generated-credential store must never fall back to
 * AZURE_KEY_VAULT_URL (the production ShaneMcCawConsulting vault). An unset or
 * blank GENERATED_SECRET_VAULT_URL is "unconfigured", which every caller treats
 * as fail-closed (`generated_secret_store_unavailable`).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("./logger.ts", () => {
  const stub = { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() };
  return { logger: { ...stub, child: vi.fn(() => stub) } };
});

import { generatedSecretStoreConfigured, storeGeneratedSecret } from "./generated-secret-store.ts";

const KEYS = [
  "GENERATED_SECRET_VAULT_URL",
  "AZURE_KEY_VAULT_URL",
  "AZURE_TENANT_ID",
  "AZURE_CLIENT_ID",
  "AZURE_CLIENT_SECRET",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  process.env.AZURE_KEY_VAULT_URL = "https://platform-vault.invalid/";
  process.env.AZURE_TENANT_ID = "00000000-0000-0000-0000-000000000000";
  process.env.AZURE_CLIENT_ID = "00000000-0000-0000-0000-000000000000";
  process.env.AZURE_CLIENT_SECRET = "not-a-real-secret";
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("#4515 — no fallback to AZURE_KEY_VAULT_URL", () => {
  it("is unconfigured when GENERATED_SECRET_VAULT_URL is unset, even with the platform vault set", () => {
    delete process.env.GENERATED_SECRET_VAULT_URL;
    expect(generatedSecretStoreConfigured()).toBe(false);
  });

  it("is unconfigured when GENERATED_SECRET_VAULT_URL is blank", () => {
    process.env.GENERATED_SECRET_VAULT_URL = "   ";
    expect(generatedSecretStoreConfigured()).toBe(false);
  });

  it("refuses to build a vault client rather than using the platform vault", async () => {
    delete process.env.GENERATED_SECRET_VAULT_URL;
    await expect(
      storeGeneratedSecret({ value: "x", purpose: "break-glass", customerId: 1 }),
    ).rejects.toThrow(/no fallback to AZURE_KEY_VAULT_URL/);
  });

  it("is configured only when GENERATED_SECRET_VAULT_URL is set explicitly", () => {
    process.env.GENERATED_SECRET_VAULT_URL = "https://generated-vault.invalid/";
    expect(generatedSecretStoreConfigured()).toBe(true);
  });
});
