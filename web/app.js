/* Slow Light: album front end.
   Reads photos and comments straight from Supabase (read-only public key),
   sends likes and new comments through the PHP API. With no keys set in
   config.js it runs in demo mode with sample frames. */
(() => {
  'use strict';

  const CFG = Object.assign(
    { supabaseUrl: '', supabaseAnonKey: '', apiUrl: '', bucket: 'photos', ownerName: '', contactEmail: '' },
    window.SLOW_LIGHT || {}
  );
  const LIVE = Boolean(CFG.supabaseUrl && CFG.supabaseAnonKey);
  const SB = CFG.supabaseUrl.replace(/\/+$/, '');
  const API = CFG.apiUrl.replace(/\/+$/, '');

  /* ------------------------------------------------------------ helpers */

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function h(tag, props = {}, ...kids) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'style') node.style.cssText = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : value);
    }
    for (const kid of kids.flat()) {
      if (kid === null || kid === undefined) continue;
      node.append(kid.nodeType ? kid : document.createTextNode(kid));
    }
    return node;
  }

  // Browser storage can be blocked (private windows, strict settings), so keep a fallback.
  const memory = {};
  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        if (raw !== null) return JSON.parse(raw);
      } catch (e) { /* ignore */ }
      return key in memory ? memory[key] : fallback;
    },
    set(key, value) {
      memory[key] = value;
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
    }
  };

  const ICON = {
    heart: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M12 20.5s-8-4.9-8-11A4.5 4.5 0 0 1 12 6.8 4.5 4.5 0 0 1 20 9.5c0 6.1-8 11-8 11z"/></svg>',
    bubble: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M4 4.5h16v11H10l-6 4.5z"/></svg>'
  };
  function icon(name) {
    const span = h('span', { class: 'ico' });
    span.innerHTML = ICON[name]; // fixed, trusted markup (no user data)
    return span;
  }

  function visitorId() {
    let id = store.get('sl_visitor', null);
    if (!id) {
      id = (window.crypto && crypto.randomUUID)
        ? crypto.randomUUID().replace(/-/g, '')
        : Math.random().toString(36).slice(2) + Date.now().toString(36);
      store.set('sl_visitor', id);
    }
    return id;
  }

  const likedSet = new Set(store.get('sl_liked', []));
  const saveLiked = () => store.set('sl_liked', Array.from(likedSet));

  let toastTimer = 0;
  function toast(message) {
    const node = $('#toast');
    node.textContent = message;
    node.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove('show'), 4200);
  }

  async function request(url, options = {}, timeoutMs = 90000) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(url, Object.assign({}, options, { signal: ctl.signal }));
      let data = null;
      try { data = await res.json(); } catch (e) { /* no body */ }
      if (!res.ok) {
        throw new Error((data && (data.error || data.message)) || 'Something went wrong (' + res.status + ').');
      }
      return data;
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('The server took too long to answer. Please try again.');
      if (err instanceof TypeError) throw new Error('Could not reach the server. It may be waking up, so try again in a moment.');
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /* --------------------------------------------------------- live data */

  const live = {
    headers() {
      const headers = { apikey: CFG.supabaseAnonKey };
      if (CFG.supabaseAnonKey.startsWith('eyJ')) headers.Authorization = 'Bearer ' + CFG.supabaseAnonKey;
      return headers;
    },
    fileUrl(path) {
      return SB + '/storage/v1/object/public/' + CFG.bucket + '/' + path.split('/').map(encodeURIComponent).join('/');
    },
    async photos() {
      const rows = await request(SB + '/rest/v1/photos?select=*&order=position.asc,created_at.asc', { headers: live.headers() }, 25000);
      return rows.map((r) => Object.assign({}, r, { image_url: live.fileUrl(r.image_path), thumb_url: live.fileUrl(r.thumb_path) }));
    },
    comments(id) {
      return request(
        SB + '/rest/v1/comments?select=id,name,body,created_at&photo_id=eq.' + encodeURIComponent(id) + '&order=created_at.desc&limit=100',
        { headers: live.headers() }, 25000
      );
    },
    async comment(id, payload) {
      if (!API) throw new Error('The API address is missing in config.js.');
      const res = await request(API + '/api/photos/' + encodeURIComponent(id) + '/comments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      return res.comment;
    },
    like(id) {
      if (!API) throw new Error('The API address is missing in config.js.');
      return request(API + '/api/photos/' + encodeURIComponent(id) + '/like', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visitor: visitorId() })
      });
    }
  };

  /* ------------------------------------------------------- demo data */

  function toneUrl(ar, spec) {
    const W = 900;
    const H = Math.round(W / ar);
    const stops = spec.stops.map((c, i) => '<stop offset="' + Math.round((i * 100) / (spec.stops.length - 1)) + '%" stop-color="' + c + '"/>').join('');
    const gradient = spec.type === 'radial'
      ? '<radialGradient id="g" cx="' + spec.cx + '" cy="' + spec.cy + '" r="0.85">' + stops + '</radialGradient>'
      : '<linearGradient id="g" gradientTransform="rotate(' + spec.angle + ' .5 .5)">' + stops + '</linearGradient>';
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' +
      '<defs>' + gradient +
      '<filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch"/>' +
      '<feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope=".2"/></feComponentTransfer></filter></defs>' +
      '<rect width="100%" height="100%" fill="url(#g)"/><rect width="100%" height="100%" filter="url(#n)"/></svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  const R = (cx, cy, stops) => ({ type: 'radial', cx, cy, stops });
  const L = (angle, stops) => ({ type: 'linear', angle, stops });
  const DEMO_SPECS = [
    ['cover', 'harbour, 5:42 am', 0.8, R(0.35, 0.25, ['#7a7a7a', '#2c2c2c', '#0b0b0b'])],
    ['strip', 'harbour, first light', 0.8, L(70, ['#4d4d4d', '#171717', '#050505'])],
    ['strip', 'salt flats, noon', 1.5, R(0.72, 0.3, ['#d1d1d1', '#7b7b7b', '#242424'])],
    ['strip', 'fog over the pier', 0.75, L(90, ['#ebebeb', '#9d9d9d', '#3b3b3b'])],
    ['strip', 'window, november', 1, L(30, ['#111111', '#3d3d3d', '#0d0d0d'])],
    ['strip', 'last tram home', 0.8, R(0.3, 0.7, ['#bfbfbf', '#525252', '#0c0c0c'])],
    ['sheet', 'plaster wall', 0.8, L(110, ['#bdbdbd', '#4a4a4a', '#101010'])],
    ['sheet', 'stairwell, two floors up', 1.5, R(0.4, 0.4, ['#e0e0e0', '#8f8f8f', '#2b2b2b'])],
    ['sheet', 'fern, after rain', 0.75, L(70, ['#1b1b1b', '#5e5e5e', '#0a0a0a'])],
    ['sheet', 'sheet on the line', 1, R(0.65, 0.35, ['#f0f0f0', '#a3a3a3', '#303030'])],
    ['sheet', 'empty platform', 1.5, L(10, ['#0e0e0e', '#444444', '#151515'])],
    ['sheet', 'hands, mid-sentence', 0.8, R(0.3, 0.6, ['#cfcfcf', '#666666', '#121212'])]
  ];
  const DEMO_SEED_COMMENTS = {
    'demo-2': [{ id: 'c1', name: 'Mara', body: 'That light on the water. I could stare at this one for an hour.', created_at: '2026-10-12T09:30:00Z' }],
    'demo-3': [{ id: 'c2', name: 'Jon', body: 'The empty space does so much work here.', created_at: '2026-10-14T18:05:00Z' }]
  };

  const demoState = store.get('sl_demo', { counts: {}, comments: {}, liked: [] });
  const demo = {
    photos() {
      return Promise.resolve(DEMO_SPECS.map(([chapter, title, ar, spec], i) => {
        const id = 'demo-' + (i + 1);
        const url = toneUrl(ar, spec);
        const comments = demoState.comments[id] || DEMO_SEED_COMMENTS[id] || [];
        return {
          id, chapter, title, caption: 'A sample caption. Replace the frames and captions from the admin page.',
          width: 900, height: Math.round(900 / ar), image_url: url, thumb_url: url,
          likes_count: demoState.counts[id] !== undefined ? demoState.counts[id] : (i % 4 === 0 ? 3 : i % 3 === 0 ? 1 : 0),
          comments_count: comments.length
        };
      }));
    },
    comments(id) {
      return Promise.resolve(demoState.comments[id] || DEMO_SEED_COMMENTS[id] || []);
    },
    comment(id, payload) {
      const list = (demoState.comments[id] || DEMO_SEED_COMMENTS[id] || []).slice();
      const entry = { id: 'd' + Date.now(), name: payload.name, body: payload.body, created_at: new Date().toISOString() };
      list.unshift(entry);
      demoState.comments[id] = list;
      store.set('sl_demo', demoState);
      return Promise.resolve(entry);
    },
    like(id) {
      const photo = byId.get(id);
      const was = demoState.liked.includes(id);
      const base = photo ? photo.likes_count - (likedSet.has(id) !== was ? (was ? -1 : 1) : 0) : 0;
      const likes = Math.max(0, base + (was ? -1 : 1));
      demoState.liked = was ? demoState.liked.filter((x) => x !== id) : demoState.liked.concat(id);
      demoState.counts[id] = likes;
      store.set('sl_demo', demoState);
      return Promise.resolve({ liked: !was, likes });
    }
  };

  const data = LIVE ? live : demo;

  /* ------------------------------------------------------------- state */

  let byId = new Map();
  let order = [];      // every photo in viewing order (cover, strip, sheet)
  let index = -1;      // current photo in the lightbox
  const commentCache = new Map();
  const pending = new Set();
  let commentsToken = 0;

  /* ------------------------------------------------------- photo cards */

  function card(p) {
    const ratio = p.width && p.height ? Math.min(2.6, Math.max(0.4, p.width / p.height)) : 0.8;
    const title = p.title || 'untitled';
    const img = h('img', { src: p.thumb_url, alt: title, loading: 'lazy', decoding: 'async' });

    const open = h('button', { class: 'photo-open', type: 'button', 'aria-label': 'Open ' + title, onclick: () => openPhoto(p.id) },
      h('span', { class: 'photo-frame' }, img));

    const likeBtn = h('button', { class: 'act like-btn', type: 'button', 'aria-pressed': 'false', onclick: () => toggleLike(p.id) },
      icon('heart'), h('span', { class: 'like-count', text: '0' }));
    const commentBtn = h('button', { class: 'act comment-btn', type: 'button', onclick: () => openPhoto(p.id, true) },
      icon('bubble'), h('span', { class: 'comment-count', text: '0' }));

    return h('figure', { class: 'photo', 'data-id': p.id, style: '--ar:' + ratio.toFixed(4) },
      open,
      h('figcaption', { class: 'photo-cap' },
        h('span', { class: 'cap-title', text: title.toLowerCase() }),
        h('span', { class: 'cap-acts' }, likeBtn, commentBtn)));
  }

  function refresh(p) {
    const liked = likedSet.has(p.id);
    const title = p.title || 'photograph';
    for (const fig of $$('.photo[data-id="' + p.id + '"]')) {
      const likeBtn = $('.like-btn', fig);
      likeBtn.setAttribute('aria-pressed', liked ? 'true' : 'false');
      likeBtn.setAttribute('aria-label', (liked ? 'Unlike ' : 'Like ') + title + ', ' + p.likes_count + ' likes');
      $('.like-count', fig).textContent = String(p.likes_count);
      const commentBtn = $('.comment-btn', fig);
      commentBtn.setAttribute('aria-label', 'Comments on ' + title + ', ' + p.comments_count);
      $('.comment-count', fig).textContent = String(p.comments_count);
    }
    if (index >= 0 && order[index] && order[index].id === p.id) refreshLightboxMeta(p);
  }

  /* -------------------------------------------------------------- build */

  function build(rows) {
    byId = new Map(rows.map((p) => [p.id, p]));
    const covers = rows.filter((p) => p.chapter === 'cover');
    const cover = covers.length ? covers[covers.length - 1] : null;
    const strip = rows.filter((p) => p.chapter === 'strip');
    const sheet = rows.filter((p) => p.chapter === 'sheet' || (p.chapter === 'cover' && p !== cover));
    order = (cover ? [cover] : []).concat(strip, sheet);

    // cover
    const coverBtn = $('#cover-open');
    if (cover) {
      coverBtn.hidden = false;
      coverBtn.onclick = () => openPhoto(cover.id);
      coverBtn.setAttribute('aria-label', 'Open the cover photo: ' + (cover.title || 'untitled'));
      coverBtn.replaceChildren(h('img', { src: cover.image_url, alt: cover.title || 'Cover photograph', fetchpriority: 'high' }));
      $('#cover-chip').hidden = true;
    }

    // strip
    const section = $('#strip');
    const track = $('#strip-track');
    $$('.photo', track).forEach((n) => n.remove());
    strip.forEach((p) => track.append(card(p)));
    section.hidden = strip.length === 0;
    $$('[data-nav="strip"], [data-row="strip"]').forEach((n) => { n.hidden = strip.length === 0; });

    // contact sheet
    const grid = $('#sheet-grid');
    grid.replaceChildren();
    sheet.forEach((p) => grid.append(card(p)));

    $$('[data-count="strip"]').forEach((n) => { n.textContent = String(strip.length); });
    $$('[data-count="sheet"]').forEach((n) => { n.textContent = String(sheet.length); });

    const state = $('#state');
    if (!rows.length) {
      state.hidden = false;
      state.replaceChildren(document.createTextNode(
        LIVE ? 'no photos yet. add the first frames from the admin page.' : 'no photos to show.'));
    } else {
      state.hidden = true;
    }

    rows.forEach(refresh);
    refreshMotion();
    openFromHash();
  }

  function showError(err) {
    const state = $('#state');
    state.hidden = false;
    state.replaceChildren(
      document.createTextNode('the album is resting. ' + (err && err.message ? err.message : '')),
      h('div', {}, h('button', { class: 'btn', type: 'button', onclick: load, text: 'Try again' }))
    );
  }

  /* The pinned film strip and the other scroll effects live in motion.js. */
  const refreshMotion = () => { if (window.slMotion) window.slMotion.refresh(); };

  /* ------------------------------------------------------------- likes */

  async function toggleLike(id) {
    const p = byId.get(id);
    if (!p || pending.has(id)) return;
    pending.add(id);

    const was = likedSet.has(id);
    if (was) likedSet.delete(id); else likedSet.add(id);
    p.likes_count = Math.max(0, p.likes_count + (was ? -1 : 1));
    refresh(p);

    try {
      const res = await data.like(id);
      if (res.liked) likedSet.add(id); else likedSet.delete(id);
      p.likes_count = res.likes;
    } catch (err) {
      if (was) likedSet.add(id); else likedSet.delete(id);
      p.likes_count = Math.max(0, p.likes_count + (was ? 1 : -1));
      toast(err.message);
    } finally {
      pending.delete(id);
      saveLiked();
      refresh(p);
    }
  }

  /* ---------------------------------------------------------- lightbox */

  const dlg = $('#lightbox');
  const lbImg = $('#lb-img');
  const form = $('#lb-form');
  const fName = form.elements.namedItem('name');
  const fBody = form.elements.namedItem('body');
  const fHoney = form.elements.namedItem('website');
  const statusEl = $('#lb-status');

  function setStatus(message, isError) {
    statusEl.textContent = message || '';
    statusEl.classList.toggle('err', Boolean(isError));
  }

  function refreshLightboxMeta(p) {
    const liked = likedSet.has(p.id);
    const likeBtn = $('#lb-like');
    likeBtn.setAttribute('aria-pressed', liked ? 'true' : 'false');
    likeBtn.setAttribute('aria-label', (liked ? 'Unlike this photo' : 'Like this photo') + ', ' + p.likes_count + ' likes');
    $('#lb-like-count').textContent = String(p.likes_count);
    $('#lb-like-label').textContent = p.likes_count === 1 ? 'like' : 'likes';
    $('#lb-comment-count').textContent = '(' + p.comments_count + ')';
  }

  function renderComments(list) {
    const ul = $('#lb-comments');
    ul.replaceChildren();
    if (!list.length) {
      ul.append(h('li', { class: 'comment-empty', text: 'no comments yet. say something kind.' }));
      return;
    }
    for (const c of list) {
      const when = new Date(c.created_at);
      const date = isNaN(when) ? '' : when.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
      ul.append(h('li', {},
        h('div', {}, h('span', { class: 'comment-name', text: c.name }), h('span', { class: 'comment-date', text: date })),
        h('p', { class: 'comment-body', text: c.body })));
    }
  }

  async function loadComments(p) {
    const token = ++commentsToken;
    const ul = $('#lb-comments');
    if (commentCache.has(p.id)) {
      renderComments(commentCache.get(p.id));
    } else {
      ul.replaceChildren(h('li', { class: 'comment-empty', text: 'loading…' }));
    }
    try {
      const rows = await data.comments(p.id);
      commentCache.set(p.id, rows);
      if (rows.length < 100) p.comments_count = rows.length;
      if (token !== commentsToken) return;
      renderComments(rows);
      refresh(p);
    } catch (err) {
      if (token !== commentsToken) return;
      ul.replaceChildren(
        h('li', { class: 'comment-empty', text: 'could not load comments.' }),
        h('li', {}, h('button', { class: 'btn ghost', type: 'button', text: 'Try again', onclick: () => loadComments(p) }))
      );
    }
  }

  function showPhoto(i) {
    index = (i + order.length) % order.length;
    const p = order[index];
    lbImg.src = p.image_url;
    lbImg.alt = p.title || 'Photograph';
    $('#lb-count').textContent = String(index + 1).padStart(2, '0') + ' / ' + String(order.length).padStart(2, '0');
    $('#lb-title').textContent = (p.title || 'untitled').toLowerCase();
    $('#lb-caption').textContent = p.caption || '';
    refreshLightboxMeta(p);
    setStatus('');
    fBody.value = '';
    $('#lb-chars').textContent = '0 / 500';
    loadComments(p);
    try { history.replaceState(null, '', '#photo-' + p.id); } catch (e) { /* ignore */ }

    const next = order[(index + 1) % order.length];
    if (next && next.image_url && !next.image_url.startsWith('data:')) new Image().src = next.image_url;
  }

  function openPhoto(id, focusForm) {
    const i = order.findIndex((p) => p.id === id);
    if (i < 0) return;
    showPhoto(i);
    if (!dlg.open) dlg.showModal();
    fName.value = store.get('sl_name', '');
    if (focusForm) (fName.value ? fBody : fName).focus();
  }

  function openFromHash() {
    const match = /^#photo-(.+)$/.exec(location.hash);
    if (match && byId.has(match[1]) && !dlg.open) openPhoto(match[1]);
  }

  $('#lb-close').addEventListener('click', () => dlg.close());
  $('#lb-prev').addEventListener('click', () => showPhoto(index - 1));
  $('#lb-next').addEventListener('click', () => showPhoto(index + 1));
  $('#lb-like').addEventListener('click', () => { if (order[index]) toggleLike(order[index].id); });
  dlg.addEventListener('close', () => {
    commentsToken++;
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }
  });
  dlg.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea')) return;
    if (e.key === 'ArrowLeft') showPhoto(index - 1);
    if (e.key === 'ArrowRight') showPhoto(index + 1);
  });
  fBody.addEventListener('input', () => { $('#lb-chars').textContent = fBody.value.length + ' / 500'; });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const p = order[index];
    if (!p) return;
    const name = fName.value.trim();
    const body = fBody.value.trim();
    if (!name) { setStatus('Please add your name.', true); fName.focus(); return; }
    if (!body) { setStatus('Please write a comment.', true); fBody.focus(); return; }

    const submit = $('#lb-submit');
    submit.disabled = true;
    setStatus('Posting…');
    const wakeTimer = setTimeout(() => setStatus('The server is waking up. The first comment can take up to a minute.'), 4000);

    try {
      const entry = await data.comment(p.id, { name, body, website: fHoney.value });
      store.set('sl_name', name);
      if (entry) {
        const list = [entry].concat(commentCache.get(p.id) || []);
        commentCache.set(p.id, list);
        p.comments_count += 1;
        if (order[index] && order[index].id === p.id) renderComments(list);
        refresh(p);
      }
      fBody.value = '';
      $('#lb-chars').textContent = '0 / 500';
      setStatus('Thank you. Your comment is up.');
    } catch (err) {
      setStatus(err.message, true);
    } finally {
      clearTimeout(wakeTimer);
      submit.disabled = false;
    }
  });

  /* -------------------------------------------------------------- start */

  async function load() {
    try {
      build(await data.photos());
    } catch (err) {
      showError(err);
    }
  }

  /* ------------------------------------------------------ contact sheet */

  const CICON = {
    mail: '<path d="M3 6h18v12H3z M3 7l9 7 9-7"/>',
    phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
    instagram: '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r="0.6"/>',
    facebook: '<path d="M14 8h3V4h-3a4 4 0 0 0-4 4v3H7v4h3v6h4v-6h3l1-4h-4V8z"/>',
    x: '<path d="M4 4l16 16M20 4L4 20"/>',
    pin: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>'
  };

  function contactItems() {
    const items = [];
    const handle = (v) => String(v).trim().replace(/^@/, '');
    const isUrl = (v) => /^https?:\/\//i.test(String(v).trim());
    const bare = (v) => String(v).trim().replace(/^https?:\/\/(www\.)?/i, '');
    const email = CFG.contactEmail || (LIVE ? '' : 'you@example.com');
    if (email) items.push({ icon: 'mail', label: 'Email', value: email, href: 'mailto:' + email });
    if (CFG.phone) items.push({ icon: 'phone', label: 'Phone', value: CFG.phone, href: 'tel:' + String(CFG.phone).replace(/[^\d+]/g, '') });
    const ig = CFG.instagram || (LIVE ? '' : '@yourhandle');
    if (ig) items.push({ icon: 'instagram', label: 'Instagram', value: isUrl(ig) ? bare(ig) : '@' + handle(ig), href: isUrl(ig) ? ig : 'https://instagram.com/' + handle(ig) });
    if (CFG.facebook) items.push({ icon: 'facebook', label: 'Facebook', value: isUrl(CFG.facebook) ? bare(CFG.facebook) : handle(CFG.facebook), href: isUrl(CFG.facebook) ? CFG.facebook : 'https://facebook.com/' + handle(CFG.facebook) });
    if (CFG.twitter) items.push({ icon: 'x', label: 'X', value: isUrl(CFG.twitter) ? bare(CFG.twitter) : '@' + handle(CFG.twitter), href: isUrl(CFG.twitter) ? CFG.twitter : 'https://x.com/' + handle(CFG.twitter) });
    const where = CFG.location || (LIVE ? '' : 'Your city, Country');
    if (where) items.push({ icon: 'pin', label: 'Based in', value: where, href: '' });
    return items;
  }

  function renderContacts() {
    const list = $('#contacts');
    if (!list) return;
    list.replaceChildren();
    contactItems().forEach((it, i) => {
      const ico = h('span', { class: 'c-ico' });
      ico.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">' + CICON[it.icon] + '</svg>';
      const parts = [ico, h('span', { class: 'c-text' }, h('span', { class: 'c-label', text: it.label }), h('span', { class: 'c-val', text: it.value }))];
      let inner;
      if (it.href) {
        parts.push(h('span', { class: 'c-go', text: '→' }));
        inner = h('a', { class: 'contact-link', href: it.href }, ...parts);
        if (it.href.startsWith('http')) { inner.target = '_blank'; inner.rel = 'noopener'; }
      } else {
        inner = h('div', { class: 'contact-link static' }, ...parts);
      }
      const li = h('li', { class: 'contact-item' }, inner);
      li.style.setProperty('--i', String(i));
      list.append(li);
    });
    refreshMotion();
  }

  /* Keep the like and comment counts honest if the page stays open for a while. */
  let lastSync = Date.now();
  async function syncCounts() {
    if (!LIVE) return;
    try {
      const rows = await data.photos();
      rows.forEach((r) => {
        const p = byId.get(r.id);
        if (!p || pending.has(r.id)) return;
        p.likes_count = r.likes_count;
        p.comments_count = r.comments_count;
        refresh(p);
      });
      lastSync = Date.now();
    } catch (err) { /* quiet: counts just stay as they were */ }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastSync > 60000) syncCounts();
  });

  function init() {
    $$('[data-icon]').forEach((n) => { n.innerHTML = ICON[n.dataset.icon]; });

    renderContacts();
    if (CFG.ownerName) $('#owner').textContent = CFG.ownerName;
    if (!LIVE) {
      $('#demo-note').hidden = false;
      console.info('Slow Light is in demo mode. Add your Supabase keys in config.js to go live.');
    }

    // Wake the (free, sleepy) API in the background so likes and comments feel quick.
    if (LIVE && API) fetch(API + '/api/ping').catch(() => {});

    window.addEventListener('hashchange', openFromHash);
    load();
  }

  init();
})();