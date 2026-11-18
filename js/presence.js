// Who's online (Supabase Realtime presence, no table needed).
// Everyone shares their status: online, idle or do not disturb. Invisible
// people aren't shared at all, so they look offline. Online switches to
// idle after 10 minutes without using the site.
import { sb } from './supabase.js';
import { session } from './auth.js';
import { emit, on } from './store.js';

export let onlineCount = 1;
let statuses = new Map(); // user id -> 'online' | 'idle' | 'dnd'
let channel = null;
let tracked = null;
let idle = false;

/** 'online' | 'idle' | 'dnd', or null when offline / invisible */
export const statusOf = (userId) => statuses.get(userId) || null;
export const isOnline = (userId) => statuses.has(userId);

function myStatus() {
  const chosen = session.profile?.status || 'online';
  if (chosen === 'invisible') return null;
  return chosen === 'online' && idle ? 'idle' : chosen;
}

async function sync() {
  if (!channel || session.guest) return;
  const s = myStatus();
  if (s === tracked) return;
  tracked = s;
  if (s) await channel.track({ status: s, at: Date.now() });
  else await channel.untrack();
}

export function startPresence() {
  if (channel || !sb || session.offline || !session.user) return;
  // guests see the count but aren't counted (they have no account id)
  const key = session.guest ? `guest-${Math.random().toString(36).slice(2)}` : session.user.id;
  channel = sb.channel('online-users', { config: { presence: { key } } });
  channel
    .on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState();
      const keys = Object.keys(state);
      statuses = new Map();
      for (const k of keys) {
        if (k.startsWith('guest-')) continue;
        const metas = state[k] || [];
        const last = metas[metas.length - 1] || {};
        statuses.set(k, ['online', 'idle', 'dnd'].includes(last.status) ? last.status : 'online');
      }
      onlineCount = Math.max(1, keys.length);
      emit('online', onlineCount);
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') { tracked = undefined; sync(); }
    });

  // auto idle after 10 minutes without activity
  let last = Date.now();
  const wake = () => {
    last = Date.now();
    if (idle) { idle = false; sync(); }
  };
  for (const ev of ['pointerdown', 'keydown', 'pointermove', 'wheel', 'touchstart']) addEventListener(ev, wake, { passive: true });
  setInterval(() => {
    if (!idle && Date.now() - last > 10 * 60 * 1000) { idle = true; sync(); }
  }, 30000);
  on('profile', sync); // changed status in your profile
}
