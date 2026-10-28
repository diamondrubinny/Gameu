/**
 * Trivia topics. Each has a data file at games/trivia/data/<id>.json and
 * translations at games/trivia/i18n/<lang>/<id>.json. Display names live in locales/.
 */
export interface Category {
  id: string;
  icon: string;
  /** Hebrew/English names (kept for tooling; the game uses locales/*.categories). */
  he: string;
  en: string;
}

export const CATEGORIES: readonly Category[] = [
  { id: 'general', icon: '🧠', he: 'ידע כללי', en: 'General knowledge' },
  { id: 'geography', icon: '🌍', he: 'גאוגרפיה', en: 'Geography' },
  { id: 'history', icon: '🏛️', he: 'היסטוריה', en: 'History' },
  { id: 'science', icon: '🔬', he: 'מדע', en: 'Science' },
  { id: 'space', icon: '🚀', he: 'חלל ואסטרונומיה', en: 'Space & astronomy' },
  { id: 'nature', icon: '🦁', he: 'טבע ובעלי חיים', en: 'Nature & animals' },
  { id: 'body', icon: '🫀', he: 'גוף האדם', en: 'Human body' },
  { id: 'sports', icon: '⚽', he: 'ספורט', en: 'Sports' },
  { id: 'music', icon: '🎵', he: 'מוזיקה', en: 'Music' },
  { id: 'movies', icon: '🎬', he: 'קולנוע וטלוויזיה', en: 'Movies & TV' },
  { id: 'literature', icon: '📚', he: 'ספרות ושפה', en: 'Books & language' },
  { id: 'art', icon: '🎨', he: 'אמנות ואדריכלות', en: 'Art & architecture' },
  { id: 'food', icon: '🍕', he: 'אוכל ומטבח', en: 'Food & cooking' },
  { id: 'tech', icon: '💻', he: 'טכנולוגיה ומחשבים', en: 'Technology' },
  { id: 'math', icon: '➗', he: 'מתמטיקה והיגיון', en: 'Math & logic' },
  { id: 'israel', icon: '🇮🇱', he: 'ישראל', en: 'Israel' },
];
