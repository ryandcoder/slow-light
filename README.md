# Slow Light

A black-and-white photography album with a cover photo, scroll animations, and a **like** and **comment** feature on every photo.

| Part | Folder | Where it runs | Free plan |
|---|---|---|---|
| Website (HTML, CSS, JS) | `web/` | Vercel | yes |
| API (PHP 8.3 + Apache, Docker) | `api/` | Render | yes |
| Database + photo storage | `supabase/schema.sql` | Supabase | yes |

```
Visitor's browser
  ├─ reads photos + comments ──────────────► Supabase (read-only public key)
  └─ likes, posts comments, admin uploads ─► PHP API on Render ─► Supabase (secret key)
```

Reads go straight to Supabase, so the album still loads while the free Render service is asleep. Only likes, new comments and admin actions need the API.

**Try it first:** open `web/index.html` through any local web server (see "Run it locally"). With the keys in `web/config.js` left empty, the site runs in **demo mode** with sample frames. Likes and comments are saved only in your own browser.

---

## 1. Supabase (database + photo storage)

1. Create a project at supabase.com (free plan).
2. Open **SQL Editor > New query**, paste the whole of `supabase/schema.sql`, and press **Run**. This creates the tables, the like and comment counters, the safety rules, and a public `photos` storage bucket.
3. Open **Project Settings > API** (or **API Keys**) and copy:
   - the **Project URL**,
   - the **anon / publishable** key (public, goes into the website),
   - the **service_role / secret** key (private, goes only into Render).

## 2. Render (the PHP API)

1. Put this whole folder in a GitHub repository.
2. In Render choose **New > Blueprint**, pick the repo. It reads `render.yaml` and creates a free Docker web service called `slow-light-api`.
   (Or **New > Web Service**, runtime **Docker**, root directory `api`.)
3. When asked, fill in the environment variables (see `api/.env.example`):

   | Name | Value |
   |---|---|
   | `SUPABASE_URL` | the Project URL |
   | `SUPABASE_SERVICE_KEY` | the secret / service_role key |
   | `ADMIN_TOKEN` | a long random password (16+ characters) for the admin page |
   | `ALLOWED_ORIGINS` | your Vercel address, e.g. `https://slow-light.vercel.app` (use `*` while testing) |

4. When it is live, open `https://YOUR-SERVICE.onrender.com/health`. You should see `{"name":"slow-light-api","ok":true}`.

> The first request after 15 idle minutes takes about a minute (free plan). The site sends a quiet "wake up" call as soon as someone opens it, and shows a message if a like or comment is slow.

## 3. Vercel (the website)

1. Edit `web/config.js` and fill in:
   ```js
   supabaseUrl: "https://YOUR-PROJECT.supabase.co",
   supabaseAnonKey: "your anon / publishable key",
   apiUrl: "https://YOUR-SERVICE.onrender.com",
   ownerName: "Your Name",
   contactEmail: "you@example.com"
   ```
   These values are meant to be public. Never put the secret key here.
2. In Vercel choose **Add New > Project**, import the repo, and set **Root Directory** to `web`. Framework preset: **Other**. No build command.
3. Copy the Vercel address into Render's `ALLOWED_ORIGINS` and redeploy the API.

## 4. Add your photos

Open `https://YOUR-SITE.vercel.app/admin`, enter your `ADMIN_TOKEN`, then:

- **Add photos**: choose files (JPEG, PNG or WebP, up to 20 MB each). The server resizes them (1800 px full size plus a small thumbnail) and converts them to WebP, so about 2,500 photos fit in the free 1 GB.
- Pick where they appear: **film strip** (chapter one), **contact sheet** (chapter two) or **cover** (the newest cover is used).
- Edit titles, move photos between chapters, change the order, delete photos.
- **Latest comments**: delete anything you don't want on the site.

Photos are shown in black and white. To show colour, set `--photo-filter: none;` at the top of `web/styles.css`.

## 5. Keep the free plans awake (recommended)

Supabase pauses a free project after a week with no activity. The workflow `.github/workflows/keepalive.yml` pings the API every three days. In GitHub open **Settings > Secrets and variables > Actions** and add a secret `API_URL` set to your Render address. (GitHub may switch off scheduled workflows in a public repo after about 60 days without any repo activity.)

---

## How likes and comments work

- **Likes:** one per visitor per photo. Each browser gets a random visitor id, stored in its own storage. Liking again removes the like. Clearing browser data lets that person like again, which is fine for a personal album.
- **Comments:** name (up to 40 characters) and text (up to 500). Shown newest first, always as plain text. Spam protection: a hidden field that bots fill in, a limit of 3 comments per minute and 30 per hour per visitor, and a limit on links.
- **Privacy:** the API stores only a salted hash of the visitor's IP, used for rate limiting. Likes can't be read by visitors at all.
- **Deep links:** opening a photo adds `#photo-<id>` to the address, so a single photo can be shared.

## Customising

- **Words on the page** (foreword, quote, footer line): edit `web/index.html`.
- **Fonts and colours:** top of `web/styles.css` (Archivo and Instrument Serif from Google Fonts).
- **Scroll animations:** bottom of `web/styles.css`. They use modern CSS scroll-driven animations (current Chrome and Edge). Other browsers get the same page without the motion, and the film strip becomes a normal swipeable row. Visitors who prefer reduced motion get no animation.

## Run it locally

```bash
# website (demo mode or live, depending on config.js)
cd web && python3 -m http.server 8000      # then open http://localhost:8000

# API (needs PHP 8.1+ with curl, gd and exif)
cd api
SUPABASE_URL=https://YOUR-PROJECT.supabase.co \
SUPABASE_SERVICE_KEY=your-secret-key \
ADMIN_TOKEN=a-long-random-password \
ALLOWED_ORIGINS='*' \
php -S localhost:8080 -t public public/index.php
```

API routes: `GET /health`, `GET /api/ping`, `POST /api/photos/{id}/like`, `POST /api/photos/{id}/comments`, and (with the admin token) `GET /api/admin/check`, `POST /api/admin/photos`, `PATCH` and `DELETE /api/admin/photos/{id}`, `DELETE /api/admin/comments/{id}`.

## Free-plan limits to keep in mind

- Supabase free: 500 MB database, 1 GB file storage, 5 GB transfer per month. The grids use small thumbnails and the full image loads only when a photo is opened, to stay within transfer.
- Render free: sleeps after 15 minutes idle, nothing saved on its disk (that's why photos live in Supabase Storage), outgoing email ports blocked.
- Always check the providers' current pricing pages, as free tiers change.
