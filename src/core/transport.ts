/** A text-message connection (WebSocket in Node, native socket bridge on Android TV). */
export interface TextTransport {
  send(text: string): void;
  close(code: number, reason: string): void;
}
