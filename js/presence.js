// "N users online" using Supabase Realtime presence (no table needed).
import { sb } from './supabase.js';
import { session } from './auth.js';
import { emit } from './store.js';

export let onlineCount = 1;
let channel = null;

export function startPresence() {
  if (channel || !sb || session.offline || !session.user) return;
  channel = sb.channel('online-users', { config: { presence: { key: session.user.id } } });
  channel
    .on('presence', { event: 'sync' }, () => {
      onlineCount = Math.max(1, Object.keys(channel.presenceState()).length);
      emit('online', onlineCount);
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') await channel.track({ at: Date.now() });
    });
}
