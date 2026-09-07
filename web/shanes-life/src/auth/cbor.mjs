// A minimal CBOR (RFC 8949) decoder -- exactly enough to read the two structures WebAuthn puts
// on the wire, and nothing more:
//
//   1. the attestationObject a browser returns from navigator.credentials.create(), a map of
//      { fmt: text, attStmt: map, authData: bytes };
//   2. the COSE_Key embedded in that authData, a map whose keys are small negative and positive
//      integers.
//
// Written by hand rather than pulled from npm on purpose. This app carries exactly one runtime
// dependency (pg), and CLAUDE.md makes bandwidth a real, stated constraint on this project --
// a CBOR package plus its tree is a download to justify, and this is ~120 lines of a spec that
// has not changed since 2013.
//
// Deliberately strict: anything it does not understand throws rather than guessing. A decoder
// that silently returns a partial structure for a malformed attestation is a security bug.

class CborError extends Error {}

function readLength(buf, offset, info) {
  if (info < 24) return [info, offset];
  if (info === 24) return [buf.readUInt8(offset), offset + 1];
  if (info === 25) return [buf.readUInt16BE(offset), offset + 2];
  if (info === 26) return [buf.readUInt32BE(offset), offset + 4];
  if (info === 27) {
    const value = buf.readBigUInt64BE(offset);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new CborError("length out of range");
    return [Number(value), offset + 8];
  }
  throw new CborError(`unsupported additional information ${info}`);
}

function decodeItem(buf, offset) {
  if (offset >= buf.length) throw new CborError("truncated CBOR");
  const initial = buf.readUInt8(offset);
  const major = initial >> 5;
  const info = initial & 0x1f;
  let pos = offset + 1;

  switch (major) {
    case 0: {
      // unsigned integer
      const [value, next] = readLength(buf, pos, info);
      return [value, next];
    }
    case 1: {
      // negative integer: encoded as -1 - n
      const [value, next] = readLength(buf, pos, info);
      return [-1 - value, next];
    }
    case 2: {
      // byte string
      if (info === 31) throw new CborError("indefinite-length byte strings are not supported");
      const [length, next] = readLength(buf, pos, info);
      if (next + length > buf.length) throw new CborError("truncated byte string");
      return [buf.subarray(next, next + length), next + length];
    }
    case 3: {
      // text string
      if (info === 31) throw new CborError("indefinite-length text strings are not supported");
      const [length, next] = readLength(buf, pos, info);
      if (next + length > buf.length) throw new CborError("truncated text string");
      return [buf.subarray(next, next + length).toString("utf8"), next + length];
    }
    case 4: {
      // array
      if (info === 31) throw new CborError("indefinite-length arrays are not supported");
      const [count, next] = readLength(buf, pos, info);
      pos = next;
      const out = [];
      for (let i = 0; i < count; i++) {
        const [item, after] = decodeItem(buf, pos);
        out.push(item);
        pos = after;
      }
      return [out, pos];
    }
    case 5: {
      // map. A Map, not an object: COSE keys are integers, and -1/-2/-3 would collide with
      // string keys the moment anything coerced them.
      if (info === 31) throw new CborError("indefinite-length maps are not supported");
      const [count, next] = readLength(buf, pos, info);
      pos = next;
      const out = new Map();
      for (let i = 0; i < count; i++) {
        const [key, afterKey] = decodeItem(buf, pos);
        const [value, afterValue] = decodeItem(buf, afterKey);
        out.set(key, value);
        pos = afterValue;
      }
      return [out, pos];
    }
    case 6: {
      // semantic tag -- decode and hand back what it wraps.
      const [, next] = readLength(buf, pos, info);
      return decodeItem(buf, next);
    }
    case 7: {
      if (info === 20) return [false, pos];
      if (info === 21) return [true, pos];
      if (info === 22) return [null, pos];
      if (info === 23) return [undefined, pos];
      if (info === 25) throw new CborError("half-precision floats are not supported");
      if (info === 26) return [buf.readFloatBE(pos), pos + 4];
      if (info === 27) return [buf.readDoubleBE(pos), pos + 8];
      throw new CborError(`unsupported simple value ${info}`);
    }
    default:
      throw new CborError(`unsupported major type ${major}`);
  }
}

/** Decode the single CBOR item at the start of buf. Trailing bytes are an error. */
export function cborDecode(buf) {
  const [value, offset] = decodeItem(Buffer.from(buf), 0);
  if (offset !== buf.length) {
    throw new CborError(`${buf.length - offset} trailing byte(s) after the CBOR item`);
  }
  return value;
}

/**
 * Decode the first CBOR item and report where it ended. The COSE key inside authData is followed
 * by optional extension data, so its length is only knowable by decoding it.
 */
export function cborDecodeFirst(buf) {
  const [value, offset] = decodeItem(Buffer.from(buf), 0);
  return { value, bytesRead: offset };
}
