import type { Lang } from '../../../src/shared/i18n';
import { ar } from './ar';
import { en } from './en';
import { es } from './es';
import { fr } from './fr';
import { he, type TriviaDict } from './he';
import { ru } from './ru';

export const DICTS: Record<Lang, TriviaDict> & { en: TriviaDict } = { he, en, ar, ru, es, fr };
