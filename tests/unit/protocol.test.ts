import { describe, expect, it } from 'vitest';
import { ControllerLayoutSchema, ControllerToServerSchema, GameManifestSchema, HostToServerSchema, InputSchema, NicknameSchema, RoomCodeSchema } from '../../src/shared/protocol';

describe('NicknameSchema', () => {
  it('trims, collapses whitespace and accepts Hebrew/emoji', () => {
    expect(NicknameSchema.parse('  דני   הגדול ')).toBe('דני הגדול');
    expect(NicknameSchema.parse('Maya 🦄')).toBe('Maya 🦄');
  });
  it('rejects empty, too long, markup and control characters', () => {
    for (const bad of ['', '   ', 'x'.repeat(17), '<script>', 'a\u0000b', 'a‮b']) {
      expect(NicknameSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('RoomCodeSchema', () => {
  it('uppercases and validates the alphabet', () => {
    expect(RoomCodeSchema.parse(' abcd ')).toBe('ABCD');
    expect(RoomCodeSchema.safeParse('AB0D').success).toBe(false); // 0 is excluded
    expect(RoomCodeSchema.safeParse('ABCDE').success).toBe(false);
  });
});

describe('InputSchema', () => {
  it('accepts valid inputs', () => {
    expect(InputSchema.safeParse({ kind: 'button', id: 'up', pressed: true }).success).toBe(true);
    expect(InputSchema.safeParse({ kind: 'stick', id: 'stick', x: -1, y: 0.5 }).success).toBe(true);
    expect(InputSchema.safeParse({ kind: 'choice', id: 'answer', index: 3 }).success).toBe(true);
    expect(InputSchema.safeParse({ kind: 'draw', id: 'c', stroke: 1, color: 0, size: 2, points: [[0, 0], [1, 1]] }).success).toBe(true);
  });
  it('rejects out-of-range and oversized inputs', () => {
    expect(InputSchema.safeParse({ kind: 'stick', id: 'stick', x: 2, y: 0 }).success).toBe(false);
    expect(InputSchema.safeParse({ kind: 'button', id: 'bad id!', pressed: true }).success).toBe(false);
    expect(InputSchema.safeParse({ kind: 'text', id: 't', value: 'x'.repeat(121) }).success).toBe(false);
    const points = Array.from({ length: 65 }, () => [0.5, 0.5]);
    expect(InputSchema.safeParse({ kind: 'draw', id: 'c', stroke: 1, color: 0, size: 2, points }).success).toBe(false);
    expect(InputSchema.safeParse({ kind: 'eval', code: 'x' }).success).toBe(false);
  });
});

describe('messages', () => {
  it('parses a controller join', () => {
    const r = ControllerToServerSchema.safeParse({ type: 'join', room: 'abcd', nickname: ' Noa ', avatar: 3 });
    expect(r.success && r.data.type === 'join' && r.data.room).toBe('ABCD');
  });
  it('rejects unknown host message types and bad secrets', () => {
    expect(HostToServerSchema.safeParse({ type: 'shutdown' }).success).toBe(false);
    expect(HostToServerSchema.safeParse({ type: 'auth', secret: 'short' }).success).toBe(false);
  });
  it('validates layouts', () => {
    expect(ControllerLayoutSchema.safeParse({ type: 'choices', id: 'a', options: ['only one'] }).success).toBe(false);
    expect(ControllerLayoutSchema.parse({ type: 'dpad' })).toEqual({ type: 'dpad', buttons: [] });
    expect(ControllerLayoutSchema.safeParse({ type: 'draw', id: 'c', colors: ['red'] }).success).toBe(false);
  });
});

describe('GameManifestSchema', () => {
  it('rejects path traversal in entry/icon', () => {
    const base = { id: 'x', version: '1.0.0', name: { he: 'א', en: 'a' }, description: { he: 'א', en: 'a' }, minPlayers: 1, maxPlayers: 2, controller: 'dpad' };
    expect(GameManifestSchema.safeParse({ ...base, entry: '../../etc/passwd.html' }).success).toBe(false);
    expect(GameManifestSchema.safeParse({ ...base, icon: '../x.svg' }).success).toBe(false);
    expect(GameManifestSchema.parse(base).entry).toBe('index.html');
  });
});
