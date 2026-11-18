// The announcement bar: a message admins post in the Admin panel, shown at
// the top of the site until each person closes it.
import { h, icon } from './ui.js';
import { sb } from './supabase.js';
import { getLocal, setLocal } from './store.js';

let bar = null;
export async function showAnnouncement() {
  if (!sb) return;
  const { data } = await sb.from('site_settings').select('announcement, updated_at').eq('id', 1).maybeSingle();
  const text = data?.announcement?.trim();
  bar?.remove();
  bar = null;
  if (!text) return;
  const id = `${data.updated_at}|${text}`;
  if (getLocal('announcement.closed', '') === id) return;
  bar = h('div', { class: 'announce', role: 'status' },
    h('span', { class: 'announce-ic' }, '📣'),
    h('span', { class: 'announce-text' }, text),
    h('button', { class: 'icon-btn sm', 'aria-label': 'Close', html: icon('close', 14), onClick: () => { setLocal('announcement.closed', id); bar.remove(); bar = null; } }));
  document.body.append(bar);
}
