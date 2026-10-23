/**
 * Messages between the TV page and the Android app (androidx.webkit WebMessageListener).
 * The native object `gameuNative` is injected only into the console's own origin —
 * sandboxed game iframes (opaque origin) never see it.
 */
export type NativeToJs =
  | { t: 'info'; lanIps: string[]; port: number; version: string }
  | { t: 'back' };

export type JsToNative = { t: 'hello' } | { t: 'exit' };

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
