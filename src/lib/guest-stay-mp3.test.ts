import { guestStayMpegLooksValid } from "./guest-stay-mp3";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const MPEG = new Uint8Array([0xff, 0xfb, 0x90, 0x00]);

function id3Then(payload: Uint8Array, tagBytes = 10) {
  const out = new Uint8Array(tagBytes + payload.length);
  out[0] = 0x49;
  out[1] = 0x44;
  out[2] = 0x33;
  out[3] = 0x03;
  out.set(payload, tagBytes);
  return out;
}

export function runGuestStayMp3Tests() {
  assert(guestStayMpegLooksValid(MPEG), "valid MPEG frame without ID3 accepted");
  assert(guestStayMpegLooksValid(id3Then(MPEG)), "valid ID3 + MPEG frame accepted");
  assert(!guestStayMpegLooksValid(id3Then(new Uint8Array(0))), "ID3 without MPEG frame rejected");
  assert(!guestStayMpegLooksValid(new Uint8Array([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])), "ID3 header alone rejected");
  assert(!guestStayMpegLooksValid(new Uint8Array()), "empty rejected");
  assert(!guestStayMpegLooksValid(new Uint8Array([0xff, 0xfb])), "truncated header rejected");
  assert(!guestStayMpegLooksValid(new TextEncoder().encode('{"ok":true}')), "JSON rejected");
  assert(!guestStayMpegLooksValid(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45])), "PCM/WAV prefix rejected");
  assert(!guestStayMpegLooksValid(new Uint8Array(32)), "random zeros rejected");
  assert(!guestStayMpegLooksValid(new Uint8Array([0xff, 0x00, 0x00, 0x00])), "sync without layer/bitrate rejected");
}

const isDirectRun = process.argv[1]?.includes("guest-stay-mp3.test");
if (isDirectRun) {
  try {
    runGuestStayMp3Tests();
    console.log("guest-stay-mp3 tests passed");
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : "guest-stay-mp3 tests failed");
    process.exitCode = 1;
  }
}
