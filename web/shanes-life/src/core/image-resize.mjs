// Real server-side image downscale, closing the gap #3262 found in get_capture_photo (Git
// #3261's own follow-up): a photo over MAX_INLINE_IMAGE_BYTES used to just get an honest
// "too big" error, with no path to actually shrink it.
//
// This is a deliberate, explicit exception to this app's "one runtime dependency (`pg`)"
// rule -- Shane's own call on #3262, not a silent one: "Accepting the break from the
// single-runtime-dependency stance for this -- a real, proper image-resize library beats
// hand-rolling pure-JS JPEG re-encoding. Add `sharp`... document why in README.md's own
// dependency list." `sharp` (libvips under the hood) decodes JPEG/PNG/WEBP/HEIC/HEIF alike --
// every mime type media.mjs's ALLOWED set accepts for a photo -- and re-encodes as JPEG, which
// is what actually gets this under Anthropic's inline-image limit for a real phone photo.

import sharp from "sharp";

const MIN_DIMENSION = 480;
const QUALITY_STEPS = [80, 65, 50, 35, 25];
const MAX_RESIZE_PASSES = 8;

/**
 * Downscale a real image buffer (any mime type sharp/libvips can decode) until it fits under
 * maxBytes, by shrinking dimensions and/or dropping JPEG encode quality. Returns
 * { bytes, mimeType: "image/jpeg", width, height, quality } on success, or null if the bytes
 * can't be decoded at all, or we hit the size/quality floor and still can't get under budget
 * (genuinely too large/detailed to shrink further at a sane resolution).
 */
export async function downscaleImageToFit(originalBytes, maxBytes) {
  let meta;
  try {
    meta = await sharp(originalBytes, { failOn: "none" }).metadata();
  } catch {
    return null;
  }
  if (!meta.width || !meta.height) return null;

  let width = meta.width;
  let height = meta.height;

  for (let pass = 0; pass < MAX_RESIZE_PASSES; pass++) {
    for (const quality of QUALITY_STEPS) {
      let out;
      try {
        out = await sharp(originalBytes, { failOn: "none" })
          .resize({ width, height, fit: "inside", withoutEnlargement: true })
          .jpeg({ quality, mozjpeg: true })
          .toBuffer();
      } catch {
        return null;
      }

      if (out.length <= maxBytes) {
        const outMeta = await sharp(out).metadata();
        return { bytes: out, mimeType: "image/jpeg", width: outMeta.width, height: outMeta.height, quality };
      }
    }

    if (width <= MIN_DIMENSION && height <= MIN_DIMENSION) return null;
    width = Math.max(MIN_DIMENSION, Math.round(width * 0.75));
    height = Math.max(MIN_DIMENSION, Math.round(height * 0.75));
  }

  return null;
}
