// Shared bits for Discord-style profiles: names, statuses, avatar
// decorations and badges.

/** Columns to load wherever another user's profile is shown. */
export const PROFILE_COLS = 'id, username, display_name, pronouns, avatar_url, banner_url, banner_color, bio, created_at, status, status_text, status_emoji, theme_primary, theme_accent, avatar_deco, badges, is_admin, banned';

export const displayName = (p) => (p?.display_name || '').trim() || p?.username || 'unknown';

export const STATUSES = {
  online: { label: 'Online', color: '#23a55a' },
  idle: { label: 'Idle', color: '#f0b232' },
  dnd: { label: 'Do not disturb', color: '#f23f43' },
  invisible: { label: 'Invisible', color: '#80848e' },
};
export const statusColor = (s) => (STATUSES[s] || STATUSES.invisible).color;
export const statusLabel = (s) => (s ? STATUSES[s]?.label || 'Online' : 'Offline');

export const DECOS = {
  snow: { label: 'Snowflake', emoji: '❄️' },
  holly: { label: 'Christmas', emoji: '🎄' },
  neon: { label: 'Neon', emoji: '' },
  gold: { label: 'Gold', emoji: '' },
  flame: { label: 'Flame', emoji: '🔥' },
  rainbow: { label: 'Rainbow', emoji: '' },
  hearts: { label: 'Hearts', emoji: '💖' },
  pixel: { label: 'Pixel', emoji: '👾' },
};

export const BADGES = {
  admin: { label: 'Admin', emoji: '🛡️' },
  early: { label: 'Early member', emoji: '🌱' },
  supporter: { label: 'Supporter', emoji: '💎' },
  gamer: { label: 'Top gamer', emoji: '🎮' },
  artist: { label: 'Artist', emoji: '🎨' },
  bughunter: { label: 'Bug hunter', emoji: '🐛' },
  verified: { label: 'Verified', emoji: '✅' },
  xmas: { label: 'Christmas 2026', emoji: '🎅' },
};
/** The badges to show for a profile (admins get the Admin badge). */
export const badgeList = (p) => [...(p?.is_admin ? ['admin'] : []), ...(p?.badges || []).filter((b) => BADGES[b] && b !== 'admin')];

export const isHex = (c) => /^#[0-9a-f]{6}$/i.test(c || '');
