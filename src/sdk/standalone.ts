/** Global build for third-party games: <script src="/sdk/gameu.js"></script> then `window.Gameu`. */
import { createSdk } from './gameu';

declare global {
  interface Window {
    Gameu: ReturnType<typeof createSdk>;
  }
}

window.Gameu = createSdk();
