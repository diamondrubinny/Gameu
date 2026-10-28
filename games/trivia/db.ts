/** The trivia database: every data/<category>.json file, bundled into the game at build time. */
import { CATEGORIES } from './categories';
import type { Question } from './contest';
import art from './data/art.json';
import body from './data/body.json';
import food from './data/food.json';
import general from './data/general.json';
import geography from './data/geography.json';
import history from './data/history.json';
import israel from './data/israel.json';
import literature from './data/literature.json';
import math from './data/math.json';
import movies from './data/movies.json';
import music from './data/music.json';
import nature from './data/nature.json';
import science from './data/science.json';
import space from './data/space.json';
import sports from './data/sports.json';
import tech from './data/tech.json';

type Raw = Omit<Question, 'cat'>;

const FILES: Record<string, unknown[]> = { general, geography, history, science, space, nature, body, sports, music, movies, literature, art, food, tech, math, israel };

export const QUESTIONS: Question[] = CATEGORIES.flatMap((c) => ((FILES[c.id] ?? []) as Raw[]).map((q) => ({ ...q, cat: c.id })));
