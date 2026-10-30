# Plan: controls, audio, Texas Hold'em, Guess the Word

Status: controls ✅ · audio ✅ · poker ✅ · guess-the-word ✅

## 1. Controls (done)
- TV selection tracked with `.nav-focus` (painted even when the window is unfocused), kept across re-renders, follows Tab/pointer.
- OK with nothing selected → selects the first item. Press/edge flashes.
- Phone buttons stay visibly pressed ≥160 ms; pointer capture so a sliding finger keeps the press.
- Android WebView requests focus.

## 2. Audio
- `src/host/audio.ts`: one AudioContext on the TV. Buses: sfx, music → compressor → out. Synthetic reverb.
- All sounds and music are **synthesized at runtime** (original, no files, no licences, no network).
- Music: generative look-ahead scheduler. Moods `menu`, `game`, `tense`, `calm`, `off`. Chord progressions + seeded pentatonic melody, pad, arp, bass, soft drums.
- SFX names (enum in protocol, validated by host): `tick countdown go correct wrong reveal chip card eat crash coin win fanfare letter turn lose`.
- Protocol: game → host `{type:'sound', name}` and `{type:'music', mood}`. SDK `sound()` / `music()`.
- Settings: `music: boolean` (default on) + existing volume. Results screen plays the fanfare and ducks music.
- `src/host/music-theory.ts`: pure helpers, unit-tested.
- Privacy/a11y: no data; music can be turned off; sounds never carry information that isn't also shown.

## 3. Texas Hold'em (virtual chips only, no money)
- `games/poker/engine.ts` pure, unit-tested: deck, blinds, betting rounds, min-raise rules, all-in, side pots, showdown, 7-card evaluator.
- New controller layout `cards`: private hole cards + actions (fold / check / call / raise presets / all-in), with labels.
- TV: table, community cards, pot(s), whose turn, timer; hole cards only on the owner's phone.
- 2–8 players, end by elimination or hand limit; disconnected player auto-folds/checks on timeout.

## 4. Guess the Word (hangman-style, no gallows imagery: a balloon losing air)
- New controller layout `letters`: alphabet grid per language, used letters disabled, optional "solve" text.
- Turn-based; words with category hints in all 6 languages; normalization (Hebrew finals, Arabic hamza/ta-marbuta, accents, ё).
- Scoring: letter hits, solving bonus; rounds = players × 2.

## Security notes
- New layouts and messages are zod-validated with length caps; hole cards are sent only to their owner via per-player layouts.
- Game messages stay rate-limited by the host budget.
