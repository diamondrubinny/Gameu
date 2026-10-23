import QRCode from 'qrcode';
import type { ServerToHost } from '../shared/protocol';
import type { Room } from './room';

/** Builds the join info shown on the TV (QR code points phones at the first LAN address). */
export async function buildRoomInfo(room: Room, lanIps: string[], port: number): Promise<Extract<ServerToHost, { type: 'room' }>> {
  const host = lanIps[0] ?? 'localhost';
  const joinUrl = `http://${host}:${port}/c?r=${room.code}`;
  const qrSvg = await QRCode.toString(joinUrl, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } });
  return { type: 'room', code: room.code, urls: lanIps.map((ip) => `http://${ip}:${port}/c`), joinUrl, qrSvg, locked: room.locked };
}
