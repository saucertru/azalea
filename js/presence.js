// "N users online" using Supabase Realtime presence (no table needed).
import { sb } from './supabase.js';
import { session } from './auth.js';
import { emit } from './store.js';

export let onlineCount = 1;
let onlineIds = new Set();
let channel = null;

/** Is this user online right now? (account users only) */
export const isOnline = (userId) => onlineIds.has(userId);

export function startPresence() {
  if (channel || !sb || session.offline || !session.user) return;
  // guests see the count but aren't counted (they have no account id)
  const key = session.guest ? `guest-${Math.random().toString(36).slice(2)}` : session.user.id;
  channel = sb.channel('online-users', { config: { presence: { key } } });
  channel
    .on('presence', { event: 'sync' }, () => {
      const keys = Object.keys(channel.presenceState());
      onlineIds = new Set(keys.filter((k) => !k.startsWith('guest-')));
      onlineCount = Math.max(1, keys.length);
      emit('online', onlineCount);
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED' && !session.guest) await channel.track({ at: Date.now() });
    });
}
