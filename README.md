# Gameu 🎮

Turn any TV into a party game console that runs from a USB drive, with players' phones as controllers. No phone app needed; players just scan a QR code.

הופכים כל טלוויזיה לקונסולת משחקים שרצה מ־USB, והטלפונים של השחקנים הם השלטים. אין צורך להתקין אפליקציה: סורקים QR ומשחקים.

```
 USB ──► laptop / mini‑PC ──HDMI──► 📺 TV (Chromium kiosk)
                ▲
                │ Wi‑Fi (LAN, WebSocket)
         📱 📱 📱  phone controllers (browser, no install)
```

## Features (MVP)

- **6 languages**: Hebrew, English, Arabic, Russian, Spanish and French. The TV and each phone have their own language, so in trivia every player reads the question in their own language. See [docs/TRANSLATING.md](docs/TRANSLATING.md).
- **TV host**: a 10‑foot UI in any of the 6 languages (Hebrew and Arabic right‑to‑left), a QR code and room code, a player list, and a game menu you navigate from the admin's phone (👑).
- **Phone controller**: a d‑pad, joystick, answer buttons, text input or drawing canvas. The game decides what each phone shows. It also has vibration, left‑hand mode and automatic reconnect.
- **3 games**: Snakes (arcade, 1–8 players), Trivia Contest (1–8; 400 questions in 16 topics, Hebrew + English; see [docs/TRIVIA.md](docs/TRIVIA.md)) and Draw & Guess (2–8).
- **Game SDK**: games are sandboxed iframes (`sandbox="allow-scripts"`, opaque origin, `connect-src 'none'`). See [docs/GAME-SDK.md](docs/GAME-SDK.md).
- **Portable USB build** for Windows, macOS (Intel and Apple Silicon) and Linux (x64 and arm64, including Raspberry Pi 64‑bit).

## Quick start (development)

Requires Node.js ≥ 20.11.

```bash
npm install
npm run dev          # build + watch + auto-restart server on http://localhost:8080
```

Open `http://localhost:8080/` on the computer (this is the TV screen), then scan the QR code with a phone on the same Wi‑Fi.

| Command | What it does |
|---|---|
| `npm run build` | Production build into `dist/` |
| `npm start` | Run the built server (`dist/server/server.cjs`) |
| `npm run start:kiosk` | Run it and open the TV screen full‑screen in Chrome, Edge or Chromium |
| `npm run typecheck` | Strict TypeScript for the server, web and e2e code |
| `npm test` | Unit and integration tests (Vitest) |
| `npm run test:e2e` | End‑to‑end tests in real Chromium, including axe WCAG 2.1 AA checks (Playwright). Run `npm run build` first. |
| `npm run check` | Everything above |
| `npm run build:usb` | Build the portable USB folder at `release/usb/Gameu` |

## Make a USB drive

```bash
npm run build:usb                                  # all OS targets (~540 MB)
npm run build:usb -- --targets=win-x64,linux-x64   # only some targets
```

The script downloads official Node.js 22 LTS runtimes from nodejs.org and **verifies each one against the official SHA256SUMS** before copying it. Copy the whole `release/usb/Gameu` folder to the root of a USB drive (exFAT recommended). The folder includes `README.txt` with end‑user instructions in Hebrew and English, launchers for each OS, and `SHA256SUMS.txt`.

At runtime nothing is installed on the host computer. Settings and an isolated browser profile are stored in `Gameu/data` on the drive.

## Android TV / Google TV app

The console can also run as an app on the TV itself. The web UI and room logic run in a WebView, and Kotlin serves the assets and runs the phone server (Ktor). Phones connect straight to the TV; no computer is needed.

```bash
export ANDROID_HOME=~/android-sdk     # platforms;android-36 + build-tools;36.0.0, JDK 17+
npm run build:apk                     # → release/android/Gameu-debug.apk (unit tests + lint + build)
```

Signed release builds (APK + Google Play AAB): `npm run build:apk:release`. Signing is read from environment variables or `android/keystore.properties` (never committed); see [docs/ANDROID-RELEASE.md](docs/ANDROID-RELEASE.md). `npm run build:usb` also copies the APK into the USB folder (`Android-TV/`).

Install guide (Hebrew): [docs/ANDROID-TV-INSTALL.md](docs/ANDROID-TV-INSTALL.md). Plan and status: [docs/ANDROID-TV-PLAN.md](docs/ANDROID-TV-PLAN.md).

## Configuration

All environment variables are optional. See `.env.example`.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | HTTP/WebSocket port |
| `BIND_ADDRESS` | `0.0.0.0` | Interface to listen on |
| `GAMEU_HOST_KEY` | *(empty)* | Enables opening the TV screen from another device (for example a smart‑TV browser) at `/?key=…`. Minimum 16 characters. |
| `GAMEU_DATA_DIR` | `<app>/../data` | Settings and kiosk browser profile |
| `GAMEU_BROWSER` | auto | Path to a Chromium‑family browser for kiosk mode |
| `GAMEU_RECONNECT_GRACE_MS` | `120000` | How long a disconnected phone keeps its place (1000–600000) |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error` |

## Project structure

```
src/shared/      protocol (zod schemas) + dependency-free constants
src/server/      Node HTTP + WebSocket server: rooms, security, static files, kiosk launcher
src/host/        TV UI (spatial navigation, settings, game iframe bridge)
src/controller/  phone controller (join form, dynamic layouts)
src/sdk/         game SDK (+ standalone /sdk/gameu.js) and shared game helpers
src/public/      404 + legal drafts (privacy, accessibility statement)
games/<id>/      manifest.json, index.html, main.ts, style.css, icon.svg
scripts/         build.mjs, build-usb.mjs
tests/           unit, integration, e2e (Playwright + axe)
docs/            PLAN, SECURITY, GAME-SDK, PRODUCTION-CHECKLIST
```

## Security, privacy and accessibility

- Threat model and controls: [docs/SECURITY.md](docs/SECURITY.md)
- Pre‑production checklist (data map, trackers, legal and a11y review items): [docs/PRODUCTION-CHECKLIST.md](docs/PRODUCTION-CHECKLIST.md)
- No accounts, no cookies, no analytics, no outbound network calls at runtime.

The privacy policy and accessibility statement pages are **technical drafts** and need legal and accessibility review before public release.

## Troubleshooting

- **Phone can't connect**: the phone must be on the same network as the computer. Guest Wi‑Fi or "client isolation" on the router blocks device‑to‑device traffic. On Windows, allow Node.js on *Private networks* when the firewall asks.
- **The TV screen opens on the phone instead of the controller**: `/` redirects phones to `/c`. The TV screen only works on the console computer itself, unless `GAMEU_HOST_KEY` is set.
- **Port in use**: set `PORT=8090` (or another free port).
