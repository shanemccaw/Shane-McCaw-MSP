#!/usr/bin/env node
// Real self-check for src/push/webpush.mjs's RFC 8291 encryption, since this build session has
// no real device/browser to verify against. Simulates a subscriber (its own P-256 key pair +
// random auth secret, exactly the shape a real PushSubscription carries), encrypts a real
// payload the same way sendWebPush() would, then decrypts it back using the receiver-side
// derivation and asserts the round trip matches. This proves the HKDF/AES-GCM derivation is
// internally consistent with the spec's algorithm; it does NOT prove a real iOS Safari push
// service accepts the wire format -- that needs a real subscribed device (see build-journal
// #3160 for the honest gap).

import { createECDH, randomBytes } from "node:crypto";
import { __test } from "../src/push/webpush.mjs";

const receiverEcdh = createECDH("prime256v1");
receiverEcdh.generateKeys();
const authSecret = randomBytes(16);

const subscription = {
  p256dh: __test.base64url(receiverEcdh.getPublicKey()),
  auth: __test.base64url(authSecret),
};

const payload = { title: "Vet appt tomorrow", body: "Bella -- 2:30pm", url: "/dates/abc123" };
const encoded = __test.encryptPayload(payload, subscription);
const decoded = __test.decryptPayloadForTest(encoded, receiverEcdh, authSecret);
const roundTripped = JSON.parse(decoded);

const ok = JSON.stringify(roundTripped) === JSON.stringify(payload);
console.log(ok ? "PASS: encrypt -> decrypt round-trip matches" : "FAIL: round-trip mismatch");
console.log("  sent:    ", JSON.stringify(payload));
console.log("  decoded: ", JSON.stringify(roundTripped));
process.exitCode = ok ? 0 : 1;
