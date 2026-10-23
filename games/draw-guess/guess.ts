/** Lenient comparison for guesses: ignores case, niqqud, punctuation, spaces and Hebrew final letters. */
export function normalizeGuess(s: string): string {
  return s
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[֑-ׇ]/g, '') // niqqud & cantillation
    .replace(/[̀-ͯ]/g, '') // latin diacritics
    .replace(/[ךםןףץ]/g, (c) => ({ ך: 'כ', ם: 'מ', ן: 'נ', ף: 'פ', ץ: 'צ' })[c] ?? c)
    .replace(/[^\p{L}\p{N}]/gu, '');
}

export function isCorrectGuess(guess: string, answers: string[]): boolean {
  const g = normalizeGuess(guess);
  return g.length > 0 && answers.some((a) => normalizeGuess(a) === g);
}
