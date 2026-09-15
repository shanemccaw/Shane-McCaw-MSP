import { describe, it, expect } from "vitest";
import { createPrivateKey, generateKeyPairSync } from "node:crypto";
import { decodeMtAppCertPrivateKey, readMtAppCertPrivateKeyPem } from "./mt-app-cert-key.ts";

// A throwaway key generated per run — no real credential material in this file.
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

describe("decodeMtAppCertPrivateKey (Git #4156)", () => {
  it("decodes the canonical single-line base64-of-PEM form to a parseable PEM", () => {
    const encoded = Buffer.from(pem, "utf8").toString("base64");
    expect(encoded).not.toMatch(/\s/);
    const decoded = decodeMtAppCertPrivateKey(encoded);
    expect(decoded).toBe(pem);
    expect(createPrivateKey(decoded).asymmetricKeyType).toBe("rsa");
  });

  it("tolerates surrounding whitespace on the base64 form", () => {
    const encoded = Buffer.from(pem, "utf8").toString("base64");
    expect(decodeMtAppCertPrivateKey(`  ${encoded}\n`)).toBe(pem);
  });

  it("still accepts a legacy PEM with real newlines", () => {
    expect(createPrivateKey(decodeMtAppCertPrivateKey(pem)).asymmetricKeyType).toBe("rsa");
  });

  it("still accepts a legacy PEM with literal \\n escapes", () => {
    const escaped = pem.replace(/\n/g, "\\n");
    expect(escaped).not.toContain("\n");
    expect(decodeMtAppCertPrivateKey(escaped)).toBe(pem);
  });

  it("rejects a value that is neither PEM nor base64, naming the env var but not the value", () => {
    const bogus = "not a key at all!";
    expect(() => decodeMtAppCertPrivateKey(bogus)).toThrow(/MT_APP_CERT_PRIVATE_KEY/);
    try {
      decodeMtAppCertPrivateKey(bogus);
    } catch (err) {
      expect((err as Error).message).not.toContain(bogus);
    }
  });

  it("rejects base64 that does not decode to a PEM", () => {
    const notPem = Buffer.from("hello world", "utf8").toString("base64");
    expect(() => decodeMtAppCertPrivateKey(notPem)).toThrow(/not a PEM/);
  });
});

describe("readMtAppCertPrivateKeyPem", () => {
  it("returns undefined when the var is unset or blank", () => {
    expect(readMtAppCertPrivateKeyPem({})).toBeUndefined();
    expect(readMtAppCertPrivateKeyPem({ MT_APP_CERT_PRIVATE_KEY: "   " })).toBeUndefined();
  });

  it("decodes the var when present", () => {
    const encoded = Buffer.from(pem, "utf8").toString("base64");
    expect(readMtAppCertPrivateKeyPem({ MT_APP_CERT_PRIVATE_KEY: encoded })).toBe(pem);
  });
});
