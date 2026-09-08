#!/usr/bin/env node
// Real self-check for src/core/image-resize.mjs (Git #3262). Builds a real, large, genuinely
// noisy JPEG in-process via `sharp` (noise resists compression, so it reliably lands over 5MB
// at high resolution -- a flat-color image would compress to nothing and prove nothing), runs
// it through downscaleImageToFit the same way get_capture_photo does, and asserts the result
// actually fits under the limit and actually decodes back to a real image.

import sharp from "sharp";
import { downscaleImageToFit } from "../src/core/image-resize.mjs";

const MAX_INLINE_IMAGE_BYTES = 5 * 1024 * 1024;

async function buildNoisyJpeg(width, height) {
  const data = Buffer.alloc(width * height * 3);
  for (let i = 0; i < data.length; i++) data[i] = Math.floor(Math.random() * 256);
  return sharp(data, { raw: { width, height, channels: 3 } }).jpeg({ quality: 100, chromaSubsampling: "4:4:4" }).toBuffer();
}

const original = await buildNoisyJpeg(3200, 3200);
console.log(`Built a real synthetic JPEG: ${(original.length / (1024 * 1024)).toFixed(2)}MB`);

let ok = original.length > MAX_INLINE_IMAGE_BYTES;
if (!ok) {
  console.log("FAIL: synthetic fixture wasn't actually over the limit -- test proves nothing");
  process.exitCode = 1;
} else {
  const resized = await downscaleImageToFit(original, MAX_INLINE_IMAGE_BYTES);
  if (!resized) {
    console.log("FAIL: downscaleImageToFit returned null for a real over-limit JPEG");
    process.exitCode = 1;
  } else {
    const fits = resized.bytes.length <= MAX_INLINE_IMAGE_BYTES;
    let decodes = false;
    try {
      const redecoded = await sharp(resized.bytes).metadata();
      decodes = redecoded.width === resized.width && redecoded.height === resized.height;
    } catch {
      decodes = false;
    }
    ok = fits && decodes;
    console.log(
      `Downscaled to ${(resized.bytes.length / (1024 * 1024)).toFixed(2)}MB `
      + `(${resized.width}x${resized.height} @ q${resized.quality}) -- fits: ${fits}, re-decodes: ${decodes}`,
    );
  }
}

console.log(ok ? "PASS: real over-limit JPEG downscales to a real, decodable image under the limit" : "FAIL");
process.exitCode = ok ? 0 : 1;
