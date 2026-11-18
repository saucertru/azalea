// Emulator cloud saves. play.html (the ROM player, in a frame on this site)
// calls window.parent.__azaleaCloud to keep save states and in-game saves
// in the person's account: Supabase storage bucket "saves", in a folder
// only they can read (saves/<user id>/<game id>.state / .srm).
import { sb } from './supabase.js';
import { session } from './auth.js';

const enabled = () => Boolean(sb && session.user && !session.guest && !session.offline);
const safeId = (id) => String(id || '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').slice(0, 150);
const pathFor = (gameId, kind) => `${session.user.id}/${safeId(gameId)}.${kind === 'state' ? 'state' : 'srm'}`;

window.__azaleaCloud = {
  enabled,
  /** Uint8Array, or null when there's no save yet */
  async get(gameId, kind) {
    if (!enabled() || !safeId(gameId)) return null;
    const { data, error } = await sb.storage.from('saves').download(pathFor(gameId, kind));
    if (error || !data) return null;
    return new Uint8Array(await data.arrayBuffer());
  },
  async put(gameId, kind, bytes) {
    if (!enabled()) throw new Error('Log in to use cloud saves');
    if (!safeId(gameId)) throw new Error('Unknown game');
    const { error } = await sb.storage.from('saves').upload(pathFor(gameId, kind), new Blob([bytes], { type: 'application/octet-stream' }), {
      upsert: true, contentType: 'application/octet-stream', cacheControl: '0',
    });
    if (error) throw error;
  },
};
