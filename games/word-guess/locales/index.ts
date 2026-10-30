import type { Lang } from '../../../src/shared/i18n';
import { ar } from './ar';
import { en } from './en';
import { es } from './es';
import { fr } from './fr';
import { he, type WordDict } from './he';
import { ru } from './ru';

export const DICTS: Record<Lang, WordDict> & { en: WordDict } = { he, en, ar, ru, es, fr };
