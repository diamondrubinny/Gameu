/**
 * Messages between the TV page and the Android app (androidx.webkit WebMessageListener).
 * The native object `gameuNative` is injected only into the console's own origin —
 * sandboxed game iframes (opaque origin) never see it.
 */
export type NativeToJs =
  | { t: 'info'; lanIps: string[]; port: number; version: string; serverError?: string }
  | { t: 'back' }
  // Phone sockets (native server → page)
  | { t: 'open'; id: number; ip: string }
  | { t: 'msg'; id: number; data: string }
  | { t: 'bad'; id: number }
  | { t: 'closed'; id: number };

export type JsToNative =
  | { t: 'hello' }
  | { t: 'exit' }
  // Phone sockets (page → native server)
  | { t: 'send'; id: number; data: string }
  | { t: 'close'; id: number; code: number; reason: string };

interface NativeObject {
  postMessage(message: string): void;
  addEventListener(type: 'message', listener: (event: { data: string }) => void): void;
}

declare global {
  interface Window {
    gameuNative?: NativeObject;
  }
}

export class NativeBridge {
  private readonly listeners: ((msg: NativeToJs) => void)[] = [];

  constructor(private readonly native: NativeObject | undefined = window.gameuNative) {
    native?.addEventListener('message', (event) => {
      let msg: NativeToJs;
      try {
        msg = JSON.parse(event.data) as NativeToJs;
      } catch {
        return;
      }
      for (const l of this.listeners) l(msg);
    });
  }

  get available(): boolean {
    return !!this.native;
  }

  onMessage(listener: (msg: NativeToJs) => void): void {
    this.listeners.push(listener);
  }

  post(msg: JsToNative): void {
    this.native?.postMessage(JSON.stringify(msg));
  }
}
