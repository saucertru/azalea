// Game favourites + play stats (plays, play time, last played).
// Saved in the browser, and in your account (game_stats table) when logged
// in, so they follow you to other devices and show on your profile.
import { sb } from './supabase.js';
import { session } from './auth.js';
import { getLocal, setLocal, emit, on } from './store.js';

const KEY = 'games.stats';
const loggedIn = () => Boolean(sb && session.user && !session.guest && !session.offline);

/** id -> { title, plays, seconds, favourite, last } */
let stats = {};
let loadedFor = null; // user id the stats were loaded for (or 'local')

function loadLocal() {
  stats = getLocal(KEY, {});
  // older versions kept favourites in their own list
  const oldFavs = getLocal('games.favs', null);
  if (oldFavs) {
    for (const id of oldFavs) (stats[id] ||= blank()).favourite = true;
    setLocal('games.favs', null);
    setLocal(KEY, stats);
  }
}
const blank = () => ({ title: '', plays: 0, seconds: 0, favourite: false, last: null });
const saveLocal = () => setLocal(KEY, stats);

/** Loads stats (from the account when logged in). Safe to call often. */
export async function loadStats() {
  const who = loggedIn() ? session.user.id : 'local';
  if (loadedFor === who) return stats;
  loadedFor = who;
  loadLocal();
  if (who === 'local') return stats;
  const { data, error } = await sb.from('game_stats').select('game_id, title, plays, seconds, favourite, last_played').eq('user_id', who);
  if (error) { console.warn('game stats:', error.message); return stats; }
  const local = stats;
  stats = {};
  for (const r of data) stats[r.game_id] = { title: r.title || '', plays: r.plays, seconds: r.seconds, favourite: r.favourite, last: r.last_played };
  // first time on this account: bring this browser's stats along
  if (!data.length && Object.keys(local).length) {
    stats = local;
    for (const id of Object.keys(stats)) queue(id);
  }
  saveLocal();
  emit('gamestats');
  return stats;
}

on('auth', () => { loadedFor = null; });

// ---- saving to the account (batched)
const pending = new Set();
let timer = null;
function queue(id) {
  if (!loggedIn()) return;
  pending.add(id);
  clearTimeout(timer);
  timer = setTimeout(flush, 2500);
}
export async function flush() {
  clearTimeout(timer);
  if (!loggedIn() || !pending.size) return;
  const rows = [...pending].map((id) => {
    const s = stats[id];
    return { user_id: session.user.id, game_id: id, title: (s.title || '').slice(0, 200), plays: s.plays, seconds: Math.round(s.seconds), favourite: s.favourite, last_played: s.last };
  });
  pending.clear();
  const { error } = await sb.from('game_stats').upsert(rows, { onConflict: 'user_id,game_id' });
  if (error) console.warn('game stats save:', error.message);
}
addEventListener('pagehide', () => { flush(); });

function touch(g) {
  const s = (stats[g.id] ||= blank());
  if (g.title) s.title = g.title;
  return s;
}

export const getStat = (id) => stats[id] || blank();
export const isFavourite = (id) => Boolean(stats[id]?.favourite);
export const allStats = () => stats;

export function toggleFavourite(g) {
  const s = touch(g);
  s.favourite = !s.favourite;
  saveLocal();
  queue(g.id);
  emit('gamestats');
  return s.favourite;
}

/**
 * Counts a play and tracks time while `frame` stays on the page and the
 * tab is visible. Stops by itself when the game is closed.
 */
export function trackPlay(g, frame) {
  const s = touch(g);
  s.plays++;
  s.last = new Date().toISOString();
  saveLocal();
  queue(g.id);
  let lastTick = Date.now();
  const STEP = 15000;
  const t = setInterval(() => {
    const now = Date.now();
    if (!frame.isConnected) {
      clearInterval(t);
      flush();
      return;
    }
    if (document.visibilityState === 'visible') {
      // cap each step so sleeping computers don't count
      s.seconds += Math.min(now - lastTick, STEP * 2) / 1000;
      saveLocal();
      queue(g.id);
    }
    lastTick = now;
  }, STEP);
}

/** "2h 5m", "12m", "<1m" */
export function formatPlaytime(sec) {
  const m = Math.floor((sec || 0) / 60);
  if (m < 1) return '<1m';
  const hrs = Math.floor(m / 60);
  return hrs ? `${hrs}h ${m % 60}m` : `${m}m`;
}

/** Another user's top games, for their profile. */
export async function statsFor(userId) {
  if (!sb) return [];
  const { data, error } = await sb.from('game_stats')
    .select('game_id, title, plays, seconds, favourite, last_played')
    .eq('user_id', userId).order('seconds', { ascending: false }).limit(50);
  return error ? [] : data;
}
