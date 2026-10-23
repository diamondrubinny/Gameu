import { createSdk, type GamePlayer, type Input } from '../../src/sdk/gameu';
import { AVATARS } from '../../src/shared/constants';
import { $, announce, applyDocumentSettings, clear, h, shuffle, sleep } from '../../src/sdk/game-utils';
import { QUESTIONS } from './questions';

const ROUNDS = 10;
const SHAPES = ['▲', '◆', '●', '■'];

interface Round {
  q: string;
  answers: string[];
  correct: number;
}

const sdk = createSdk();
const stage = $('#stage');
let players: GamePlayer[] = [];
const scores = new Map<string, number>();
let answers = new Map<string, { index: number; at: number }>();
let accepting = false;
let roundStart = 0;
let seconds = 20;
let resolveRound: (() => void) | null = null;

sdk.onInit(async (ctx) => {
  applyDocumentSettings(ctx.settings);
  players = ctx.players;
  seconds = ctx.settings.extendedTime ? 35 : 20;
  for (const p of players) scores.set(p.id, 0);
  await run();
});

sdk.onPlayers((p) => {
  players = p;
  for (const pl of p) if (!scores.has(pl.id)) scores.set(pl.id, 0);
  renderAnswered();
  if (accepting && everyoneAnswered()) resolveRound?.();
});

sdk.onInput((playerId: string, input: Input) => {
  if (!accepting || input.kind !== 'choice' || input.id !== 'answer') return;
  if (answers.has(playerId) || input.index > 3) return;
  answers.set(playerId, { index: input.index, at: performance.now() });
  sdk.setLayout({ type: 'message', text: sdk.t('התשובה נקלטה ✓', 'Answer locked in ✓'), subtext: sdk.t('ממתינים לשאר השחקנים…', 'Waiting for the others…') }, playerId);
  renderAnswered();
  if (everyoneAnswered()) resolveRound?.();
});

function connected(): GamePlayer[] {
  return players.filter((p) => p.connected);
}

function everyoneAnswered(): boolean {
  const c = connected();
  return c.length > 0 && c.every((p) => answers.has(p.id));
}

function buildRounds(): Round[] {
  const lang = sdk.settings?.language ?? 'he';
  return shuffle(QUESTIONS)
    .slice(0, ROUNDS)
    .map((q) => {
      const loc = q[lang];
      const order = shuffle([0, 1, 2, 3]);
      return { q: loc.q, answers: order.map((i) => loc.a[i] as string), correct: order.indexOf(q.correct) };
    });
}

async function run(): Promise<void> {
  clear(stage);
  stage.append(h('div', { class: 'intro pop' }, h('h1', {}, '❓ ', sdk.t('טריוויה', 'Trivia')), h('p', {}, sdk.t(`${ROUNDS} שאלות — עונים מהטלפון`, `${ROUNDS} questions — answer on your phone`))));
  sdk.setLayout({ type: 'message', text: sdk.t('מתכוננים…', 'Get ready…') });
  announce(sdk.t('טריוויה מתחילה', 'Trivia is starting'));
  await sleep(3500);

  const rounds = buildRounds();
  for (let i = 0; i < rounds.length; i++) {
    await playRound(rounds[i]!, i);
  }
  sdk.end([...scores.entries()].map(([playerId, score]) => ({ playerId, score })));
}

async function playRound(round: Round, index: number): Promise<void> {
  answers = new Map();
  clear(stage);
  const timerBar = h('div');
  const answerEls = round.answers.map((a, i) =>
    h('div', { class: `answer a${i}` }, h('span', { class: 'shape', 'aria-hidden': 'true' }, SHAPES[i]), h('span', {}, a), h('span', { class: 'count' })),
  );
  stage.append(
    h('div', { class: 'meta' }, h('span', {}, sdk.t(`שאלה ${index + 1} מתוך ${ROUNDS}`, `Question ${index + 1} of ${ROUNDS}`)), h('span', { id: 'leader' }, leaderText())),
    h('h1', { class: 'question pop' }, round.q),
    h('div', { class: 'answers' }, ...answerEls),
    h('div', { class: 'reveal', id: 'reveal' }),
    h('div', { class: 'footer' }, h('div', { class: 'answered', id: 'answered', 'aria-hidden': 'true' }), h('div', { class: 'timer' }, timerBar)),
  );
  renderAnswered();
  announce(`${round.q} ${round.answers.map((a, i) => `${i + 1}: ${a}`).join(', ')}`);
  sdk.setLayout({ type: 'choices', id: 'answer', prompt: round.q, options: round.answers });
  sdk.haptic([40]);

  accepting = true;
  roundStart = performance.now();
  const total = seconds * 1000;
  await new Promise<void>((resolve) => {
    resolveRound = resolve;
    const tick = () => {
      if (!accepting) return;
      const left = Math.max(0, total - (performance.now() - roundStart));
      timerBar.style.transform = `scaleX(${left / total})`;
      if (left <= 0) resolve();
      else requestAnimationFrame(tick);
    };
    tick();
  });
  accepting = false;
  resolveRound = null;

  // reveal + scoring
  const counts = [0, 0, 0, 0];
  const winners: string[] = [];
  for (const [pid, a] of answers) {
    counts[a.index] = (counts[a.index] ?? 0) + 1;
    if (a.index === round.correct) {
      const remaining = Math.max(0, total - (a.at - roundStart));
      scores.set(pid, (scores.get(pid) ?? 0) + 500 + Math.round((500 * remaining) / total));
      winners.push(pid);
      sdk.setLayout({ type: 'message', text: sdk.t('נכון! 🎉', 'Correct! 🎉') }, pid);
      sdk.haptic([60, 40, 60], pid);
    } else {
      sdk.setLayout({ type: 'message', text: sdk.t('לא הפעם 😕', 'Not this time 😕'), subtext: sdk.t(`התשובה: ${round.answers[round.correct]}`, `Answer: ${round.answers[round.correct]}`) }, pid);
    }
  }
  for (const p of connected()) {
    if (!answers.has(p.id)) sdk.setLayout({ type: 'message', text: sdk.t('נגמר הזמן ⏰', "Time's up ⏰"), subtext: sdk.t(`התשובה: ${round.answers[round.correct]}`, `Answer: ${round.answers[round.correct]}`) }, p.id);
  }
  answerEls.forEach((el, i) => {
    el.classList.add(i === round.correct ? 'right' : 'wrong');
    const count = el.querySelector('.count');
    if (count) count.textContent = String(counts[i]);
  });
  const names = winners.map((id) => players.find((p) => p.id === id)?.nickname).filter(Boolean);
  const reveal = $('#reveal');
  reveal.textContent = names.length ? sdk.t(`ענו נכון: ${names.join(', ')}`, `Correct: ${names.join(', ')}`) : sdk.t('אף אחד לא צדק הפעם', 'Nobody got it this time');
  announce(sdk.t(`התשובה הנכונה: ${round.answers[round.correct]}. ${reveal.textContent}`, `The answer: ${round.answers[round.correct]}. ${reveal.textContent}`));
  $('#leader').textContent = leaderText();
  await sleep(5000);
}

function leaderText(): string {
  const top = [...scores.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!top || top[1] === 0) return '';
  const p = players.find((pl) => pl.id === top[0]);
  return p ? `👑 ${AVATARS[p.avatar] ?? ''} ${p.nickname} — ${top[1]}` : '';
}

function renderAnswered(): void {
  const el = document.getElementById('answered');
  if (!el) return;
  clear(el);
  for (const p of connected()) el.append(h('span', { class: answers.has(p.id) ? 'done' : '', title: p.nickname }, AVATARS[p.avatar] ?? '🙂'));
}
