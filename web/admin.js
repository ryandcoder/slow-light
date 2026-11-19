/* Slow Light admin: upload photos, edit titles and chapters, delete photos, moderate comments.
   Everything that changes data goes through the PHP API with the ADMIN_TOKEN. */
(() => {
  'use strict';

  const CFG = Object.assign({ supabaseUrl: '', supabaseAnonKey: '', apiUrl: '', bucket: 'photos' }, window.SLOW_LIGHT || {});
  const SB = CFG.supabaseUrl.replace(/\/+$/, '');
  const API = CFG.apiUrl.replace(/\/+$/, '');
  const READY = Boolean(SB && CFG.supabaseAnonKey && API);

  const $ = (sel, root = document) => root.querySelector(sel);

  function h(tag, props = {}, ...kids) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : value);
    }
    for (const kid of kids.flat()) {
      if (kid === null || kid === undefined) continue;
      node.append(kid.nodeType ? kid : document.createTextNode(kid));
    }
    return node;
  }

  let toastTimer = 0;
  function toast(message) {
    const node = $('#toast');
    node.textContent = message;
    node.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove('show'), 4200);
  }

  // The token lives only for this browser tab.
  let token = '';
  try { token = sessionStorage.getItem('sl_admin') || ''; } catch (e) { /* ignore */ }
  const keepToken = (value) => { try { sessionStorage.setItem('sl_admin', value); } catch (e) { /* ignore */ } };

  function sbHeaders() {
    const headers = { apikey: CFG.supabaseAnonKey };
    if (CFG.supabaseAnonKey.startsWith('eyJ')) headers.Authorization = 'Bearer ' + CFG.supabaseAnonKey;
    return headers;
  }

  async function api(path, options = {}) {
    const headers = Object.assign({ Authorization: 'Bearer ' + token }, options.headers || {});
    let res;
    try {
      res = await fetch(API + path, Object.assign({}, options, { headers }));
    } catch (e) {
      throw new Error('Could not reach the API. It may be waking up, so try again in a moment.');
    }
    let body = null;
    try { body = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) throw new Error((body && body.error) || 'Request failed (' + res.status + ').');
    return body;
  }

  async function sbGet(query) {
    const res = await fetch(SB + '/rest/v1/' + query, { headers: sbHeaders() });
    if (!res.ok) throw new Error('Could not read from Supabase (' + res.status + ').');
    return res.json();
  }

  const fileUrl = (path) => SB + '/storage/v1/object/public/' + CFG.bucket + '/' + path.split('/').map(encodeURIComponent).join('/');

  /* ------------------------------------------------------------ sign in */

  async function unlock(value) {
    token = value;
    await api('/api/admin/check');
    keepToken(value);
    $('#login').hidden = true;
    $('#tools').hidden = false;
    loadAll();
  }

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = $('#login-status');
    status.textContent = 'Checking…';
    status.classList.remove('err');
    try {
      await unlock($('#token').value.trim());
      status.textContent = '';
    } catch (err) {
      status.textContent = err.message;
      status.classList.add('err');
    }
  });

  /* ------------------------------------------------------------- upload */

  const niceName = (filename) => filename.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim().slice(0, 120);

  $('#upload-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const files = Array.from($('#files').files);
    if (!files.length) return;

    const button = $('#upload-btn');
    const queue = $('#queue');
    button.disabled = true;
    queue.replaceChildren();

    const rows = files.map((file) => {
      const status = h('span', { text: 'waiting' });
      queue.append(h('li', {}, h('span', { text: file.name }), status));
      return status;
    });

    let done = 0;
    for (let i = 0; i < files.length; i++) {
      rows[i].textContent = 'uploading…';
      const body = new FormData();
      body.append('file', files[i]);
      body.append('chapter', $('#chapter').value);
      body.append('title', files.length === 1 ? $('#title').value : niceName(files[i].name));
      if (files.length === 1) body.append('caption', $('#caption').value);
      try {
        await api('/api/admin/photos', { method: 'POST', body });
        rows[i].textContent = 'done';
        done++;
      } catch (err) {
        rows[i].textContent = err.message;
      }
    }

    button.disabled = false;
    toast(done + ' of ' + files.length + ' uploaded.');
    if (done) {
      $('#upload-form').reset();
      loadPhotos();
    }
  });

  /* ------------------------------------------------------------- photos */

  async function loadPhotos() {
    const list = $('#photo-list');
    try {
      const photos = await sbGet('photos?select=*&order=position.asc,created_at.asc');
      $('#photos-note').textContent = photos.length
        ? photos.length + ' photos. Lower "order" numbers come first within a chapter.'
        : 'No photos yet. Add some above.';
      list.replaceChildren(...photos.map(photoRow));
    } catch (err) {
      list.replaceChildren(h('p', { class: 'small', text: err.message }));
    }
  }

  function photoRow(p) {
    const title = h('input', { type: 'text', value: p.title, maxlength: '120', id: 't-' + p.id });
    const chapter = h('select', { id: 'c-' + p.id },
      ...[['cover', 'Cover'], ['strip', 'Film strip'], ['sheet', 'All-time favourites']].map(([c, label]) => h('option', { value: c, text: label, selected: c === p.chapter })));
    const position = h('input', { type: 'number', value: String(p.position), id: 'o-' + p.id });

    const save = h('button', {
      class: 'btn ghost', type: 'button', text: 'Save',
      onclick: async () => {
        save.disabled = true;
        try {
          await api('/api/admin/photos/' + p.id, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: title.value, chapter: chapter.value, position: Number(position.value) || 0 })
          });
          toast('Saved.');
        } catch (err) { toast(err.message); }
        save.disabled = false;
      }
    });
    const del = h('button', {
      class: 'btn ghost', type: 'button', text: 'Delete',
      onclick: async () => {
        if (!confirm('Delete this photo, its comments and its likes? This cannot be undone.')) return;
        del.disabled = true;
        try {
          await api('/api/admin/photos/' + p.id, { method: 'DELETE' });
          toast('Deleted.');
          loadPhotos();
          loadComments();
        } catch (err) { toast(err.message); del.disabled = false; }
      }
    });

    return h('div', { class: 'admin-item' },
      h('img', { class: 'admin-thumb', src: fileUrl(p.thumb_path), alt: '', loading: 'lazy' }),
      h('div', { class: 'admin-fields' },
        h('label', { for: 't-' + p.id }, 'Title', title),
        h('label', { for: 'c-' + p.id }, 'Chapter', chapter),
        h('label', { for: 'o-' + p.id }, 'Order', position)),
      h('span', { class: 'small dim', text: p.likes_count + ' likes · ' + p.comments_count + ' comments' }),
      save, del);
  }

  /* ----------------------------------------------------------- comments */

  async function loadComments() {
    const list = $('#comment-list');
    try {
      const rows = await sbGet('comments?select=id,name,body,created_at,photos(title)&order=created_at.desc&limit=50');
      if (!rows.length) { list.replaceChildren(h('p', { class: 'small dim', text: 'No comments yet.' })); return; }
      list.replaceChildren(...rows.map((c) => {
        const del = h('button', {
          class: 'btn ghost', type: 'button', text: 'Delete',
          onclick: async () => {
            if (!confirm('Delete this comment?')) return;
            del.disabled = true;
            try { await api('/api/admin/comments/' + c.id, { method: 'DELETE' }); loadComments(); loadPhotos(); }
            catch (err) { toast(err.message); del.disabled = false; }
          }
        });
        const photoTitle = c.photos && c.photos.title ? c.photos.title : 'untitled';
        return h('div', { class: 'admin-comment' },
          h('div', {},
            h('p', { class: 'small dim', text: c.name + ' on "' + photoTitle + '" · ' + new Date(c.created_at).toLocaleString() }),
            h('p', { text: c.body })),
          del);
      }));
    } catch (err) {
      list.replaceChildren(h('p', { class: 'small', text: err.message }));
    }
  }

  function loadAll() { loadPhotos(); loadComments(); }

  /* -------------------------------------------------------------- start */

  if (!READY) {
    $('#mode').textContent = 'Admin needs supabaseUrl, supabaseAnonKey and apiUrl filled in inside config.js.';
    $('#login').hidden = true;
  } else if (token) {
    unlock(token).catch(() => { token = ''; keepToken(''); });
  }
})();