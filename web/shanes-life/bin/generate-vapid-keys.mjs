#!/usr/bin/env node
// One-off: prints a real fresh VAPID key pair (P-256, base64url) for SL_VAPID_PUBLIC_KEY /
// SL_VAPID_PRIVATE_KEY in .env. Run once per real deployment; do not regenerate casually -- every
// subscriber's browser has the old public key baked into its subscription until it re-subscribes.

import { generateVapidKeyPair } from "../src/push/webpush.mjs";

const { publicKey, privateKey } = generateVapidKeyPair();
console.log(`SL_VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`SL_VAPID_PRIVATE_KEY=${privateKey}`);
