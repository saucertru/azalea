# Azelela

Games, music, videos, PDFs, books, TV, a free AI and chat, in one website.
Choose a browser-style or desktop-style layout, 10 themes, and your own accent colour, font and background.

- **Browser look:** tabs, an address bar (`azelela://games`), back, forward and reload, an icon rail, and a music pill.
  Alt+T opens a new tab and Alt+W closes it. Type an app name, a website (`example.com`) or a search into the address bar.
  Websites open in the tab through the built-in **Scramjet web proxy**.
- **Desktop look:** coloured app icons, a big clock, local weather (Open-Meteo, after you allow location) and live system stats,
  plus a floating dock with search, pinned apps and open windows.

## Quick start (on your computer)

```bash
npm install
npm start          # full site + web proxy: http://localhost:8080
npm run dev        # quick preview without the proxy, no install needed: http://localhost:3000
```

Both re-scan the content folders every time the page loads, so new files show up when you refresh.
You need Node.js 18 or newer.

## Deploying on Render (with the web proxy)

1. Push the project to GitHub. `node_modules` is ignored.
2. In Render, create a **New, then Web Service** from the repo. Or use **New, then Blueprint**, which reads `render.yaml` and fills this in for you.
   - **Build command:** `npm install && npm run build`
   - **Start command:** `npm start`
3. Open the site on its `https://…onrender.com` address. The proxy's service worker needs https; Render gives you that automatically.

`server/index.mjs` serves the site, the Scramjet files (`/scram/`, `/baremux/`, `/libcurl/`) and a Wisp server at `/wisp/`.
It never serves `node_modules`, `server/`, `scripts/`, `supabase/` or hidden files.

**Web proxy safety settings** (in `server/index.mjs`):
- It can't reach private or internal network addresses.
- It looks up sites with Cloudflare's family DNS (1.1.1.3), which blocks malware and adult sites.
  If sites won't load on your host, add the environment variable `SAFE_DNS=off` in Render to use normal DNS instead.
- Add sites to block in `hostname_blacklist`.

On a static host (Vercel, GitHub Pages) everything else still works. Websites just open in a normal browser tab instead of through the proxy.

## Adding content (the auto-detect folders)

| Drop files here | What happens |
|---|---|
| `games/html5/<name>/index.html` | HTML5 game. Add `cover.png` for a thumbnail and `game.json` with `{ "title", "description" }` (optional). |
| `games/webports/<name>/index.html` | Webport (Unity WebGL, Godot, etc.). Same layout as html5. |
| `games/flash/*.swf` | Flash game, runs with **Ruffle**. |
| `games/roms/*` | ROM, runs with **EmulatorJS**. The system comes from the file extension. For `.zip` or `.bin` files, use a system folder such as `games/roms/gba/` or `games/roms/psx/`. |
| `music/Artist - Title.mp3` | Local music. The "Artist - Title" name gives the artist and helps find lyrics. |
| `pdfs/*.pdf` | PDF library. |
| `videos/*.mp4` | Video library. A same-name `.vtt` file becomes subtitles. |

Any item can have a same-name image as its cover, for example `game.gba` with `game.png`.

When you deploy, `npm run build` scans the folders and writes `manifest.json`. Vercel runs it automatically (see `vercel.json`).
On a host with no build step (such as GitHub Pages), run `npm run build` yourself and commit `manifest.json`.

Only add games, ROMs, music and videos you have the right to share.

## Supabase setup (accounts, chat, PDF uploads)

1. Create a project at [supabase.com](https://supabase.com).
2. Go to **SQL Editor**, then **New query**. Paste all of `supabase/schema.sql` and click **Run**. This creates:
   profiles (username, profile picture, banner, bio, join date, saved settings), chat rooms, private-room codes,
   messages, PDF uploads, storage buckets and all the security rules.
3. Go to **Project Settings**, then **API**. Copy the **Project URL** and the **anon public** key into `js/config.js`.
4. Go to **Authentication**, then **URL Configuration**. Set **Site URL** to your website's address.
5. Optional: under **Authentication**, then **Providers**, then **Email**, turn off **Confirm email** so people can log in straight after signing up.
   If it's on, they confirm by email first, and the site tells them to.

Until the keys are added, the site runs in **setup mode**. Your profile is saved in your browser only, and chat and uploads are off.

## Optional settings (`js/config.js`)

- `youtubeApiKey`: a free YouTube Data API v3 key turns on YouTube search in Music. Without one, you can still paste YouTube links.
- `liveChannels`: the official broadcaster live streams shown in TV. Each channel is a YouTube channel ID.
- `archiveCollections`: the public-domain Internet Archive collections shown in TV.

## What powers each part

| Feature | Uses |
|---|---|
| Flash | Ruffle (from unpkg) |
| ROMs | EmulatorJS stable CDN |
| YouTube music | The official YouTube embed player (shown in a small corner player, as YouTube requires) |
| Lyrics | LRCLIB (free, no key) |
| AI | Puter.js. Free, no key. Each user signs in to a free Puter account on their first message. |
| Books | Open Library search plus the Internet Archive reader. Only public-domain books are shown. |
| TV | Official YouTube live streams from public broadcasters, plus public-domain Internet Archive shows and films |
| Accounts, chat, uploads | Supabase. The library is bundled in `js/vendor/`, so it still works when CDNs are blocked. |
| Web proxy | Scramjet 1.1, bare-mux and the libcurl transport, with a Wisp server (`@mercuryworkshop/wisp-js`) on the Node server |

## Project layout

```
index.html          app shell
play.html           Flash / ROM runner (opened in a frame)
css/style.css       all styles
js/app.js           boot, onboarding, browser (tabs) + desktop (dock) layouts, window manager
js/appmeta.js       app icon colours, search, wallpaper logo
js/widgets.js       clock, weather and system widgets
js/presence.js      "users online" count (Supabase Realtime presence)
js/apps/*.js        one file per app (games, music, videos, pdfs, books, tv, ai, chat, profile, settings, home)
js/config.js        your settings
js/themes.js        the 10 themes + fonts
js/proxy.js         Scramjet web proxy setup (lazy: only loads when you open a website)
sw.js               proxy service worker
server/index.mjs    Node server for Render: site + proxy + Wisp
render.yaml         Render Blueprint
scripts/            manifest builder + dev server
supabase/schema.sql database setup
```
