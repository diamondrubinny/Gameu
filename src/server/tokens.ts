import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { LIMITS, ROOM_CODE_ALPHABET } from '../shared/protocol';

export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString('base64url');
}

export function randomRoomCode(): string {
  let code = '';
  for (let i = 0; i < LIMITS.roomCodeLength; i++) code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  return code;
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
