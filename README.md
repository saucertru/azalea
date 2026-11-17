# Azalea

Games, music, videos, PDFs, books, TV, a free AI and chat, in one website.
Choose a browser-style or desktop-style layout, 10 themes, and your own accent colour, font and background.

- **Browser look:** tabs, an address bar (`azalea://games`), back, forward and reload, an icon rail, and a music pill.
  Alt+T opens a new tab and Alt+W closes it. Type an app name, a website (`example.com`) or a search into the address bar.
  Websites open in the tab through the built-in **Scramjet web proxy**, and you can add **Chrome extensions**
  (ad blockers, userscripts and so on) with the puzzle button in the Web app.
- **Desktop look:** coloured app icons, a big clock, local weather (Open-Meteo, after you allow location) and live system stats,
  plus a floating dock with search, pinned apps and open windows.

## Quick start (on your computer)

```bash
npm install
npm start           # full site + web proxy: http://localhost:8080
npm run dev         # quick preview without the proxy, no install needed: http://localhost:3000
npm run build:pages # what Cloudflare runs: builds the site into dist/
```

Both re-scan the content folders every time the page loads, so new files show up when you refresh.
You need Node.js 18 or newer.

## How it's hosted

| Part | Where | What it does |
|---|---|---|
| Website | **Cloudflare Workers** (`azalea.blazess-mc.workers.dev`) | The whole site, plus the Scramjet proxy files. It never sleeps, so it always loads instantly. |
| Large files (over 25 MB) | **Cloudflare R2** (bucket `azelela`) | Big ROMs, webports, videos, music and PDFs. Free downloads. |
| Wisp server | **Render** | The part of the web proxy that actually fetches websites. |

The site connects to Render using `wispUrl` in `js/config.js`. Free Render servers sleep after 15 minutes.
The site pings Render as soon as someone opens it, and the Web app retries for up to about a minute while Render wakes up.

### 1. Render (Wisp server)

Already set up. The service runs `server/index.mjs`, and nothing needs to change there.
- **Build command:** `npm install && npm run build` (or Render's pnpm equivalent)
- **Start command:** `npm start` or `node index.js`

The Render address still shows the full site too, which is handy as a backup.

**Web proxy safety settings** (in `server/index.mjs`):
- It can't reach private or internal network addresses.
- It looks up sites with Cloudflare's family DNS (1.1.1.3), which blocks malware and adult sites.
  If sites won't load, add the environment variable `SAFE_DNS=off` in Render to use normal DNS instead.
- Add sites to block in `hostname_blacklist`.

### 2. Cloudflare Worker (website)

The Worker `azalea` is connected to this GitHub repo, so every push to `main` redeploys it.
- **Build command:** `pnpm run build:pages` (puts the site in `dist/`)
- **Deploy command:** `npx wrangler deploy` (uses `wrangler.jsonc`)

Only `dist/` is published, so server code and config files stay private.
`worker/index.mjs` answers `/manifest.json`: it combines the files in this repo with whatever is in the R2 bucket right now.
The bucket is connected in `wrangler.jsonc`, so no R2 keys are needed, and new uploads show up within about a minute without a redeploy.

### 3. R2 (large files)

- **Upload files** in the dashboard (**R2 Object Storage**, then `azelela`, then **Upload**) using the same folders as the site.
  For example: `games/roms/n64/game.z64`, `games/webports/MyGame/index.html` or `videos/movie.mp4`.
  A same-name image still works as a cover, and `game.json` still works for titles.
- The bucket's public address (`mediaUrl` in `js/config.js`) is its `r2.dev` URL. It's rate-limited and meant for testing.
  If you get a domain later, connect it under the bucket's **Settings**, then **Custom Domains**, and use that as `mediaUrl`.
- The bucket's **CORS Policy** (in **Settings**) must allow the site to load files, which the emulator needs:
  ```json
  [
    {
      "AllowedOrigins": ["*"],
      "AllowedMethods": ["GET", "HEAD"],
      "AllowedHeaders": ["*"],
      "ExposeHeaders": ["Content-Length", "Content-Range", "Accept-Ranges"],
      "MaxAgeSeconds": 86400
    }
  ]
  ```

The Render copy of the site only lists files in the repo. To make it list R2 too, add `R2_ACCOUNT_ID`, `R2_BUCKET`,
`R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` (from an R2 API token with **Object Read only**) to Render's environment.

### 4. Supabase sign-in links

In Supabase, go to **Authentication**, then **URL Configuration**:
- **Site URL:** `https://azalea.blazess-mc.workers.dev`
- **Redirect URLs:** `https://azalea.blazess-mc.workers.dev/**` and `https://azalea-3rwy.onrender.com/**`

## Chrome extensions (in the Web app)

Open a website in the Web app and click the **puzzle button** to open **Extensions**. Then either:
- paste a **Chrome Web Store link** (or the 32-letter extension id) and click **Install**. The Render server downloads it from Google (`/api/crx/<id>`), or
- install a **.zip or .crx** file.

Extensions run on websites opened through the Web app. Their buttons and popups appear in the small bar above the page.
They're saved in each person's browser, can be turned off or removed, and options pages open in a new tab.

Not every extension works. Sapphire copies most of Chrome's extension features, but some (for example
blocking requests at the network level outside the page) can't fully work inside a website.

**Updating Sapphire:** the bundle in `js/vendor/` is committed, so deploys don't need to build it. To update it, run:
```bash
npm install --no-save --legacy-peer-deps @x8r/sapphire@<version> jszip@3.10.1 esbuild@0.28.0
node scripts/build-vendor.mjs
```
Sapphire, Scramjet and `scramjet-controller` versions must match each other.
`scramjet-controller` 0.0.14 checks it's running with Scramjet `2.0.67-alpha.2`.

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

Files over 25 MB go in your **R2 bucket** instead, in the same folders (see **How it's hosted**).
The Pages build lists the bucket and adds those files to the site automatically.

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

- `wispUrl`: the Wisp server for the web proxy (your Render address, `wss://…/wisp/`). Leave it blank to use the site's own server.
- `mediaUrl`: your R2 bucket's public address, for files over 25 MB.
- `youtubeApiKey`: a free YouTube Data API v3 key turns on YouTube search in Music. Without one, you can still paste YouTube links.
- `liveChannels`: the official broadcaster live streams shown in TV. Each channel is a YouTube channel ID.

## What powers each part

| Feature | Uses |
|---|---|
| Flash | Ruffle (from unpkg) |
| ROMs | EmulatorJS stable CDN |
| YouTube music | The official YouTube embed player (shown in a small corner player, as YouTube requires) |
| Lyrics | LRCLIB (free, no key) |
| AI | Puter.js. Free, no key. Each user signs in to a free Puter account on their first message. |
| Books | Open Library search plus the Internet Archive reader. Only public-domain books are shown. |
| TV | Official YouTube live streams from public broadcasters |
| Accounts, chat, uploads | Supabase. The library is bundled in `js/vendor/`, so it still works when CDNs are blocked. |
| Web proxy | Scramjet 2.0 (alpha) with `scramjet-controller` and the libcurl transport, connecting to a Wisp server (`@mercuryworkshop/wisp-js`) on the Node server |
| Chrome extensions | [Sapphire](https://github.com/x8rr/sapphire) (emulates the `chrome.*` APIs inside proxied pages), bundled into `js/vendor/` |

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
js/proxy.js         web proxy setup: Scramjet 2, Wisp transport, Sapphire, tab tracking (loads only when needed)
js/extensions.js    extensions UI: toolbar buttons, manager, popups, menus, notifications
js/vendor/          bundled libraries: supabase.js, sapphire.js, sapphire-sw.js
sw.js               service worker for the proxy and extensions
scripts/build-vendor.mjs  re-bundles Sapphire (only when updating it)
server/index.mjs    Node server for Render: site + proxy + Wisp
render.yaml         Render Blueprint
scripts/            manifest builder (local + R2), Pages build (build-static.cjs), dev server
supabase/schema.sql database setup
```
