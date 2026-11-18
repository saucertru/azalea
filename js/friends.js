// Friends: requests by username, accept/decline, and opening a direct
// message (a private two-person chat room) with a friend.
import { sb } from './supabase.js';
import { session, cacheProfile } from './auth.js';
import { emit } from './store.js';
import { PROFILE_COLS, displayName } from './profilekit.js';

export const canUseFriends = () => Boolean(sb && session.user && !session.guest && !session.offline);

/**
 * { friends: [{ id, user, since }], incoming: [{ id, user }], outgoing: [{ id, user }] }
 * `id` is the friendship id; `user` is the other person's profile.
 */
export async function loadFriends() {
  const empty = { friends: [], incoming: [], outgoing: [] };
  if (!canUseFriends()) return empty;
  const { data, error } = await sb.from('friendships').select('id, requester, addressee, status, created_at').order('created_at');
  if (error) throw error;
  const me = session.user.id;
  const otherIds = [...new Set(data.map((f) => (f.requester === me ? f.addressee : f.requester)))];
  const profiles = new Map();
  if (otherIds.length) {
    const { data: ps } = await sb.from('profiles').select(PROFILE_COLS).in('id', otherIds);
    for (const p of ps || []) { profiles.set(p.id, p); cacheProfile(p); }
  }
  const out = empty;
  for (const f of data) {
    const other = f.requester === me ? f.addressee : f.requester;
    const user = profiles.get(other) || { id: other, username: 'unknown' };
    if (f.status === 'accepted') out.friends.push({ id: f.id, user, since: f.created_at });
    else if (f.addressee === me) out.incoming.push({ id: f.id, user });
    else out.outgoing.push({ id: f.id, user });
  }
  out.friends.sort((a, b) => displayName(a.user).localeCompare(displayName(b.user)));
  return out;
}

const friendlyError = (e) => {
  const m = e?.message || String(e);
  if (/friendships_pair|duplicate/i.test(m)) return 'You already have a request with them';
  return m;
};

/** Returns 'sent' or 'accepted' (if they'd already asked you). */
export async function sendRequest(username) {
  const { data, error } = await sb.rpc('send_friend_request', { friend_name: username });
  if (error) throw new Error(friendlyError(error));
  emit('friends');
  return data.status === 'accepted' ? 'accepted' : 'sent';
}

export async function acceptRequest(id) {
  const { error } = await sb.rpc('accept_friend_request', { request_id: id });
  if (error) throw new Error(friendlyError(error));
  emit('friends');
}

/** Decline, cancel or unfriend (also closes your DM with them). */
export async function removeFriendship(id) {
  const { error } = await sb.from('friendships').delete().eq('id', id);
  if (error) throw new Error(friendlyError(error));
  emit('friends');
}

/** The DM room with a friend (made the first time). */
export async function openDm(userId) {
  const { data, error } = await sb.rpc('open_dm', { friend: userId });
  if (error) throw new Error(friendlyError(error));
  return data;
}

/** How you're connected to someone: 'friend' | 'incoming' | 'outgoing' | null, plus the friendship id. */
export async function relationTo(userId) {
  if (!canUseFriends() || userId === session.user.id) return { rel: 'self' };
  const me = session.user.id;
  const { data } = await sb.from('friendships').select('id, requester, addressee, status')
    .or(`and(requester.eq.${me},addressee.eq.${userId}),and(requester.eq.${userId},addressee.eq.${me})`).maybeSingle();
  if (!data) return { rel: null };
  if (data.status === 'accepted') return { rel: 'friend', id: data.id };
  return { rel: data.addressee === me ? 'incoming' : 'outgoing', id: data.id };
}

// live updates: new requests, accepts, removals
let channel = null;
export function watchFriends() {
  if (channel || !canUseFriends()) return;
  channel = sb.channel('friendships-watch')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships' }, () => emit('friends'))
    .subscribe();
}
