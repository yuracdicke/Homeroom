/* Homeroom — tasks & homework */
(() => {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const KEY = 'homeroom.tasks.v1';
  const DAY = 86400000;

  // ---------- State ----------
  let tasks = load();
  let view = localStorage.getItem('homeroom.view') || 'today';
  let editingId = null;

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
  }
  function persist() {
    localStorage.setItem(KEY, JSON.stringify(tasks));
    render();
    syncReminders();
  }
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  // ---------- Dates ----------
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const parseDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const todayStr = () => ymd(new Date());

  // When the task is actually due (end of day if no time).
  function dueMs(t) {
    if (!t.date) return null;
    const d = parseDate(t.date);
    if (t.time) { const [h, m] = t.time.split(':').map(Number); d.setHours(h, m); }
    else d.setHours(23, 59);
    return d.getTime();
  }
  function remindMs(t) {
    if (!t.date || t.remind === '' || t.remind == null) return null;
    const d = parseDate(t.date);
    if (t.remind === 'morning') { d.setHours(8, 0); return d.getTime(); }
    if (t.remind === 'evening') { d.setDate(d.getDate() - 1); d.setHours(19, 0); return d.getTime(); }
    const base = t.time ? dueMs(t) : (() => { const x = parseDate(t.date); x.setHours(8, 0); return x.getTime(); })();
    return base - Number(t.remind) * 60000;
  }
  function fmtTime(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    return new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  function dayDiff(dateStr) { return Math.round((parseDate(dateStr) - startOfDay(new Date())) / DAY); }
  function dayLabel(dateStr) {
    const n = dayDiff(dateStr);
    if (n === 0) return 'Today';
    if (n === 1) return 'Tomorrow';
    if (n === -1) return 'Yesterday';
    const d = parseDate(dateStr);
    if (n > 1 && n < 7) return d.toLocaleDateString([], { weekday: 'long' });
    return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  }

  // ---------- Subject colors ----------
  const PALETTE = ['#5b5bd6', '#e5484d', '#30a46c', '#f76b15', '#0090ff', '#d6409f', '#12a594', '#ab4aba', '#978365', '#e2a336'];
  function subjColor(s) {
    if (!s) return null;
    let h = 0; for (const c of s.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return PALETTE[h % PALETTE.length];
  }

  // ---------- Views ----------
  const isOverdue = (t) => !t.done && t.date && dueMs(t) < Date.now();
  const sortKey = (t) => [dueMs(t) ?? Infinity, { high: 0, med: 1, low: 2 }[t.priority] ?? 1, t.createdAt];
  const byDue = (a, b) => { const A = sortKey(a), B = sortKey(b); for (let i = 0; i < 3; i++) if (A[i] !== B[i]) return A[i] < B[i] ? -1 : 1; return 0; };

  function viewTasks(v) {
    const open = tasks.filter((t) => !t.done);
    const today = todayStr();
    switch (v) {
      case 'today': return open.filter((t) => !t.date || t.date <= today);
      case 'upcoming': return open.filter((t) => t.date && t.date > today);
      case 'homework': return open.filter((t) => t.kind === 'homework');
      case 'all': return open;
      case 'done': return tasks.filter((t) => t.done);
    }
    return [];
  }

  function groupsFor(v, list) {
    const today = todayStr();
    if (v === 'done') {
      return [{ label: 'Completed', items: list.sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0)) }];
    }
    list.sort(byDue);
    if (v === 'today') {
      return [
        { label: 'Overdue', cls: 'overdue', items: list.filter((t) => t.date && t.date < today || (t.date === today && isOverdue(t) && t.time)) },
        { label: 'Today', items: list.filter((t) => t.date === today && !(t.time && isOverdue(t))) },
        { label: 'Anytime', items: list.filter((t) => !t.date) },
      ];
    }
    if (v === 'homework') {
      const map = new Map();
      for (const t of list) { const k = t.subject || 'Other'; if (!map.has(k)) map.set(k, []); map.get(k).push(t); }
      return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, items]) => ({ label: k, color: subjColor(k === 'Other' ? '' : k), items }));
    }
    // upcoming / all → group by day
    const map = new Map();
    for (const t of list) {
      const k = !t.date ? 'none' : t.date < today ? 'overdue' : t.date;
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(t);
    }
    return [...map.entries()].map(([k, items]) => ({
      label: k === 'none' ? 'No date' : k === 'overdue' ? 'Overdue' : dayLabel(k),
      sub: k.length === 10 && dayDiff(k) > 1 && dayDiff(k) < 7 ? parseDate(k).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '',
      cls: k === 'overdue' ? 'overdue' : '',
      items,
    }));
  }

  // ---------- Render ----------
  const listEl = $('#list');
  const tpl = $('#item-tpl');

  function render() {
    // Header
    const now = new Date();
    const h = now.getHours();
    $('#greeting').textContent = h < 5 ? 'Up late?' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    $('#today-label').textContent = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });

    // Progress ring: tasks due today (incl. done today)
    const today = todayStr();
    const todays = tasks.filter((t) => t.date === today || (!t.done && t.date && t.date < today) || (t.done && t.doneAt && ymd(new Date(t.doneAt)) === today));
    const doneN = todays.filter((t) => t.done).length;
    const total = todays.length;
    $('#ring-text').textContent = `${doneN}/${total}`;
    $('#ring-fg').style.strokeDashoffset = 113.1 * (1 - (total ? doneN / total : 0));
    $('#ring').classList.toggle('complete', total > 0 && doneN === total);
    $('#ring').title = `${doneN} of ${total} done today`;

    // Tabs
    for (const b of $$('#tabs button')) {
      b.classList.toggle('active', b.dataset.view === view);
      b.setAttribute('aria-selected', b.dataset.view === view);
      const n = b.dataset.view === 'done' ? 0 : viewTasks(b.dataset.view).length;
      b.querySelector('.count').textContent = n || '';
    }

    // List
    const list = viewTasks(view);
    listEl.replaceChildren();
    if (!list.length) return listEl.append(emptyState());
    for (const g of groupsFor(view, list)) {
      if (!g.items.length) continue;
      const label = document.createElement('div');
      label.className = 'group-label ' + (g.cls || '');
      label.textContent = g.label;
      if (g.color) label.style.color = g.color;
      if (g.sub) { const s = document.createElement('small'); s.textContent = g.sub; label.append(s); }
      const box = document.createElement('div');
      box.className = 'group';
      for (const t of g.items) box.append(itemEl(t));
      listEl.append(label, box);
    }

    // Subjects datalist
    const subs = [...new Set(tasks.map((t) => t.subject).filter(Boolean))].sort();
    $('#subjects').replaceChildren(...subs.map((s) => Object.assign(document.createElement('option'), { value: s })));
  }

  function itemEl(t) {
    const el = tpl.content.firstElementChild.cloneNode(true);
    el.dataset.id = t.id;
    el.classList.toggle('done', t.done);
    el.classList.toggle('high', t.priority === 'high' && !t.done);
    const c = subjColor(t.subject);
    if (c) el.style.setProperty('--subj', c);
    $('.title', el).textContent = (t.priority === 'high' && !t.done ? '🔥 ' : '') + t.title;
    $('.check', el).setAttribute('aria-label', t.done ? 'Mark not done' : 'Mark complete');

    const meta = $('.meta', el);
    if (t.kind === 'homework') {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = t.subject || 'Homework';
      if (!c) tag.style.setProperty('--subj', 'var(--accent)');
      meta.append(tag);
    } else if (t.subject) {
      const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = t.subject; meta.append(tag);
    }
    if (t.date) {
      const s = document.createElement('span');
      const n = dayDiff(t.date);
      let txt = view === 'today' && n === 0 ? '' : dayLabel(t.date);
      if (t.time) txt = (txt ? txt + ', ' : '') + fmtTime(t.time);
      if (!t.done && isOverdue(t)) { s.className = 'late'; txt = txt || 'Today'; txt += n < -1 ? ` · ${-n} days late` : ' · late'; }
      else if (!t.done && dueMs(t) - Date.now() < 3 * 3600e3) s.className = 'soon';
      if (txt) { s.textContent = (n === 0 && !t.time ? '' : 'Due ') + txt; meta.append(s); }
    }
    const r = remindMs(t);
    if (!t.done && r && r > Date.now()) {
      const s = document.createElement('span'); s.textContent = '🔔'; s.title = 'Reminder ' + new Date(r).toLocaleString(); meta.append(s);
    }
    if (t.done && t.doneAt) {
      const s = document.createElement('span'); s.textContent = 'Done ' + dayLabel(ymd(new Date(t.doneAt))).toLowerCase(); meta.append(s);
    }
    $('.notes', el).textContent = t.notes || '';
    return el;
  }

  function emptyState() {
    const e = document.createElement('div');
    e.className = 'empty';
    const msgs = {
      today: ['🌤️', "You're all clear for today", 'Add something above, or enjoy the free time.'],
      upcoming: ['🗓️', 'Nothing coming up', 'Tasks with a future due date will show up here.'],
      homework: ['📚', 'No homework right now', 'Tap + and choose “Homework” to add an assignment.'],
      all: ['✨', 'No open tasks', 'Tap + to add your first one.'],
      done: ['🏁', 'Nothing completed yet', 'Check off a task and it will land here.'],
    }[view];
    e.innerHTML = `<div class="big">${msgs[0]}</div><strong>${msgs[1]}</strong>${msgs[2]}`;
    if (!tasks.length) e.innerHTML = `<div class="big">👋</div><strong>Welcome to Homeroom</strong>Add your tasks and homework, and get reminders right on your phone.`;
    return e;
  }

  // ---------- Interactions ----------
  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    view = b.dataset.view; localStorage.setItem('homeroom.view', view); render();
  });

  listEl.addEventListener('click', (e) => {
    const item = e.target.closest('.item'); if (!item) return;
    const t = tasks.find((x) => x.id === item.dataset.id); if (!t) return;
    if (e.target.closest('.check')) {
      t.done = !t.done; t.doneAt = t.done ? Date.now() : null;
      if (navigator.vibrate) navigator.vibrate(10);
      item.classList.toggle('done', t.done);
      if (view !== 'done' && t.done || view === 'done' && !t.done) {
        item.classList.add('leaving');
        setTimeout(persist, 330);
      } else persist();
      if (t.done) {
        const left = viewTasks('today').length;
        toast(left === 0 && view === 'today' ? 'All done for today 🎉' : 'Nice work ✓', 'Undo', () => { t.done = false; t.doneAt = null; persist(); });
      }
      return;
    }
    openTask(t);
  });

  // Quick add
  $('#quick-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const inp = $('#quick-input');
    const title = inp.value.trim(); if (!title) return inp.focus();
    tasks.push({ id: uid(), title, kind: 'task', subject: '', date: todayStr(), time: '', remind: '', priority: 'med', notes: '', done: false, createdAt: Date.now() });
    inp.value = '';
    if (view !== 'today' && view !== 'all') view = 'today';
    persist();
    toast('Added to today');
  });
  $('#quick-more').addEventListener('click', () => openTask(null, $('#quick-input').value.trim()));
  $('#fab').addEventListener('click', () => openTask(null));

  // ---------- Task sheet ----------
  const sheet = $('#task-sheet');
  const form = $('#task-form');

  function openTask(t, prefillTitle = '') {
    editingId = t ? t.id : null;
    form.reset();
    $('#sheet-title').textContent = t ? 'Edit' : 'New';
    $('#delete-btn').hidden = !t;
    const d = t || { kind: view === 'homework' ? 'homework' : 'task', title: prefillTitle, subject: '', date: view === 'upcoming' ? ymd(new Date(Date.now() + DAY)) : todayStr(), time: '', remind: '', priority: 'med', notes: '' };
    form.kind.value = d.kind;
    form.title.value = d.title;
    form.subject.value = d.subject || '';
    form.date.value = d.date || '';
    form.time.value = d.time || '';
    form.remind.value = d.remind ?? '';
    form.priority.value = d.priority || 'med';
    form.notes.value = d.notes || '';
    updateKind();
    sheet.showModal();
    if (!t) setTimeout(() => form.title.focus(), 50);
  }
  function updateKind() {
    const hw = form.kind.value === 'homework';
    $('#subject-field > span').textContent = hw ? 'Class / subject' : 'List / category (optional)';
    form.subject.placeholder = hw ? 'e.g. Biology' : 'e.g. Chores, Work';
    $('#sheet-title').textContent = ($('#delete-btn').hidden ? 'New ' : 'Edit ') + (hw ? 'homework' : 'task');
  }
  $$('input[name=kind]', form).forEach((r) => r.addEventListener('change', updateKind));

  $('#date-chips').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const v = b.dataset.days;
    if (v === 'none') { form.date.value = ''; form.time.value = ''; return; }
    const d = new Date();
    if (v === 'weekend') d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || (d.getDay() === 6 ? 0 : 7)));
    else d.setDate(d.getDate() + Number(v));
    form.date.value = ymd(d);
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const title = form.title.value.trim();
    if (!title) return form.title.focus();
    const data = {
      title,
      kind: form.kind.value,
      subject: form.subject.value.trim(),
      date: form.date.value,
      time: form.date.value ? form.time.value : '',
      remind: form.remind.value,
      priority: form.priority.value,
      notes: form.notes.value.trim(),
    };
    if (editingId) Object.assign(tasks.find((t) => t.id === editingId), data);
    else tasks.push({ id: uid(), done: false, createdAt: Date.now(), ...data });
    sheet.close();
    persist();
    toast(editingId ? 'Saved' : 'Added');
    if (data.remind && data.date && !pushReady()) setTimeout(() => toast('Turn on notifications to get this reminder', 'Set up', openSettings), 2600);
  });

  $('#delete-btn').addEventListener('click', () => {
    const idx = tasks.findIndex((t) => t.id === editingId); if (idx < 0) return;
    const [removed] = tasks.splice(idx, 1);
    sheet.close(); persist();
    toast('Deleted', 'Undo', () => { tasks.splice(idx, 0, removed); persist(); });
  });

  // Close sheets: buttons + tap on backdrop + swipe down on grabber area
  for (const dlg of $$('dialog.sheet')) {
    dlg.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) dlg.close();
      else if (e.target === dlg) {
        const r = dlg.getBoundingClientRect();
        if (e.clientY < r.top || e.clientY > r.bottom || e.clientX < r.left || e.clientX > r.right) dlg.close();
      }
    });
    let y0 = null;
    dlg.addEventListener('touchstart', (e) => { y0 = dlg.scrollTop === 0 ? e.touches[0].clientY : null; }, { passive: true });
    dlg.addEventListener('touchmove', (e) => {
      if (y0 == null) return;
      const dy = e.touches[0].clientY - y0;
      if (dy > 0 && !e.target.closest('input,textarea,select')) dlg.style.transform = `translateY(${dy}px)`;
    }, { passive: true });
    dlg.addEventListener('touchend', (e) => {
      if (y0 == null) return;
      const dy = e.changedTouches[0].clientY - y0;
      dlg.style.transform = '';
      if (dy > 120) dlg.close();
      y0 = null;
    });
  }

  // ---------- Toast ----------
  let toastTimer;
  function toast(msg, action, fn) {
    const el = $('#toast');
    el.replaceChildren(document.createTextNode(msg));
    if (action) {
      const b = document.createElement('button'); b.textContent = action;
      b.onclick = () => { el.classList.remove('show'); fn(); };
      el.append(b);
    }
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), action ? 4500 : 1800);
  }

  // ---------- Notifications ----------
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  let swReg = null;
  let subscription = null;
  let serverOK = false;

  const pushReady = () => !!subscription && serverOK;

  async function initPush() {
    if (!('serviceWorker' in navigator)) return updateNotifUI();
    try {
      swReg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      if (pushSupported) subscription = await swReg.pushManager.getSubscription();
      const r = await fetch('/api/vapid-public-key');
      serverOK = r.ok;
    } catch { serverOK = false; }
    updateNotifUI();
    syncReminders();
  }

  function urlB64ToUint8Array(b64) {
    const pad = '='.repeat((4 - (b64.length % 4)) % 4);
    const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  }

  async function enablePush() {
    const btn = $('#enable-notifs');
    btn.disabled = true;
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { toast('Notifications were not allowed'); return; }
      const { key } = await (await fetch('/api/vapid-public-key')).json();
      subscription = await swReg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(key) });
      serverOK = true;
      await syncReminders();
      await sendTest();
    } catch (err) {
      console.error(err);
      toast("Couldn't turn on notifications");
    } finally {
      btn.disabled = false;
      updateNotifUI();
    }
  }

  async function sendTest() {
    if (!subscription) return;
    const r = await fetch('/api/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription }) });
    toast(r.ok ? 'Test notification sent 📲' : 'Test failed — check the server');
  }

  let syncTimer;
  function syncReminders() {
    clearTimeout(syncTimer);
    return new Promise((resolve) => {
      syncTimer = setTimeout(async () => {
        if (!subscription) return resolve();
        const now = Date.now();
        const reminders = tasks
          .filter((t) => !t.done)
          .map((t) => ({ t, at: remindMs(t) }))
          .filter((x) => x.at && x.at > now - 60000)
          .map(({ t, at }) => ({
            id: t.id,
            at,
            title: (t.kind === 'homework' ? '📚 ' : '✓ ') + t.title,
            body: [t.subject, t.date && ('Due ' + dayLabel(t.date).toLowerCase().replace(/^(mon|tue|wed|thu|fri|sat|sun)/, (m) => m[0].toUpperCase() + m.slice(1)) + (t.time ? ' at ' + fmtTime(t.time) : ''))].filter(Boolean).join(' · '),
          }));
        try {
          const r = await fetch('/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription, reminders }) });
          serverOK = r.ok;
        } catch { serverOK = false; }
        updateNotifUI();
        resolve();
      }, 300);
    });
  }

  function updateNotifUI() {
    const status = $('#notif-status');
    const enableBtn = $('#enable-notifs');
    const testBtn = $('#test-notif');
    const needsInstall = isIOS && !isStandalone;
    $('#ios-steps').hidden = !needsInstall;
    let state, text;
    if (needsInstall) { state = 'off'; text = '<b>One quick step first.</b> On iPhone, add Homeroom to your Home Screen to allow notifications.'; }
    else if (!pushSupported) { state = 'off'; text = "This browser doesn't support push notifications. On iPhone, use Safari and add Homeroom to your Home Screen (iOS 16.4+)."; }
    else if (Notification.permission === 'denied') { state = 'off'; text = 'Notifications are blocked. Turn them on in <b>Settings → Notifications → Homeroom</b>.'; }
    else if (subscription && serverOK) { state = 'on'; text = '<b>Notifications are on.</b> You’ll get a reminder for any task with “Remind me” set — even when the app is closed.'; }
    else if (subscription && !serverOK) { state = 'off'; text = "Notifications are on, but the reminder server can't be reached right now."; }
    else { state = ''; text = 'Notifications are off. Turn them on to get reminders for tasks and homework.'; }
    status.className = 'status-card ' + state;
    status.innerHTML = `<span class="s-dot"></span><div>${text}</div>`;
    enableBtn.hidden = needsInstall || !pushSupported || Notification.permission === 'denied' || !!subscription;
    testBtn.hidden = !subscription;

    const showBanner = !subscription && localStorage.getItem('homeroom.bannerDismissed') !== '1' && (needsInstall || (pushSupported && Notification.permission !== 'denied'));
    $('#notif-banner').hidden = !showBanner;
    $('#banner-text').textContent = needsInstall ? 'Add Homeroom to your Home Screen to get reminders.' : 'Turn on notifications so you never miss a due date.';
    $('#bell-dot').hidden = !!subscription;
  }

  function openSettings() { updateNotifUI(); $('#settings-sheet').showModal(); }
  $('#open-settings').addEventListener('click', openSettings);
  $('#banner-btn').addEventListener('click', openSettings);
  $('#enable-notifs').addEventListener('click', enablePush);
  $('#test-notif').addEventListener('click', sendTest);

  // ---------- Data ----------
  $('#export-btn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ app: 'homeroom', version: 1, tasks }, null, 2)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `homeroom-${todayStr()}.json` });
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('#import-file').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const incoming = Array.isArray(data) ? data : data.tasks;
      if (!Array.isArray(incoming)) throw 0;
      const ids = new Set(tasks.map((t) => t.id));
      const added = incoming.filter((t) => t && t.id && t.title && !ids.has(t.id));
      tasks.push(...added); persist(); toast(`Imported ${added.length} task${added.length === 1 ? '' : 's'}`);
    } catch { toast("That file doesn't look like a Homeroom backup"); }
    e.target.value = '';
  });
  $('#clear-done').addEventListener('click', () => {
    const n = tasks.filter((t) => t.done).length;
    if (!n) return toast('No completed tasks');
    if (!confirm(`Remove ${n} completed task${n === 1 ? '' : 's'}?`)) return;
    tasks = tasks.filter((t) => !t.done); persist(); toast('Cleared');
  });

  // Refresh "late"/greeting labels periodically and when returning to the app.
  setInterval(render, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { tasks = load(); render(); syncReminders(); } });

  render();
  initPush();
})();
