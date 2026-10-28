/**
 * Wire protocol shared by the server, the TV host, the phone controller and games.
 * Every message crossing a trust boundary is validated with these schemas.
 */
import * as z from 'zod';

import { LIMITS } from './constants';

export * from './constants';

// ---------- primitives ----------

/** Rejects control/format characters and angle brackets; output is still rendered as text only. */
const SAFE_TEXT = /^[^\p{Cc}\p{Cf}\p{Co}<>]*$/u;

export const RoomCodeSchema = z
  .string()
  .transform((s) => s.trim().toUpperCase())
  .pipe(z.string().length(LIMITS.roomCodeLength).regex(/^[A-HJ-NP-Z2-9]+$/));

export const NicknameSchema = z
  .string()
  .transform((s) => s.normalize('NFC').replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(1).max(LIMITS.nicknameMax).regex(SAFE_TEXT));

export const SafeTextSchema = (max: number) =>
  z
    .string()
    .transform((s) => s.normalize('NFC').replace(/\s+/g, ' ').trim())
    .pipe(z.string().max(max).regex(SAFE_TEXT));

const ControlId = z.string().regex(/^[a-z0-9_-]{1,16}$/i);
const Unit = z.number().min(0).max(1);
const Axis = z.number().min(-1).max(1);
const AvatarSchema = z.number().int().min(0).max(LIMITS.avatarCount - 1);
const Token = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);
const PlayerId = z.string().regex(/^[A-Za-z0-9-]{8,64}$/);
const Label = z.string().min(1).max(24);
const HexColor = z.string().regex(/^#[0-9a-f]{6}$/i);

// ---------- controller input ----------

export const InputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('button'), id: ControlId, pressed: z.boolean() }),
  z.object({ kind: z.literal('stick'), id: ControlId, x: Axis, y: Axis }),
  z.object({ kind: z.literal('choice'), id: ControlId, index: z.number().int().min(0).max(9) }),
  z.object({ kind: z.literal('text'), id: ControlId, value: SafeTextSchema(LIMITS.textMax) }),
  z.object({
    kind: z.literal('draw'),
    id: ControlId,
    stroke: z.number().int().min(0).max(1_000_000),
    color: z.number().int().min(0).max(15),
    size: z.number().int().min(1).max(5),
    points: z.array(z.tuple([Unit, Unit])).min(1).max(LIMITS.drawPointsPerMessage),
  }),
]);
export type Input = z.infer<typeof InputSchema>;

// ---------- controller layouts (what the phone shows) ----------

const ButtonDef = z.object({
  id: ControlId,
  label: Label,
  aria: z.string().max(60).optional(),
  color: z.enum(['primary', 'secondary', 'danger', 'success']).optional(),
});
export type ButtonDef = z.infer<typeof ButtonDef>;

export const ControllerLayoutSchema = z.discriminatedUnion('type', [
  /** Console navigation: d-pad + OK/Back (+ Home for the admin). */
  z.object({ type: z.literal('menu'), title: z.string().max(60).optional() }),
  z.object({ type: z.literal('dpad'), title: z.string().max(60).optional(), buttons: z.array(ButtonDef).max(4).default([]) }),
  z.object({ type: z.literal('joystick'), title: z.string().max(60).optional(), buttons: z.array(ButtonDef).max(4).default([]) }),
  z.object({
    type: z.literal('choices'),
    id: ControlId,
    prompt: z.string().max(200).optional(),
    options: z.array(z.string().min(1).max(80)).min(2).max(6),
  }),
  z.object({
    type: z.literal('text'),
    id: ControlId,
    prompt: z.string().max(200),
    maxLength: z.number().int().min(1).max(LIMITS.textMax).default(LIMITS.textMax),
    placeholder: z.string().max(60).optional(),
  }),
  z.object({
    type: z.literal('draw'),
    id: ControlId,
    prompt: z.string().max(200).optional(),
    colors: z.array(HexColor).min(1).max(8),
  }),
  z.object({ type: z.literal('message'), text: z.string().max(200), subtext: z.string().max(200).optional() }),
]);
export type ControllerLayout = z.input<typeof ControllerLayoutSchema>;
export type ParsedLayout = z.output<typeof ControllerLayoutSchema>;

const HapticPattern = z.array(z.number().int().min(0).max(1000)).min(1).max(LIMITS.hapticSteps);

// ---------- controller <-> server ----------

export const ControllerToServerSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('join'),
    room: RoomCodeSchema,
    nickname: NicknameSchema,
    avatar: AvatarSchema,
    reconnectToken: Token.optional(),
  }),
  z.object({ type: z.literal('input'), input: InputSchema }),
  z.object({ type: z.literal('ping'), t: z.number() }),
]);
export type ControllerToServer = z.input<typeof ControllerToServerSchema>;
export type ControllerToServerMsg = z.output<typeof ControllerToServerSchema>;

export type ErrorCode =
  | 'bad_room'
  | 'room_full'
  | 'room_locked'
  | 'invalid'
  | 'rate_limited'
  | 'kicked'
  | 'not_joined'
  | 'replaced';

export type ServerToController =
  | { type: 'welcome'; playerId: string; reconnectToken: string; nickname: string; avatar: number; isAdmin: boolean }
  | { type: 'layout'; layout: ParsedLayout }
  | { type: 'haptic'; pattern: number[] }
  | { type: 'admin'; isAdmin: boolean }
  | { type: 'host_status'; online: boolean }
  | { type: 'error'; code: ErrorCode }
  | { type: 'pong'; t: number };

// ---------- host <-> server ----------

const Target = z.union([z.literal('all'), PlayerId]);

export const HostToServerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('auth'), secret: Token }),
  z.object({ type: z.literal('layout'), target: Target, layout: ControllerLayoutSchema }),
  z.object({ type: z.literal('haptic'), target: Target, pattern: HapticPattern }),
  z.object({ type: z.literal('kick'), playerId: PlayerId }),
  z.object({ type: z.literal('lock'), locked: z.boolean() }),
  z.object({ type: z.literal('new_code') }),
]);
export type HostToServer = z.input<typeof HostToServerSchema>;
export type HostToServerMsg = z.output<typeof HostToServerSchema>;

export interface PlayerInfo {
  id: string;
  nickname: string;
  avatar: number;
  isAdmin: boolean;
  connected: boolean;
}

export type ServerToHost =
  | { type: 'room'; code: string; urls: string[]; joinUrl: string; qrSvg: string; locked: boolean }
  | { type: 'players'; players: PlayerInfo[] }
  | { type: 'input'; playerId: string; input: Input }
  | { type: 'error'; code: 'unauthorized' | 'invalid' | 'replaced' };

// ---------- game manifest ----------

const Localized = z.object({ he: z.string().min(1).max(80), en: z.string().min(1).max(80) });
const LocalizedLong = z.object({ he: z.string().min(1).max(300), en: z.string().min(1).max(300) });

export const GameManifestSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,32}$/),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  name: Localized,
  description: LocalizedLong,
  minPlayers: z.number().int().min(1).max(LIMITS.maxPlayers),
  maxPlayers: z.number().int().min(1).max(LIMITS.maxPlayers),
  entry: z.string().regex(/^[a-z0-9_-]+\.html$/i).default('index.html'),
  icon: z.string().regex(/^[a-z0-9_-]+\.svg$/i).optional(),
  controller: z.enum(['dpad', 'joystick', 'choices', 'text', 'draw', 'mixed']),
  accessibility: z
    .object({
      colorIndependent: z.boolean().default(false),
      extendedTime: z.boolean().default(false),
      noFlashing: z.boolean().default(true),
    })
    .default({ colorIndependent: false, extendedTime: false, noFlashing: true }),
});
export type GameManifest = z.output<typeof GameManifestSchema>;

// ---------- console settings ----------

export const SettingsSchema = z.object({
  language: z.enum(['he', 'en']).default('he'),
  textScale: z.number().min(1).max(2).default(1),
  highContrast: z.boolean().default(false),
  reduceMotion: z.boolean().default(false),
  extendedTime: z.boolean().default(false),
  volume: z.number().min(0).max(1).default(0.7),
});
export type Settings = z.output<typeof SettingsSchema>;
export const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({});

// ---------- host <-> game iframe (postMessage) ----------

export const GameToHostSchema = z.discriminatedUnion('type', [
  z.object({ gameu: z.literal(1), type: z.literal('ready') }),
  z.object({ gameu: z.literal(1), type: z.literal('layout'), target: Target, layout: ControllerLayoutSchema }),
  z.object({ gameu: z.literal(1), type: z.literal('haptic'), target: Target, pattern: HapticPattern }),
  z.object({
    gameu: z.literal(1),
    type: z.literal('end'),
    results: z.array(z.object({ playerId: PlayerId, score: z.number().int().min(-1_000_000).max(1_000_000) })).max(LIMITS.maxPlayers),
  }),
]);
export type GameToHost = z.input<typeof GameToHostSchema>;
export type GameToHostMsg = z.output<typeof GameToHostSchema>;

export interface GamePlayer {
  id: string;
  nickname: string;
  avatar: number;
  color: string;
  connected: boolean;
  /** The room admin (controls menus); games may give them setup controls. */
  isAdmin: boolean;
}

export type HostToGame =
  | { gameu: 1; type: 'init'; players: GamePlayer[]; settings: Settings }
  | { gameu: 1; type: 'players'; players: GamePlayer[] }
  | { gameu: 1; type: 'input'; playerId: string; input: Input };
