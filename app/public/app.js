'use strict';
(() => {
  // ---------- pomocné ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const pad = (n) => String(n).padStart(2, '0');
  const fmtDate = (iso) => (iso ? `${iso.slice(8, 10)}. ${iso.slice(5, 7)}. ${iso.slice(0, 4)}` : '');
  const desktop = window.desktop || null; // most k Electronu (v prohlížeči není)
  const prefs = {};
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* bez uložení */ } },
  };

  function fmtWhen(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const diff = Date.now() - d.getTime();
    const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    if (diff < 60_000) return 'právě teď';
    if (diff < 3_600_000) return `před ${Math.floor(diff / 60_000)} min`;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (d >= today) return `dnes ${hm}`;
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    if (d >= yesterday) return `včera ${hm}`;
    return `${pad(d.getDate())}. ${pad(d.getMonth() + 1)}. ${d.getFullYear()} ${hm}`;
  }

  const initials = (name) => {
    const words = String(name ?? '').trim().split(/\s+/).filter((w) => /^\p{L}/u.test(w));
    if (!words.length) return '?';
    const first = [...words[0]][0];
    const second = words[1] && /^\p{Lu}/u.test(words[1]) ? [...words[1]][0] : '';
    return (first + second).toUpperCase();
  };
  const avatar = (name, cls = '') => {
    let h = 0;
    for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) % 360;
    return `<b class="avatar ${cls}" style="background:hsl(${h} 42% 38%)" aria-hidden="true">${esc(initials(name))}</b>`;
  };

  const ICONS = {
    assignment: 'M19 3h-4.18C14.4 1.84 13.3 1 12 1s-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm2 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z',
    search: 'M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
    add: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
    export: 'M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z',
    down: 'M7 10l5 5 5-5z',
    up: 'M7 14l5-5 5 5z',
    edit: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
    delete: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
    close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
    note: 'M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z',
    receipt: 'M18 17H6v-2h12v2zm0-4H6v-2h12v2zm0-4H6V7h12v2zM3 22l1.5-1.5L6 22l1.5-1.5L9 22l1.5-1.5L12 22l1.5-1.5L15 22l1.5-1.5L18 22l1.5-1.5L21 22V2l-1.5 1.5L18 2l-1.5 1.5L15 2l-1.5 1.5L12 2l-1.5 1.5L9 2 7.5 3.5 6 2 4.5 3.5 3 2v20z',
    warning: 'M11 15h2v2h-2zm0-8h2v6h-2zm.99-5C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z',
    auto: 'M20 8.69V4h-4.69L12 .69 8.69 4H4v4.69L.69 12 4 15.31V20h4.69L12 23.31 15.31 20H20v-4.69L23.31 12 20 8.69zM12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6 6 2.69 6 6-2.69 6-6 6zm0-10v8c2.21 0 4-1.79 4-4s-1.79-4-4-4z',
    refresh: 'M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z',
    download: 'M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z',
    sun: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM11 1h2v3h-2zM11 20h2v3h-2zM3.5 4.9l1.4-1.4 2.1 2.1-1.4 1.4zM17 18.4l1.4-1.4 2.1 2.1-1.4 1.4zM1 11h3v2H1zM20 11h3v2h-3zM3.5 19.1l2.1-2.1 1.4 1.4-2.1 2.1zM17 5.6l2.1-2.1 1.4 1.4-2.1 2.1z',
    moon: 'M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.39 5.39 0 0 1-4.4 2.26 5.4 5.4 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1z',
    hide: 'M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z',
    nodate: 'M9.31 17l2.44-2.44L14.19 17l1.06-1.06-2.44-2.44 2.44-2.44L14.19 10l-2.44 2.44L9.31 10l-1.06 1.06 2.44 2.44-2.44 2.44L9.31 17zM19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11z',
  };
  const icon = (name, cls = 'ic') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[name]}"/></svg>`;
  const paintIcons = (root = document) => $$('svg[data-i]', root).forEach((svg) => {
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = `<path d="${ICONS[svg.dataset.i]}"/>`;
  });

  // ---------- stav ----------
  const state = {
    orders: [], rev: null, user: null, askName: false,
    query: '', tab: 'active', hiddenYears: [], view: 'all',
    sort: { key: 'number', dir: 1 }, page: 1, pageSize: 15,
    flashId: null, suggest: '',
    openId: null, editingNoteId: null,
  };
  const drafts = new Map(); // rozepsané poznámky podle zakázky

  // ---------- komunikace se serverem ----------
  async function api(method, url, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (state.askName && state.user) headers['X-User'] = encodeURIComponent(state.user);
    let res;
    try {
      res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      setStatus(false);
      throw Object.assign(new Error('Server neodpovídá. Zkontrolujte spojení.'), { code: 'offline' });
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) throw Object.assign(new Error(data?.error || 'Chyba serveru.'), { status: res.status, code: data?.code });
    return data;
  }

  function setStatus(ok) {
    const el = $('#status');
    el.classList.toggle('ok', ok);
    el.classList.toggle('err', !ok);
    $('span', el).textContent = ok ? 'Připojeno' : 'Bez spojení';
    el.title = ok && el.dataset.db ? `Připojeno k databázi:\n${el.dataset.db}` : 'Stav spojení s databází';
  }

  async function load() {
    const data = await api('GET', '/api/orders');
    state.orders = data.orders;
    state.hiddenYears = data.hiddenYears || [];
    state.rev = data.rev;
    setStatus(true);
    fixTab();
    fillDatalists();
    render();
    syncDrawer();
  }

  async function poll() {
    try {
      const { rev } = await api('GET', '/api/rev');
      setStatus(true);
      if (rev !== state.rev) await load();
    } catch { /* stav už zobrazen */ }
  }

  // ---------- filtrování, řazení ----------
  const latestDate = (o) => o.invoices.reduce((m, i) => (i.date && i.date > m ? i.date : m), '');
  const orderKey = (o) => o.year * 1e6 + o.seq;
  const matchesView = (o, view) =>
    view === 'all' || (view === 'with' && o.invoices.length) || (view === 'without' && !o.invoices.length);

  const isHiddenYear = (y) => state.hiddenYears.includes(y);
  const currentYear = () => new Date().getFullYear();
  const hayOf = (o) => norm([o.number, o.customer, o.location, ...o.invoices.flatMap((i) => [i.number, fmtDate(i.date)]), ...o.notes.map((n) => n.text)].join(' | '));
  const matchesQuery = (o, q) => { const hay = hayOf(o); return q.split(/\s+/).every((part) => hay.includes(part)); };

  /** Zakázky podle vybrané záložky: všechny aktivní roky / jeden rok / skryté roky. */
  function tabOrders() {
    const t = state.tab;
    if (t === 'hidden') return state.orders.filter((o) => isHiddenYear(o.year));
    const active = state.orders.filter((o) => !isHiddenYear(o.year));
    return /^\d+$/.test(t) ? active.filter((o) => String(o.year) === t) : active;
  }
  function fixTab() {
    const t = state.tab;
    if (t === 'hidden' && !state.hiddenYears.length) state.tab = 'active';
    else if (/^\d+$/.test(t) && isHiddenYear(Number(t))) state.tab = 'active'; // rok mezitím schoval kolega
  }

  function visibleOrders() {
    const q = norm(state.query).trim();
    let list = tabOrders().filter((o) => {
      if (!matchesView(o, state.view)) return false;
      return !q || matchesQuery(o, q);
    });
    const { key, dir } = state.sort;
    const cmp = {
      number: (a, b) => orderKey(a) - orderKey(b),
      customer: (a, b) => a.customer.localeCompare(b.customer, 'cs'),
      location: (a, b) => a.location.localeCompare(b.location, 'cs'),
      date: (a, b) => latestDate(a).localeCompare(latestDate(b)),
    }[key];
    list = list.slice().sort((a, b) => dir * (cmp(a, b) || orderKey(a) - orderKey(b)));
    return list;
  }

  // ---------- vykreslení seznamu ----------
  function renderKpis() {
    const all = state.orders.filter((o) => !isHiddenYear(o.year)); // přehled jen z aktivních roků
    const without = all.filter((o) => !o.invoices.length).length;
    const thisYear = all.filter((o) => o.year === new Date().getFullYear()).length;
    const card = (iconName, value, label, { view, warn } = {}) => {
      const inner = `<span class="kpi-icon ${warn && value ? 'warn' : ''}">${icon(iconName)}</span><span><div class="kpi-value">${value}</div><div class="kpi-label">${label}</div></span>`;
      return view
        ? `<button class="kpi" data-view="${view}" title="Zobrazit tyto zakázky">${inner}</button>`
        : `<div class="kpi">${inner}</div>`;
    };
    $('#kpis').innerHTML =
      card('assignment', all.length, `Zakázek celkem · letos ${thisYear}`) +
      card('warning', without, 'Zakázek bez faktury', { view: 'without', warn: true });
  }

  function renderSegments() {
    const defs = [['all', 'Vše'], ['with', 'S fakturou'], ['without', 'Bez faktury']];
    $('#seg').innerHTML = defs.map(([v, label]) => {
      const n = tabOrders().filter((o) => matchesView(o, v)).length;
      return `<button class="seg" role="tab" data-view="${v}" aria-selected="${state.view === v}">${label}<span class="n">${n}</span></button>`;
    }).join('');
  }

  function rowHtml(o) {
    const plus = `<button class="add-inv" data-action="add-invoice" data-order="${o.id}" title="Přidat fakturu" aria-label="Přidat fakturu k zakázce ${esc(o.number)}">${icon('add')}</button>`;
    const none = '<span class="muted">—</span>';
    const invoices = o.invoices.length
      ? o.invoices.map((i, idx) => `<div class="line"><button class="chip" data-action="edit-invoice" data-order="${o.id}" data-id="${i.id}" title="Upravit fakturu">${esc(i.number)}</button>${idx === o.invoices.length - 1 ? plus : ''}</div>`).join('')
      : `<div class="line">${none}${plus}</div>`;
    const dates = o.invoices.length
      ? o.invoices.map((i) => `<div class="line">${i.date ? fmtDate(i.date) : none}</div>`).join('')
      : `<div class="line">${none}</div>`;
    const notes = o.notes.length ? `<span class="notes-badge" title="Poznámky: ${o.notes.length}">${icon('note')}${o.notes.length}</span>` : '';
    const cls = [state.flashId === o.id ? 'flash' : '', state.openId === o.id ? 'selected' : ''].filter(Boolean).join(' ');
    return `<tr data-id="${o.id}" tabindex="0" ${cls ? `class="${cls}"` : ''}>
      <td class="num"><div class="line">${esc(o.number)}</div></td>
      <td class="cust"><div class="line">${avatar(o.customer, 'sm')}<span class="name" title="${esc(o.customer)}">${esc(o.customer)}</span></div></td>
      <td class="loc"><div class="line" title="${esc(o.location)}">${esc(o.location)}</div></td>
      <td>${invoices}</td>
      <td>${dates}</td>
      <td class="notes-cell"><div class="line" style="justify-content:center">${notes}</div></td>
      <td class="row-actions"><div class="line">
        <button class="icon-btn" data-action="edit-order" data-order="${o.id}" title="Upravit zakázku" aria-label="Upravit zakázku ${esc(o.number)}">${icon('edit')}</button>
        <button class="icon-btn danger" data-action="delete-order" data-order="${o.id}" title="Smazat zakázku" aria-label="Smazat zakázku ${esc(o.number)}">${icon('delete')}</button>
      </div></td>
    </tr>`;
  }

  function pageButtons(pages) {
    const set = new Set([1, pages, state.page - 1, state.page, state.page + 1].filter((p) => p >= 1 && p <= pages));
    const nums = [...set].sort((a, b) => a - b);
    const out = [`<button data-page="${state.page - 1}" ${state.page <= 1 ? 'disabled' : ''}>Předchozí</button>`];
    nums.forEach((p, idx) => {
      if (idx && p - nums[idx - 1] > 1) out.push('<button disabled>…</button>');
      out.push(`<button data-page="${p}" class="${p === state.page ? 'current' : ''}" ${p === state.page ? 'aria-current="page"' : ''}>${p}</button>`);
    });
    out.push(`<button data-page="${state.page + 1}" ${state.page >= pages ? 'disabled' : ''}>Další</button>`);
    return out.join('');
  }

  function render() {
    renderKpis();
    renderTabs();
    renderHiddenBanner();
    renderSegments();
    const list = visibleOrders();
    const pages = Math.max(1, Math.ceil(list.length / state.pageSize));
    state.page = Math.min(Math.max(1, state.page), pages);
    const start = (state.page - 1) * state.pageSize;
    const slice = list.slice(start, start + state.pageSize);

    $('#rows').innerHTML = slice.map(rowHtml).join('');
    const empty = $('#empty');
    empty.hidden = slice.length > 0;
    if (!slice.length) {
      emptyMessage(empty);
    }
    $('#summary').textContent = list.length
      ? `Zobrazeno ${start + 1}–${start + slice.length} z ${list.length} zakázek`
      : 'Žádné zakázky';
    $('#pages').innerHTML = pageButtons(pages);

    $$('th.sortable').forEach((th) => {
      const active = th.dataset.sort === state.sort.key;
      th.classList.toggle('sorted', active);
      if (active) $('svg', th).innerHTML = `<path d="${ICONS[state.sort.dir === 1 ? 'up' : 'down']}"/>`;
      th.setAttribute('aria-sort', active ? (state.sort.dir === 1 ? 'ascending' : 'descending') : 'none');
    });
    state.flashId = null;
  }

  function renderTabs() {
    const active = state.orders.filter((o) => !isHiddenYear(o.year));
    const years = new Set(active.map((o) => o.year));
    if (!isHiddenYear(currentYear())) years.add(currentYear()); // letošní rok je vidět i bez zakázek
    const tab = (id, label, n) => `<button class="tab" role="tab" data-tab="${id}" aria-selected="${state.tab === id}">${label}<span class="n">${n}</span></button>`;
    let html = tab('active', 'Všechny roky', active.length) +
      [...years].sort((a, b) => b - a).map((y) => tab(String(y), y, active.filter((o) => o.year === y).length)).join('');
    if (state.hiddenYears.length) {
      html += '<span class="tab-spacer"></span>' + tab('hidden', `${icon('hide')}Skryté roky`, state.orders.filter((o) => isHiddenYear(o.year)).length);
    }
    $('#tabs').innerHTML = html;
    const hideBtn = $('#btn-hide-year');
    const specific = /^\d+$/.test(state.tab);
    hideBtn.hidden = !specific;
    if (specific) $('span', hideBtn).textContent = `Schovat rok ${state.tab}`;
  }

  function renderHiddenBanner() {
    const el = $('#hidden-banner');
    el.hidden = state.tab !== 'hidden';
    if (el.hidden) return;
    const years = [...state.hiddenYears].sort((a, b) => b - a);
    el.innerHTML = `<div class="hb-text">${icon('hide')}<span>Tyto roky jsou schované – nejsou v seznamu ani v přehledech, ale nejsou smazané.</span></div>
      <div class="hb-years">${years.map((y) => `<span class="hb-year"><b>${y}</b><small>${state.orders.filter((o) => o.year === y).length} zakázek</small>
        <button class="btn ghost small" data-action="unhide-year" data-year="${y}">Zobrazit znovu</button></span>`).join('')}</div>`;
  }

  function emptyMessage(el) {
    if (!state.orders.length) { el.textContent = 'Zatím tu nejsou žádné zakázky. Založte první tlačítkem „Nová zakázka“.'; return; }
    const msg = 'Filtru ani hledání neodpovídá žádná zakázka.';
    el.textContent = msg;
    const q = norm(state.query).trim();
    if (q && state.tab !== 'hidden') {
      const n = state.orders.filter((o) => isHiddenYear(o.year) && matchesQuery(o, q)).length;
      if (n) el.innerHTML = `${esc(msg)}<br><button class="btn ghost small" data-action="search-hidden" style="margin-top:10px">Ve skrytých rocích je ${n} shod – zobrazit</button>`;
    }
  }

  async function setYearHidden(year, hide) {
    const n = state.orders.filter((o) => o.year === year).length;
    if (hide) {
      const ok = await confirmDialog(`Schovat rok ${year}?`,
        `Zakázky z roku ${year} (${n}) zmizí ze seznamu a z přehledů. Nic se nemaže – najdete je na záložce „Skryté roky“ a kdykoli je můžete znovu zobrazit. Skrytí se týká všech uživatelů.`, 'Schovat rok', false);
      if (!ok) return;
    }
    try {
      await api('POST', `/api/years/${year}/${hide ? 'hide' : 'unhide'}`);
      state.tab = hide ? 'active' : String(year);
      state.page = 1;
      await load();
      toast(hide ? `Rok ${year} je schovaný.` : `Rok ${year} je znovu zobrazený.`);
    } catch (e) { toast(e.message, true); }
  }
  function fillDatalists() {
    const uniq = (arr) => [...new Set(arr)].sort((a, b) => a.localeCompare(b, 'cs'));
    $('#dl-customers').innerHTML = uniq(state.orders.map((o) => o.customer)).map((v) => `<option value="${esc(v)}">`).join('');
    $('#dl-locations').innerHTML = uniq(state.orders.map((o) => o.location)).map((v) => `<option value="${esc(v)}">`).join('');
  }

  // ---------- zprávy a dialogy ----------
  let toastTimer;
  function toast(msg, isError = false) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.toggle('err', isError);
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, isError ? 6000 : 3000);
  }
  const showError = (el, msg) => { el.textContent = msg; el.hidden = false; };

  $$('dialog').forEach((d) => d.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) d.close('cancel');
  }));
  const dialogOpen = () => $$('dialog').some((d) => d.open);

  function confirmDialog(title, text, okLabel = 'Smazat', danger = true) {
    const dlg = $('#dlg-confirm');
    $('#c-title').textContent = title;
    $('#c-text').textContent = text;
    const ok = $('#c-ok');
    ok.textContent = okLabel;
    ok.className = 'btn ' + (danger ? 'danger' : 'primary');
    ok.value = 'ok';
    return new Promise((resolve) => {
      dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true });
      dlg.returnValue = '';
      dlg.showModal();
    });
  }

  // selhání uložení: konflikt/smazání = obnovit data
  async function handleSaveError(e, dlg, errEl) {
    if (e.code === 'conflict' || e.code === 'missing') {
      dlg.close('cancel');
      toast(e.message, true);
      await load().catch(() => {});
    } else {
      showError(errEl, e.message);
    }
  }

  // ---------- detail zakázky ----------
  const findOrder = (id) => state.orders.find((o) => o.id === Number(id));
  const canEditNote = (n) => n.author && n.author === state.user;

  function openDrawer(id) {
    const order = findOrder(id);
    if (!order) return;
    const switching = state.openId !== order.id;
    if (switching) saveDraft();
    state.openId = order.id;
    state.editingNoteId = null;
    $('#drawer').classList.add('open');
    $('#drawer').setAttribute('aria-hidden', 'false');
    $('#scrim').hidden = false;
    if (switching) {
      $('#d-note-input').value = drafts.get(order.id) ?? '';
      $('#d-note-add').disabled = !$('#d-note-input').value.trim();
      $('.drawer-body').scrollTop = 0;
    }
    renderDrawer();
    $$('#rows tr').forEach((tr) => tr.classList.toggle('selected', Number(tr.dataset.id) === order.id));
  }

  function closeDrawer() {
    saveDraft();
    state.openId = null;
    state.editingNoteId = null;
    $('#drawer').classList.remove('open');
    $('#drawer').setAttribute('aria-hidden', 'true');
    $('#scrim').hidden = true;
    $$('#rows tr.selected').forEach((tr) => tr.classList.remove('selected'));
  }

  function saveDraft() {
    if (state.openId == null) return;
    const v = $('#d-note-input').value;
    if (v.trim()) drafts.set(state.openId, v); else drafts.delete(state.openId);
  }

  /** Po načtení nových dat z databáze: obnovit otevřený detail, nebo ho zavřít, když zakázka zmizela. */
  function syncDrawer() {
    if (state.openId == null) return;
    if (!findOrder(state.openId)) {
      closeDrawer();
      toast('Zakázku mezitím smazal jiný uživatel.', true);
      return;
    }
    renderDrawer();
    $$('#rows tr').forEach((tr) => tr.classList.toggle('selected', Number(tr.dataset.id) === state.openId));
  }

  function renderDrawer() {
    const o = findOrder(state.openId);
    if (!o) return;
    $('#d-number').textContent = o.number;
    $('#d-customer').textContent = o.customer;
    $('#d-location').textContent = o.location;

    $('#d-inv-count').textContent = o.invoices.length || '';
    $('#d-invoices').innerHTML = o.invoices.length
      ? o.invoices.map((i) => `<li class="inv-item">
          <span class="chip">${esc(i.number)}</span>
          <span class="when ${i.date ? '' : 'none'}">${i.date ? 'zaevidována ' + fmtDate(i.date) : 'datum zaevidování nevyplněno'}</span>
          <button class="icon-btn" data-d-action="edit-invoice" data-id="${i.id}" title="Upravit fakturu" aria-label="Upravit fakturu ${esc(i.number)}">${icon('edit')}</button>
        </li>`).join('')
      : '<li class="list-empty">K zakázce zatím není žádná faktura.</li>';

    $('#d-note-count').textContent = o.notes.length || '';
    if (state.editingNoteId == null || !o.notes.some((n) => n.id === state.editingNoteId)) {
      state.editingNoteId = null;
      renderNotes(o);
    }

    const by = o.updatedBy ? ` · ${esc(o.updatedBy)}` : '';
    $('#d-foot').innerHTML = `Založeno ${esc(fmtWhen(o.createdAt))}${o.createdBy ? ' · ' + esc(o.createdBy) : ''}<br>Naposledy změněno ${esc(fmtWhen(o.updatedAt))}${by}`;
  }

  function renderNotes(o) {
    $('#d-notes').innerHTML = o.notes.length
      ? o.notes.map((n) => {
        const mine = canEditNote(n);
        const tools = mine
          ? `<span class="note-tools">
              <button class="icon-btn" data-d-action="edit-note" data-id="${n.id}" title="Upravit poznámku" aria-label="Upravit poznámku">${icon('edit')}</button>
              <button class="icon-btn danger" data-d-action="delete-note" data-id="${n.id}" title="Smazat poznámku" aria-label="Smazat poznámku">${icon('delete')}</button>
            </span>` : '';
        const edited = n.updatedAt ? ' · upraveno' : '';
        return `<li class="note" data-note="${n.id}">
          ${avatar(n.author || '?')}
          <div class="note-main">
            <div class="note-meta"><b>${esc(n.author || 'neznámý')}</b><span title="${esc(n.createdAt)}">${esc(fmtWhen(n.createdAt))}${edited}</span>${tools}</div>
            <div class="note-text">${esc(n.text)}</div>
          </div>
        </li>`;
      }).join('')
      : '<li class="list-empty">Zatím žádné poznámky.</li>';
  }

  function startEditNote(id) {
    const o = findOrder(state.openId);
    const n = o?.notes.find((x) => x.id === id);
    if (!n) return;
    state.editingNoteId = id;
    const li = $(`.note[data-note="${id}"] .note-main`);
    li.innerHTML = `<div class="note-edit"><textarea maxlength="5000" aria-label="Upravit poznámku">${esc(n.text)}</textarea>
      <div class="row"><button class="btn ghost small" data-d-action="cancel-note">Zrušit</button><button class="btn primary small" data-d-action="save-note" data-id="${id}">Uložit</button></div></div>`;
    const ta = $('textarea', li);
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveNote(id); }
      else if (e.key === 'Escape') { e.stopPropagation(); cancelEditNote(); }
    });
  }
  function cancelEditNote() {
    state.editingNoteId = null;
    renderNotes(findOrder(state.openId));
  }

  async function saveNote(id) {
    const ta = $(`.note[data-note="${id}"] textarea`);
    const text = ta?.value.trim();
    if (!text) return toast('Poznámka nemůže být prázdná.', true);
    try {
      await api('PUT', `/api/notes/${id}`, { text });
      state.editingNoteId = null;
      await load();
      toast('Poznámka uložena.');
    } catch (e) {
      toast(e.message, true);
      if (e.code === 'forbidden' || e.code === 'missing') { state.editingNoteId = null; await load().catch(() => {}); }
    }
  }

  async function removeNote(id) {
    if (!(await confirmDialog('Smazat poznámku?', 'Poznámku nelze obnovit.'))) return;
    try {
      await api('DELETE', `/api/notes/${id}`);
      await load();
      toast('Poznámka smazána.');
    } catch (e) { toast(e.message, true); }
  }

  const noteInput = $('#d-note-input');
  noteInput.addEventListener('input', () => { $('#d-note-add').disabled = !noteInput.value.trim(); });
  noteInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); addNote(); }
  });
  $('#d-note-add').addEventListener('click', addNote);

  async function addNote() {
    const text = noteInput.value.trim();
    if (!text || state.openId == null) return;
    const btn = $('#d-note-add');
    btn.disabled = true;
    try {
      await api('POST', `/api/orders/${state.openId}/notes`, { text });
      drafts.delete(state.openId);
      noteInput.value = '';
      await load();
      toast('Poznámka přidána.');
    } catch (e) {
      toast(e.message, true);
      btn.disabled = !noteInput.value.trim();
      if (e.code === 'missing') await load().catch(() => {});
    }
  }

  $('#drawer').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-d-action]');
    if (!btn) return;
    const o = findOrder(state.openId);
    const id = Number(btn.dataset.id);
    switch (btn.dataset.dAction) {
      case 'edit-invoice': if (o) openInvoice(o, o.invoices.find((i) => i.id === id)); break;
      case 'edit-note': startEditNote(id); break;
      case 'delete-note': removeNote(id); break;
      case 'save-note': saveNote(id); break;
      case 'cancel-note': cancelEditNote(); break;
    }
  });
  $('#d-close').addEventListener('click', closeDrawer);
  $('#scrim').addEventListener('click', closeDrawer);
  $('#d-edit').addEventListener('click', () => { const o = findOrder(state.openId); if (o) openOrder(o); });
  $('#d-delete').addEventListener('click', () => { const o = findOrder(state.openId); if (o) removeOrder(o); });
  $('#d-add-invoice').addEventListener('click', () => { const o = findOrder(state.openId); if (o) openInvoice(o, null); });

  // ---------- zakázka (dialog) ----------
  const ORDER_RE = /^(\d{1,4})\s*\/\s*(\d{4})$/;
  let editingOrder = null;

  async function openOrder(order) {
    editingOrder = order;
    const dlg = $('#dlg-order');
    $('#order-title').textContent = order ? `Upravit zakázku ${order.number}` : 'Nová zakázka';
    $('#o-customer').value = order ? order.customer : '';
    $('#o-location').value = order ? order.location : '';
    $('#o-error').hidden = true;
    $$('input', dlg).forEach((i) => i.classList.remove('invalid'));
    if (order) {
      $('#o-number').value = order.number;
      state.suggest = '';
    } else {
      $('#o-number').value = '';
      try {
        const { number } = await api('GET', `/api/next-number?year=${new Date().getFullYear()}`);
        $('#o-number').value = number;
        state.suggest = number;
      } catch { state.suggest = ''; }
    }
    dlg.showModal();
    $('#o-customer').focus();
  }

  $('#form-order').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#o-error');
    err.hidden = true;
    const numberEl = $('#o-number'), customerEl = $('#o-customer'), locationEl = $('#o-location');
    [numberEl, customerEl, locationEl].forEach((i) => i.classList.remove('invalid'));

    const m = ORDER_RE.exec(numberEl.value.trim());
    if (!m || Number(m[1]) < 1) { numberEl.classList.add('invalid'); return showError(err, 'Číslo zakázky musí mít formát xx/rrrr (např. 05/2026).'); }
    const number = `${pad(Number(m[1]))}/${m[2]}`;
    const customer = customerEl.value.trim(), location = locationEl.value.trim();
    if (!customer) { customerEl.classList.add('invalid'); return showError(err, 'Vyplňte odběratele.'); }
    if (!location) { locationEl.classList.add('invalid'); return showError(err, 'Vyplňte lokalitu.'); }

    try {
      let result;
      if (editingOrder) {
        result = await api('PUT', `/api/orders/${editingOrder.id}`, { number, customer, location, version: editingOrder.version });
        result.number = number;
      } else {
        result = await api('POST', '/api/orders', { number, customer, location, auto: number === state.suggest });
      }
      $('#dlg-order').close('ok');
      state.flashId = result.id;
      await load();
      toast(editingOrder ? `Zakázka ${result.number} uložena.` : `Zakázka ${result.number} založena.`);
      if (!editingOrder) openDrawer(result.id); // rovnou otevřít detail, ať jde psát poznámky
    } catch (ex) {
      await handleSaveError(ex, $('#dlg-order'), err);
    }
  });

  async function removeOrder(order) {
    const n = order.invoices.length, notes = order.notes.length;
    const extra = [n ? `faktury (${n})` : '', notes ? `poznámky (${notes})` : ''].filter(Boolean).join(' a ');
    const ok = await confirmDialog(`Smazat zakázku ${order.number}?`,
      `${order.customer}, ${order.location}.${extra ? ` Smažou se i její ${extra}.` : ''} Operaci nelze vrátit.`);
    if (!ok) return;
    try {
      await api('DELETE', `/api/orders/${order.id}`);
      if (state.openId === order.id) closeDrawer();
      await load();
      toast(`Zakázka ${order.number} smazána.`);
    } catch (ex) { toast(ex.message, true); }
  }

  // ---------- faktura (dialog) ----------
  let invCtx = null; // { order, invoice|null }

  function openInvoice(order, invoice) {
    invCtx = { order, invoice };
    const dlg = $('#dlg-invoice');
    $('#inv-title').textContent = invoice ? `Upravit fakturu ${invoice.number}` : 'Nová faktura';
    $('#inv-ctx').textContent = `Zakázka ${order.number} · ${order.customer}`;
    $('#i-seq').value = invoice ? String(invoice.seq) : '';
    $('#i-year').value = invoice ? String(invoice.year) : String(order.year);
    $('#i-date').value = invoice?.date || '';
    $('#i-delete').hidden = !invoice;
    $('#i-error').hidden = true;
    $$('input', dlg).forEach((i) => i.classList.remove('invalid'));
    dlg.showModal();
    $('#i-seq').focus();
  }

  ['#i-seq', '#i-year'].forEach((sel) => $(sel).addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, ''); }));

  $('#form-invoice').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#i-error');
    err.hidden = true;
    const seqEl = $('#i-seq'), yearEl = $('#i-year');
    [seqEl, yearEl].forEach((i) => i.classList.remove('invalid'));
    const seq = Number(seqEl.value), year = Number(yearEl.value);
    if (!seqEl.value || seq < 1) { seqEl.classList.add('invalid'); return showError(err, 'Zadejte pořadové číslo faktury (např. 12).'); }
    if (!/^\d{4}$/.test(yearEl.value)) { yearEl.classList.add('invalid'); return showError(err, 'Rok musí mít 4 číslice (rrrr).'); }
    const payload = { seq, year, date: $('#i-date').value || null };
    const label = `F${pad(seq)}/${year}`;
    try {
      const orderId = invCtx.order.id;
      if (invCtx.invoice) await api('PUT', `/api/invoices/${invCtx.invoice.id}`, { ...payload, version: invCtx.invoice.version });
      else await api('POST', `/api/orders/${orderId}/invoices`, payload);
      $('#dlg-invoice').close('ok');
      state.flashId = orderId;
      await load();
      toast(`Faktura ${label} uložena.`);
    } catch (ex) {
      await handleSaveError(ex, $('#dlg-invoice'), err);
    }
  });

  $('#i-delete').addEventListener('click', async () => {
    const { order, invoice } = invCtx;
    $('#dlg-invoice').close('cancel');
    if (!(await confirmDialog(`Smazat fakturu ${invoice.number}?`, `Faktura se odebere ze zakázky ${order.number}.`))) return;
    try {
      await api('DELETE', `/api/invoices/${invoice.id}`);
      state.flashId = order.id;
      await load();
      toast(`Faktura ${invoice.number} smazána.`);
    } catch (ex) { toast(ex.message, true); }
  });

  // ---------- události v tabulce a ovládání ----------
  $('#rows').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    const tr = e.target.closest('tr');
    const order = findOrder((btn || tr)?.dataset[btn ? 'order' : 'id']);
    if (!order) return;
    if (!btn) return openDrawer(order.id);
    switch (btn.dataset.action) {
      case 'edit-order': openOrder(order); break;
      case 'delete-order': removeOrder(order); break;
      case 'add-invoice': openInvoice(order, null); break;
      case 'edit-invoice': openInvoice(order, order.invoices.find((i) => i.id === Number(btn.dataset.id))); break;
    }
  });
  $('#rows').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.target.tagName !== 'TR') return;
    openDrawer(Number(e.target.dataset.id));
  });

  $('#btn-new').addEventListener('click', () => openOrder(null));

  let searchTimer;
  $('#search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.query = e.target.value; state.page = 1; render(); }, 120);
  });

  $('thead').addEventListener('click', (e) => {
    const th = e.target.closest('th.sortable');
    if (!th) return;
    state.sort = state.sort.key === th.dataset.sort ? { key: th.dataset.sort, dir: -state.sort.dir } : { key: th.dataset.sort, dir: 1 };
    state.page = 1;
    render();
  });

  $('#pages').addEventListener('click', (e) => {
    const b = e.target.closest('[data-page]');
    if (!b || b.disabled) return;
    state.page = Number(b.dataset.page);
    render();
    $('#page').scrollTo({ top: 0 });
  });
  $('#page-size').addEventListener('change', (e) => { state.pageSize = Number(e.target.value); state.page = 1; savePref('pageSize', e.target.value); render(); });

  const setView = (v) => { state.view = v; state.page = 1; render(); };
  $('#seg').addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (b) setView(b.dataset.view); });
  $('#kpis').addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (b) setView(state.view === b.dataset.view ? 'all' : b.dataset.view); });
  $('#tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) { state.tab = b.dataset.tab; state.page = 1; render(); } });
  $('#btn-hide-year').addEventListener('click', () => { if (/^\d+$/.test(state.tab)) setYearHidden(Number(state.tab), true); });
  $('#hidden-banner').addEventListener('click', (e) => { const b = e.target.closest('[data-action="unhide-year"]'); if (b) setYearHidden(Number(b.dataset.year), false); });
  $('#empty').addEventListener('click', (e) => { if (e.target.closest('[data-action="search-hidden"]')) { state.tab = 'hidden'; state.page = 1; render(); } });

  // klávesové zkratky
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') { e.preventDefault(); if (!dialogOpen()) openOrder(null); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); $('#search').focus(); $('#search').select(); }
    else if (e.key === '/' && !typing && !dialogOpen()) { e.preventDefault(); $('#search').focus(); }
    else if (e.key === 'Escape' && !dialogOpen() && state.openId != null && state.editingNoteId == null) closeDrawer();
  });

  // ---------- start ----------
  async function askForName() {
    const dlg = $('#dlg-name');
    $('#n-name').value = state.user || '';
    return new Promise((resolve) => {
      $('#form-name').addEventListener('submit', (e) => {
        e.preventDefault();
        const name = $('#n-name').value.trim();
        if (!name) return;
        dlg.close('ok');
        resolve(name);
      });
      dlg.addEventListener('cancel', (e) => e.preventDefault()); // jméno je povinné
      dlg.showModal();
    });
  }

  // nastavení: v aplikaci se ukládá do profilu uživatele (adresa okna se mění, localStorage by se ztratil)
  function savePref(key, value) {
    prefs[key] = value;
    if (desktop) desktop.setSetting(key, value).catch(() => {});
    else store.set('ezakazky.' + key, value);
  }

  const THEME_LABEL = { system: 'automaticky (podle Windows)', light: 'světlý', dark: 'tmavý' };
  const THEME_ICON = { system: 'auto', light: 'sun', dark: 'moon' };
  function paintThemeButton() {
    const mode = prefs.theme || 'system';
    const btn = $('#btn-theme');
    btn.innerHTML = icon(THEME_ICON[mode]);
    btn.title = `Vzhled: ${THEME_LABEL[mode]} – kliknutím změníte`;
    btn.setAttribute('aria-label', btn.title);
  }
  function cycleTheme() {
    const order = ['system', 'light', 'dark'];
    const next = order[(order.indexOf(prefs.theme || 'system') + 1) % order.length];
    savePref('theme', next);
    paintThemeButton();
    toast(`Vzhled: ${THEME_LABEL[next]}`);
  }

  // ---------- aktualizace programu ----------
  let upd = { state: 'unsupported' };
  let updManual = false; // uživatel o kontrolu požádal sám → ukázat i výsledek „máte nejnovější“
  function paintUpdate() {
    const btn = $('#btn-update-check');
    const now = $('#btn-update');
    const cur = upd.current ? `Verze ${upd.current}` : '';
    btn.hidden = upd.state === 'unsupported';
    btn.innerHTML = icon('refresh');
    btn.classList.toggle('spin', upd.state === 'checking');
    btn.title = `${cur} – kliknutím vyhledáte aktualizace`;
    btn.setAttribute('aria-label', btn.title);
    const labels = {
      available: `Nová verze ${upd.version} – stáhnout`,
      downloading: `Stahuje se… ${upd.percent ?? 0} %`,
      downloaded: `Restartovat a aktualizovat na ${upd.version}`,
    };
    now.hidden = !labels[upd.state];
    now.disabled = upd.state === 'downloading';
    now.innerHTML = `${icon(upd.state === 'downloaded' ? 'refresh' : 'download')}<span class="hide-sm">${esc(labels[upd.state] || '')}</span>`;
    now.title = upd.state === 'downloaded' ? 'Program se na chvíli zavře, nainstaluje novou verzi a sám se znovu spustí. Data zůstanou.' : labels[upd.state] || '';
  }
  function onUpdate(s) {
    const prev = upd.state;
    upd = s;
    paintUpdate();
    if (prev === s.state) return;
    if (s.state === 'uptodate' && updManual) toast(`Máte nejnovější verzi (${s.current}).`);
    if (s.state === 'error' && updManual) toast('Aktualizaci se nepodařilo zjistit: ' + (s.error || 'neznámá chyba'), true);
    if (s.state === 'available') toast(`Je k dispozici nová verze ${s.version}.`);
    if (s.state === 'uptodate' || s.state === 'error') updManual = false;
  }
  async function initUpdates() {
    onUpdate(await desktop.getUpdate().catch(() => ({ state: 'unsupported' })));
    desktop.onUpdate(onUpdate);
    $('#btn-update-check').addEventListener('click', () => {
      if (upd.state === 'checking') return;
      if (['downloading', 'downloaded', 'available'].includes(upd.state)) return toast(`Nová verze ${upd.version} je připravena – použijte tlačítko vedle.`);
      updManual = true;
      desktop.checkUpdate();
    });
    $('#btn-update').addEventListener('click', () => {
      if (upd.state === 'available') desktop.downloadUpdate();
      else if (upd.state === 'downloaded') desktop.installUpdate();
    });
  }

  async function init() {
    paintIcons();
    if (desktop) {
      Object.assign(prefs, await desktop.getSettings().catch(() => ({})));
      $('#btn-theme').hidden = false;
      $('#btn-theme').addEventListener('click', cycleTheme);
      paintThemeButton();
      initUpdates();
    } else {
      prefs.pageSize = store.get('ezakazky.pageSize');
    }
    const savedSize = prefs.pageSize == null ? null : String(prefs.pageSize);
    if (savedSize && [...$('#page-size').options].some((o) => o.value === savedSize)) {
      $('#page-size').value = savedSize;
      state.pageSize = Number(savedSize);
    }
    try {
      const me = await api('GET', '/api/me');
      state.askName = me.askName;
      state.user = me.user ?? store.get('ezakazky.user');
      if (state.askName && !state.user) {
        state.user = await askForName();
        store.set('ezakazky.user', state.user);
      }
      $('#status').dataset.db = me.dbFile || '';
      $('#user').innerHTML = `${avatar(state.user || '?')}<span>${esc(state.user || '')}</span>`;
      await load();
    } catch (e) {
      setStatus(false);
      $('#empty').hidden = false;
      $('#empty').textContent = 'Nepodařilo se připojit k databázi. ' + e.message;
    }
    setInterval(poll, 4000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
  }
  init();
})();
