/**
 * The trivia database: data/<category>.json (Hebrew + English) plus i18n/<lang>/<category>.json
 * translations, all bundled into the game at build time. Generated imports — keep in sync with CATEGORIES.
 */
import { CATEGORIES } from './categories';
import type { Localized, Question } from './contest';
import general from './data/general.json';
import geography from './data/geography.json';
import history from './data/history.json';
import science from './data/science.json';
import space from './data/space.json';
import nature from './data/nature.json';
import body from './data/body.json';
import sports from './data/sports.json';
import music from './data/music.json';
import movies from './data/movies.json';
import literature from './data/literature.json';
import art from './data/art.json';
import food from './data/food.json';
import tech from './data/tech.json';
import math from './data/math.json';
import israel from './data/israel.json';
import ar_general from './i18n/ar/general.json';
import ar_geography from './i18n/ar/geography.json';
import ar_history from './i18n/ar/history.json';
import ar_science from './i18n/ar/science.json';
import ar_space from './i18n/ar/space.json';
import ar_nature from './i18n/ar/nature.json';
import ar_body from './i18n/ar/body.json';
import ar_sports from './i18n/ar/sports.json';
import ar_music from './i18n/ar/music.json';
import ar_movies from './i18n/ar/movies.json';
import ar_literature from './i18n/ar/literature.json';
import ar_art from './i18n/ar/art.json';
import ar_food from './i18n/ar/food.json';
import ar_tech from './i18n/ar/tech.json';
import ar_math from './i18n/ar/math.json';
import ar_israel from './i18n/ar/israel.json';
import ru_general from './i18n/ru/general.json';
import ru_geography from './i18n/ru/geography.json';
import ru_history from './i18n/ru/history.json';
import ru_science from './i18n/ru/science.json';
import ru_space from './i18n/ru/space.json';
import ru_nature from './i18n/ru/nature.json';
import ru_body from './i18n/ru/body.json';
import ru_sports from './i18n/ru/sports.json';
import ru_music from './i18n/ru/music.json';
import ru_movies from './i18n/ru/movies.json';
import ru_literature from './i18n/ru/literature.json';
import ru_art from './i18n/ru/art.json';
import ru_food from './i18n/ru/food.json';
import ru_tech from './i18n/ru/tech.json';
import ru_math from './i18n/ru/math.json';
import ru_israel from './i18n/ru/israel.json';
import es_general from './i18n/es/general.json';
import es_geography from './i18n/es/geography.json';
import es_history from './i18n/es/history.json';
import es_science from './i18n/es/science.json';
import es_space from './i18n/es/space.json';
import es_nature from './i18n/es/nature.json';
import es_body from './i18n/es/body.json';
import es_sports from './i18n/es/sports.json';
import es_music from './i18n/es/music.json';
import es_movies from './i18n/es/movies.json';
import es_literature from './i18n/es/literature.json';
import es_art from './i18n/es/art.json';
import es_food from './i18n/es/food.json';
import es_tech from './i18n/es/tech.json';
import es_math from './i18n/es/math.json';
import es_israel from './i18n/es/israel.json';
import fr_general from './i18n/fr/general.json';
import fr_geography from './i18n/fr/geography.json';
import fr_history from './i18n/fr/history.json';
import fr_science from './i18n/fr/science.json';
import fr_space from './i18n/fr/space.json';
import fr_nature from './i18n/fr/nature.json';
import fr_body from './i18n/fr/body.json';
import fr_sports from './i18n/fr/sports.json';
import fr_music from './i18n/fr/music.json';
import fr_movies from './i18n/fr/movies.json';
import fr_literature from './i18n/fr/literature.json';
import fr_art from './i18n/fr/art.json';
import fr_food from './i18n/fr/food.json';
import fr_tech from './i18n/fr/tech.json';
import fr_math from './i18n/fr/math.json';
import fr_israel from './i18n/fr/israel.json';

type Raw = Omit<Question, 'cat'>;
type Translations = Record<string, Localized>;

const FILES: Record<string, unknown[]> = { general, geography, history, science, space, nature, body, sports, music, movies, literature, art, food, tech, math, israel };

const TRANSLATIONS: Record<'ar' | 'ru' | 'es' | 'fr', Record<string, Translations>> = {
  ar: { general: ar_general, geography: ar_geography, history: ar_history, science: ar_science, space: ar_space, nature: ar_nature, body: ar_body, sports: ar_sports, music: ar_music, movies: ar_movies, literature: ar_literature, art: ar_art, food: ar_food, tech: ar_tech, math: ar_math, israel: ar_israel },
  ru: { general: ru_general, geography: ru_geography, history: ru_history, science: ru_science, space: ru_space, nature: ru_nature, body: ru_body, sports: ru_sports, music: ru_music, movies: ru_movies, literature: ru_literature, art: ru_art, food: ru_food, tech: ru_tech, math: ru_math, israel: ru_israel },
  es: { general: es_general, geography: es_geography, history: es_history, science: es_science, space: es_space, nature: es_nature, body: es_body, sports: es_sports, music: es_music, movies: es_movies, literature: es_literature, art: es_art, food: es_food, tech: es_tech, math: es_math, israel: es_israel },
  fr: { general: fr_general, geography: fr_geography, history: fr_history, science: fr_science, space: fr_space, nature: fr_nature, body: fr_body, sports: fr_sports, music: fr_music, movies: fr_movies, literature: fr_literature, art: fr_art, food: fr_food, tech: fr_tech, math: fr_math, israel: fr_israel },
};

export const QUESTIONS: Question[] = CATEGORIES.flatMap((c) =>
  ((FILES[c.id] ?? []) as Raw[]).map((q) => {
    const out: Question = { ...q, cat: c.id };
    for (const [lang, byCat] of Object.entries(TRANSLATIONS) as [keyof typeof TRANSLATIONS, Record<string, Translations>][]) {
      const tr = byCat[c.id]?.[q.id];
      if (tr) out[lang] = tr;
    }
    return out;
  }),
);
