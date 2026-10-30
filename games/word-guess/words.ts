/** Word lists per language and category (written natively per language, not machine-translated). */
import type { Lang } from '../../src/shared/i18n';

export const CATEGORY_KEYS = ['animals', 'food', 'countries', 'home', 'nature', 'sports', 'jobs', 'transport'] as const;
export type CategoryKey = (typeof CATEGORY_KEYS)[number];

export const WORDS: Record<Lang, Record<CategoryKey, string[]>> = {
  he: {
    animals: ['פיל', 'קנגורו', 'תנין', 'ינשוף', 'דולפין', 'זברה', 'פרפר', 'סנאי', 'היפופוטם', 'תמנון'],
    food: ['פיצה', 'שוקולד', 'אבטיח', 'פלאפל', 'ספגטי', 'המבורגר', 'עוגייה', 'תפוז', 'חביתה', 'גלידה'],
    countries: ['ישראל', 'צרפת', 'איטליה', 'יפן', 'ברזיל', 'מצרים', 'קנדה', 'אוסטרליה', 'מקסיקו', 'הודו'],
    home: ['מקרר', 'ספה', 'מנורה', 'מראה', 'כרית', 'שעון', 'מטרייה', 'מחשב', 'כיסא', 'טלוויזיה'],
    nature: ['מפל', 'קשת', 'ענן', 'מדבר', 'יער', 'אוקיינוס', 'שקיעה', 'כוכב', 'ברק', 'הר געש'],
    sports: ['כדורגל', 'כדורסל', 'טניס', 'שחייה', 'אופניים', 'התעמלות', 'כדורעף', 'ריצה', 'גלישה', 'אגרוף'],
    jobs: ['רופא', 'טייס', 'שף', 'צלם', 'נגר', 'אסטרונאוט', 'מורה', 'שוטר', 'כבאי', 'וטרינר'],
    transport: ['אוטובוס', 'רכבת', 'מטוס', 'אופנוע', 'מסוק', 'ספינה', 'טרקטור', 'צוללת', 'רכבל', 'קורקינט'],
  },
  en: {
    animals: ['ELEPHANT', 'KANGAROO', 'CROCODILE', 'OWL', 'DOLPHIN', 'ZEBRA', 'BUTTERFLY', 'SQUIRREL', 'HIPPOPOTAMUS', 'OCTOPUS'],
    food: ['PIZZA', 'CHOCOLATE', 'WATERMELON', 'PANCAKE', 'SPAGHETTI', 'HAMBURGER', 'COOKIE', 'ORANGE', 'OMELETTE', 'ICE CREAM'],
    countries: ['ISRAEL', 'FRANCE', 'ITALY', 'JAPAN', 'BRAZIL', 'EGYPT', 'CANADA', 'AUSTRALIA', 'MEXICO', 'INDIA'],
    home: ['FRIDGE', 'SOFA', 'LAMP', 'MIRROR', 'PILLOW', 'CLOCK', 'UMBRELLA', 'COMPUTER', 'CHAIR', 'TELEVISION'],
    nature: ['WATERFALL', 'RAINBOW', 'CLOUD', 'DESERT', 'FOREST', 'OCEAN', 'SUNSET', 'STAR', 'LIGHTNING', 'VOLCANO'],
    sports: ['FOOTBALL', 'BASKETBALL', 'TENNIS', 'SWIMMING', 'CYCLING', 'GYMNASTICS', 'VOLLEYBALL', 'RUNNING', 'SURFING', 'BOXING'],
    jobs: ['DOCTOR', 'PILOT', 'CHEF', 'PHOTOGRAPHER', 'CARPENTER', 'ASTRONAUT', 'TEACHER', 'POLICE OFFICER', 'FIREFIGHTER', 'VETERINARIAN'],
    transport: ['BUS', 'TRAIN', 'AIRPLANE', 'MOTORCYCLE', 'HELICOPTER', 'SHIP', 'TRACTOR', 'SUBMARINE', 'CABLE CAR', 'SCOOTER'],
  },
  ar: {
    animals: ['فيل', 'كنغر', 'تمساح', 'بومة', 'دلفين', 'حمار وحشي', 'فراشة', 'سنجاب', 'فرس النهر', 'أخطبوط'],
    food: ['بيتزا', 'شوكولاتة', 'بطيخ', 'فلافل', 'معكرونة', 'همبرغر', 'بسكويت', 'برتقال', 'عجة', 'بوظة'],
    countries: ['فرنسا', 'إيطاليا', 'اليابان', 'البرازيل', 'مصر', 'كندا', 'أستراليا', 'المكسيك', 'الهند', 'المغرب'],
    home: ['ثلاجة', 'أريكة', 'مصباح', 'مرآة', 'وسادة', 'ساعة', 'مظلة', 'حاسوب', 'كرسي', 'تلفاز'],
    nature: ['شلال', 'قوس قزح', 'غيمة', 'غابة', 'محيط', 'غروب', 'نجمة', 'برق', 'بركان', 'جبل'],
    sports: ['كرة القدم', 'كرة السلة', 'تنس', 'سباحة', 'دراجة', 'جمباز', 'كرة الطائرة', 'جري', 'تزلج', 'ملاكمة'],
    jobs: ['طبيب', 'طيار', 'طاهي', 'مصور', 'نجار', 'مهندس', 'معلم', 'شرطي', 'إطفائي', 'بيطري'],
    transport: ['حافلة', 'قطار', 'طائرة', 'دراجة نارية', 'مروحية', 'سفينة', 'جرار', 'غواصة', 'تلفريك', 'سيارة'],
  },
  ru: {
    animals: ['СЛОН', 'КЕНГУРУ', 'КРОКОДИЛ', 'СОВА', 'ДЕЛЬФИН', 'ЗЕБРА', 'БАБОЧКА', 'БЕЛКА', 'БЕГЕМОТ', 'ОСЬМИНОГ'],
    food: ['ПИЦЦА', 'ШОКОЛАД', 'АРБУЗ', 'БЛИНЫ', 'СПАГЕТТИ', 'ГАМБУРГЕР', 'ПЕЧЕНЬЕ', 'АПЕЛЬСИН', 'ОМЛЕТ', 'МОРОЖЕНОЕ'],
    countries: ['ФРАНЦИЯ', 'ИТАЛИЯ', 'ЯПОНИЯ', 'БРАЗИЛИЯ', 'ЕГИПЕТ', 'КАНАДА', 'АВСТРАЛИЯ', 'МЕКСИКА', 'ИНДИЯ', 'ИЗРАИЛЬ'],
    home: ['ХОЛОДИЛЬНИК', 'ДИВАН', 'ЛАМПА', 'ЗЕРКАЛО', 'ПОДУШКА', 'ЧАСЫ', 'ЗОНТИК', 'КОМПЬЮТЕР', 'СТУЛ', 'ТЕЛЕВИЗОР'],
    nature: ['ВОДОПАД', 'РАДУГА', 'ОБЛАКО', 'ПУСТЫНЯ', 'ЛЕС', 'ОКЕАН', 'ЗАКАТ', 'ЗВЕЗДА', 'МОЛНИЯ', 'ВУЛКАН'],
    sports: ['ФУТБОЛ', 'БАСКЕТБОЛ', 'ТЕННИС', 'ПЛАВАНИЕ', 'ВЕЛОСПОРТ', 'ГИМНАСТИКА', 'ВОЛЕЙБОЛ', 'БЕГ', 'СЁРФИНГ', 'БОКС'],
    jobs: ['ВРАЧ', 'ПИЛОТ', 'ПОВАР', 'ФОТОГРАФ', 'ПЛОТНИК', 'КОСМОНАВТ', 'УЧИТЕЛЬ', 'ПОЛИЦЕЙСКИЙ', 'ПОЖАРНЫЙ', 'ВЕТЕРИНАР'],
    transport: ['АВТОБУС', 'ПОЕЗД', 'САМОЛЁТ', 'МОТОЦИКЛ', 'ВЕРТОЛЁТ', 'КОРАБЛЬ', 'ТРАКТОР', 'ПОДЛОДКА', 'ТРАМВАЙ', 'САМОКАТ'],
  },
  es: {
    animals: ['ELEFANTE', 'CANGURO', 'COCODRILO', 'BÚHO', 'DELFÍN', 'CEBRA', 'MARIPOSA', 'ARDILLA', 'HIPOPÓTAMO', 'PULPO'],
    food: ['PIZZA', 'CHOCOLATE', 'SANDÍA', 'CHURROS', 'ESPAGUETIS', 'HAMBURGUESA', 'GALLETA', 'NARANJA', 'TORTILLA', 'HELADO'],
    countries: ['ISRAEL', 'FRANCIA', 'ITALIA', 'JAPÓN', 'BRASIL', 'EGIPTO', 'CANADÁ', 'AUSTRALIA', 'MÉXICO', 'INDIA'],
    home: ['NEVERA', 'SOFÁ', 'LÁMPARA', 'ESPEJO', 'ALMOHADA', 'RELOJ', 'PARAGUAS', 'ORDENADOR', 'SILLA', 'TELEVISIÓN'],
    nature: ['CASCADA', 'ARCOÍRIS', 'NUBE', 'DESIERTO', 'BOSQUE', 'OCÉANO', 'ATARDECER', 'ESTRELLA', 'RELÁMPAGO', 'VOLCÁN'],
    sports: ['FÚTBOL', 'BALONCESTO', 'TENIS', 'NATACIÓN', 'CICLISMO', 'GIMNASIA', 'VOLEIBOL', 'ATLETISMO', 'SURF', 'BOXEO'],
    jobs: ['MÉDICO', 'PILOTO', 'COCINERO', 'FOTÓGRAFO', 'CARPINTERO', 'ASTRONAUTA', 'PROFESOR', 'POLICÍA', 'BOMBERO', 'VETERINARIO'],
    transport: ['AUTOBÚS', 'TREN', 'AVIÓN', 'MOTOCICLETA', 'HELICÓPTERO', 'BARCO', 'TRACTOR', 'SUBMARINO', 'TELEFÉRICO', 'PATINETE'],
  },
  fr: {
    animals: ['ÉLÉPHANT', 'KANGOUROU', 'CROCODILE', 'HIBOU', 'DAUPHIN', 'ZÈBRE', 'PAPILLON', 'ÉCUREUIL', 'HIPPOPOTAME', 'PIEUVRE'],
    food: ['PIZZA', 'CHOCOLAT', 'PASTÈQUE', 'CRÊPE', 'SPAGHETTIS', 'HAMBURGER', 'BISCUIT', 'ORANGE', 'OMELETTE', 'GLACE'],
    countries: ['ISRAËL', 'FRANCE', 'ITALIE', 'JAPON', 'BRÉSIL', 'ÉGYPTE', 'CANADA', 'AUSTRALIE', 'MEXIQUE', 'INDE'],
    home: ['FRIGO', 'CANAPÉ', 'LAMPE', 'MIROIR', 'OREILLER', 'HORLOGE', 'PARAPLUIE', 'ORDINATEUR', 'CHAISE', 'TÉLÉVISION'],
    nature: ['CASCADE', 'ARC-EN-CIEL', 'NUAGE', 'DÉSERT', 'FORÊT', 'OCÉAN', 'ÉTOILE', 'ÉCLAIR', 'VOLCAN', 'MONTAGNE'],
    sports: ['FOOTBALL', 'BASKET', 'TENNIS', 'NATATION', 'CYCLISME', 'GYMNASTIQUE', 'VOLLEY', 'COURSE', 'SURF', 'BOXE'],
    jobs: ['MÉDECIN', 'PILOTE', 'CUISINIER', 'PHOTOGRAPHE', 'MENUISIER', 'ASTRONAUTE', 'PROFESSEUR', 'POLICIER', 'POMPIER', 'VÉTÉRINAIRE'],
    transport: ['AUTOBUS', 'TRAIN', 'AVION', 'MOTO', 'HÉLICOPTÈRE', 'BATEAU', 'TRACTEUR', 'SOUS-MARIN', 'TÉLÉPHÉRIQUE', 'TROTTINETTE'],
  },
};
