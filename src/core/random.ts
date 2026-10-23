/**
 * Randomness and comparisons via Web Crypto (`globalThis.crypto`), available in
 * Node ≥ 20 and every browser/WebView — including non-secure (HTTP) contexts.
 */
import { LIMITS, ROOM_CODE_ALPHABET } from '../shared/constants';

function bytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}

/** URL-safe base64 token (default 24 bytes = 192 bits). */
export function randomToken(n = 24): string {
  let bin = '';
  for (const x of bytes(n)) bin += String.fromCharCode(x);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Unbiased integer in [0, max) by rejection sampling. */
export function randomInt(max: number): number {
  if (!Number.isInteger(max) || max <= 0 || max > 256) throw new RangeError('max must be 1..256');
  const limit = 256 - (256 % max);
  for (;;) {
    const v = bytes(1)[0]!;
    if (v < limit) return v % max;
  }
}

export function randomRoomCode(): string {
  let code = '';
  for (let i = 0; i < LIMITS.roomCodeLength; i++) code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  return code;
}

/** RFC 4122 v4 UUID (does not require a secure context, unlike crypto.randomUUID). */
export function uuid(): string {
  const b = bytes(16);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Constant-time string comparison (length is not secret). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
