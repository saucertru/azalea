// Chrome extensions (Sapphire) UI: toolbar buttons, the Extensions manager,
// extension popups, notifications, context menus and permission prompts.
import { h, icon, toast, modal, confirmBox, empty, spinner } from './ui.js';
import { proxyReady, proxyAvailable, getSapphire, getActiveTabId, serverOrigin, toUrl } from './proxy.js';
import { on } from './store.js';

// ---------------------------------------------------------------- toolbar
/** Fills `wrap` with one button per enabled extension (icon, badge). */
export function renderExtButtons(wrap, getTabId) {
  const s = getSapphire();
  if (!s) return wrap.replaceChildren();
  const tabId = getTabId();
  let list = [];
  try { list = s.getInstalledExtensions(tabId); } catch {}
  wrap.replaceChildren(...list.filter((x) => x.enabled).map((ext) => {
    const b = h('button', {
      class: `ext-btn${ext.actionEnabled === false ? ' disabled' : ''}`,
      title: ext.title || ext.name,
      'aria-label': ext.title || ext.name,
      onClick: (e) => {
        e.stopPropagation();
        if (popup?.extId === ext.id) return hidePopup();
        hidePopup();
        popupAnchor = b;
        try { s.clickAction(ext.id, getTabId()); } catch (err) { toast(err.message || String(err), 'error'); }
      },
    }, ext.iconUrl ? h('img', { src: ext.iconUrl, alt: '' }) : h('span', { class: 'ext-letter' }, (ext.name || '?')[0]));
    if (ext.badgeText) b.append(h('span', { class: 'ext-badge', style: ext.badgeColor ? { background: ext.badgeColor } : {} }, ext.badgeText));
    return b;
  }));
}

// ---------------------------------------------------------------- popup
let popup = null; // { extId, el, frame }
let popupAnchor = null;

export function showPopup(extId, tabId) {
  const s = getSapphire();
  if (!s) return;
  hidePopup();
  const frame = h('iframe', { class: 'ext-popup-frame', title: 'Extension' });
  const el = h('div', { class: 'ext-popup' }, frame);
  document.body.append(el);
  // place it under the button that opened it (or top-right)
  const r = popupAnchor?.isConnected ? popupAnchor.getBoundingClientRect() : { right: innerWidth - 16, bottom: 60 };
  el.style.top = `${Math.min(r.bottom + 6, innerHeight - 120)}px`;
  el.style.right = `${Math.max(8, innerWidth - r.right)}px`;
  popup = { extId, el, frame };
  // size the popup to its content when the page allows it
  const fit = () => {
    try {
      const d = frame.contentDocument;
      const body = d?.body;
      if (!body || !body.childElementCount) return;
      const cs = d.defaultView.getComputedStyle(body);
      const pad = (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0);
      const w = Math.min(Math.max(body.scrollWidth + (parseFloat(cs.marginLeft) || 0) + (parseFloat(cs.marginRight) || 0), 200), 800);
      const hgt = Math.min(Math.max(body.scrollHeight + pad, 60), 600);
      el.style.width = `${Math.ceil(w)}px`;
      el.style.height = `${Math.ceil(hgt)}px`;
    } catch {}
  };
  frame.addEventListener('load', () => { fit(); setTimeout(fit, 250); setTimeout(fit, 1000); });
  s.mountExtensionPopup(frame, extId, tabId).then((ok) => { if (!ok) hidePopup(); }).catch(() => hidePopup());
}

export function hidePopup() {
  if (!popup) return;
  try { getSapphire()?.unmountExtensionPopup(popup.frame); } catch {}
  popup.el.remove();
  popup = null;
}

document.addEventListener('pointerdown', (e) => {
  if (popup && !popup.el.contains(e.target) && !e.target.closest?.('.ext-btn')) hidePopup();
  if (menuEl && !menuEl.contains(e.target)) closeMenu();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { hidePopup(); closeMenu(); } });
// clicks inside a proxied page don't reach this document; focus moving into
// any other frame means the user clicked elsewhere
window.addEventListener('blur', () => setTimeout(() => {
  const a = document.activeElement;
  if (popup && a !== popup.frame) hidePopup();
  if (menuEl && a?.tagName === 'IFRAME') closeMenu();
}, 0));

// ---------------------------------------------------------------- notifications etc.
export function notice(text) {
  toast(text, 'info', 5000);
}

export function notify(extId, options, callbacks) {
  const title = options?.title || '';
  const message = options?.message || '';
  let wrap = document.getElementById('toasts');
  if (!wrap) document.body.append((wrap = h('div', { id: 'toasts' })));
  const t = h('div', { class: 'toast ext-toast', onClick: () => { try { callbacks.click(); } catch {} t.remove(); } },
    options?.iconUrl ? h('img', { src: options.iconUrl, alt: '' }) : null,
    h('div', {}, title ? h('b', {}, title) : null, message ? h('div', { class: 'small' }, message) : null));
  wrap.append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => { t.remove(); try { callbacks.close(false); } catch {} }, 300); }, 6000);
}

export function askPermissions(extId, perms, origins) {
  const s = getSapphire();
  let name = extId;
  try { name = s.getInstalledExtensions(null).find((x) => x.id === extId)?.name || extId; } catch {}
  const list = [...perms, ...origins].join(', ') || 'extra permissions';
  return confirmBox('Extension permission', `“${name}” is asking for: ${list}`, 'Allow');
}

// ---------------------------------------------------------------- context menu
let menuEl = null;
function closeMenu() {
  menuEl?.remove();
  menuEl = null;
}

export function showContextMenu(request, iframe) {
  closeMenu();
  const base = iframe?.getBoundingClientRect() || { left: 0, top: 0 };
  menuEl = h('div', { class: 'ext-menu' });
  const add = (entry, depth) => {
    if (entry.children?.length) {
      menuEl.append(h('div', { class: 'ext-menu-head', style: { paddingLeft: `${10 + depth * 12}px` } }, entry.title));
      entry.children.forEach((c) => add(c, depth + 1));
      return;
    }
    if (entry.type === 'separator') { menuEl.append(h('hr')); return; }
    const check = entry.type === 'checkbox' || entry.type === 'radio' ? (entry.checked ? '☑ ' : '☐ ') : '';
    menuEl.append(h('button', {
      class: 'ext-menu-item', style: { paddingLeft: `${10 + depth * 12}px` }, disabled: entry.enabled === false,
      onClick: () => { closeMenu(); request.select(entry); },
    }, check + entry.title));
  };
  for (const e of request.items) {
    menuEl.append(h('div', { class: 'ext-menu-head' }, e.extName));
    if (String(e.id).startsWith('__sapphire_root_')) e.children.forEach((c) => add(c, 0));
    else add(e, 0);
  }
  document.body.append(menuEl);
  const x = Math.min(base.left + request.x, innerWidth - menuEl.offsetWidth - 8);
  const y = Math.min(base.top + request.y, innerHeight - menuEl.offsetHeight - 8);
  menuEl.style.left = `${Math.max(8, x)}px`;
  menuEl.style.top = `${Math.max(8, y)}px`;
}

// ---------------------------------------------------------------- manager
async function download(input) {
  const v = input.trim();
  const store = v.match(/(?:\/detail\/(?:[^/]+\/)?|^)([a-p]{32})(?:[/?#]|$)/);
  if (store) {
    const r = await fetch(`${serverOrigin()}/api/crx/${store[1]}`);
    if (!r.ok) throw new Error(r.status === 400 ? 'That isn’t a Chrome Web Store extension' : `Download failed (${r.status}). The proxy server may be waking up; try again in a minute.`);
    return { buf: await r.arrayBuffer(), name: `${store[1]}.crx` };
  }
  throw new Error('Paste a Chrome Web Store link (or the 32-letter extension id), or choose a .zip / .crx file.');
}

export async function openManager(ctx) {
  const body = h('div', { class: 'ext-manager' }, spinner());
  const m = modal({ title: 'Extensions', wide: true, content: body });
  let off = null;
  const closeObs = new MutationObserver(() => { if (!m.el.isConnected) { off?.(); closeObs.disconnect(); } });
  closeObs.observe(document.body, { childList: true });

  if (!(await proxyAvailable())) {
    body.replaceChildren(empty('Extensions need the web proxy', 'They run on websites opened through the Web app, which needs the Node server or the Pages build.'));
    return;
  }
  let s;
  try {
    ({ sapphire: s } = await proxyReady());
  } catch (e) {
    body.replaceChildren(empty('Couldn’t start the web proxy', e.message || String(e)));
    return;
  }
  if (!s) {
    body.replaceChildren(empty('Extensions couldn’t start', 'The web proxy works, but extension support failed to load. Check the browser console for details.'));
    return;
  }

  const msg = h('div', { class: 'small ext-msg' });
  const setMsg = (t, bad = false) => { msg.textContent = t; msg.className = `small ext-msg${bad ? ' bad' : ''}`; };
  const linkInput = h('input', { class: 'input', placeholder: 'Chrome Web Store link or extension id', spellcheck: 'false' });
  const fileInput = h('input', { type: 'file', accept: '.zip,.crx,application/zip,application/x-chrome-extension', style: { display: 'none' } });
  const list = h('div', { class: 'ext-list' });

  const install = async (getter) => {
    try {
      setMsg('Downloading…');
      const { buf, name } = await getter();
      setMsg('Installing…');
      const id = await s.installExtension(buf, name);
      const ext = s.getInstalledExtensions(null).find((x) => x.id === id);
      setMsg(`Installed ${ext?.name || id}. It works on websites you open from now on.`);
      linkInput.value = '';
    } catch (e) {
      setMsg(e.message || String(e), true);
    }
    renderList();
  };
  linkInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && linkInput.value.trim()) install(() => download(linkInput.value)); });
  fileInput.addEventListener('change', () => {
    const f = fileInput.files[0];
    fileInput.value = '';
    if (f) install(async () => ({ buf: await f.arrayBuffer(), name: f.name }));
  });

  function renderList() {
    let exts = [];
    try { exts = s.getInstalledExtensions(getActiveTabId()); } catch {}
    if (!exts.length) {
      list.replaceChildren(empty('No extensions yet', 'Install one from the Chrome Web Store, for example an ad blocker like uBlock Origin Lite.'));
      return;
    }
    list.replaceChildren(...exts.map((ext) => {
      const act = (label, cls, fn) => h('button', { class: `btn sm ${cls}`, onClick: async () => {
        try { await fn(); } catch (e) { setMsg(e.message || String(e), true); }
        renderList();
      } }, label);
      return h('div', { class: `ext-row${ext.enabled ? '' : ' off'}` },
        ext.iconUrl ? h('img', { class: 'ext-row-icon', src: ext.iconUrl, alt: '' }) : h('span', { class: 'ext-row-icon ph', html: icon('puzzle', 22) }),
        h('div', { class: 'ext-row-meta' },
          h('b', {}, `${ext.name}`, ext.version ? h('span', { class: 'muted small' }, ` ${ext.version}`) : null),
          ext.description ? h('div', { class: 'muted small clamp2' }, ext.description) : null,
          h('div', { class: 'row gap wrap ext-row-acts' },
            act(ext.enabled ? 'Turn off' : 'Turn on', '', () => s.setExtensionEnabled(ext.id, !ext.enabled)),
            ext.optionsUrl ? act('Options', '', () => { m.close(); ctx.openNew ? ctx.openNew('web', { url: ext.optionsUrl }) : ctx.open('web', { url: ext.optionsUrl }); }) : null,
            act('Remove', 'danger', async () => {
              if (await confirmBox('Remove extension?', `“${ext.name}” and its settings will be removed.`, 'Remove', true)) await s.uninstallExtension(ext.id);
            }))));
    }));
  }

  off = on('extensions', renderList);
  body.replaceChildren(
    h('div', { class: 'ext-install' },
      h('div', { class: 'row gap' }, linkInput, h('button', { class: 'btn primary', onClick: () => linkInput.value.trim() && install(() => download(linkInput.value)) }, 'Install')),
      h('div', { class: 'row gap wrap' },
        h('button', { class: 'btn sm', onClick: () => fileInput.click() }, h('span', { html: icon('upload', 14) }), 'Install from a .zip or .crx file'),
        h('a', { class: 'btn sm', href: 'https://chromewebstore.google.com/', target: '_blank', rel: 'noopener', onClick: (e) => { e.preventDefault(); m.close(); ctx.open('web', { url: toUrl('chromewebstore.google.com') }); } }, h('span', { html: icon('globe', 14) }), 'Browse the Web Store')),
      msg, fileInput),
    h('p', { class: 'muted small' }, 'Extensions run on websites you open in the Web app. Some extensions need features browsers don’t allow websites to copy, so not every extension will work.'),
    list);
  renderList();
}
