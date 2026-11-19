# Slow Light

A black-and-white photography album with a cinematic cover, a one-scroll slideshow, an all-time favourites chapter, and a like and comment feature on every photo.

**Live site:** https://slow-light-omega.vercel.app/
**Source:** https://github.com/ryandcoder/slow-light

---

## What it is

Slow Light is a personal project: a quiet, monochrome album for my photography. The mood is stark black and white, with no neon and no bright colour, and the photos do the talking. Visitors can browse the frames, like a photo, and leave a comment. I manage everything (uploads, ordering, moderation) from a private admin page.

**The page, top to bottom**

1. **Cover**: a single cover photo. The first scroll plays a short animation where the card tilts, turns landscape, and grows to fill the screen.
2. **Foreword**: a few lines that light up word by word.
3. **Film strip (chapter one)**: a horizontal slideshow where one scroll moves exactly one photo.
4. **All-time favourites (chapter two)**: the photos I keep coming back to.
5. **Index** and a quote band.
6. **Contact sheet (chapter three)**: icons and text only, no photos.

---

## Tech stack

| Layer | Technology | Hosted on |
|---|---|---|
| Front end | HTML, CSS, and vanilla JavaScript (no framework, no build step) | Vercel |
| API | PHP 8.3 on Apache, packaged in Docker | Render |
| Database | PostgreSQL | Supabase |
| Photo storage | Supabase Storage (public bucket) | Supabase |
| Fonts | Archivo and Instrument Serif (Google Fonts) | |

```
Visitor's browser
  ├─ reads photos and comments ─────────────► Supabase (read-only, public key)
  └─ likes, comments, admin uploads ────────► PHP API on Render ──► Supabase
```

**Why this split**

- **Reading goes straight to Supabase.** The album still loads while the free Render service is asleep. Only likes, comments, and admin actions need the API.
- **All writes go through my own API.** The browser never gets permission to change the database directly.
- **Supabase over a separate database plus file host.** One free project covers the database and the image storage, with enough room for a few thousand photos.
- **No framework on the front end.** The site is a handful of static files, which keeps it fast, simple to host, and easy to reason about.

---

## How it works

- **Photos:** when I upload an image in the admin page, the API resizes it, creates a small thumbnail, converts both to WebP, and stores them. The grids load thumbnails, and the full image loads only when a photo is opened.
- **Likes:** one like per visitor per photo, and liking again removes it. The count updates instantly in the page and is confirmed by the server.
- **Comments:** a name and a message, shown newest first as plain text. The API applies basic spam protection before saving anything.
- **Counts:** the like and comment totals are kept in step with the real data by the database itself, and a page that stays open refreshes its numbers when you come back to it.
- **Chapters:** every photo belongs to the cover, the film strip, or the favourites, and I can move it between them from the admin page.
- **Demo mode:** with no keys configured, the site runs with sample frames, so it can be tried with no accounts at all.

---

## The animation

All motion is written by hand in JavaScript, with no animation library.

- **Cover:** the first scroll plays the whole cover animation by itself, and scrolling up at the top plays it backwards. After it opens, a "Scroll down" button appears.
- **Slideshow:** each scroll moves one photo. The photo in the middle is sharp and full size, and the neighbours turn away and fade. After the last photo, scrolling carries on down the page.
- **Everything else:** each section starts its own animation as soon as it comes into view, plays on its own, and plays again every time you scroll back to it. Each section has a different effect: words lighting up, headings drawn in, photos uncovered from different sides, a band that opens like a curtain, rows sliding in from opposite sides.
- **Scroll bar:** a thin custom scroll bar, plus a small side rail showing progress and the name of the current section.
- **Accessibility:** visitors who set "reduce motion" on their device get a calm static page.

---

## The process

1. **Concept and design draft.** I started with a Vogue-style magazine layout, then changed direction to a Frank Ocean-inspired black-and-white concept: a cover photo first, then animation as you scroll.
2. **Choosing the stack.** I wanted PHP for the backend, Render for the API, and Vercel for hosting. For the database I compared options and picked Supabase for its free Postgres and image storage.
3. **Building the front end.** I built the page and the photo cards, a lightbox viewer with comments, and the admin page.
4. **Building the API.** A small PHP service handles likes, comments, and image processing. Anything that writes to the database goes through it.
5. **Iterating on the motion.** My first version used the newer CSS scroll-driven animations. They only work in some browsers, so I replaced them with a JavaScript engine that works everywhere. I then rebuilt it around a reference animation I liked, and finally changed it so a single scroll triggers each animation instead of needing a lot of scrolling.
6. **Testing.** I tested the whole stack locally against a stand-in for Supabase, with automated browser tests for likes, comments, admin uploads, and layout on desktop and phone. I also checked that the like and comment totals match the real data after every action.
7. **Deploying.** The database on Supabase, the API on Render, and the site on Vercel.
8. **Fixing what only showed up live.** Newer Supabase projects no longer open new tables to the API by default, so uploads and reads failed until I granted the permissions explicitly. I then added clearer error messages for it.

---

## What I learned

- Splitting reads and writes keeps a free, sleepy backend from making the site feel broken.
- Browser support matters more than novelty: a hand-written scroll engine beat a CSS feature that only some browsers have.
- Defaults in hosted services change, so a production deploy needs its own checks, not just a local test.
- Animation should respond to a single gesture, not demand endless scrolling.

---

## Running it

The front end is static files. To try it in demo mode, serve the `web` folder with any local web server, for example `python3 -m http.server`, and open it in a browser. Going live needs your own Supabase project, API host, and settings file. Those are deliberately not included in this repository.

## Author

**Kim Ryan Nabo**, Computer Science graduate, based in Bocaue, Bulacan, Philippines.
GitHub: [ryandcoder](https://github.com/ryandcoder)