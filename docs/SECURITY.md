# Security — Threat Model & Controls

Scope: Gameu runs on a home or private LAN. One computer (the "console") serves the TV screen and accepts phone controllers. It has no accounts, no database and no cloud.

## Assets
| Asset | Why it matters |
|---|---|
| Control of the TV screen (host channel) | Whoever holds it can set any phone's UI, kick players and change settings |
| Players' nicknames and inputs | Low‑sensitivity personal data; players may be minors |
| The console computer | Must not be exposed to code execution, file reads or CSRF from phones or websites |
| The USB drive contents | Integrity of the runtime and app |

## Entry points
| Endpoint | Who | Auth |
|---|---|---|
| `GET /` (TV screen) | console computer | loopback only (or `?key=` when `GAMEU_HOST_KEY` is set); phones are redirected to `/c` |
| `GET /api/host-session` | TV screen | loopback or `X-Gameu-Key`; returns a per-run random secret |
| `WS /ws/host` | TV screen | loopback/host-key at upgrade, then `auth` message with the secret within 5s |
| `PUT /api/settings` | TV screen | `X-Gameu-Host: <secret>` header + `application/json` (≤4 KB) |
| `GET /c`, `WS /ws/controller` | phones on LAN | room code (32⁴ ≈ 1M) via QR; reconnect token (192-bit) |
| `GET /api/games`, `/api/settings`, `/api/health`, static files | LAN | public, read-only, no secrets |

## Threats → controls
| Threat | Risk | Control (implemented) |
|---|---|---|
| Neighbour on the Wi‑Fi joins or takes over | Medium | Room code from QR, join‑failure limiter (8 failures/min → 60s block per IP), room lock, new room code, kick, max 8 players |
| Spoofing the TV host | High | Host channel limited to loopback, plus a per‑run secret (timing‑safe compare); a newer host replaces the old one |
| DNS rebinding (malicious site reads `localhost` API) | High | Host header must be `localhost` or an IP literal, otherwise **421** |
| Cross‑site WebSocket hijacking | High | WebSocket `Origin` must equal `Host`, otherwise **403** |
| CSRF on settings | Medium | Custom secret header (requires a CORS preflight that is never granted) + JSON content type |
| XSS via nicknames, guesses or text | High | zod validation (length, no control or bidi‑override characters, no `<>`); all UI uses `textContent` only; strict CSP with no inline scripts or styles |
| Malicious or buggy game | Medium | `<iframe sandbox="allow-scripts">` (opaque origin, no console storage or cookies), CSP `sandbox` header on game files, `connect-src 'none'`, host validates every game message (zod) and rate‑limits it, manifest paths validated |
| Message flood / DoS | Medium | WebSocket `maxPayload` 8 KB, token bucket (120 burst, 60/s) per socket, disconnect after 20 invalid messages, 6 connections per IP, 32 total, heartbeat ping/pong, HTTP header/request timeouts, 4 KB body limit |
| Path traversal | High | `safeResolve`: decodes the path, rejects `..`, dotfiles, backslashes and NUL, enforces the root prefix and a MIME allow‑list |
| Clickjacking | Low | `frame-ancestors 'none'` + `X-Frame-Options: DENY` (host and controller) |
| Command injection (kiosk launch) | Medium | `spawn` with an argument array (no shell); the URL is server‑generated |
| Tampered runtime on USB | Low‑Med | Node binaries verified against nodejs.org SHA256SUMS at build time; `SHA256SUMS.txt` shipped for the whole folder |
| Secret leakage in logs | Medium | Structured logger records event names and player UUIDs only; no IPs, nicknames, tokens or payloads |

Headers on every response: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cross-Origin-Opener-Policy: same-origin`, `Permissions-Policy` (camera, mic, geolocation, payment and USB disabled) and a CSP per page type.

## Known limitations and accepted risks
1. **HTTP on the LAN, not HTTPS.** Phones would not trust a self‑signed certificate for a LAN IP. Traffic on the local Wi‑Fi is not encrypted at the application layer, which is acceptable for game inputs and nicknames only. Any cloud or remote mode must use HTTPS/WSS. Secure‑context APIs (Wake Lock, Service Worker) are unavailable as a result.
2. **The room code is a bearer secret.** Anyone who sees the TV can join. That is by design for a party console; lock the room after everyone has joined.
3. **Players' text is shown on the TV unfiltered** (guesses in Draw & Guess). The admin can kick players. There is no profanity filter in the MVP.
4. **Mode C** (`GAMEU_HOST_KEY`) exposes host control to anyone on the LAN who knows the key. Use a long random key.
5. **Live‑USB OS image (mode A)** is not built yet; Secure Boot, firmware and driver behaviour are untested.

## Supply chain
- Runtime dependencies: `ws`, `zod`, `qrcode`, all bundled into `dist/server/server.cjs` by esbuild.
- Run `npm audit --omit=dev` before each release (current: 0 vulnerabilities). Consider generating an SBOM with `npm sbom --sbom-format cyclonedx` for distribution.

**Not verified by a penetration test.** A professional security review is recommended before commercial distribution.
