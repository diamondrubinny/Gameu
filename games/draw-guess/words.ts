/**
 * Word keys (English). Each locale maps every key to its words in that language:
 * the first is shown to the drawer, the rest are also accepted as guesses.
 * Guesses are accepted in any language.
 */
export const WORD_KEYS = ["cat", "dog", "house", "sun", "tree", "flower", "car", "bicycle", "airplane", "boat", "fish", "bird", "apple", "banana", "pizza", "ice cream", "cake", "ball", "glasses", "hat", "shoe", "clock", "phone", "umbrella", "moon", "star", "mountain", "rain", "cloud", "snake", "elephant", "giraffe", "robot", "guitar", "book", "key", "heart", "crown", "castle", "train"] as const;

export type WordKey = (typeof WORD_KEYS)[number];
