// Accounts: Supabase auth + profiles. Falls back to a local "setup mode"
// profile when Supabase keys are not set yet, so the site is still usable.
import { PROFILE_COLS } from './profilekit.js';
import { sb, configured } from './supabase.js';
import { settings, saveSettings, setSyncHook, emit, getLocal, setLocal } from './store.js';
import { resizeImage, blobToDataUrl, confirmBox } from './ui.js';

export const session = { user: null, profile: null, offline: !configured || !sb, guest: false };

/** True when the profile lives in this browser only (setup mode or guest). */
export const isLocal = () => session.offline || session.guest;
const localKey = () => (session.offline ? 'localProfile' : 'guestProfile');

function guestName() {
  return `Guest${Math.floor(1000 + Math.random() * 9000)}`;
}

/** Use the site without an account. Profile + settings stay in this browser. */
export function continueAsGuest() {
  session.guest = true;
  const p = getLocal('guestProfile', null) || { id: 'guest', username: guestName(), avatar_url: null, banner_url: null, bio: '', created_at: new Date().toISOString() };
  setLocal('guestProfile', p);
  session.user = { id: 'guest' };
  session.profile = p;
}

/** Leave guest mode and go back to the log in / sign up screen. */
export function leaveGuest() {
  localStorage.removeItem('azelela.guestProfile');
  session.guest = false;
  session.user = null;
  session.profile = null;
  emit('auth', session);
}

/** Shown when a guest tries something that needs an account. */
export async function promptAccount(what) {
  if (await confirmBox('You need an account', `${what} needs an account. Your theme and settings stay as they are.`, 'Log in or sign up')) leaveGuest();
}

const profileCache = new Map();

export async function initAuth() {
  if (session.offline) {
    const p = getLocal('localProfile', null);
    if (p) {
      session.user = { id: 'local' };
      session.profile = p;
    }
    return;
  }
  const { data } = await sb.auth.getSession();
  if (data.session) {
    session.user = data.session.user;
    await loadOwnProfile();
    localStorage.removeItem('azelela.guestProfile');
  } else {
    const g = getLocal('guestProfile', null);
    if (g) {
      session.guest = true;
      session.user = { id: 'guest' };
      session.profile = g;
    }
  }
  sb.auth.onAuthStateChange(async (event, s) => {
    if (event === 'SIGNED_OUT') {
      session.user = null;
      session.profile = null;
      emit('auth', session);
    } else if (s?.user && s.user.id !== session.user?.id) {
      endGuest();
      session.user = s.user;
      await loadOwnProfile();
      emit('auth', session);
    }
  });
  setSyncHook(pushSettings);
}

function endGuest() {
  if (!session.guest) return;
  session.guest = false;
  localStorage.removeItem('azelela.guestProfile');
}

async function loadOwnProfile() {
  const { data, error } = await sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
  if (error) console.error(error);
  session.profile = data || null;
  if (data) profileCache.set(data.id, data);
  // Settings saved on the account win on a fresh browser
  if (data?.settings && Object.keys(data.settings).length && !settings.onboarded) {
    saveSettings({ ...data.settings, onboarded: true }, { sync: false });
  }
}

async function pushSettings(s) {
  if (!sb || !session.user || session.guest) return;
  const copy = { ...s };
  if (copy.background?.startsWith('data:')) delete copy.background; // too big for the profile row
  await sb.from('profiles').update({ settings: copy }).eq('id', session.user.id);
}

export function validUsername(name) {
  return /^[A-Za-z0-9_]{3,20}$/.test(name);
}

export async function usernameAvailable(name) {
  if (isLocal()) return true;
  const { data, error } = await sb.rpc('username_available', { name });
  if (error) return true; // don't block sign-up if the check fails; the DB still enforces it
  return data;
}

export async function signUp({ email, password, username }) {
  if (session.offline) {
    const p = { id: 'local', username, avatar_url: null, banner_url: null, bio: '', created_at: new Date().toISOString() };
    setLocal('localProfile', p);
    session.user = { id: 'local' };
    session.profile = p;
    return { needsConfirm: false };
  }
  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: { data: { username }, emailRedirectTo: location.origin + location.pathname },
  });
  if (error) throw error;
  if (!data.session) return { needsConfirm: true };
  endGuest();
  session.user = data.user;
  // the profile row is made by a database trigger; give it a moment
  for (let i = 0; i < 5 && !session.profile; i++) {
    await loadOwnProfile();
    if (!session.profile) await new Promise((r) => setTimeout(r, 400));
  }
  return { needsConfirm: false };
}

export async function signIn({ email, password }) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  endGuest();
  session.user = data.user;
  await loadOwnProfile();
}

export async function signOut() {
  if (session.guest) return leaveGuest();
  if (session.offline) {
    session.user = null;
    session.profile = null;
    emit('auth', session);
    return;
  }
  await sb.auth.signOut();
  session.user = null;
  session.profile = null;
  emit('auth', session);
}

export async function updateProfile(patch) {
  if (isLocal()) {
    session.profile = { ...session.profile, ...patch };
    setLocal(localKey(), session.profile);
    emit('profile', session.profile);
    return session.profile;
  }
  const { data, error } = await sb.from('profiles').update(patch).eq('id', session.user.id).select().single();
  if (error) {
    if (error.code === '23505') throw new Error('That username is taken');
    throw error;
  }
  session.profile = data;
  profileCache.set(data.id, data);
  emit('profile', data);
  return data;
}

/** Upload an image for the avatar or banner and save its URL on the profile. */
export async function uploadProfileImage(kind, file) {
  const isAvatar = kind === 'avatar';
  const blob = await resizeImage(file, isAvatar ? 400 : 1600, isAvatar ? 400 : 600);
  const field = isAvatar ? 'avatar_url' : 'banner_url';
  if (isLocal()) {
    return updateProfile({ [field]: await blobToDataUrl(blob) });
  }
  const ext = blob.type === 'image/gif' ? 'gif' : 'webp';
  const path = `${session.user.id}/${kind}-${Date.now()}.${ext}`;
  const bucket = isAvatar ? 'avatars' : 'banners';
  const { error } = await sb.storage.from(bucket).upload(path, blob, { contentType: blob.type, upsert: true });
  if (error) throw error;
  const { data } = sb.storage.from(bucket).getPublicUrl(path);
  // tidy up the old image
  const old = session.profile?.[field];
  const marker = `/object/public/${bucket}/`;
  if (old && old.includes(marker)) {
    sb.storage.from(bucket).remove([decodeURIComponent(old.split(marker)[1])]).catch(() => {});
  }
  return updateProfile({ [field]: data.publicUrl });
}

export async function getProfile(id) {
  if (session.profile?.id === id) return session.profile;
  if (profileCache.has(id)) return profileCache.get(id);
  if (!sb) return null;
  const { data } = await sb.from('profiles').select(PROFILE_COLS).eq('id', id).maybeSingle();
  if (data) profileCache.set(id, data);
  return data;
}

export function cacheProfile(p) {
  if (p?.id) profileCache.set(p.id, p);
}
