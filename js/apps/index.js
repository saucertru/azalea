import home from './home.js';
import games from './games.js';
import music from './music.js';
import videos from './videos.js';
import pdfs from './pdfs.js';
import books from './books.js';
import tv from './tv.js';
import ai from './ai.js';
import chat from './chat.js';
import profile from './profile.js';
import settings from './settings.js';

const list = [home, games, music, videos, pdfs, books, tv, ai, chat, profile, settings];

export const APPS = Object.fromEntries(list.map((a) => [a.id, a]));
export const APP_ORDER = list.map((a) => a.id);
