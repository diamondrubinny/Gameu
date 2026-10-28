import type { TriviaDict } from './he';

/** Russian plural form: one (1, 21…), few (2–4, 22–24…), many (5–20, 25…). */
const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};
const questions = (n: number) => `${n} ${plural(n, 'вопрос', 'вопроса', 'вопросов')}`;
const points = (n: number) => `${n} ${plural(n, 'очко', 'очка', 'очков')}`;

export const ru: TriviaDict = {
  title: 'Викторина',
  topics: 'Темы',
  allTopics: 'Все темы',
  easy: 'Легко',
  hard: 'Сложно',
  mixed: 'Смешанный (от простого к сложному)',
  questionsOpt: (n) => `Вопросов: ${n}`,
  levelOpt: (label) => `Уровень: ${label}`,
  start: 'Начать!',
  choosingTopics: (name) => `${name}: выбор тем…`,
  startsSoon: 'Викторина вот-вот начнётся',
  setupPadTitle: 'Настройка викторины — стрелки и «Выбрать»',
  select: 'Выбрать',
  setupAnnounce: 'Настройка викторины. Выберите темы, число вопросов и уровень сложности.',
  setupHint: (name) => `${name} 👑 выбирает на телефоне: стрелки — перемещение, «Выбрать» — отметить`,
  waitingPlayers: 'Ждём игроков…',
  noQuestions: 'Для такого выбора нет вопросов — выберите другую тему или уровень',
  summary: (n, available, topics) => `${n} из ${available} доступных вопросов · ${topics}`,
  contestBegins: 'Викторина начинается!',
  introLine: (total, topics) => `${questions(total)} · ${topics}`,
  rules: 'Быстрее = больше очков · 3 верных ответа подряд = бонус 🔥 · Последний вопрос — двойные очки!',
  getReady: 'Приготовьтесь…',
  beginsAnnounce: (total) => `Викторина начинается. ${questions(total)}.`,
  answerLocked: 'Ответ принят ✓',
  waitingOthers: 'Ждём остальных…',
  championTitle: 'Вопрос чемпионов',
  doublePoints: 'Двойные очки!',
  finalAnnounce: 'Последний вопрос, двойные очки',
  championPhone: '🏆 Вопрос чемпионов — двойные очки!',
  difficultyAria: (d) => `Сложность ${d} из 3`,
  questionOf: (i, total) => `Вопрос ${i} из ${total}`,
  correctPlus: (pts) => `Верно! +${pts}`,
  streak: (n, bonus) => `🔥 ${n} подряд (+${bonus} бонус)`,
  notThisTime: 'Не в этот раз 😕',
  timesUp: 'Время вышло ⏰',
  answerIs: (answer) => `Ответ: ${answer}`,
  nobody: 'В этот раз никто не угадал',
  revealAnnounce: (answer, n) => `Правильный ответ: ${answer}. Верно ответили: ${n}.`,
  movedUp: 'вверх',
  movedDown: 'вниз',
  leaderboard: (done, total) => `Таблица лидеров · ${done}/${total}`,
  place: (rank, of) => `Место ${rank} из ${of}`,
  points: (score) => points(score),
  firstPlaceAnnounce: (name, score) => `На первом месте: ${name}, ${points(score)}`,
  pts: (score) => `${score} очк.`,
  champions: 'Чемпионы!',
  winnersAnnounce: (names) => `${names.length > 1 ? 'Победители' : 'Победа'}: ${names.join(' и ')}`,
  youWon: '🏆 Победа!',
  placeN: (rank) => `Место ${rank}`,
  categories: {
    general: 'Общие знания',
    geography: 'География',
    history: 'История',
    science: 'Наука',
    space: 'Космос и астрономия',
    nature: 'Природа и животные',
    body: 'Тело человека',
    sports: 'Спорт',
    music: 'Музыка',
    movies: 'Кино и ТВ',
    literature: 'Книги и язык',
    art: 'Искусство и архитектура',
    food: 'Еда и кулинария',
    tech: 'Технологии',
    math: 'Математика и логика',
    israel: 'Израиль',
  },
};
