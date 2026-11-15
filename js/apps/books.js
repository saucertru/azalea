// Free public-domain books from Open Library, read with the Internet Archive reader.
import { h, icon, empty, spinner, toast } from '../ui.js';
import { getLocal, setLocal } from '../store.js';

const SUBJECTS = ['Adventure', 'Fantasy', 'Science fiction', 'Mystery', 'Horror', 'Romance', 'Fairy tales', 'Poetry', 'History', 'Children'];

export default {
  id: 'books',
  name: 'Books',
  icon: 'book',
  mount(el, params, ctx) {
    let alive = true;
    let reqId = 0;
    const input = h('input', { class: 'input', type: 'search', placeholder: 'Search free books (title or author)' });
    const chips = h('div', { class: 'chips' });
    const grid = h('div', { class: 'grid book-grid' });
    const note = h('div', { class: 'muted small' }, 'Public-domain books from Open Library and the Internet Archive.');
    const browse = h('div', {},
      h('div', { class: 'toolbar' }, input, h('button', { class: 'btn primary', onClick: () => search(input.value) }, h('span', { html: icon('search', 16) }), 'Search')),
      chips, note, grid);
    el.append(browse);

    let active = '';
    function renderChips() {
      const recent = getLocal('books.recent', []);
      chips.replaceChildren(
        recent.length ? h('button', { class: `chip-btn${active === '__recent' ? ' on' : ''}`, onClick: showRecent }, 'Recently read') : '',
        ...SUBJECTS.map((s) => h('button', { class: `chip-btn${active === s ? ' on' : ''}`, onClick: () => { input.value = ''; search(`subject:"${s.toLowerCase()}"`, s); } }, s)));
    }

    function cover(b) {
      return b.cover_i
        ? h('img', { class: 'book-cover', src: `https://covers.openlibrary.org/b/id/${b.cover_i}-M.jpg`, alt: '', loading: 'lazy' })
        : h('div', { class: 'book-cover ph' }, h('span', {}, b.title));
    }

    function showBooks(list) {
      if (!list.length) return grid.replaceChildren(empty('No free books found', 'Try another search — only public-domain books that can be read here are shown.'));
      grid.replaceChildren(...list.map((b) => h('div', { class: 'card book-card', tabindex: 0, onClick: () => read(b), onKeydown: (e) => e.key === 'Enter' && read(b) },
        cover(b),
        h('div', { class: 'card-body' }, h('b', { class: 'clamp2' }, b.title), h('span', { class: 'muted small clamp1' }, (b.author_name || []).slice(0, 2).join(', ') || 'Unknown'),
          b.first_publish_year ? h('span', { class: 'muted small' }, String(b.first_publish_year)) : null))));
    }

    function showRecent() {
      active = '__recent';
      renderChips();
      showBooks(getLocal('books.recent', []));
    }

    async function search(q, chip = '') {
      q = q.trim();
      if (!q) return;
      active = chip;
      renderChips();
      const id = ++reqId;
      grid.replaceChildren(spinner());
      try {
        const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&has_fulltext=true&limit=100&fields=key,title,author_name,cover_i,ia,ebook_access,public_scan_b,first_publish_year`;
        const r = await fetch(url);
        if (!r.ok) throw new Error(`Open Library error ${r.status}`);
        const j = await r.json();
        if (!alive || id !== reqId) return;
        const free = (j.docs || []).filter((d) => d.ia?.length && (d.ebook_access === 'public' || d.public_scan_b));
        showBooks(free);
      } catch (e) {
        if (alive && id === reqId) grid.replaceChildren(empty('Could not reach Open Library', e.message));
      }
    }

    function read(b) {
      const recent = getLocal('books.recent', []).filter((x) => x.key !== b.key);
      recent.unshift({ key: b.key, title: b.title, author_name: b.author_name, cover_i: b.cover_i, ia: b.ia.slice(0, 1), first_publish_year: b.first_publish_year });
      setLocal('books.recent', recent.slice(0, 24));
      const url = `https://archive.org/embed/${encodeURIComponent(b.ia[0])}`;
      if (ctx.openFrame(b.title, url, { iconName: 'book', width: 1000, height: 720 })) { renderChips(); return; }
      el.replaceChildren(h('div', { class: 'viewer' },
        h('div', { class: 'row gap' },
          h('button', { class: 'btn sm', onClick: () => { el.replaceChildren(browse); renderChips(); } }, h('span', { html: icon('back', 16) }), 'Back'),
          h('b', { class: 'grow clamp1' }, b.title),
          h('a', { class: 'btn sm', href: `https://openlibrary.org${b.key}`, target: '_blank', rel: 'noopener' }, h('span', { html: icon('external', 16) }), 'Open Library')),
        h('iframe', { class: 'viewer-frame', src: url, title: b.title, allowfullscreen: true })));
    }

    input.addEventListener('keydown', (e) => e.key === 'Enter' && search(input.value));
    renderChips();
    if (getLocal('books.recent', []).length) showRecent();
    else search('subject:"adventure"', 'Adventure');
    return () => { alive = false; };
  },
};
