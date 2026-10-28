# Translation guide (Gameu)

Languages: Hebrew `he` (source of truth), English `en`, Arabic `ar` (RTL), Russian `ru`, Spanish `es`, French `fr`.

## Files per language `<L>`
| What | File | Shape |
|---|---|---|
| TV screen | `src/host/locales/<L>.ts` | `export const <L>: HostDict = { ... }`, same keys as `he.ts` |
| Phone controller | `src/controller/locales/<L>.ts` | `ControllerDict` |
| Snake | `games/snake/locales/<L>.ts` | `SnakeDict` |
| Draw & Guess | `games/draw-guess/locales/<L>.ts` | `DrawDict`, including `words` (all 40 keys) |
| Trivia UI | `games/trivia/locales/<L>.ts` | `TriviaDict`, including `categories` |
| Trivia questions | `games/trivia/i18n/<L>/<category>.json` | `{ "<id>": { "q": "...", "a": ["", "", "", ""] } }` |

## Rules
1. **Same structure:** every key and every function signature of `he.ts` / `en.ts`. Keep `${...}` placeholders, emoji and `👑`/`🔥` symbols. Arrow functions may omit parameter types (they come from the Dict type).
2. **Natural, family-friendly language** as a TV quiz show in that language would write it. Arabic: Modern Standard Arabic, simple and clear. Prefer gender-neutral phrasing (players can be anyone) — e.g. address players in the plural or use neutral nouns.
3. **Trivia answers stay in the same order** as `en.a` (index 0..3). Never reorder; the correct answer is decided by position. Numbers stay the same number (you may use local separators, e.g. `1 440`, `1.440`).
4. **Names:** people, places and works by their standard name in the target language (e.g. Arabic/Russian conventional spellings). Brand names stay as is.
5. **Don't give the answer away:** check grammar (gender, word overlap) so the question doesn't point to one option.
6. **Questions about the Hebrew language or Hebrew words:** keep the Hebrew word itself in the question/answers and translate the rest.
7. Limits: question ≤ 200 chars, each answer ≤ 80 chars, no `<` or `>`.
8. Draw & Guess `words`: first item is shown to the drawer (simple common noun), extra items are accepted guesses (common synonyms/plural). All 40 keys required, all primaries distinct.

## Checks
- `npx tsc -p tsconfig.web.json` — types/keys complete.
- `node scripts/validate-trivia.mjs --lang=<L>` — trivia coverage, limits, numeric consistency (use `--partial` while in progress).
