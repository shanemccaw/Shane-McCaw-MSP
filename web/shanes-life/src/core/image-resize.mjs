// Real server-side JPEG downscale, closing the gap #3262 found in get_capture_photo (Git #3261's
// own follow-up): a photo over MAX_INLINE_IMAGE_BYTES used to just get an honest "too big" error,
// with no path to actually shrink it. There is no reasonable path to that WITHOUT decoding real
// JPEG bytes (chroma subsampling, DCT, Huffman coding) -- unlike bin/make-icons.mjs's hand-rolled
// PNG *encoder* (drawing flat-shaded pixels forward, no decode needed) or webpush.mjs's hand-rolled
// RFC 8291 crypto (well-specified primitives already in node:crypto), a correct JPEG codec from
// scratch is a real multi-hundred-line undertaking with high risk of silently corrupting exactly
// the photos this tool exists to let Claude actually see. `jpeg-js` is the one exception carved
// out of this app's "one runtime dependency (pg)" rule for that reason: pure JS (no native
// binary, no compiled download, no platform-specific binary to fetch), zero transitive
// dependencies of its own, decode+encode only -- the resize math itself (nearest-neighbor
// downsample) is still hand-written right here, same as everywhere else in this app.

import jpeg from "jpeg-js";

const MIN_DIMENSION = 480;
const MIN_QUALITY = 25;

/** Nearest-neighbor downsample of a decoded RGBA buffer -- deliberately simple; this is a
 * downscale for an AI vision read, not a print job. */
function resizeRgba(data, srcW, srcH, dstW, dstH) {
  const out = Buffer.alloc(dstW * dstH * 4);
  for (let y = 0; y < dstH; y++) {
    const srcY = Math.min(srcH - 1, Math.floor((y * srcH) / dstH));
    for (let x = 0; x < dstW; x++) {
      const srcX = Math.min(srcW - 1, Math.floor((x * srcW) / dstW));
      const srcIdx = (srcY * srcW + srcX) * 4;
      const dstIdx = (y * dstW + x) * 4;
      out[dstIdx] = data[srcIdx];
      out[dstIdx + 1] = data[srcIdx + 1];
      out[dstIdx + 2] = data[srcIdx + 2];
      out[dstIdx + 3] = data[srcIdx + 3];
    }
  }
  return out;
}

/**
 * Downscale a real JPEG buffer until it fits under maxBytes, by shrinking dimensions and/or
 * dropping encode quality. Returns { bytes, mimeType, width, height, quality } on success, or
 * null if the format isn't a JPEG we can decode, or if we hit the size/quality floor and still
 * can't get under budget (genuinely too large/detailed to shrink further at a sane resolution).
 */
export function downscaleJpegToFit(originalBytes, mimeType, maxBytes) {
  if (mimeType !== "image/jpeg") return null;

  let decoded;
  try {
    decoded = jpeg.decode(originalBytes, { useTArray: true, maxResolutionInMP: 100 });
  } catch {
    return null;
  }

  let { width, height, data } = decoded;
  let quality = 82;

  for (let attempt = 0; attempt < 12; attempt++) {
    const resized = width === decoded.width && height === decoded.height
      ? data
      : resizeRgba(decoded.data, decoded.width, decoded.height, width, height);

    let encoded;
    try {
      encoded = jpeg.encode({ data: resized, width, height }, quality);
    } catch {
      return null;
    }

    if (encoded.data.length <= maxBytes) {
      return { bytes: encoded.data, mimeType: "image/jpeg", width, height, quality };
    }

    if (quality > MIN_QUALITY) {
      quality = Math.max(MIN_QUALITY, quality - 15);
    } else if (width > MIN_DIMENSION && height > MIN_DIMENSION) {
      width = Math.max(MIN_DIMENSION, Math.round(width * 0.75));
      height = Math.max(MIN_DIMENSION, Math.round(height * 0.75));
      quality = 82;
    } else {
      return null;
    }
  }

  return null;
}
