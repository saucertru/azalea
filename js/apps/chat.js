// Chat: public rooms, private rooms (join with a code), direct messages
// with friends, and game sharing.
import { h, icon, toast, empty, spinner, modal, avatarEl, timeAgo, debounce, confirmBox } from '../ui.js';
import { sb } from '../supabase.js';
import { session, getProfile, cacheProfile, leaveGuest } from '../auth.js';
import { getManifest } from '../data.js';
import { gameCover } from './games.js';
import { showProfileModal } from './profile.js';
import { on } from '../store.js';
import { isOnline } from '../presence.js';
import { loadFriends, sendRequest, acceptRequest, removeFriendship, openDm, relationTo, watchFriends } from '../friends.js';

const PROFILE_COLS = 'id, username, avatar_url, banner_url, bio, created_at';

function linkify(text) {
  const out = [];
  const re = /(https?:\/\/[^\s]+)/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(h('a', { href: m[1], target: '_blank', rel: 'noopener noreferrer nofollow' }, m[1]));
    last = m.index + m[1].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export default {
  id: 'chat',
  name: 'Chat',
  icon: 'chat',
  mount(el, params, ctx) {
    if (!sb || session.offline) {
      el.append(empty('Chat needs Supabase', 'Add your Supabase URL and anon key in js/config.js and run supabase/schema.sql to turn on chatrooms.'));
      return;
    }
    if (session.guest) {
      el.append(h('div', { class: 'empty' },
        h('div', { class: 'empty-title' }, 'Chat needs an account'),
        h('p', { class: 'muted small' }, 'Make a free account to join public rooms, make private rooms and share games.'),
        h('button', { class: 'btn primary', onClick: leaveGuest }, 'Log in or sign up')));
      return;
    }

    let alive = true;
    let rooms = [];
    let current = null;
    let channel = null;
    let messages = [];
    let lastSend = 0;
    let pendingShare = null;
    let games = [];
    let friendsData = { friends: [], incoming: [], outgoing: [] };
    const dmFriend = new Map(); // DM room id -> friend's user id
    const unread = new Set();   // friend user ids with unread DMs
    let dmWatch = null;

    const friendsBtn = h('button', { class: 'btn sm grow friends-btn', onClick: () => friendsModal() });
    const roomList = h('div', { class: 'room-list' });
    const shareBanner = h('div', { class: 'share-banner hidden' });
    const head = h('div', { class: 'chat-head' });
    const msgList = h('div', { class: 'msg-list' });
    const input = h('input', { class: 'input', placeholder: 'Message', maxlength: 1000, disabled: true });
    const sendBtn = h('button', { class: 'btn primary', 'aria-label': 'Send', html: icon('send', 18), disabled: true });
    const shareBtn = h('button', { class: 'btn', title: 'Share a game', html: icon('games', 18), disabled: true, onClick: () => pickGame() });
    const composer = h('div', { class: 'composer' }, shareBtn, input, sendBtn);
    const pane = h('div', { class: 'chat-pane' }, head, msgList, composer);
    const layout = h('div', { class: 'chat-layout' },
      h('div', { class: 'chat-rooms' },
        h('div', { class: 'row gap' },
          h('button', { class: 'btn sm primary grow', onClick: createRoom }, h('span', { html: icon('plus', 14) }), 'New room'),
          h('button', { class: 'btn sm grow', onClick: joinByCode }, h('span', { html: icon('key', 14) }), 'Join code')),
        h('div', { class: 'row gap' }, friendsBtn),
        roomList),
      pane);
    el.append(shareBanner, layout);

    getManifest().then((m) => { games = m.games; if (params.share) startShare(params.share); });

    // ---------- rooms ----------
    async function loadRooms() {
      const { data, error } = await sb.from('rooms').select('id, name, is_private, code, kind, created_by, created_at').order('created_at');
      if (error) { roomList.replaceChildren(empty('Could not load rooms', error.message)); return; }
      rooms = data.filter((r) => r.kind !== 'dm');
      const dmIds = data.filter((r) => r.kind === 'dm').map((r) => r.id);
      dmFriend.clear();
      if (dmIds.length) {
        const { data: mem } = await sb.from('room_members').select('room_id, user_id').in('room_id', dmIds).neq('user_id', session.user.id);
        for (const m of mem || []) dmFriend.set(m.room_id, m.user_id);
      }
      renderRooms();
    }

    function renderRooms() {
      const pub = rooms.filter((r) => !r.is_private);
      const priv = rooms.filter((r) => r.is_private);
      const item = (r) => h('button', { class: `room${current?.id === r.id ? ' on' : ''}`, onClick: () => openRoom(r) },
        h('span', { html: icon(r.is_private ? 'lock' : 'chat', 16) }), h('span', { class: 'clamp1' }, r.name));
      const friendItem = (f) => h('button', {
        class: `room dm${current?.kind === 'dm' && current.friend?.id === f.user.id ? ' on' : ''}`,
        onClick: () => openFriend(f.user),
      },
      h('span', { class: 'dm-av' }, avatarEl(f.user, 22), h('i', { class: `dot${isOnline(f.user.id) ? ' online' : ''}` })),
      h('span', { class: 'clamp1 grow' }, f.user.username),
      unread.has(f.user.id) ? h('i', { class: 'unread-dot', title: 'New messages' }) : null);
      const n = friendsData.incoming.length;
      friendsBtn.replaceChildren(...[h('span', { html: icon('user', 14) }), 'Friends', n ? h('span', { class: 'badge' }, String(n)) : null].filter(Boolean));
      roomList.replaceChildren(
        h('div', { class: 'muted tiny list-label' }, 'Direct messages'),
        ...(friendsData.friends.length ? friendsData.friends.map(friendItem)
          : [h('div', { class: 'muted small pad' }, 'Add friends to message them')]),
        h('div', { class: 'muted tiny list-label' }, 'Public rooms'),
        ...(pub.length ? pub.map(item) : [h('div', { class: 'muted small pad' }, 'None yet')]),
        h('div', { class: 'muted tiny list-label' }, 'Private rooms'),
        ...(priv.length ? priv.map(item) : [h('div', { class: 'muted small pad' }, 'Create one or join with a code')]));
    }

    function createRoom() {
      const name = h('input', { class: 'input', placeholder: 'Room name', maxlength: 40 });
      const priv = h('input', { type: 'checkbox' });
      modal({
        title: 'New room',
        content: h('div', {},
          h('label', { class: 'field' }, h('span', {}, 'Name'), name),
          h('label', { class: 'row gap' }, priv, h('span', {}, 'Private (people join with a code)'))),
        actions: [
          { label: 'Cancel' },
          { label: 'Create', primary: true, onClick: async () => {
            const n = name.value.trim();
            if (!n) { toast('Give the room a name', 'error'); return false; }
            const { data, error } = await sb.rpc('create_room', { room_name: n, private: priv.checked });
            if (error) { toast(error.message, 'error'); return false; }
            await loadRooms();
            openRoom(data);
            if (data.is_private) toast(`Room code: ${data.code}`, 'success', 6000);
          } },
        ],
      });
    }

    function joinByCode() {
      const code = h('input', { class: 'input code-input', placeholder: 'ABC123', maxlength: 6, autocapitalize: 'characters' });
      modal({
        title: 'Join a private room',
        content: h('label', { class: 'field' }, h('span', {}, 'Room code'), code),
        actions: [
          { label: 'Cancel' },
          { label: 'Join', primary: true, onClick: async () => {
            const c = code.value.trim().toUpperCase();
            if (c.length < 6) { toast('Codes are 6 characters', 'error'); return false; }
            const { data, error } = await sb.rpc('join_room_by_code', { room_code: c });
            if (error) { toast(error.message.includes('No room') ? 'No room with that code' : error.message, 'error'); return false; }
            await loadRooms();
            openRoom(data);
            toast(`Joined ${data.name}`, 'success');
          } },
        ],
      });
    }

    async function leaveRoom(r) {
      if (!(await confirmBox('Leave room?', `You’ll need the code to get back into “${r.name}”.`, 'Leave', true))) return;
      const { error } = await sb.from('room_members').delete().eq('room_id', r.id).eq('user_id', session.user.id);
      if (error) return toast(error.message, 'error');
      closeChannel();
      current = null;
      await loadRooms();
      renderHead();
      msgList.replaceChildren(empty('Pick a room'));
      setComposer(false);
    }

    // ---------- messages ----------
    function closeChannel() {
      if (channel) sb.removeChannel(channel);
      channel = null;
    }

    function setComposer(on) {
      input.disabled = sendBtn.disabled = shareBtn.disabled = !on;
    }

    function renderHead() {
      if (!current) { head.replaceChildren(h('b', {}, 'Chat')); return; }
      if (current.kind === 'dm') {
        const f = current.friend || { username: 'Friend' };
        head.replaceChildren(
          h('button', { class: 'icon-btn sm back-rooms', html: icon('back', 16), 'aria-label': 'Rooms', onClick: () => layout.classList.remove('in-room') }),
          h('button', { class: 'dm-head', onClick: () => showProfileModal(f.id ? f : null) }, avatarEl(f, 26),
            h('b', { class: 'clamp1' }, f.username),
            h('span', { class: `muted tiny${isOnline(f.id) ? ' is-online' : ''}` }, isOnline(f.id) ? 'online' : 'offline')),
          h('span', { class: 'grow' }));
        return;
      }
      head.replaceChildren(
        h('button', { class: 'icon-btn sm back-rooms', html: icon('back', 16), 'aria-label': 'Rooms', onClick: () => layout.classList.remove('in-room') }),
        h('span', { html: icon(current.is_private ? 'lock' : 'chat', 18) }),
        h('b', { class: 'grow clamp1' }, current.name),
        current.is_private && current.code
          ? h('button', { class: 'chip code-chip', title: 'Copy code', onClick: () => navigator.clipboard?.writeText(current.code).then(() => toast('Code copied')) },
            h('span', { html: icon('copy', 12) }), current.code)
          : null,
        current.is_private ? h('button', { class: 'btn sm', onClick: () => leaveRoom(current) }, 'Leave') : null);
    }

    async function openRoom(r) {
      current = r;
      if (r.kind === 'dm' && r.friend) unread.delete(r.friend.id);
      layout.classList.add('in-room');
      renderRooms();
      renderHead();
      closeChannel();
      msgList.replaceChildren(spinner());
      setComposer(false);
      const roomId = r.id;
      games = (await getManifest()).games; // so shared games know if they're playable
      const { data, error } = await sb.from('messages')
        .select(`id, room_id, user_id, kind, content, payload, created_at, profiles(${PROFILE_COLS})`)
        .eq('room_id', roomId).order('created_at', { ascending: false }).limit(60);
      if (!alive || current?.id !== roomId) return;
      if (error) { msgList.replaceChildren(empty('Could not load messages', error.message)); return; }
      messages = data.reverse();
      messages.forEach((m) => cacheProfile(m.profiles));
      renderMessages();
      setComposer(true);
      input.focus();
      updateShareBanner();

      channel = sb.channel(`room-${roomId}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` }, async ({ new: m }) => {
          if (m.room_id !== roomId || messages.some((x) => x.id === m.id)) return;
          m.profiles = await getProfile(m.user_id);
          if (current?.id !== roomId) return;
          messages.push(m);
          appendMessage(m);
        })
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, ({ old }) => {
          const i = messages.findIndex((x) => x.id === old.id);
          if (i < 0) return;
          messages.splice(i, 1);
          msgList.querySelector(`[data-id="${old.id}"]`)?.remove();
        })
        .subscribe();
    }

    function msgEl(m, prev) {
      const p = m.profiles || { username: 'unknown' };
      const grouped = prev && prev.user_id === m.user_id && new Date(m.created_at) - new Date(prev.created_at) < 5 * 60 * 1000;
      const mine = m.user_id === session.user.id;
      let body;
      if (m.kind === 'game') {
        const g = m.payload || {};
        const exists = games.some((x) => x.id === g.id);
        body = h('div', { class: 'game-share' },
          gameCover({ title: g.title || 'Game', cover: g.cover }, 'gs-cover'),
          h('div', { class: 'gs-info' }, h('span', { class: 'muted tiny' }, 'Shared a game'), h('b', {}, g.title || 'Game'), g.system ? h('span', { class: 'muted small' }, g.system) : null),
          h('button', { class: 'btn sm primary', disabled: !exists, title: exists ? 'Play' : 'Not on this site', onClick: () => ctx.open('games', { play: g.id }) }, h('span', { html: icon('play', 14) }), 'Play'));
      } else {
        body = h('div', { class: 'msg-text' }, ...linkify(m.content));
      }
      return h('div', { class: `msg${grouped ? ' grouped' : ''}${mine ? ' mine' : ''}`, dataset: { id: m.id } },
        grouped ? h('div', { class: 'msg-gutter' }) : h('button', { class: 'msg-av', onClick: () => showPerson(p) }, avatarEl(p, 36)),
        h('div', { class: 'msg-main' },
          grouped ? null : h('div', { class: 'msg-meta' },
            h('button', { class: 'msg-name', onClick: () => showPerson(p) }, p.username),
            h('span', { class: 'muted tiny', title: new Date(m.created_at).toLocaleString() }, timeAgo(m.created_at))),
          body),
        mine ? h('button', { class: 'icon-btn sm msg-del', title: 'Delete', html: icon('trash', 14), onClick: () => del(m) }) : null);
    }

    function renderMessages() {
      if (!messages.length) { msgList.replaceChildren(empty('No messages yet', current?.kind === 'dm' ? `Say hi to ${current.friend?.username || 'your friend'}!` : 'Say hi!')); return; }
      msgList.replaceChildren(...messages.map((m, i) => msgEl(m, messages[i - 1])));
      msgList.scrollTop = msgList.scrollHeight;
    }

    function appendMessage(m) {
      const nearBottom = msgList.scrollHeight - msgList.scrollTop - msgList.clientHeight < 120;
      if (messages.length === 1) msgList.replaceChildren();
      msgList.append(msgEl(m, messages[messages.length - 2]));
      if (nearBottom || m.user_id === session.user.id) msgList.scrollTop = msgList.scrollHeight;
    }

    async function insert(row) {
      if (Date.now() - lastSend < 800) { toast('Slow down a little', 'error'); return false; }
      lastSend = Date.now();
      const { data, error } = await sb.from('messages').insert({ room_id: current.id, user_id: session.user.id, ...row })
        .select(`id, room_id, user_id, kind, content, payload, created_at, profiles(${PROFILE_COLS})`).single();
      if (error) { toast(error.message, 'error'); return false; }
      if (!messages.some((x) => x.id === data.id) && current?.id === data.room_id) {
        messages.push(data);
        appendMessage(data);
      }
      return true;
    }

    async function send() {
      const text = input.value.trim();
      if (!text || !current) return;
      input.value = '';
      const ok = await insert({ kind: 'text', content: text.slice(0, 1000) });
      if (!ok) input.value = text;
      input.focus();
    }

    async function del(m) {
      const { error } = await sb.from('messages').delete().eq('id', m.id);
      if (error) return toast(error.message, 'error');
      messages = messages.filter((x) => x.id !== m.id);
      renderMessages();
    }

    // ---------- game share ----------
    function shareGame(g) {
      return insert({ kind: 'game', content: '', payload: { id: g.id, title: g.title, type: g.type, cover: g.cover || null, system: g.system || null } });
    }

    function pickGame() {
      if (!games.length) return toast('No games on the site yet', 'error');
      const q = h('input', { class: 'input', type: 'search', placeholder: 'Search games' });
      const list = h('div', { class: 'pick-list' });
      let m;
      const draw = () => {
        const s = q.value.toLowerCase();
        const items = games.filter((g) => g.title.toLowerCase().includes(s)).slice(0, 60);
        list.replaceChildren(...(items.length ? items.map((g) => h('button', { class: 'pick-item', onClick: async () => { if (await shareGame(g)) m.close(); } },
          gameCover(g, 'pick-cover'), h('span', { class: 'clamp1' }, g.title))) : [empty('No games found')]));
      };
      q.oninput = debounce(draw, 100);
      draw();
      m = modal({ title: 'Share a game', content: h('div', {}, q, list) });
    }

    function startShare(id) {
      pendingShare = games.find((g) => g.id === id) || null;
      updateShareBanner();
    }

    function updateShareBanner() {
      if (!pendingShare) { shareBanner.classList.add('hidden'); return; }
      shareBanner.classList.remove('hidden');
      shareBanner.replaceChildren(
        h('span', { html: icon('share', 16) }),
        h('span', { class: 'grow' }, current ? `Share “${pendingShare.title}” with ${current.kind === 'dm' ? current.friend?.username : current.name}?` : `Pick a room or friend to share “${pendingShare.title}”`),
        current ? h('button', { class: 'btn sm primary', onClick: async () => { if (await shareGame(pendingShare)) { pendingShare = null; updateShareBanner(); } } }, 'Share here') : null,
        h('button', { class: 'btn sm', onClick: () => { pendingShare = null; updateShareBanner(); } }, 'Cancel'));
    }

    // ---------- friends + direct messages ----------
    async function refreshFriends() {
      try {
        friendsData = await loadFriends();
      } catch (e) {
        console.warn('friends:', e.message);
      }
      if (!alive) return;
      renderRooms();
      if (current?.kind === 'dm' && !friendsData.friends.some((f) => f.user.id === current.friend?.id)) {
        // unfriended: close the chat
        closeChannel();
        current = null;
        renderHead();
        msgList.replaceChildren(empty('Pick a room'));
        setComposer(false);
      }
      if (openFriendsModal) openFriendsModal.redraw();
    }

    async function openFriend(user) {
      try {
        const room = await openDm(user.id);
        dmFriend.set(room.id, user.id);
        openRoom({ ...room, friend: user });
      } catch (e) {
        toast(e.message, 'error');
      }
    }

    function watchDms() {
      // a dot next to friends who message you while you're elsewhere
      dmWatch = sb.channel('dm-watch')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, async ({ new: m }) => {
          if (m.user_id === session.user.id) return;
          let fid = dmFriend.get(m.room_id);
          if (!fid) {
            // a DM a friend just started with us
            if (!friendsData.friends.some((f) => f.user.id === m.user_id)) return;
            const { data } = await sb.from('rooms').select('kind').eq('id', m.room_id).maybeSingle();
            if (data?.kind !== 'dm') return;
            dmFriend.set(m.room_id, m.user_id);
            fid = m.user_id;
          }
          if (current?.id === m.room_id) return;
          unread.add(fid);
          renderRooms();
        })
        .subscribe();
    }

    /** Profile popup with Add friend / Message buttons. */
    async function showPerson(p) {
      if (!p?.id) return;
      const actions = h('div', { class: 'row gap pf-actions' });
      const pm = showProfileModal(p, actions);
      if (p.id === session.user.id) return;
      const { rel, id } = await relationTo(p.id);
      const btn = (label, cls, fn) => h('button', { class: `btn sm ${cls}`, onClick: async (e) => {
        e.currentTarget.disabled = true;
        try { await fn(); } catch (err) { toast(err.message, 'error'); }
        pm?.close();
      } }, label);
      if (rel === 'friend') actions.append(btn('Message', 'primary', () => openFriend(p)));
      else if (rel === 'incoming') actions.append(btn('Accept friend request', 'primary', () => acceptRequest(id).then(() => toast(`You and ${p.username} are now friends`, 'success'))));
      else if (rel === 'outgoing') actions.append(h('span', { class: 'muted small' }, 'Friend request sent'));
      else actions.append(btn('Add friend', 'primary', () => sendRequest(p.username).then((r) => toast(r === 'accepted' ? `You and ${p.username} are now friends` : 'Friend request sent', 'success'))));
    }

    let openFriendsModal = null;
    function friendsModal() {
      const name = h('input', { class: 'input', placeholder: 'Username', maxlength: 20, autocapitalize: 'off', spellcheck: 'false' });
      const add = async () => {
        const u = name.value.trim();
        if (!u) return;
        try {
          const r = await sendRequest(u);
          name.value = '';
          toast(r === 'accepted' ? `You and ${u} are now friends` : `Friend request sent to ${u}`, 'success');
        } catch (e) {
          toast(e.message, 'error');
        }
      };
      name.addEventListener('keydown', (e) => e.key === 'Enter' && add());
      const body = h('div', {});
      const person = (u, ...btns) => h('div', { class: 'friend-row' },
        h('span', { class: 'dm-av' }, avatarEl(u, 30), h('i', { class: `dot${isOnline(u.id) ? ' online' : ''}` })),
        h('button', { class: 'link-btn grow clamp1 friend-name', onClick: () => showProfileModal(u) }, u.username), ...btns);
      const act = (label, cls, fn) => h('button', { class: `btn sm ${cls}`, onClick: async (e) => {
        e.currentTarget.disabled = true;
        try { await fn(); } catch (err) { toast(err.message, 'error'); e.currentTarget.disabled = false; }
      } }, label);
      const redraw = () => {
        const { friends, incoming, outgoing } = friendsData;
        body.replaceChildren(...[
          incoming.length ? h('div', { class: 'muted tiny list-label' }, 'Friend requests') : null,
          ...incoming.map((r) => person(r.user,
            act('Accept', 'primary', () => acceptRequest(r.id)),
            act('Decline', '', () => removeFriendship(r.id)))),
          h('div', { class: 'muted tiny list-label' }, `Friends (${friends.length})`),
          ...(friends.length ? friends.map((f) => person(f.user,
            act('Message', 'primary', async () => { m.close(); await openFriend(f.user); }),
            act('Remove', '', async () => {
              if (await confirmBox('Remove friend?', `You and ${f.user.username} won’t be able to message each other.`, 'Remove', true)) await removeFriendship(f.id);
            })))
            : [h('p', { class: 'muted small' }, 'No friends yet. Add someone by their username.')]),
          outgoing.length ? h('div', { class: 'muted tiny list-label' }, 'Sent requests') : null,
          ...outgoing.map((r) => person(r.user, act('Cancel', '', () => removeFriendship(r.id))))].filter(Boolean));
      };
      redraw();
      const m = modal({
        title: 'Friends',
        content: h('div', { class: 'friends-modal' },
          h('div', { class: 'row gap' }, name, h('button', { class: 'btn primary', onClick: add }, 'Add friend')),
          body),
      });
      openFriendsModal = { redraw };
      const close = m.close;
      m.close = () => { openFriendsModal = null; close(); };
    }

    sendBtn.onclick = send;
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });

    renderHead();
    msgList.replaceChildren(empty('Pick a room', 'Choose a room on the left, make your own, or join one with a code.'));
    roomList.replaceChildren(spinner());
    watchFriends();
    watchDms();
    const offFriends = on('friends', refreshFriends);
    const offOnline = on('online', () => { renderRooms(); if (current?.kind === 'dm') renderHead(); });
    Promise.all([loadRooms(), refreshFriends()]).then(() => {
      if (params.room) {
        const r = rooms.find((x) => x.id === params.room);
        if (r) openRoom(r);
      }
      if (params.dm) {
        const f = friendsData.friends.find((x) => x.user.id === params.dm);
        if (f) openFriend(f.user);
      }
    });

    // refresh relative times
    const timer = setInterval(() => current && messages.length && renderMessagesTimes(), 60000);
    function renderMessagesTimes() {
      msgList.querySelectorAll('.msg').forEach((node) => {
        const m = messages.find((x) => String(x.id) === node.dataset.id);
        const t = node.querySelector('.msg-meta .tiny');
        if (m && t) t.textContent = timeAgo(m.created_at);
      });
    }

    return () => {
      alive = false;
      clearInterval(timer);
      closeChannel();
      if (dmWatch) sb.removeChannel(dmWatch);
      offFriends();
      offOnline();
    };
  },
};
