/* Slow Light: scroll motion (no libraries needed).

   One scroll is enough. Nothing here waits for you to keep scrolling:
   - Cover      first scroll plays the whole cover animation by itself (card tilts, turns
                landscape, grows to full screen). Scroll up at the top and it plays back.
   - Slideshow  each scroll moves exactly one photo. After the last (or before the first)
                photo, the next scroll carries on down (or up) the page.
   - Everything else starts as soon as it comes into view and plays by itself. It plays
                again every time you scroll back to it.
   Keyboard (arrows, Page Up/Down, space) and touch swipes work the same way.
   Visitors who ask their device for reduced motion get the calm static page. */
(() => {
  'use strict';

  const root = document.documentElement;
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) root.classList.add('reduce');

  const $ = (sel, r = document) => r.querySelector(sel);
  const $$ = (sel, r = document) => Array.from(r.querySelectorAll(sel));
  const clamp = (v) => Math.min(1, Math.max(0, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  const NAMES = [['.hero', 'Cover'], ['#foreword', 'Foreword'], ['#strip', 'Frames'], ['#sheet', 'Favourites'],
    ['.band', 'Quote'], ['#index', 'Index'], ['.closing', 'End'], ['#contact', 'Contact']];
  const REVEAL = '.foreword .eyebrow, .lines, .sec-head, .sheet .photo, .band, .index .row, .closing, .foot-line, .contact-item';

  let el = {};
  let vw = window.innerWidth;
  let vh = window.innerHeight;
  let ticking = false;
  let io = null;
  let rail = null;
  let lastSection = '';
  let lastPct = -1;

  // gesture state
  let busy = false;
  let lockUntil = 0;
  let heroP = 0;
  let heroOpen = false;
  let step = 0;
  let travel = 0;
  let stageW = vw;
  let centers = [];
  let lastT = 0;
  let lastAbs = 0;

  const lightboxOpen = () => { const d = $('#lightbox'); return !!(d && d.open); };

  function collect() {
    el = {
      progress: $('.progress'),
      hero: $('.hero'),
      stage: $('.hero-stage'),
      cover: $('#cover'),
      title: $('.hero-title'),
      foot: $('.hero-foot'),
      chip: $('#cover-chip'),
      strip: $('#strip'),
      track: $('#strip-track'),
      photos: $$('#strip-track .photo'),
      intro: $('.strip-intro'),
      fill: $('.strip-fill'),
      n: $('#strip-n'),
      total: $('#strip-total'),
      name: $('#strip-name'),
      navLinks: $$('.nav-link[data-nav]'),
      sections: NAMES.map(([sel, name]) => ({ node: $(sel), name })).filter((s) => s.node)
    };
  }

  function splitWords() {
    let i = 0;
    $$('.line').forEach((line) => {
      if (!line.dataset.split) {
        line.dataset.split = '1';
        const text = line.textContent.trim().split(/\s+/);
        line.textContent = '';
        text.forEach((w, k) => {
          const span = document.createElement('span');
          span.className = 'w';
          span.textContent = w;
          line.appendChild(span);
          if (k < text.length - 1) line.appendChild(document.createTextNode(' '));
        });
        line.setAttribute('aria-label', text.join(' '));
      }
      $$('.w', line).forEach((w) => w.style.setProperty('--i', String(i++)));
    });
  }

  function makeRail() {
    if (rail) return;
    rail = document.createElement('div');
    rail.className = 'rail';
    rail.setAttribute('aria-hidden', 'true');
    rail.innerHTML = '<span class="rail-pct">00</span><span class="rail-track"><i class="rail-fill"></i></span><span class="rail-name">Cover</span>';
    document.body.appendChild(rail);
    rail.fill = $('.rail-fill', rail);
    rail.pct = $('.rail-pct', rail);
    rail.name = $('.rail-name', rail);
  }

  /* ---------------------------------------------------------- timing helper */

  function tween(ms, fn, done) {
    busy = true;
    const t0 = performance.now();
    (function frame(now) {
      const t = clamp((now - t0) / ms);
      fn(t);
      if (t < 1) {
        window.requestAnimationFrame(frame);
      } else {
        busy = false;
        lockUntil = performance.now() + 200;
        if (done) done();
      }
    })(t0);
  }

  /* ------------------------------------------------------------------ cover */

  function renderHero(p) {
    if (!el.stage || !el.cover) return;
    const sw = el.stage.clientWidth;
    const sh = el.stage.clientHeight;
    const h0 = Math.min(sh * 0.62, sw * 0.78 * 1.25, 640);
    const w0 = h0 * 0.8;
    const q = easeInOut(clamp((p - 0.15) / 0.8));
    const tilt = Math.sin(Math.PI * clamp(p / 0.6));
    el.cover.style.width = lerp(w0, sw, q).toFixed(1) + 'px';
    el.cover.style.height = lerp(h0, sh, q).toFixed(1) + 'px';
    el.cover.style.transform = 'perspective(1400px) rotateX(' + (11 * tilt).toFixed(2) + 'deg) rotateY(' +
      (-24 * tilt).toFixed(2) + 'deg) rotateZ(' + (-7 * tilt).toFixed(2) + 'deg)';
    if (el.title) {
      el.title.style.opacity = (1 - clamp(p / 0.45)).toFixed(3);
      el.title.style.transform = 'translate3d(0,' + (-p * 9).toFixed(2) + 'vh,0) scale(' + (1 + p * 0.3).toFixed(3) + ')';
    }
    if (el.foot) el.foot.style.opacity = (1 - clamp(p / 0.12)).toFixed(3);
    if (el.chip) el.chip.style.opacity = (1 - clamp(p / 0.15)).toFixed(3);
  }

  // "Scroll down" button that appears once the cover has opened
  let heroCue = null;
  function makeHeroCue() {
    if (heroCue || !el.stage) return;
    heroCue = document.createElement('button');
    heroCue.type = 'button';
    heroCue.className = 'cue2';
    heroCue.innerHTML = '<span>Scroll down</span><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path d="M5 9l7 7 7-7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    heroCue.addEventListener('click', () => {
      const f = $('#foreword');
      if (f) f.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    el.stage.appendChild(heroCue);
    if (heroOpen) heroCue.classList.add('show');
  }
  const showHeroCue = (on) => { if (heroCue) heroCue.classList.toggle('show', on); };

  function playHero(to) {
    const from = heroP;
    showHeroCue(false);
    tween(1700, (t) => { heroP = lerp(from, to, t); renderHero(heroP); }, () => { heroOpen = to === 1; showHeroCue(heroOpen); });
  }

  /* -------------------------------------------------------------- slideshow */

  function measureStrip() {
    const section = el.strip;
    if (!section || section.hidden || !el.track) return;
    const stage = $('.strip-stage', section);
    section.classList.add('pinned');
    section.style.height = '';
    stageW = stage.clientWidth;
    el.track.style.paddingRight = '';
    if (el.photos.length) {
      const last = el.photos[el.photos.length - 1];
      el.track.style.paddingRight = Math.max(40, stageW / 2 - last.offsetWidth / 2) + 'px';
    }
    travel = Math.max(0, el.track.scrollWidth - stageW);
    centers = el.photos.map((p) => p.offsetLeft + p.offsetWidth / 2);
    if (el.total) el.total.textContent = String(el.photos.length).padStart(2, '0');
    step = Math.min(step, Math.max(0, el.photos.length - 1));
  }

  const stepTx = (s) => (centers.length ? Math.min(travel, Math.max(0, centers[s] - stageW / 2)) : 0);

  function applyStrip(tx) {
    if (!el.track || !el.photos.length) return;
    el.track.style.transform = 'translate3d(' + (-tx).toFixed(1) + 'px,0,0)';
    if (el.fill) el.fill.style.transform = 'scaleX(' + (travel > 0 ? clamp(tx / travel) : 0).toFixed(4) + ')';
    if (el.intro) {
      el.intro.style.opacity = (1 - clamp((tx - 40) / (stageW * 0.3))).toFixed(3);
      el.intro.style.transform = 'translate3d(' + (-tx * 0.15).toFixed(1) + 'px,0,0)';
    }
    let best = 0;
    let bestD = Infinity;
    el.photos.forEach((ph, i) => {
      const d = (centers[i] - tx - stageW / 2) / stageW;
      const ad = Math.min(1, Math.abs(d) * 1.5);
      if (Math.abs(d) < bestD) { bestD = Math.abs(d); best = i; }
      const rot = Math.max(-1, Math.min(1, -d)) * 18;
      ph.style.transform = 'perspective(1100px) rotateY(' + rot.toFixed(2) + 'deg) scale(' + (1 - 0.2 * ad).toFixed(3) + ')';
      ph.style.opacity = (1 - 0.65 * ad).toFixed(3);
    });
    if (el.n) el.n.textContent = String(best + 1).padStart(2, '0');
    const t = $('.cap-title', el.photos[best]);
    if (el.name) el.name.textContent = t ? t.textContent : '';
  }

  let curTx = 0;
  function goStep(n) {
    const last = el.photos.length - 1;
    n = Math.max(0, Math.min(last, n));
    const from = curTx;
    const to = stepTx(n);
    step = n;
    tween(950, (t) => { curTx = lerp(from, to, easeInOut(t)); applyStrip(curTx); });
  }

  function snapTo(y, done) {
    const from = window.scrollY || window.pageYOffset || 0;
    tween(800, (t) => window.scrollTo({ top: lerp(from, y, easeInOut(t)), behavior: 'instant' }), done);
  }

  /* ------------------------------------------------------- one-scroll logic */

  // What should one scroll in direction dir (+1 down, -1 up) do right now? null = let the page scroll.
  function plan(dir) {
    if (lightboxOpen()) return null;
    const y = window.scrollY || window.pageYOffset || 0;
    if (el.hero && y <= 1) {
      if (dir > 0 && !heroOpen) return ['hero', 1];
      if (dir < 0 && heroOpen) return ['hero', 0];
    }
    const s = el.strip;
    if (s && !s.hidden && s.classList.contains('pinned') && el.photos.length) {
      const r = s.getBoundingClientRect();
      const last = el.photos.length - 1;
      if (Math.abs(r.top) <= 12) {
        if (dir > 0 && step < last) return ['step', step + 1];
        if (dir < 0 && step > 0) return ['step', step - 1];
        return null;
      }
      if (dir > 0 && r.top > 12 && r.top < vh * 0.9) return ['snap', 0];
      if (dir < 0 && r.top < -12 && r.bottom > 12 && r.bottom < vh * 0.9) return ['snap', last];
    }
    return null;
  }

  function act(pl) {
    if (pl[0] === 'hero') {
      playHero(pl[1]);
    } else if (pl[0] === 'step') {
      goStep(pl[1]);
    } else {
      step = pl[1];
      curTx = stepTx(step);
      applyStrip(curTx);
      const top = el.strip.getBoundingClientRect().top + (window.scrollY || window.pageYOffset || 0);
      snapTo(top);
    }
  }

  function onWheel(e) {
    if (e.ctrlKey || lightboxOpen()) return;
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    const dir = Math.sign(e.deltaY);
    if (!dir) return;
    const now = performance.now();
    const abs = Math.abs(e.deltaY);
    // a new flick starts a new gesture; the long tail of a trackpad swipe does not
    const fresh = now - lastT > 120 || abs > lastAbs * 1.5 + 2;
    lastT = now;
    lastAbs = abs;
    if (busy) { e.preventDefault(); return; }
    const pl = plan(dir);
    if (!pl) return;
    e.preventDefault();
    if (fresh && now >= lockUntil) act(pl);
  }

  function onKey(e) {
    if (e.altKey || e.ctrlKey || e.metaKey || lightboxOpen()) return;
    const t = e.target;
    const tag = t && t.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    let dir = 0;
    if (e.key === 'ArrowDown' || e.key === 'PageDown') dir = 1;
    else if (e.key === 'ArrowUp' || e.key === 'PageUp') dir = -1;
    else if (e.key === ' ' && tag !== 'BUTTON' && tag !== 'A') dir = e.shiftKey ? -1 : 1;
    if (!dir) return;
    if (busy) { e.preventDefault(); return; }
    const pl = plan(dir);
    if (!pl) return;
    e.preventDefault();
    if (performance.now() >= lockUntil) act(pl);
  }

  let touchY = 0;
  let touchFired = false;
  function onTouchStart(e) {
    touchY = e.touches[0].clientY;
    touchFired = false;
  }
  function onTouchMove(e) {
    if (lightboxOpen()) return;
    const dy = touchY - e.touches[0].clientY;
    if (Math.abs(dy) < 6) return;
    const dir = dy > 0 ? 1 : -1;
    if (busy) { e.preventDefault(); return; }
    const pl = plan(dir);
    if (!pl) return;
    e.preventDefault();
    if (!touchFired && Math.abs(dy) > 30 && performance.now() >= lockUntil) {
      touchFired = true;
      act(pl);
    }
  }

  /* --------------------------------------------- scroll-in reveals (replay) */

  function observe() {
    if (io) io.disconnect();
    io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (en.isIntersecting) en.target.classList.add('in');
        else if (en.boundingClientRect.top > 0) en.target.classList.remove('in'); // left at the bottom: replay next time
      }
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0 });
    $$(REVEAL).forEach((n) => io.observe(n));
  }

  /* --------------------------------------------- scroll bar, rail, menu */

  function update() {
    ticking = false;
    const y = window.scrollY || window.pageYOffset || 0;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const pr = max > 0 ? clamp(y / max) : 0;

    if (el.progress) el.progress.style.transform = 'scaleX(' + pr.toFixed(4) + ')';
    if (rail) {
      rail.fill.style.transform = 'scaleY(' + pr.toFixed(4) + ')';
      const pct = Math.round(pr * 100);
      if (pct !== lastPct) { lastPct = pct; rail.pct.textContent = String(pct).padStart(2, '0'); }
    }

    // the cover is already open if the page was reloaded or jumped down past it
    if (!heroOpen && !busy && y > vh * 0.5) { heroOpen = true; heroP = 1; renderHero(1); showHeroCue(true); }

    let cur = null;
    for (const s of el.sections) {
      if (s.node.hidden) continue;
      if (s.node.getBoundingClientRect().top <= vh * 0.5) cur = s;
    }
    const curName = cur ? cur.name : 'Cover';
    if (curName !== lastSection) {
      lastSection = curName;
      if (rail) rail.name.textContent = curName;
      el.navLinks.forEach((a) => {
        a.classList.toggle('on', (a.dataset.nav === 'strip' && curName === 'Frames') || (a.dataset.nav === 'sheet' && curName === 'Favourites'));
      });
    }
  }

  function request() {
    if (!ticking) {
      ticking = true;
      window.requestAnimationFrame(update);
    }
  }

  function refresh() {
    if (reduce) return;
    collect();
    splitWords();
    $$('.sheet .photo-frame').forEach((f, i) => {
      f.dataset.m = String(i % 3);
      f.style.setProperty('--d', ((i % 4) * 0.1).toFixed(1) + 's');
    });
    measureStrip();
    curTx = stepTx(step);
    applyStrip(curTx);
    makeRail();
    makeHeroCue();
    observe();
    if ((window.scrollY || 0) > 5 && !busy) { heroOpen = true; heroP = 1; showHeroCue(true); }
    renderHero(heroP);
    request();
  }

  function intro() {
    if (root.classList.contains('is-in')) return;
    if (reduce) { root.classList.add('is-in'); return; }
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => root.classList.add('is-in')));
  }

  window.slMotion = { refresh };

  function init() {
    collect();
    intro();
    if (reduce) return;
    root.classList.add('mo');

    const prev = $('#strip-prev');
    const next = $('#strip-next');
    if (prev) prev.addEventListener('click', () => { if (!busy) goStep(step - 1); });
    if (next) next.addEventListener('click', () => { if (!busy) goStep(step + 1); });
    const cue = $('#cue');
    if (cue) {
      cue.addEventListener('click', (e) => {
        if (busy) { e.preventDefault(); return; }
        if (!heroOpen) { e.preventDefault(); playHero(1); }
      });
    }

    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKey);
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('scroll', request, { passive: true });
    window.addEventListener('resize', () => {
      vw = window.innerWidth;
      vh = window.innerHeight;
      measureStrip();
      curTx = stepTx(step);
      applyStrip(curTx);
      renderHero(heroP);
      request();
    });
    window.addEventListener('load', refresh);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(refresh);
    refresh();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();