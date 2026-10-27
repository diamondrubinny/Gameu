# Pre‑production checklist

Status legend: ✅ done and automated · 🟡 partially done / manual step required · ⬜ not done

## Functional
- ✅ Join by QR or code, nickname de‑duplication, admin assignment and hand‑over (unit + e2e)
- ✅ Menu navigation from the admin phone and keyboard; quit game with confirmation; results screen (e2e)
- ✅ Trivia, Snakes, Draw & Guess play end‑to‑end with two phones (e2e)
- ✅ Reconnect after phone lock or reload within 2 minutes (unit + integration)
- 🟡 Manual test on real hardware: Windows laptop, Mac, Linux and Raspberry Pi 5 connected to a TV over HDMI; Android Chrome, iOS Safari and Samsung Internet phones
- 🟡 Kiosk launch with real Chrome/Edge on each OS (not testable in CI)

## Android TV app
- ✅ Debug/release builds, unit tests (JVM), lint with warnings as errors, R8 release build
- ✅ Release signing kept outside Git (env or `keystore.properties`); signed in CI only for `v*` tags
- 🟡 Manual test of the **release** APK on a real Android TV (R8 issues can only show at runtime)
- ⬜ Create and back up the real release keystore (owner action, see docs/ANDROID-RELEASE.md)
- ⬜ Google Play: Data safety form, public privacy‑policy URL, TV quality review (requires verification and legal review)

## Roles and permissions
- ✅ Host channel loopback‑only + per‑run secret; settings writes need the secret
- ✅ Admin‑only menu control and quit; kick and lock from the TV settings
- ✅ Players cannot send input before joining; games cannot address unknown players

## Sessions
- ✅ No user accounts; reconnect tokens are 192‑bit random, in memory only, invalid after restart
- ✅ Kicked or replaced controllers are closed and their tokens cleared on the phone

## Input, API and file security
- ✅ zod validation for every message; size limits; rate limits; Origin/Host checks (integration tests)
- ✅ Path traversal tests; strict CSP; sandboxed games
- ⬜ No file uploads in the MVP, so antivirus scanning is **not applicable**. If uploads are added (avatars or custom games), add quarantine + ClamAV scan + MIME sniffing before use.
- ⬜ Independent penetration test

## Secrets and environment
- ✅ No secrets in code; `.env.example` only; `.env` git‑ignored
- ✅ `GAMEU_HOST_KEY` length enforced (≥16)

## Dependencies
- ✅ `npm audit` → 0 vulnerabilities (2026‑10‑23)
- ✅ Node runtimes verified with official SHA‑256 sums
- 🟡 Generate an SBOM per release: `npm sbom --sbom-format cyclonedx > sbom.json`

## Backup and restore
- Not applicable: the only persisted state is `data/settings.json` (safe to delete; defaults are restored).

## Personal data map
| Data | Purpose | Legal basis (draft) | Storage | Retention | Third parties |
|---|---|---|---|---|---|
| Nickname + avatar | Show the player in the game | Performing the service the user asked for (contract / legitimate interest) | Console RAM; phone localStorage | RAM: until removed (≤2 min after disconnect) or restart; phone: until "leave" or clearing site data | None |
| Phone LAN IP | Connection, anti‑abuse limiter | Legitimate interest (security) | Console RAM only, not logged | Connection lifetime; limiter ≤2 min | None |
| Game input (taps, answers, guesses, drawings) | Run the game | Contract | Console RAM | Until the round or game ends | None |
| Console settings | Preferences | Legitimate interest | `data/settings.json` on USB | Until changed | None |

## Cookies and trackers
| Tool | Vendor | Type | Category | Data | Retention | Third party | Consent needed |
|---|---|---|---|---|---|---|---|
| `gameu.nick`, `gameu.avatar`, `gameu.rt`, `gameu.prefs` | Gameu (first party) | localStorage | Essential / functional | nickname, avatar, reconnect token, controller prefs | until cleared | No | No (strictly necessary); disclosed on the privacy page |
| `gameu.hostKey` | Gameu | sessionStorage (mode C only) | Essential | host key | browser session | No | No |

- ✅ No cookies, analytics, pixels or ads, so **no consent banner is required** in the current scope. If any analytics or marketing tool is added: build a consent banner (accept all / reject all / manage, nothing pre‑ticked, withdrawable via a permanent footer link) and do not load the tool before consent.

## Legal and policy documents (drafts — need professional review)
- 🟡 Privacy and cookies policy: `src/public/legal/privacy.html` (draft; contact details missing)
- 🟡 Accessibility statement: `src/public/legal/accessibility.html` (draft; coordinator contact missing)
- ⬜ Terms of use: needed only if the product is distributed or sold
- ⬜ Cookie policy as a separate document: not needed while there are no cookies (covered in the privacy page)

## Accessibility
- ✅ axe WCAG 2.1 A/AA automated checks: TV home, settings, phone join, phone play, legal pages (e2e)
- ✅ Keyboard / d‑pad navigation, visible focus, live regions, RTL, text scale up to 175%, high contrast, reduced motion, extended time
- 🟡 Manual: NVDA/JAWS on the TV screen, TalkBack/VoiceOver on phones, 200% zoom on phones, real‑TV viewing distance
- ⬜ Review by an accessibility consultant (Israeli Standard 5568 / Equal Rights regulations)

## Mobile, RTL, performance, SEO
- ✅ RTL Hebrew + English; responsive phone layouts (portrait and landscape)
- ✅ Bundles: host ~125 KB, controller ~23 KB, games 7–15 KB (minified, served from the LAN)
- SEO not applicable (LAN app, `noindex`)

## Requires professional sign‑off before any public or commercial release
- **Lawyer / privacy officer:** privacy policy, Israeli Privacy Protection Law (Amendment 13), GDPR if offered in the EU, use by minors, terms of use
- **Accessibility consultant:** accessibility statement and Israeli Standard 5568 compliance
- **Penetration tester:** LAN threat model, WebSocket protocol, kiosk mode
- **Third‑party licences:** shipped automatically: `runtime/NODE-LICENSE` and `app/THIRD-PARTY-LICENSES.txt` (ws, zod, qrcode, pngjs, dijkstrajs, all MIT). Review them before commercial distribution.
