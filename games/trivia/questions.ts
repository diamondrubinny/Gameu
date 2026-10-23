export interface Question {
  he: { q: string; a: [string, string, string, string] };
  en: { q: string; a: [string, string, string, string] };
  /** Index of the correct answer in `a` (before shuffling). */
  correct: number;
}

/** Original question set. First answer is not always correct; answers are shuffled at runtime anyway. */
export const QUESTIONS: Question[] = [
  { he: { q: 'מהי בירת יפן?', a: ['טוקיו', 'קיוטו', 'אוסקה', 'הירושימה'] }, en: { q: 'What is the capital of Japan?', a: ['Tokyo', 'Kyoto', 'Osaka', 'Hiroshima'] }, correct: 0 },
  { he: { q: 'כמה רגליים יש לעכביש?', a: ['6', '8', '10', '12'] }, en: { q: 'How many legs does a spider have?', a: ['6', '8', '10', '12'] }, correct: 1 },
  { he: { q: 'איזה כוכב לכת הכי קרוב לשמש?', a: ['נוגה', 'מאדים', 'חמה (מרקורי)', 'כדור הארץ'] }, en: { q: 'Which planet is closest to the Sun?', a: ['Venus', 'Mars', 'Mercury', 'Earth'] }, correct: 2 },
  { he: { q: 'מהו האוקיינוס הגדול בעולם?', a: ['האטלנטי', 'ההודי', 'הארקטי', 'השקט'] }, en: { q: 'What is the largest ocean on Earth?', a: ['Atlantic', 'Indian', 'Arctic', 'Pacific'] }, correct: 3 },
  { he: { q: 'כמה ימים יש בשנה מעוברת (בלוח הגרגוריאני)?', a: ['366', '365', '364', '360'] }, en: { q: 'How many days are in a leap year (Gregorian calendar)?', a: ['366', '365', '364', '360'] }, correct: 0 },
  { he: { q: 'איזה גז צמחים קולטים מהאוויר לצורך פוטוסינתזה?', a: ['חמצן', 'פחמן דו־חמצני', 'חנקן', 'הליום'] }, en: { q: 'Which gas do plants take from the air for photosynthesis?', a: ['Oxygen', 'Carbon dioxide', 'Nitrogen', 'Helium'] }, correct: 1 },
  { he: { q: 'מהו היונק הגדול ביותר?', a: ['פיל אפריקני', 'ג׳ירפה', 'לווייתן כחול', 'היפופוטם'] }, en: { q: 'What is the largest mammal?', a: ['African elephant', 'Giraffe', 'Blue whale', 'Hippopotamus'] }, correct: 2 },
  { he: { q: 'באיזו טמפרטורה רותחים מים בגובה פני הים (צלזיוס)?', a: ['80', '90', '120', '100'] }, en: { q: 'At what temperature does water boil at sea level (Celsius)?', a: ['80', '90', '120', '100'] }, correct: 3 },
  { he: { q: 'כמה צלעות יש למשושה?', a: ['6', '5', '7', '8'] }, en: { q: 'How many sides does a hexagon have?', a: ['6', '5', '7', '8'] }, correct: 0 },
  { he: { q: 'מי צייר את המונה ליזה?', a: ['מיכלאנג׳לו', 'לאונרדו דה וינצ׳י', 'רפאל', 'ואן גוך'] }, en: { q: 'Who painted the Mona Lisa?', a: ['Michelangelo', 'Leonardo da Vinci', 'Raphael', 'Van Gogh'] }, correct: 1 },
  { he: { q: 'מהו הסמל הכימי של זהב?', a: ['Ag', 'Go', 'Au', 'Gd'] }, en: { q: 'What is the chemical symbol for gold?', a: ['Ag', 'Go', 'Au', 'Gd'] }, correct: 2 },
  { he: { q: 'מהו הנהר הארוך ביותר בישראל?', a: ['הירקון', 'הקישון', 'נחל אלכסנדר', 'הירדן'] }, en: { q: 'What is the longest river in Israel?', a: ['Yarkon', 'Kishon', 'Alexander', 'Jordan'] }, correct: 3 },
  { he: { q: 'איפה נמצא המקום הנמוך ביותר על פני היבשה בעולם?', a: ['חופי ים המלח', 'עמק המוות', 'הכנרת', 'הים הכספי'] }, en: { q: 'Where is the lowest point on dry land on Earth?', a: ['Dead Sea shore', 'Death Valley', 'Sea of Galilee', 'Caspian Sea'] }, correct: 0 },
  { he: { q: 'כמה זה 7 כפול 8?', a: ['54', '56', '58', '64'] }, en: { q: 'What is 7 × 8?', a: ['54', '56', '58', '64'] }, correct: 1 },
  { he: { q: 'באיזו שנה נחת אדם לראשונה על הירח?', a: ['1959', '1965', '1969', '1972'] }, en: { q: 'In which year did humans first land on the Moon?', a: ['1959', '1965', '1969', '1972'] }, correct: 2 },
  { he: { q: 'מהו החומר הטבעי הקשה ביותר?', a: ['ברזל', 'גרניט', 'קוורץ', 'יהלום'] }, en: { q: 'What is the hardest natural material?', a: ['Iron', 'Granite', 'Quartz', 'Diamond'] }, correct: 3 },
  { he: { q: 'לאיזה כלי נגינה יש בדרך כלל 88 קלידים?', a: ['פסנתר', 'גיטרה', 'כינור', 'חליל'] }, en: { q: 'Which instrument usually has 88 keys?', a: ['Piano', 'Guitar', 'Violin', 'Flute'] }, correct: 0 },
  { he: { q: 'איזו ציפור נבחרה לציפור הלאומית של ישראל?', a: ['עיט', 'דוכיפת', 'יונה', 'בת־יענה'] }, en: { q: "Which bird was chosen as Israel's national bird?", a: ['Eagle', 'Hoopoe', 'Dove', 'Ostrich'] }, correct: 1 },
  { he: { q: 'כמה שחקנים יש לכל קבוצה על המגרש בכדורגל?', a: ['9', '10', '11', '12'] }, en: { q: 'How many players per team are on the field in soccer?', a: ['9', '10', '11', '12'] }, correct: 2 },
  { he: { q: 'מהי נקודת הקיפאון של מים בפרנהייט?', a: ['0', '100', '212', '32'] }, en: { q: 'What is the freezing point of water in Fahrenheit?', a: ['0', '100', '212', '32'] }, correct: 3 },
  { he: { q: 'איזה איבר מזרים דם בגוף?', a: ['הלב', 'הריאות', 'הכבד', 'הכליות'] }, en: { q: 'Which organ pumps blood around the body?', a: ['Heart', 'Lungs', 'Liver', 'Kidneys'] }, correct: 0 },
  { he: { q: 'מהו כוכב הלכת הגדול ביותר במערכת השמש?', a: ['שבתאי', 'צדק', 'נפטון', 'כדור הארץ'] }, en: { q: 'What is the largest planet in the Solar System?', a: ['Saturn', 'Jupiter', 'Neptune', 'Earth'] }, correct: 1 },
  { he: { q: 'כמה צבעים יש בקשת לפי החלוקה המסורתית?', a: ['5', '6', '7', '8'] }, en: { q: 'How many colours does a rainbow have in the traditional division?', a: ['5', '6', '7', '8'] }, correct: 2 },
  { he: { q: 'כמה דקות יש ביממה?', a: ['1,200', '1,400', '2,400', '1,440'] }, en: { q: 'How many minutes are in a day?', a: ['1,200', '1,400', '2,400', '1,440'] }, correct: 3 },
];
