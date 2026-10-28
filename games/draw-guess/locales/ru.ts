import type { DrawDict } from './he';

/** Russian plural form: one (1, 21…), few (2–4, 22–24…), many (5–20, 25…). */
const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};

export const ru: DrawDict = {
  title: 'Рисуй и угадывай',
  guesses: 'Догадки',
  canvasLabel: 'Рисунок игрока',
  guessedFeed: (name) => `✓ ${name}: верно!`,
  guessedAnnounce: (name) => `${name}: правильный ответ`,
  youGotIt: 'Угадано! 🎉',
  plusPoints: (pts) => `+${pts} ${plural(pts, 'очко', 'очка', 'очков')}`,
  round: (n, total) => `Раунд ${n} из ${total}`,
  isDrawing: (name) => `${name} рисует`,
  getReady: 'Приготовьтесь…',
  drawPrompt: (word) => `Нарисуйте: ${word}`,
  guessPrompt: (name) => `Что рисует ${name}?`,
  guessPlaceholder: 'Ваш вариант',
  drawingAnnounce: (name) => `${name} рисует. Угадывайте на телефоне`,
  guessedYourDrawing: (n) => `Ваш рисунок угадали: ${n}`,
  theWord: (word) => `Слово: ${word}`,
  theWordWas: (word) => `Было слово: ${word}`,
  theWordWasTitle: 'Было слово',
  words: {
    "cat": ["кошка", "кот", "котик", "котёнок"],
    "dog": ["собака", "пёс", "собачка", "щенок"],
    "house": ["дом", "домик"],
    "sun": ["солнце", "солнышко"],
    "tree": ["дерево", "деревья"],
    "flower": ["цветок", "цветы", "цветочек"],
    "car": ["машина", "автомобиль", "машинка"],
    "bicycle": ["велосипед", "велик"],
    "airplane": ["самолёт", "самолет"],
    "boat": ["лодка", "корабль", "кораблик"],
    "fish": ["рыба", "рыбка"],
    "bird": ["птица", "птичка"],
    "apple": ["яблоко"],
    "banana": ["банан"],
    "pizza": ["пицца"],
    "ice cream": ["мороженое", "эскимо"],
    "cake": ["торт", "пирог", "пирожное"],
    "ball": ["мяч", "мячик"],
    "glasses": ["очки"],
    "hat": ["шляпа", "шапка", "кепка"],
    "shoe": ["ботинок", "ботинки", "туфля", "туфли", "обувь"],
    "clock": ["часы"],
    "phone": ["телефон", "смартфон", "мобильник"],
    "umbrella": ["зонт", "зонтик"],
    "moon": ["луна", "месяц"],
    "star": ["звезда", "звёздочка"],
    "mountain": ["гора", "горы"],
    "rain": ["дождь", "дождик"],
    "cloud": ["облако", "туча", "облака"],
    "snake": ["змея", "змейка"],
    "elephant": ["слон", "слоник"],
    "giraffe": ["жираф"],
    "robot": ["робот"],
    "guitar": ["гитара"],
    "book": ["книга", "книжка"],
    "key": ["ключ", "ключик"],
    "heart": ["сердце", "сердечко"],
    "crown": ["корона"],
    "castle": ["замок", "дворец", "крепость"],
    "train": ["поезд", "паровоз", "поезда"],
  },
};
