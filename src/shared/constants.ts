/** Runtime constants with no dependencies (safe to bundle into the phone controller and games). */

export const LIMITS = {
  maxPlayers: 8,
  maxMessageBytes: 8 * 1024,
  nicknameMax: 16,
  textMax: 120,
  avatarCount: 12,
  roomCodeLength: 4,
  drawPointsPerMessage: 64,
  hapticSteps: 10,
} as const;

/** No ambiguous characters (0/O, 1/I). 32^4 ≈ 1M combinations. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const AVATARS = ['🦊', '🐼', '🐸', '🐙', '🦁', '🐵', '🐧', '🦄', '🐢', '🐝', '🐳', '🐯'] as const;
export const AVATAR_NAMES_HE = ['שועל', 'פנדה', 'צפרדע', 'תמנון', 'אריה', 'קוף', 'פינגווין', 'חד־קרן', 'צב', 'דבורה', 'לווייתן', 'נמר'] as const;
export const AVATAR_NAMES_EN = ['Fox', 'Panda', 'Frog', 'Octopus', 'Lion', 'Monkey', 'Penguin', 'Unicorn', 'Turtle', 'Bee', 'Whale', 'Tiger'] as const;
export const PLAYER_COLORS = ['#ff7a1a', '#e6e6e6', '#3ddc84', '#c77dff', '#ffd23f', '#a0522d', '#4cc9f0', '#ff4fa3', '#2ec4b6', '#f9c74f', '#4361ee', '#f3722c'] as const;

export function colorFor(avatar: number): string {
  return PLAYER_COLORS[avatar % PLAYER_COLORS.length] ?? '#ffffff';
}
