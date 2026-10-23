/** Original word list. `alt` = extra accepted guesses. Words are simple nouns that are easy to draw. */
export interface Word {
  he: string;
  en: string;
  alt?: string[];
}

export const WORDS: Word[] = [
  { he: 'חתול', en: 'cat' },
  { he: 'כלב', en: 'dog' },
  { he: 'בית', en: 'house' },
  { he: 'שמש', en: 'sun' },
  { he: 'עץ', en: 'tree' },
  { he: 'פרח', en: 'flower' },
  { he: 'מכונית', en: 'car', alt: ['אוטו', 'רכב'] },
  { he: 'אופניים', en: 'bicycle', alt: ['bike'] },
  { he: 'מטוס', en: 'airplane', alt: ['plane', 'אווירון'] },
  { he: 'סירה', en: 'boat', alt: ['ספינה', 'ship'] },
  { he: 'דג', en: 'fish' },
  { he: 'ציפור', en: 'bird' },
  { he: 'תפוח', en: 'apple' },
  { he: 'בננה', en: 'banana' },
  { he: 'פיצה', en: 'pizza' },
  { he: 'גלידה', en: 'ice cream', alt: ['icecream'] },
  { he: 'עוגה', en: 'cake' },
  { he: 'כדור', en: 'ball' },
  { he: 'משקפיים', en: 'glasses' },
  { he: 'כובע', en: 'hat' },
  { he: 'נעל', en: 'shoe', alt: ['נעליים', 'shoes'] },
  { he: 'שעון', en: 'clock', alt: ['watch'] },
  { he: 'טלפון', en: 'phone', alt: ['פלאפון', 'סלולרי'] },
  { he: 'מטריה', en: 'umbrella', alt: ['מטרייה'] },
  { he: 'ירח', en: 'moon' },
  { he: 'כוכב', en: 'star' },
  { he: 'הר', en: 'mountain' },
  { he: 'גשם', en: 'rain' },
  { he: 'ענן', en: 'cloud' },
  { he: 'נחש', en: 'snake' },
  { he: 'פיל', en: 'elephant' },
  { he: 'ג׳ירפה', en: 'giraffe', alt: ["ג'ירפה", 'גירפה'] },
  { he: 'רובוט', en: 'robot' },
  { he: 'גיטרה', en: 'guitar' },
  { he: 'ספר', en: 'book' },
  { he: 'מפתח', en: 'key' },
  { he: 'לב', en: 'heart' },
  { he: 'כתר', en: 'crown' },
  { he: 'טירה', en: 'castle', alt: ['ארמון'] },
  { he: 'רכבת', en: 'train' },
];
