import home from './home.js';
import games from './games.js';
import music from './music.js';
import videos from './videos.js';
import pdfs from './pdfs.js';
import books from './books.js';
import tv from './tv.js';
import ai from './ai.js';
import chat from './chat.js';
import web from './web.js';
import profile from './profile.js';
import settings from './settings.js';
import admin from './admin.js';
import { session } from '../auth.js';

const list = [home, web, games, music, videos, pdfs, books, tv, ai, chat, profile, settings, admin];

export const APPS = Object.fromEntries(list.map((a) => [a.id, a]));
export const APP_ORDER = list.map((a) => a.id);

/** Apps this person can see (the Admin app only shows for admins). */
export const visibleApps = () => APP_ORDER.filter((id) => !APPS[id].adminOnly || session.profile?.is_admin);
