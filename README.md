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
npm start           # full site + web proxy: http://localhost:8080
npm run dev         # quick preview without the proxy, no install needed: http://localhost:3000
npm run build:pages # what Cloudflare Pages runs: builds the site into dist/
```

Both re-scan the content folders every time the page loads, so new files show up when you refresh.
You need Node.js 18 or newer.

## How it's hosted

| Part | Where | What it does |
|---|---|---|
| Website | **Cloudflare Pages** | The whole site, plus the Scramjet proxy files. It never sleeps, so it always loads instantly. |
| Large files (over 25 MB) | **Cloudflare R2** | Big ROMs, webports, videos, music and PDFs. Free downloads. |
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

### 2. R2 (large files)

1. In the Cloudflare dashboard, open **R2 Object Storage** and click **Create bucket**. Name it something like `azalea-media`.
2. Open the bucket's **Settings** and find **Public Development URL**. Click **Enable**, then copy the `https://pub-….r2.dev` address.
   Paste it into `js/config.js` as `mediaUrl`, then push.
3. In the same **Settings** page, find **CORS Policy**, click **Add CORS policy** and paste the policy below.
   This lets the emulator load ROMs from R2.
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
4. Back on the R2 overview page, click **Manage API tokens**, then **Create API token**:
   - **Permission:** Object Read only
   - **Bucket:** apply it to your bucket only

   Copy the **Access Key ID** and **Secret Access Key**. The secret is only shown once. Also note your **Account ID**, shown on the R2 overview page.
5. **Upload files** using the same folders as the site, for example `games/roms/n64/game.z64`, `games/webports/MyGame/index.html` or `videos/movie.mp4`.
   A same-name image still works as a cover, and `game.json` still works for titles.

The free `r2.dev` address is rate-limited and meant for testing. If you get a domain later, connect it under **Settings**, then **Custom Domains**, and use that as `mediaUrl`.

### 3. Cloudflare Pages (website)

1. In the Cloudflare dashboard, go to **Workers & Pages**, click **Create**, then **Pages**, then **Connect to Git**, and pick `saucertru/azalea`.
2. Fill in the build settings:
   - **Framework preset:** None
   - **Build command:** `npm run build:pages`
   - **Build output directory:** `dist`
3. Under **Environment variables**, add these. Use **Encrypt** for the two keys.

   | Name | Value |
   |---|---|
   | `NODE_VERSION` | `22` |
   | `R2_ACCOUNT_ID` | your Cloudflare account ID |
   | `R2_BUCKET` | `azalea-media` (your bucket name) |
   | `R2_ACCESS_KEY_ID` | from step 2.4 |
   | `R2_SECRET_ACCESS_KEY` | from step 2.4 |
4. Click **Save and Deploy**. Your site will be at `https://<project>.pages.dev`.
5. In Supabase, go to **Authentication**, then **URL Configuration**, and set **Site URL** to the new `pages.dev` address.

**After uploading new files to R2**, redeploy Pages so the site lists them: go to **Deployments**, then **Retry deployment**.
Pushing to GitHub redeploys automatically.

The build log shows how many files came from R2, and warns if R2 couldn't be read.
It also lists any file in the repo over 25 MiB that Pages can't host, so you know to move it to R2.

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
scripts/            manifest builder (local + R2), Pages build (build-static.cjs), dev server
supabase/schema.sql database setup
```
