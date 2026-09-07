export const GUEST_STAY_MP3_SCAN_MAX = 8192;

function isMpegAudioFrameAt(bytes: Uint8Array, index: number) {
  if (index + 3 >= bytes.length) return false;
  const b0 = bytes[index]!;
  const b1 = bytes[index + 1]!;
  const b2 = bytes[index + 2]!;
  if (b0 !== 0xff) return false;
  if ((b1 & 0xe0) !== 0xe0) return false;
  const version = (b1 >> 3) & 0x03;
  if (version === 0x01) return false;
  const layer = (b1 >> 1) & 0x03;
  if (layer === 0x00) return false;
  const bitrate = (b2 >> 4) & 0x0f;
  if (bitrate === 0x00 || bitrate === 0x0f) return false;
  const sample = (b2 >> 2) & 0x03;
  if (sample === 0x03) return false;
  return true;
}

function id3v2PayloadOffset(bytes: Uint8Array) {
  if (bytes.length < 10) return 0;
  if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return 0;
  const size0 = bytes[6]!;
  const size1 = bytes[7]!;
  const size2 = bytes[8]!;
  const size3 = bytes[9]!;
  if (size0 > 0x7f || size1 > 0x7f || size2 > 0x7f || size3 > 0x7f) return 10;
  const size = (size0 << 21) | (size1 << 14) | (size2 << 7) | size3;
  const footer = (bytes[5]! & 0x10) !== 0 ? 10 : 0;
  const end = 10 + size + footer;
  if (!Number.isFinite(end) || end < 10) return 10;
  return Math.min(end, bytes.length);
}

export function guestStayMpegLooksValid(bytes: Uint8Array, scanMax = GUEST_STAY_MP3_SCAN_MAX) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 4) return false;
  const view = bytes.byteLength > scanMax ? bytes.subarray(0, scanMax) : bytes;
  const start = id3v2PayloadOffset(view);
  for (let index = start; index <= view.length - 4; index += 1) {
    if (isMpegAudioFrameAt(view, index)) return true;
  }
  return false;
}

export async function guestStayBlobMpegLooksValid(blob: Blob, scanMax = GUEST_STAY_MP3_SCAN_MAX) {
  if (!blob || blob.size < 4) return false;
  try {
    const prefix = blob.slice(0, Math.min(scanMax, blob.size));
    const buffer = await prefix.arrayBuffer();
    return guestStayMpegLooksValid(new Uint8Array(buffer), scanMax);
  } catch {
    return false;
  }
}
