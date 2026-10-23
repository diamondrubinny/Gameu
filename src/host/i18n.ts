export type Lang = 'he' | 'en';

const he = {
  appName: 'Gameu',
  games: 'משחקים',
  settings: 'הגדרות',
  settingsDesc: 'שפה, נגישות וחדר',
  joinTitle: 'הצטרפו מהטלפון',
  joinScan: 'סרקו את הקוד במצלמה',
  roomCode: 'קוד חדר',
  orBrowse: 'או היכנסו לכתובת:',
  players: 'שחקנים',
  noPlayers: 'עדיין אין שחקנים — סרקו את הקוד כדי להצטרף',
  admin: 'מנהל/ת',
  disconnected: 'מנותק/ת',
  playersRange: (min: number, max: number) => (min === max ? `${min} שחקנים` : `${min} עד ${max} שחקנים`),
  needPlayers: (n: number) => (n === 1 ? 'צריך לפחות שחקן/ית אחד/ת' : `צריך לפחות ${n} שחקנים`),
  hintAdmin: (name: string) => `${name} 👑 שולט/ת בתפריט מהטלפון`,
  hintNoAdmin: 'השחקן/ית הראשון/ה שמצטרף/ת שולט/ת בתפריט',
  waitingForAdmin: (name: string) => `${name} בוחר/ת משחק…`,
  menuTitle: 'בחרו משחק',
  joined: (name: string) => `${name} הצטרף/ה`,
  left: (name: string) => `${name} התנתק/ה`,
  loadingGame: 'טוען משחק…',
  exitTitle: 'לצאת מהמשחק?',
  exitBody: 'ההתקדמות במשחק הנוכחי תאבד.',
  yes: 'כן, לצאת',
  no: 'המשך לשחק',
  results: 'תוצאות',
  backToMenu: 'חזרה לתפריט',
  points: 'נק׳',
  gameFailed: 'המשחק לא נטען. חוזרים לתפריט.',
  exitHint: 'יציאה: כפתור 🏠 בטלפון של המנהל/ת',
  connecting: 'מתחבר לשרת המקומי…',
  hostReplaced: 'מסך הקונסולה נפתח בחלון אחר. אפשר לסגור את החלון הזה.',
  hostForbidden: 'מסך הקונסולה זמין רק במחשב שמריץ את Gameu.',
  // settings
  language: 'שפה',
  languageValue: 'עברית',
  textSize: 'גודל טקסט',
  highContrast: 'ניגודיות גבוהה',
  reduceMotion: 'הפחתת תנועה',
  extendedTime: 'זמן מורחב במשחקים',
  volume: 'עוצמת צלילים',
  roomLock: 'נעילת חדר (שחקנים חדשים לא יוכלו להצטרף)',
  newCode: 'החלפת קוד חדר',
  kick: (name: string) => `הוצאת ${name} מהחדר`,
  accessibility: 'הצהרת נגישות',
  privacy: 'פרטיות ועוגיות',
  back: 'חזרה',
  on: 'פועל',
  off: 'כבוי',
  settingsSaved: 'ההגדרות נשמרו',
  codeChanged: 'קוד החדר הוחלף',
  locked: 'החדר נעול',
  close: 'סגירה (חזרה)',
};

type Dict = typeof he;

const en: Dict = {
  appName: 'Gameu',
  games: 'Games',
  settings: 'Settings',
  settingsDesc: 'Language, accessibility & room',
  joinTitle: 'Join from your phone',
  joinScan: 'Scan the code with your camera',
  roomCode: 'Room code',
  orBrowse: 'Or open:',
  players: 'Players',
  noPlayers: 'No players yet — scan the code to join',
  admin: 'Admin',
  disconnected: 'Disconnected',
  playersRange: (min, max) => (min === max ? `${min} players` : `${min}–${max} players`),
  needPlayers: (n) => (n === 1 ? 'Needs at least 1 player' : `Needs at least ${n} players`),
  hintAdmin: (name) => `${name} 👑 controls the menu from their phone`,
  hintNoAdmin: 'The first player to join controls the menu',
  waitingForAdmin: (name) => `${name} is choosing a game…`,
  menuTitle: 'Choose a game',
  joined: (name) => `${name} joined`,
  left: (name) => `${name} disconnected`,
  loadingGame: 'Loading game…',
  exitTitle: 'Quit the game?',
  exitBody: 'Progress in the current game will be lost.',
  yes: 'Yes, quit',
  no: 'Keep playing',
  results: 'Results',
  backToMenu: 'Back to menu',
  points: 'pts',
  gameFailed: 'The game failed to load. Returning to the menu.',
  exitHint: 'Quit: 🏠 button on the admin phone',
  connecting: 'Connecting to the local server…',
  hostReplaced: 'The console screen was opened in another window. You can close this one.',
  hostForbidden: 'The console screen is available only on the computer running Gameu.',
  language: 'Language',
  languageValue: 'English',
  textSize: 'Text size',
  highContrast: 'High contrast',
  reduceMotion: 'Reduce motion',
  extendedTime: 'Extended time in games',
  volume: 'Sound volume',
  roomLock: 'Lock room (new players cannot join)',
  newCode: 'Change room code',
  kick: (name) => `Remove ${name} from the room`,
  accessibility: 'Accessibility statement',
  privacy: 'Privacy & cookies',
  back: 'Back',
  on: 'On',
  off: 'Off',
  settingsSaved: 'Settings saved',
  codeChanged: 'Room code changed',
  locked: 'Room locked',
  close: 'Close (back)',
};

let current: Dict = he;
let currentLang: Lang = 'he';

export function setLang(lang: Lang): void {
  currentLang = lang;
  current = lang === 'en' ? en : he;
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'he' ? 'rtl' : 'ltr';
}

export function lang(): Lang {
  return currentLang;
}

export const t = new Proxy({} as Dict, { get: (_t, key: string) => current[key as keyof Dict] });
