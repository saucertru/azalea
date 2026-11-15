// Free AI chat using Puter.js (no API key; each user signs in to a free
// Puter account the first time and their usage goes on that account).
import { CONFIG } from '../config.js';
import { h, icon, esc, toast, empty } from '../ui.js';
import { getLocal, setLocal } from '../store.js';

const MODELS = [
  ['', 'Default (fast)'],
  ['gpt-5-nano', 'GPT-5 nano'],
  ['claude-sonnet-4-5', 'Claude Sonnet 4.5'],
  ['google/gemini-2.5-flash', 'Gemini 2.5 Flash'],
  ['deepseek-chat', 'DeepSeek'],
];

let puterPromise = null;
function loadPuter() {
  if (window.puter) return Promise.resolve(window.puter);
  if (!puterPromise) {
    puterPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://js.puter.com/v2/';
      s.onload = () => resolve(window.puter);
      s.onerror = () => { puterPromise = null; reject(new Error('Could not load the AI service (it may be blocked on this network).')); };
      document.head.append(s);
    });
  }
  return puterPromise;
}

/** Tiny safe markdown: escape first, then code blocks, inline code, bold, italics, links. */
function md(text) {
  const blocks = [];
  let s = esc(text).replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    blocks.push(`<pre><code>${code.replace(/\n$/, '')}</code></pre>`);
    return `\u0000${blocks.length - 1}\u0000`;
  });
  s = s
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>')
    .replace(/^### (.*)$/gm, '<h4>$1</h4>')
    .replace(/^## (.*)$/gm, '<h4>$1</h4>')
    .replace(/^# (.*)$/gm, '<h4>$1</h4>')
    .replace(/^[-*] (.*)$/gm, '• $1')
    .replace(/(https?:\/\/[^\s<)]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\n/g, '<br>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[+i]);
}

export default {
  id: 'ai',
  name: 'AI',
  icon: 'ai',
  mount(el) {
    let history = getLocal('ai.history', []);
    let busy = false;
    let model = getLocal('ai.model', '');
    loadPuter().catch(() => {});

    const list = h('div', { class: 'ai-list' });
    const box = h('textarea', { class: 'input ai-input', rows: 1, placeholder: 'Ask anything…' });
    const send = h('button', { class: 'btn primary', 'aria-label': 'Send', html: icon('send', 18) });
    const sel = h('select', { class: 'input sm' }, MODELS.map(([v, n]) => h('option', { value: v, selected: v === model }, n)));
    sel.onchange = () => { model = sel.value; setLocal('ai.model', model); };
    const clear = h('button', { class: 'btn sm', onClick: () => { history = []; setLocal('ai.history', history); render(); } }, h('span', { html: icon('plus', 14) }), 'New chat');

    el.append(h('div', { class: 'ai-wrap' },
      h('div', { class: 'row gap ai-top' }, h('b', { class: 'grow' }, `${CONFIG.siteName} AI`), sel, clear),
      list,
      h('div', { class: 'ai-compose' }, box, send),
      h('div', { class: 'muted tiny center' }, 'Powered by Puter.js — free. The first message may ask you to sign in to a free Puter account. AI can make mistakes.')));

    const bubble = (m) => h('div', { class: `ai-msg ${m.role}` }, h('div', { class: 'ai-bubble', html: m.role === 'user' ? esc(m.content).replace(/\n/g, '<br>') : md(m.content) }));

    function render() {
      if (!history.length) {
        list.replaceChildren(h('div', { class: 'ai-empty' },
          h('div', { class: 'ai-orb', html: icon('ai', 34) }),
          h('h3', {}, 'What can I help with?'),
          h('div', { class: 'chips center' }, ['Explain a maths problem', 'Give me a game idea', 'Help me write a story', 'Quiz me on science'].map((p) =>
            h('button', { class: 'chip-btn', onClick: () => { box.value = p; ask(); } }, p)))));
        return;
      }
      list.replaceChildren(...history.map(bubble));
      list.scrollTop = list.scrollHeight;
    }

    async function ask() {
      const text = box.value.trim();
      if (!text || busy) return;
      busy = true;
      send.disabled = true;
      box.value = '';
      box.style.height = '';
      history.push({ role: 'user', content: text });
      const reply = { role: 'assistant', content: '' };
      history.push(reply);
      render();
      const node = list.lastChild.querySelector('.ai-bubble');
      node.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
      try {
        const puter = await loadPuter();
        const msgs = [
          { role: 'system', content: `You are ${CONFIG.siteName} AI, a friendly, helpful assistant on a games and study website. Keep answers clear and appropriate for students.` },
          ...history.slice(0, -1).slice(-20).map(({ role, content }) => ({ role, content })),
        ];
        const opts = { stream: true };
        if (model) opts.model = model;
        let resp;
        try {
          resp = await puter.ai.chat(msgs, opts);
        } catch (e) {
          if (!model) throw e;
          resp = await puter.ai.chat(msgs, { stream: true }); // model unavailable - use default
        }
        if (resp && typeof resp[Symbol.asyncIterator] === 'function') {
          for await (const part of resp) {
            reply.content += part?.text || '';
            node.innerHTML = md(reply.content);
            list.scrollTop = list.scrollHeight;
          }
        } else {
          reply.content = resp?.message?.content?.[0]?.text || resp?.message?.content || String(resp ?? '');
          node.innerHTML = md(reply.content);
        }
        if (!reply.content.trim()) throw new Error('Empty reply');
      } catch (e) {
        console.error(e);
        history.pop();
        node.innerHTML = '';
        node.append(h('span', { class: 'error-text' }, `Sorry, something went wrong: ${e?.message || e?.error?.message || 'unknown error'}`));
      } finally {
        history = history.slice(-60);
        setLocal('ai.history', history);
        busy = false;
        send.disabled = false;
        box.focus();
      }
    }

    send.onclick = ask;
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); }
    });
    box.addEventListener('input', () => {
      box.style.height = 'auto';
      box.style.height = `${Math.min(box.scrollHeight, 160)}px`;
    });
    render();
  },
};
