# Writing a Gameu game

A game is a folder under `games/<id>/`, and the folder name must equal the `id` in the manifest. It runs inside a sandboxed iframe on the TV. It **cannot** open network connections, read the console's storage or touch the parent page. It talks to the console only through the SDK (`postMessage`). The host validates every message.

```
games/my-game/
  manifest.json   metadata (validated at server start; invalid games are skipped)
  index.html      entry page (relative assets; inline scripts/styles are blocked by CSP)
  main.ts         bundled to main.js by `npm run build` (or ship plain main.js)
  style.css
  icon.svg        shown on the TV menu
```

## manifest.json
```json
{
  "id": "my-game",
  "version": "1.0.0",
  "name": { "he": "המשחק שלי", "en": "My Game" },
  "description": { "he": "תיאור קצר", "en": "Short description" },
  "minPlayers": 1,
  "maxPlayers": 8,
  "entry": "index.html",
  "icon": "icon.svg",
  "controller": "dpad",
  "accessibility": { "colorIndependent": true, "extendedTime": false, "noFlashing": true }
}
```

## API
TypeScript (bundled games): `import { createSdk } from '../../src/sdk/gameu'`. Plain JS: add `<script src="/sdk/gameu.js"></script>` and use `window.Gameu`.

| Call | Purpose |
|---|---|
| `onInit(({ players, settings }) => …)` | Start here. `settings` holds language, textScale, highContrast, reduceMotion, extendedTime and volume. |
| `onInput((playerId, input) => …)` | `input.kind`: `button` {id, pressed}, `stick` {x, y ∈ [-1, 1], y up}, `choice` {index}, `text` {value}, `draw` {stroke, color, size, points[[x, y] ∈ 0..1]} |
| `onPlayers(players => …)` | Fires when a player joins, leaves or reconnects (`connected` flag) |
| `setLayout(layout, target = 'all')` | Sets the controls on phones: `dpad`, `joystick`, `choices`, `text`, `draw`, `message`, `menu` |
| `haptic([ms, pause, ms…], target)` | Vibrates phones (unsupported on iOS) |
| `end([{ playerId, score }])` | Shows the results screen and returns to the menu |
| `t(he, en)` | Picks a string for the console language |

The 🏠 button on the admin phone is reserved by the console (quit with confirmation). Games never receive it.

## Checklist for a new game
- Works with 1 player joining or leaving mid‑game.
- Does not rely on colour alone: use the avatar emoji or shapes next to colours.
- Honors `settings.extendedTime`, `reduceMotion` and `highContrast`.
- Announces important events through a `#live` region (`aria-live="polite"`).
- Renders player text with `textContent` only.
- No flashing content (more than 3 flashes per second).
