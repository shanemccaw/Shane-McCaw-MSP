#!/usr/bin/env node
// Real self-check for src/core/image-resize.mjs (Git #3262). Builds a real, large, genuinely
// noisy JPEG in-process (noise resists compression, so it reliably lands over 5MB at high
// resolution -- a flat-color image would compress to nothing and prove nothing), runs it
// through downscaleJpegToFit the same way get_capture_photo does, and asserts the result
// actually fits under the limit and actually decodes back to a real image.

import jpeg from "jpeg-js";
import { downscaleJpegToFit } from "../src/core/image-resize.mjs";

const MAX_INLINE_IMAGE_BYTES = 5 * 1024 * 1024;

function buildNoisyJpeg(width, height) {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = Math.floor(Math.random() * 256);
    data[i + 1] = Math.floor(Math.random() * 256);
    data[i + 2] = Math.floor(Math.random() * 256);
    data[i + 3] = 255;
  }
  return jpeg.encode({ data, width, height }, 90).data;
}

const original = buildNoisyJpeg(2400, 2400);
console.log(`Built a real synthetic JPEG: ${(original.length / (1024 * 1024)).toFixed(2)}MB`);

let ok = original.length > MAX_INLINE_IMAGE_BYTES;
if (!ok) {
  console.log("FAIL: synthetic fixture wasn't actually over the limit -- test proves nothing");
  process.exitCode = 1;
} else {
  const resized = downscaleJpegToFit(original, "image/jpeg", MAX_INLINE_IMAGE_BYTES);
  if (!resized) {
    console.log("FAIL: downscaleJpegToFit returned null for a real over-limit JPEG");
    process.exitCode = 1;
  } else {
    const fits = resized.bytes.length <= MAX_INLINE_IMAGE_BYTES;
    let decodes = false;
    try {
      const redecoded = jpeg.decode(resized.bytes, { useTArray: true });
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
