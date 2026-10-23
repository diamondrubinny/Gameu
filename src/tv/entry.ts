import { HostApp } from '../host/main';
import { NativeBridge } from './bridge';
import { TvHostPlatform } from './tv-platform';

const bridge = new NativeBridge();
const platform = new TvHostPlatform(bridge);
const app = new HostApp(platform);

// Remote Back key: the app asks the page first; exit only when there is nothing to go back to.
bridge.onMessage((msg) => {
  if (msg.t === 'back' && !app.handleBack()) bridge.post({ t: 'exit' });
});

void app.start();

// Debug/automation hook (no secrets): lets tests reach the in-process room.
(window as unknown as { gameuTv: unknown }).gameuTv = { platform, app };
