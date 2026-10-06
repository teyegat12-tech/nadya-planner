import { db } from './db.js';
import { BOT_USERNAME } from './config.js';
import { I, plate, catIcon, CAT_ICONS, CAT_COLORS, CAT_PRESETS, CAT_MAX, fixColor, pcVars } from './icons.js';
import { playDone, playDayDone, playUndo, buzz, burst, celebrate, isSoundOn, setSound } from './fx.js';
import {
  ymd, addDays, humanDate, shortTime, parseQuick, repeatLabel, isoDow, DOW_SHORT, DOW_FULL, parseYmd,
} from './dates.js';

// ---------- состояние ----------
const S = {
  session: null,
  tasks: [],
  cats: [],
  settings: null,
  view: ['week', 'board'].includes(load('view', 'today')) ? 'plan' : load('view', 'today'),
  planMode: load('planMode', 'week'),
  cat: load('cat', 'all'),
  editing: null, // задача в окне редактирования
  showDone: false,
  feeds: [],
  habits: [],
  hchecks: new Set(),
  events: load('events', []), // события из календарей Google / iCloud
  evErrors: [],
};

function load(k, def) { try { return JSON.parse(localStorage.getItem('pl_' + k)) ?? def; } catch { return def; } }
function save(k, v) { try { localStorage.setItem('pl_' + k, JSON.stringify(v)); } catch {} }

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => ymd(new Date());
const nowHM = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const catById = (id) => S.cats.find((c) => c.id === id);

const STATUS = { todo: 'Запланировано', in_progress: 'В процессе', done: 'Выполнено' };
const BOARD = { todo: 'Запланировано', in_progress: 'В процессе', paused: 'На паузе', done: 'Выполнено' };
const isActive = (t) => t.status === 'todo' || t.status === 'in_progress';
const REMIND = [
  [null, 'Не напоминать'], [0, 'В момент начала'], [5, 'За 5 минут'], [15, 'За 15 минут'],
  [30, 'За 30 минут'], [60, 'За час'], [1440, 'За день'],
];

function toast(msg, isErr = false, action = null) {
  const t = $('#toast');
  t.textContent = msg;
  if (action) {
    const b = document.createElement('button');
    b.className = 'toast-act'; b.textContent = action.label;
    b.onclick = () => { t.className = 'toast'; action.fn(); };
    t.append(b);
  }
  t.className = 'toast show' + (isErr ? ' err' : '') + (action ? ' has-act' : '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.className = 'toast'), action ? 5000 : 2600);
}

async function safe(fn, okMsg) {
  try {
    const r = await fn();
    if (okMsg) toast(okMsg);
    return r;
  } catch (e) {
    console.error(e);
    toast(e.message?.includes('Failed to fetch') ? 'Нет интернета — попробуй ещё раз' : (e.message || 'Ошибка'), true);
  }
}

// ---------- загрузка данных ----------
async function reload() {
  S.reductionError = false;
  try {
    S.reductions = await db.reductions();
    S.reductionEntries = await db.reductionEntries();
  } catch {
    S.reductionError = true;
    S.reductions = []; S.reductionEntries = [];
  }
  S.archivedTasks = await db.archivedTasks();
  const [tasks, cats, settings, rework, feeds, habits, hchecks] = await Promise.all([db.tasks(), db.categories(), db.settings(), db.reworkIds().catch(() => []), db.feeds().catch(() => []), db.habits().catch(() => []), db.habitChecks().catch(() => [])]);
  S.feeds = feeds;
  S.habits = habits; S.hchecks = new Set(hchecks.map((c) => hKey(c.habit_id, c.date)));
  S.rework = new Set(rework);
  // задачи, поставленные «В процессе» до включения таймера, — запускаем отсчёт сейчас
  for (const t of tasks) if (t.status === 'in_progress' && !t.started_at) {
    t.started_at = new Date().toISOString(); // с этого момента, чтобы не насчитать лишних часов
    db.updateTask(t.id, { started_at: t.started_at }).catch(() => {});
  }
  S.tasks = tasks; S.cats = cats.map((c) => ({ ...c, color: fixColor(c.color) })); S.settings = settings;
  save('cache', { tasks, cats, settings });
  render();
  if (S.view === 'report') loadReport();
  if (S.view === 'health') loadHealth();
  loadEvents();
}

// ---------- события из календарей (только чтение) ----------
let evLoadedAt = 0;
async function loadEvents(force = false) {
  if (!S.feeds.length) { if (S.events.length) { S.events = []; save('events', []); render(); } return; }
  if (!force && Date.now() - evLoadedAt < 60 * 1000) return;
  evLoadedAt = Date.now();
  try {
    const td = today();
    const r = await db.events(td, addDays(td, 13));
    S.events = r.events || [];
    S.evErrors = r.errors || [];
    S.evApiError = null;
    save('events', S.events);
    render();
  } catch (e) { console.warn(e); S.evApiError = e.message || 'не получилось загрузить'; render(); }
}
const feedById = (id) => S.feeds.find((f) => f.id === id);
function eventsOn(day) {
  if (S.cat !== 'all') return [];
  const taken = new Set(S.tasks.map((t) => t.source_uid).filter(Boolean));
  return S.events.filter((e) => e.date === day && !taken.has(e.key) && feedById(e.feed_id));
}
function eventRow(e) {
  const f = feedById(e.feed_id);
  const past = e.date === today() && !e.all_day && (e.end || e.start) < nowHM();
  return `
    <div class="ev ${past ? 'past' : ''}" data-key="${esc(e.key)}">
      <div class="ev-time">${e.all_day ? 'весь<br>день' : `${e.start}${e.end ? `<small>${e.end}</small>` : ''}`}</div>
      <div class="ev-body">
        <div class="ev-title">${esc(e.title)}</div>
        <div class="ev-meta"><span class="ev-dot" style="background:${fixColor(f?.color) || '#c973de'}"></span>${esc(f?.name || 'Календарь')}${e.location ? ` · ${esc(e.location)}` : ''}</div>
      </div>
      <button class="ev-add" data-act="ev-task" data-key="${esc(e.key)}" aria-label="Сделать задачей" title="Сделать задачей">${I('plus')}</button>
    </div>`;
}
// будущие повторы задачи — показываем бледными в «Неделе», настоящая задача одна (следующая создаётся, когда отметишь)
function repeatsOn(r, from, day) {
  if (!r || day <= from) return false;
  if (r.freq === 'daily') return true;
  if (r.freq === 'weekly') return (r.days || []).includes(isoDow(day));
  if (r.freq === 'monthly') return Number(day.slice(8)) === Number(from.slice(8));
  return false;
}
function ghostsOn(day) {
  return visible(S.tasks).filter((t) => t.repeat && t.due_date && isActive(t) && repeatsOn(t.repeat, t.due_date, day));
}
// задачи и события одного дня вперемешку по времени
function dayRows(tasks, evs, opts = {}, ghosts = []) {
  const items = [
    ...ghosts.map((t) => ({ k: t.due_time ? '1' + shortTime(t.due_time) : '2', h: taskRow(t, { ghost: true }) })),
    ...tasks.map((t) => ({ k: t.status === 'done' ? '3' : t.due_time ? '1' + shortTime(t.due_time) : '2', h: taskRow(t, opts) })),
    ...evs.map((e) => ({ k: e.all_day ? '0' : '1' + e.start, h: eventRow(e) })),
  ];
  return items.sort((a, b) => a.k.localeCompare(b.k)).map((x) => x.h).join('');
}

// ---------- трекеры привычек ----------
const hKey = (id, d) => `${id}|${d}`;
const daysBetween = (a, b) => Math.round((parseYmd(b) - parseYmd(a)) / 864e5);
const HB_ICONS = ['flame', 'heart', 'book', 'run', 'yoga', 'drop', 'moon', 'leaf', 'brain', 'pen', 'music', 'star', 'coffee', 'walk', 'dumbbell', 'sparkle'];
const HB_DAYS = [7, 14, 21, 30, 66, 100];
const hbPlate = (h, cls = '') => plate({ emoji: h.icon, color: h.color }, cls);

function habitStats(h) {
  const td = today();
  const end = addDays(h.start_date, h.days - 1);
  let done = 0;
  for (let i = 0; i < h.days; i++) if (S.hchecks.has(hKey(h.id, addDays(h.start_date, i)))) done++;
  const todayOn = S.hchecks.has(hKey(h.id, td));
  let streak = 0; let d = todayOn ? td : addDays(td, -1);
  while (d >= h.start_date && S.hchecks.has(hKey(h.id, d))) { streak++; d = addDays(d, -1); }
  const dayN = Math.min(h.days, Math.max(0, daysBetween(h.start_date, td) + 1));
  const complete = done >= h.days;
  return { done, streak, end, dayN, todayOn, complete, finished: complete || td > end || h.archived, active: !h.archived && !complete && h.start_date <= td && td <= end };
}
const plural = (n, a, b, c) => { const m = n % 10, mm = n % 100; return m === 1 && mm !== 11 ? a : m >= 2 && m <= 4 && (mm < 12 || mm > 14) ? b : c; };

// быстрые кружки на «Сегодня»
function habitStrip() {
  const act = S.habits.filter((h) => habitStats(h).active);
  if (!act.length && !(S.reductions || []).length) return '';
  return `
    <section class="hb-strip">
      <div class="hb-strip-head"><h3>${I('flame', 'sm')} Привычки</h3><button class="link-btn" data-view="habits">Все</button></div>
      <div class="hb-row">${act.map((h) => { const st = habitStats(h); return `
        <button class="hb-dot ${st.todayOn ? 'on' : ''}" data-act="hb-today" data-id="${h.id}" style="${pcVars(h.color)}" title="${esc(h.title)}">
          <span class="hb-ring"><svg class="hb-progress" viewBox="0 0 64 64" aria-hidden="true"><circle class="hb-progress-track" cx="32" cy="32" r="27"/><circle class="hb-progress-fill" cx="32" cy="32" r="27" pathLength="100" stroke-dasharray="${100 * st.done / h.days} 100" style="${st.done ? '' : 'visibility:hidden'}"/></svg>${st.todayOn ? I('check') : I(catIcon({ emoji: h.icon }))}</span>
          <span class="hb-name">${esc(h.title)}</span>
          <span class="hb-count">${st.done} / ${h.days}</span>
        </button>`; }).join('')}${(S.reductions || []).map((r) => {
          const entry = (S.reductionEntries || []).find((e) => e.reduction_id === r.id && e.date === today());
          const pct = entry ? Math.max(0, Math.min(100, (1 - Number(entry.amount) / r.baseline) * 100)) : 0;
          return `<button class="hb-dot" data-act="red-open" data-id="${r.id}" style="${pcVars(CAT_COLORS[1])}" title="${esc(r.title)}"><span class="hb-ring"><svg class="hb-progress" viewBox="0 0 64 64" aria-hidden="true"><circle class="hb-progress-track" cx="32" cy="32" r="27"/><circle class="hb-progress-fill" cx="32" cy="32" r="27" pathLength="100" stroke-dasharray="${pct} 100" style="${pct ? '' : 'visibility:hidden'}"/></svg>${I('leaf')}</span><span class="hb-name">${esc(r.title)}</span><span class="hb-count">${entry ? `${entry.amount} / ${r.baseline}` : 'Нет записи'}</span></button>`;
        }).join('')}</div>
    </section>`;
}

function habitCard(h) {
  const st = habitStats(h); const td = today();
  const cells = [];
  for (let i = 0; i < h.days; i++) {
    const d = addDays(h.start_date, i);
    const on = S.hchecks.has(hKey(h.id, d));
    const cls = on ? 'on' : d > td ? 'future' : d === td ? '' : 'miss';
    cells.push(`<button class="hb-cell ${cls} ${d === td ? 'today' : ''}" data-act="hb-cell" data-id="${h.id}" data-d="${d}" ${d > td ? 'disabled' : ''} title="${humanDate(d, td)}">${on ? I('check') : i + 1}</button>`);
  }
  const sub = st.complete ? `Пройдено: ${h.days} из ${h.days}`
    : st.finished ? `Срок вышел · отмечено ${st.done} из ${h.days}`
    : h.start_date > td ? `Старт ${humanDate(h.start_date, td)}`
    : `День ${st.dayN} из ${h.days} · отмечено ${st.done}`;
  return `
    <section class="card habit ${st.finished ? 'finished' : ''}" style="${pcVars(h.color)}">
      <div class="hb-head">
        ${hbPlate(h)}
        <div class="hb-t">
          <div class="hb-title">${esc(h.title)}</div>
        </div>
        ${st.active ? `<button class="hb-today ${st.todayOn ? 'on' : ''}" data-act="hb-today" data-id="${h.id}" aria-label="Отметить сегодня">${I('check')}</button>` : ''}
      </div>
      <div class="hb-sub">${sub}${st.streak > 1 && !st.finished ? ` · серия ${st.streak} ${plural(st.streak, 'день', 'дня', 'дней')}` : ''}</div>
      <div class="hb-bar"><i style="width:${Math.round((st.done / h.days) * 100)}%"></i></div>
      <div class="hb-grid">${cells.join('')}</div>
      <div class="hb-foot">
        <button class="link-btn" data-act="hb-edit" data-id="${h.id}">Изменить</button>
        ${st.finished ? `<button class="link-btn" data-act="hb-restart" data-id="${h.id}">Начать заново</button>` : ''}
      </div>
    </section>`;
}

function viewHabits() {
  const tabs = `<nav class="seg habits-seg"><button data-act="habit-mode" data-mode="formation" class="${S.habitMode !== 'reduction' ? 'on' : ''}">Формирование</button><button data-act="habit-mode" data-mode="reduction" class="${S.habitMode === 'reduction' ? 'on' : ''}">Сокращение</button></nav>`;
  if (S.habitMode === 'reduction') return tabs + viewReductions();
  const list = S.habits.map((h) => [h, habitStats(h)]);
  const going = list.filter(([, st]) => !st.finished).map(([h]) => h);
  const done = list.filter(([, st]) => st.finished).map(([h]) => h);
  return `
    ${tabs}<div class="habits">
      ${going.length ? going.map(habitCard).join('') : `
        <section class="card hb-empty">
          <h3>${I('flame')} Свои трекеры</h3>
          <p>Придумай привычку и срок — 21 день, месяц или сколько хочешь. Каждый день отмечай галочкой здесь или прямо в «Сегодня».</p>
        </section>`}
      <button class="btn" data-act="hb-new">${I('plus')}Привычка</button>
      ${done.length ? `<h3 class="hb-sec">Завершённые</h3>${done.map(habitCard).join('')}` : ''}
    </div>`;
}

function viewReductions() {
  if (S.reductionError) return '<div class="empty">Для сокращений нужно установить обновление базы «10 — Сокращения».</div>';
  return `<div class="habits">${(S.reductions || []).map((r) => {
    const entries = (S.reductionEntries || []).filter((e) => e.reduction_id === r.id);
    const week = entries.filter((e) => e.date >= addDays(today(), -6) && e.date <= today());
    const average = week.length ? week.reduce((sum, e) => sum + Number(e.amount), 0) / week.length : null;
    const change = average === null ? null : Math.round((1 - average / r.baseline) * 100);
    const latest = entries.find((e) => e.date === today());
    const peak = Math.max(r.baseline, ...entries.map((e) => Number(e.amount)));
    return `<section class="card habit reduction" style="${pcVars(CAT_COLORS[1])}"><div class="hb-head">${hbPlate({ icon: 'leaf', color: CAT_COLORS[1] })}<div class="hb-t"><div class="hb-title">${esc(r.title)}</div></div><button class="hb-today" data-act="red-open" data-id="${r.id}" aria-label="Записать количество за день">${I('plus')}</button></div><div class="hb-sub">Исходный уровень: ${r.baseline} ${esc(r.unit)} в день</div><div class="red-stats"><div><b>${latest ? latest.amount : '—'}</b><span>Сегодня</span></div><div><b>${average === null ? '—' : average.toFixed(1)}</b><span>Среднее · ${week.length} из 7 дней</span></div><div><b>${entries.filter((e) => Number(e.amount) === 0).length}</b><span>Дней с нулём</span></div></div><div class="hb-sub">${change === null ? 'Нет записей за последние 7 дней' : `${change >= 0 ? 'Снижение' : 'Рост'} количества: ${Math.abs(change)}% · по заполненным дням`}</div><div class="red-history">${entries.slice(-14).map((e) => `<button class="red-day" data-act="red-edit-entry" data-id="${r.id}" data-date="${e.date}" data-amount="${e.amount}" title="${esc(e.date)}: ${e.amount} ${esc(r.unit)}"><span class="red-day-value">${e.amount}</span><span class="red-day-track"><i style="height:${100 * Number(e.amount) / peak}%"></i></span><span>${esc(e.date.slice(8))}.${esc(e.date.slice(5, 7))}</span></button>`).join('') || '<div class="hb-sub">Нет записей</div>'}</div><div class="hb-foot"><button class="link-btn" data-act="red-open" data-id="${r.id}">Записать день</button></div></section>`;
  }).join('')}<button class="btn" data-act="red-new">${I('plus')} Новый трекер сокращения</button></div>`;
}

function openReduction() {
  const box = $('#logsheet');
  box.innerHTML = `<div class="sheet-bg" data-act="close-log"></div><div class="sheet"><div class="sheet-top"><div class="sheet-handle"></div><button class="close-x" data-act="close-log" aria-label="Закрыть">${I('x')}</button></div><h3 class="sheet-h">Новый трекер сокращения</h3><label>Название<input class="plain-in" type="text" id="red-title" placeholder="Курение"></label><label>Обычно за день<input id="red-baseline" type="number" min="1" step="1"></label><label>Единица измерения<input class="plain-in" type="text" id="red-unit" value="сигарет"></label><div class="sheet-actions"><button class="btn" data-act="close-log">Отмена</button><button class="btn primary" data-act="red-save">Создать</button></div></div>`;
  box.classList.add('open');
}

function openReductionEntry(id, date = today(), amount = null) {
  const tracker = (S.reductions || []).find((r) => r.id === id);
  if (!tracker) return;
  const existing = (S.reductionEntries || []).find((e) => e.reduction_id === id && e.date === date);
  const box = $('#logsheet');
  box.innerHTML = `<div class="sheet-bg" data-act="close-log"></div><div class="sheet"><div class="sheet-top"><div class="sheet-handle"></div><button class="close-x" data-act="close-log" aria-label="Закрыть">${I('x')}</button></div><h3 class="sheet-h">${esc(tracker.title)}</h3><label>Дата<input type="date" id="red-date-${id}" value="${esc(date)}" max="${today()}"></label><label>Количество (${esc(tracker.unit)})<input type="number" id="red-amount-${id}" min="0" step="1" value="${amount ?? existing?.amount ?? ''}"></label><div class="sheet-actions"><button class="btn" data-act="close-log">Отмена</button><button class="btn primary" data-act="red-entry" data-id="${id}">Сохранить</button></div></div>`;
  box.classList.add('open');
}

function openHabit(h = null) {
  S.hbEditing = h;
  const color = (fixColor(h?.color) || '').toLowerCase() || CAT_COLORS[S.habits.length % CAT_COLORS.length];
  const icon = h?.icon || 'flame';
  const days = h?.days || 21;
  const box = $('#logsheet');
  box.innerHTML = `
    <div class="sheet-bg" data-act="close-log"></div>
    <div class="sheet">
      <div class="sheet-top"><div class="sheet-handle"></div><button class="close-x" data-act="close-log" aria-label="Закрыть">${I('x')}</button></div>
      <h3 class="sheet-h">${h ? 'Привычка' : 'Новая привычка'}</h3>
      <label>Название</label>
      <input id="hb-title" class="plain-in" value="${esc(h?.title || '')}" placeholder="Например: без сахара" maxlength="60">
      <label>Сколько дней</label>
      <div class="quick">${HB_DAYS.map((n) => `<button data-hdays="${n}" class="${n === days ? 'on' : ''}">${n}</button>`).join('')}</div>
      <input id="hb-days" type="number" min="1" max="365" value="${days}">
      <label>Иконка</label>
      <div class="hb-icons" id="hb-icons" style="${pcVars(color)}">${HB_ICONS.map((i) => `<button data-v="${i}" class="${i === icon ? 'on' : ''}">${I(i)}</button>`).join('')}</div>
      <label>Цвет</label>
      <div class="hb-colors" id="hb-colors">${CAT_COLORS.map((c) => `<button data-v="${c}" class="${c === color ? 'on' : ''}" style="${pcVars(c)}" aria-label="Цвет"></button>`).join('')}</div>
      <div class="sheet-actions">
        ${h ? '<button class="btn danger-ghost" data-act="hb-del">Удалить</button>' : '<button class="btn" data-act="close-log">Отмена</button>'}
        <button class="btn primary" data-act="hb-save">${h ? 'Сохранить' : 'Начать'}</button>
      </div>
    </div>`;
  box.classList.add('open');
  if (!h) setTimeout(() => $('#hb-title')?.focus(), 50);
}

async function saveHabit() {
  const title = $('#hb-title').value.trim();
  if (!title) { toast('Напиши, какая привычка', true); return; }
  const days = Math.min(365, Math.max(1, Math.round(Number($('#hb-days').value) || 21)));
  const row = { title, days, icon: $('#hb-icons .on')?.dataset.v || 'flame', color: $('#hb-colors .on')?.dataset.v || CAT_COLORS[0] };
  const ed = S.hbEditing;
  const res = await safe(() => (ed ? db.updateHabit(ed.id, row) : db.addHabit(row)), ed ? 'Сохранено' : 'Поехали! День 1');
  if (!res) return;
  if (ed) Object.assign(ed, res); else S.habits.push(res);
  closeLog(); render();
}

async function toggleHabit(id, d) {
  const h = S.habits.find((x) => x.id === id); if (!h) return;
  const k = hKey(id, d); const on = !S.hchecks.has(k);
  const wasComplete = habitStats(h).complete;
  on ? S.hchecks.add(k) : S.hchecks.delete(k);
  render();
  if (on) {
    buzz(); playDone();
    if (!wasComplete && habitStats(h).complete) { celebrate(); toast(`«${h.title}» — пройдено целиком!`); }
  }
  try { await db.setHabitCheck(id, d, on); }
  catch (e) { on ? S.hchecks.delete(k) : S.hchecks.add(k); render(); toast('Не сохранилось — проверь интернет', true); }
}

let reloadTimer;
const reloadSoon = () => { clearTimeout(reloadTimer); reloadTimer = setTimeout(() => safe(reload), 300); };

// ---------- фильтры ----------
function visible(tasks) {
  return S.cat === 'all' ? tasks : tasks.filter((t) => t.category_id === S.cat);
}

function sortByTime(a, b) {
  if (a.status === 'done' && b.status !== 'done') return 1;
  if (b.status === 'done' && a.status !== 'done') return -1;
  return (a.due_time || '99').localeCompare(b.due_time || '99');
}

// ---------- карточка задачи ----------
function taskRow(t, { showDate = false, board = false, ghost = false } = {}) {
  const c = catById(t.category_id);
  const td = today();
  const overdue = isActive(t) && t.due_date && (t.due_date < td || (t.due_date === td && t.due_time && shortTime(t.due_time) < nowHM()));
  // единый статус-чип: одна форма, разный цвет
  const st = t.status === 'done' ? ['done', 'Выполнено']
    : S.rework?.has(t.id) ? ['rework', 'Доработка']
    : overdue ? ['overdue', 'Просрочено']
    : t.status === 'in_progress' ? ['progress', 'В процессе']
    : t.status === 'paused' ? ['paused', 'Пауза'] : null;
  // на доске колонка уже говорит статус — оставляем только флаги «Просрочено» и «Доработка»
  const stShow = board && st && !['rework', 'overdue'].includes(st[0]) ? null : st;
  const info = [];
  if (showDate && t.due_date) info.push(humanDate(t.due_date, td));
  if (t.due_time) info.push(`${I('clock', 'sm')}${shortTime(t.due_time)}`);
  if (t.repeat) info.push(`${I('repeat', 'sm')}${repeatLabel(t.repeat)}`);
  if (t.remind_before_min != null && t.due_time) info.push(I('bell', 'sm'));
  if (t.notes) info.push(I('note', 'sm'));
  return `
    <div class="task ${ghost ? 'ghost' : `${t.status} ${overdue ? 'overdue' : ''}`}" data-id="${t.id}" ${ghost ? '' : 'draggable="true"'}>
      <div class="task-top" data-act="open">
        <span class="task-cat">${c ? `${plate(c, 'xs')}<span class="tc-name">${esc(c.name)}</span>` : 'Без категории'}</span>
        ${ghost ? '<span class="status s-ghost">Повтор</span>' : stShow ? `<span class="status s-${stShow[0]}">${stShow[1]}</span>` : ''}
      </div>
      <div class="task-main">
        ${ghost ? `<span class="check ghost-ic" data-act="open">${I('repeat', 'sm')}</span>` : `<button class="check" data-act="toggle" aria-label="Готово">${t.status === 'paused' ? I('pause') : ''}</button>`}
        <div class="task-title" data-act="open">${esc(t.title)}</div>
        ${info.length ? `<div class="task-meta" data-act="open">${info.map((m) => `<span class="mi">${m}</span>`).join('')}</div>` : ''}
      </div>
    </div>`;
}

function section(title, tasks, opts = {}) {
  const evs = opts.events || [];
  if (!tasks.length && !evs.length && !opts.always) return '';
  return `
    <section class="group">
      <h3>${title}${tasks.length ? ` <span class="count">${tasks.filter(isActive).length || ''}</span>` : ''}</h3>
      ${(evs.length ? dayRows(tasks, evs, opts) : tasks.map((t) => taskRow(t, opts)).join('')) || `<div class="empty">${opts.empty || 'Пусто'}</div>`}
    </section>`;
}

// ---------- экраны ----------
function viewToday() {
  const td = today();
  const all = visible(S.tasks);
  const overdue = all.filter((t) => isActive(t) && t.due_date && t.due_date < td);
  const todays = all.filter((t) => t.due_date === td && t.status !== 'paused').sort(sortByTime);
  const inbox = all.filter((t) => !t.due_date && isActive(t));
  const paused = all.filter((t) => t.status === 'paused');
  const doneCount = all.filter((t) => t.status === 'done').length;
  const d = new Date();
  return `
    <div class="day-head">
      <div>
        <div class="big">${DOW_FULL[isoDow(td) - 1]}</div>
        <div class="sub">${d.getDate()} ${d.toLocaleString('ru', { month: 'long' }).replace('ь', 'я').replace('й', 'я')}</div>
      </div>
      ${progressRing()}
    </div>
    ${habitStrip()}
    ${section(`${I('alert', 'sm')} Просрочено`, overdue, { showDate: true })}
    ${section('Сегодня', todays, { always: true, empty: 'На сегодня ничего — красота', events: eventsOn(td) })}
    ${section(`${I('inbox', 'sm')} Без даты`, inbox)}
    ${section(`${I('pause', 'sm')} На паузе`, paused, { showDate: true })}
    ${doneCount ? `<button class="link-btn" data-act="archive">Убрать выполненные (${doneCount})</button>` : ''}`;
}

// прогресс дня: выполнено из запланированного на сегодня
function dayProgress() {
  const td = today();
  const list = S.tasks.filter((t) => t.due_date === td && ['todo', 'in_progress', 'done'].includes(t.status));
  const done = list.filter((t) => t.status === 'done').length;
  return { done, total: list.length };
}
function progressRing() {
  const { done, total } = dayProgress();
  if (!total) return '';
  const pct = done / total;
  const C = 2 * Math.PI * 26;
  return `
    <div class="ring ${pct === 1 ? 'full' : ''}" title="Выполнено ${done} из ${total}">
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f0a07a"/><stop offset=".55" stop-color="#eb9bad"/><stop offset="1" stop-color="#c9b9ef"/></linearGradient></defs>
        <circle cx="32" cy="32" r="26" class="ring-bg"/>
        <circle cx="32" cy="32" r="26" class="ring-fg" style="stroke-dasharray:${C};stroke-dashoffset:${C * (1 - pct)}"/>
      </svg>
      <div class="ring-txt">${pct === 1 ? I('check', 'big') : `<b>${done}<small>/${total}</small></b>`}</div>
    </div>`;
}

function viewWeek() {
  const td = today();
  const all = visible(S.tasks);
  let html = section(`${I('alert', 'sm')} Просрочено`, all.filter((t) => isActive(t) && t.due_date && t.due_date < td), { showDate: true });
  for (let i = 0; i < 14; i++) {
    const day = addDays(td, i);
    const list = all.filter((t) => t.due_date === day).sort(sortByTime);
    const label = i < 2 ? humanDate(day, td) : humanDate(day, td);
    html += `
      <section class="group day ${isoDow(day) >= 6 ? 'weekend' : ''}">
        <h3>${label[0].toUpperCase() + label.slice(1)} <button class="add-day" data-act="add-on" data-date="${day}" aria-label="Добавить">${I('plus')}</button></h3>
        ${dayRows(list, eventsOn(day), {}, ghostsOn(day)) || '<div class="empty small">—</div>'}
      </section>`;
  }
  const later = all.filter((t) => t.due_date && t.due_date > addDays(td, 13) && isActive(t));
  html += section('Позже', later, { showDate: true });
  return html;
}

function viewBoard() {
  const all = visible(S.tasks);
  const col = (st) => {
    const list = all.filter((t) => t.status === st)
      .sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999') || sortByTime(a, b));
    return `
      <div class="col" data-status="${st}">
        <h3>${BOARD[st]} <span class="count">${list.length}</span></h3>
        <div class="col-list">${list.map((t) => taskRow(t, { showDate: true, board: true })).join('') || '<div class="empty small">Перетащи сюда</div>'}</div>
        ${st === 'done' && list.length ? '<button class="link-btn" data-act="archive">Убрать выполненные</button>' : ''}
      </div>`;
  };
  return `<div class="board">${col('todo')}${col('in_progress')}${col('paused')}${col('done')}</div>`;
}

function viewArchive() {
  const list = visible(S.archivedTasks || []);
  return `<section class="group"><h3>Архив (${list.length})</h3>${list.map((t) => `<div class="group"><strong>${esc(t.title)}</strong>${t.notes ? `<p>${esc(t.notes)}</p>` : ''}${t.due_date ? `<p>${esc(t.due_date)}</p>` : ''}<button class="link-btn" data-act="restore-task" data-id="${esc(t.id)}">Вернуть в задачи</button></div>`).join('') || '<div class="empty small">Архив пуст</div>'}</section>`;
}

function viewSettings() {
  const s = S.settings || {};
  const host = location.host;
  const calHttps = `https://${host}/api/calendar?token=${s.calendar_token}`;
  const calWebcal = `webcal://${host}/api/calendar?token=${s.calendar_token}`;
  const initials = (s.display_name || 'Я').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const left = s.weight_kg && s.goal_weight_kg ? Math.round((s.weight_kg - s.goal_weight_kg) * 10) / 10 : null;
  return `
    <div class="settings">
      <section class="card profile">
        <div class="pf-head">
          <button type="button" class="avatar" data-act="avatar" aria-label="Загрузить фото">${s.avatar ? `<img src="${s.avatar}" alt="">` : esc(initials)}<span class="avatar-add">${I('plus')}</span></button>
          <div class="pf-name">
            <input class="pf-name-in" data-prof="display_name" value="${esc(s.display_name || '')}" placeholder="Как тебя зовут?">
            <div class="pf-sub">${left == null ? 'Заполни данные — пригодятся для норм и графиков' : left > 0 ? `до цели −${String(left).replace('.', ',')} кг` : left < 0 ? `до цели +${String(-left).replace('.', ',')} кг` : 'цель достигнута'}</div>
          </div>
        </div>
        <div class="pf-grid">
          ${[['age', 'Возраст', 'лет'], ['height_cm', 'Рост', 'см'], ['weight_kg', 'Вес', 'кг'], ['goal_weight_kg', 'Цель', 'кг']]
            .map(([k, l, u]) => `<label class="pf-f"><span>${l}</span><div><input type="number" inputmode="decimal" step="any" data-step="${{ age: 1, height_cm: 1, weight_kg: 0.5, goal_weight_kg: 0.5 }[k]}" data-start="${{ age: 30, height_cm: 165, weight_kg: 60, goal_weight_kg: 58 }[k]}" data-prof="${k}" value="${s[k] ?? ''}" placeholder="—"><em>${u}</em></div></label>`).join('')}
        </div>
      </section>
      <section class="card">
        <h3>${I('telegram')} Напоминания в Telegram</h3>
        ${s.telegram_chat_id
          ? '<p class="ok">Подключено ✓ Бот напомнит о задачах и пришлёт план на утро.</p>'
          : `<p>Нажми кнопку — откроется бот, нажми там «Start».</p>
             <a class="btn primary" href="https://t.me/${BOT_USERNAME}?start=${s.telegram_link_code}" target="_blank" rel="noopener">${I('telegram')} Подключить Telegram</a>
             <button class="link-btn" data-act="refresh">Я нажала Start — проверить</button>`}
        <label class="row">Утренний план
          <input type="time" id="digest" class="goal-in" value="${shortTime(s.digest_time) || '08:30'}">
        </label>
      </section>

      <section class="card">
        <div class="card-head sound-head">
          <h3>${I('sound')} Звук</h3>
          <button class="switch ${isSoundOn() ? 'on' : ''}" data-act="sound" aria-label="Звук"></button>
        </div>
        <p class="muted small">При выполнении задачи</p>
      </section>

      <section class="card">
        <h3>${I('heart')} Цели на день</h3>
        ${[['kcal_goal', 'Еда, ккал', 1800], ['water_goal', 'Вода, мл', 2000], ['move_goal', 'Подвижность, ккал', 750], ['exercise_goal', 'Упражнения, мин', 30], ['stand_goal', 'Стоя, часов', 12], ['steps_goal', 'Шаги', 8000]]
          .map(([k, l, d]) => `<label class="row">${l}<input type="number" class="goal-in" data-goal="${k}" data-step="${{ kcal_goal: 50, water_goal: 250, move_goal: 10, exercise_goal: 5, stand_goal: 1, steps_goal: 500 }[k] || 1}" value="${s[k] ?? d}"></label>`).join('')}
        <p class="muted small">Данные с Apple Watch приходят через команду в приложении «Команды» на iPhone — она запускается сама несколько раз в день.</p>
      </section>

      <section class="card">
        <h3>${I('calendar')} Календарь</h3>
        <p>Задачи с датами появятся в Календаре на iPhone, iPad и Mac и будут обновляться сами.</p>
        <a class="btn primary" href="${calWebcal}">Добавить в Календарь Apple</a>
        <button class="btn" data-act="copy" data-text="${calHttps}">Ссылка для Google</button>
      </section>

      <section class="card feeds-card">
        <h3>${I('calendar')} События из календарей</h3>
        <p>Встречи из Google и iCloud появятся в «Сегодня» и «Неделе». Любую можно превратить в задачу. Только просмотр — сами календари планер не меняет.</p>
        ${S.feeds.length ? `<div class="feeds">${S.feeds.map((f) => {
          const err = S.evErrors.find((x) => x.feed_id === f.id);
          let host = ''; try { host = new URL(f.url.replace(/^webcals?:/i, 'https:')).hostname.replace(/^p\d+-caldav\./, ''); } catch {}
          return `
          <div class="feed-row" data-id="${f.id}">
            <span class="ev-dot big" style="background:${fixColor(f.color) || '#c973de'}"></span>
            <div class="feed-txt"><div class="feed-name">${esc(f.name)}</div><div class="feed-host ${err || S.evApiError ? 'err' : ''}">${err ? esc(err.error) : S.evApiError ? 'Ошибка: ' + esc(S.evApiError) : `${esc(host)} · событий на 2 недели: ${S.events.filter((e) => e.feed_id === f.id).length}`}</div></div>
            <button class="icon-btn" data-act="feed-del" data-id="${f.id}" title="Отключить">${I('x')}</button>
          </div>`;
        }).join('')}</div>` : ''}
        ${`
        <div class="feed-add">
          <input id="feed-name" placeholder="Название, например: Работа" maxlength="40">
          <input id="feed-url" class="path-in" placeholder="Ссылка iCal (https:// или webcal://)" inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false">
          <button class="btn" data-act="feed-add">${I('plus')}Календарь</button>
        </div>
        <details class="feed-help">
          <summary>Где взять ссылку</summary>
          <p><b>Google:</b> calendar.google.com на компьютере → шестерёнка → «Настройки» → слева выбери календарь → «Интеграция календаря» → «Секретный адрес в формате iCal» → скопировать.</p>
          <p><b>iCloud:</b> Календарь на iPhone → «Календари» → «i» рядом с календарём → включи «Публичный календарь» → «Поделиться ссылкой» → «Скопировать».</p>
        </details>`}
      </section>

      <section class="card">
        <h3>${I('tag')} Категории</h3>
        <div class="cats-edit">
          ${S.cats.map((c) => `
            <div class="cat-row" data-id="${c.id}">
              <button class="plate-btn" data-act="cat-style" title="Иконка и цвет">${plate(c)}</button>
              <input class="name-in" value="${esc(c.name)}" data-field="name">
              <button class="icon-btn" data-act="del-cat" title="Удалить">${I('x')}</button>
            </div>`).join('')}
        </div>
        <button class="btn" data-act="add-cat">${I('plus')}Категория</button>
      </section>

      <section class="card info-card">
        <h3>${I('phone')} Поставить как приложение</h3>
        <p><b>iPhone / iPad:</b> открой этот сайт в Safari → кнопка «Поделиться» → «На экран Домой».</p>
        <p><b>Mac:</b> Safari → меню «Файл» → «Добавить в Dock». В Chrome/Яндексе — значок установки в адресной строке.</p>
      </section>

      <section class="card info-card">
        <h3>${I('keyboard')} Быстрый ввод</h3>
        <p>Пиши как есть — дату и время я пойму сам:</p>
        <ul class="hints">
          <li><code>завтра 19:00 тренировка</code></li>
          <li><code>пт в 10:30 урок 5 #учёба</code></li>
          <li><code>каждый пн ср пт 19:00 бассейн</code></li>
          <li><code>по будням 9:00 зарядка</code></li>
          <li><code>12.10 записаться к врачу</code></li>
        </ul>
        <p>То же самое можно просто написать боту в Telegram.</p>
      </section>

      <button class="btn danger-ghost text-btn" data-act="logout">Выйти</button>
    </div>`;
}

// ---------- окно редактирования ----------
function sheet(t) {
  const r = t.repeat;
  const repKind = !r ? 'none' : r.freq === 'daily' ? 'daily' : r.freq === 'monthly' ? 'monthly' : 'weekly';
  const days = r?.days || [];
  return `
    <div class="sheet-bg" data-act="close"></div>
    <div class="sheet" role="dialog">
      <div class="sheet-top"><div class="sheet-handle"></div><button class="close-x" data-act="close" aria-label="Закрыть">${I('x')}</button></div>
      <label class="first">Задача</label>
      <textarea id="f-text" class="task-text" rows="2" placeholder="Что сделать? Подробности и ссылки — с новой строки">${esc([t.title, t.notes].filter(Boolean).join('\n'))}</textarea>

      <label>Статус</label>
      <div class="pick" id="f-status">
        ${[['todo', 'Запланировано', 'todo'], ['in_progress', 'В процессе', 'progress'], ['done', 'Выполнено', 'done']].map(([k, v, cls]) => `<button data-v="${k}" class="status s-${cls} ${t.status === k ? 'on' : ''}">${v}</button>`).join('')}
      </div>

      <label>Категория</label>
      <div class="pick" id="f-cat">
        ${catChips(t.category_id)}
      </div>

      <div class="grid2">
        <div class="dp-wrap"><label>Дата</label>
          <input type="hidden" id="f-date" value="${t.due_date || ''}">
          <button type="button" class="date-btn" id="f-date-btn" data-act="dp-open"><span>${t.due_date ? fmtDateRu(t.due_date) : 'Без даты'}</span>${I('calendar')}</button>
          <div class="dp-pop" id="dp" hidden></div>
        </div>
        <div class="dp-wrap"><label>Время</label>
          <input type="hidden" id="f-time" value="${shortTime(t.due_time)}">
          <button type="button" class="date-btn" id="f-time-btn" data-act="tp-open"><span>${t.due_time ? shortTime(t.due_time) : 'Без времени'}</span>${I('clock')}</button>
          <div class="dp-pop tp-pop" id="tp" hidden></div>
        </div>
      </div>
      <div class="quick">
        <button data-q="hour">+1 час</button>
        <button data-q="evening">Вечером</button>
        <button data-q="tomorrow">Завтра</button>
        <button data-q="nodate">Без даты</button>
      </div>

      <div class="grid2">
        <label>Напомнить
          <select id="f-remind">
            ${REMIND.map(([v, l]) => `<option value="${v ?? ''}" ${(t.remind_before_min ?? null) === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </label>
        <label>Повтор
          <select id="f-repeat">
            <option value="none" ${repKind === 'none' ? 'selected' : ''}>Не повторять</option>
            <option value="daily" ${repKind === 'daily' ? 'selected' : ''}>Каждый день</option>
            <option value="weekly" ${repKind === 'weekly' ? 'selected' : ''}>Каждую неделю</option>
            <option value="monthly" ${repKind === 'monthly' ? 'selected' : ''}>Каждый месяц</option>
          </select>
        </label>
      </div>
      <div class="chips days ${repKind === 'weekly' ? '' : 'hidden'}" id="f-days">
        ${DOW_SHORT.map((d, i) => `<button data-v="${i + 1}" class="${days.includes(i + 1) ? 'on' : ''}">${d}</button>`).join('')}
      </div>

      ${t.id ? '<div id="task-logs" class="task-logs"><div class="muted small">Журнал…</div></div>' : ''}
      ${t.id ? `
      <div class="task-actions">
        ${t.status === 'paused'
          ? `<button data-act="resume">${I('play')} Возобновить</button>`
          : `<button data-act="pause">${I('pause')} На паузу</button>`}
        <button data-act="cancel">${I('x')} Снять задачу</button>
        <button data-act="delete" class="danger">${I('trash')} Удалить</button>
      </div>` : ''}
      <div class="sheet-actions">
        <button class="btn" data-act="close">Отмена</button>
        <button class="btn primary" data-act="save">${t.id ? 'Сохранить' : 'Добавить'}</button>
      </div>
    </div>`;
}

function catChips(sel) {
  return S.cats.map((c) => `<button data-v="${c.id}" class="cat-chip ${sel === c.id ? 'on' : ''}" style="${pcVars(c.color)}">${I(catIcon(c))}<span>${esc(c.name)}</span><span class="chip-x" data-act="cat-del" data-id="${c.id}" role="button" aria-label="Удалить категорию">${I('x')}</span></button>`).join('')
    + `<button data-v="" class="cat-chip none ${!sel ? 'on' : ''}">Без категории</button>`
    + (S.cats.length < CAT_MAX ? `<button class="cat-chip add" data-act="cat-new">${I('plus')}Своя</button>` : '');
}

// панель «добавить категорию» прямо под категориями, без отдельного окна
function catAddPanel() {
  const have = new Set(S.cats.map((c) => c.name.trim().toLowerCase()));
  const left = CAT_MAX - S.cats.length;
  const sugg = CAT_PRESETS.filter(([n]) => !have.has(n.toLowerCase()));
  return `
    <div class="cat-add" id="cat-add">
      ${sugg.length ? `<div class="cat-sugg">${sugg.map(([n, ic]) => `<button class="sugg" data-act="cat-preset" data-name="${n}" data-icon="${ic}">${I(ic)}${n}</button>`).join('')}</div>` : ''}
      <div class="cat-own">
        <input class="plain-in" id="cat-own-in" placeholder="Или своё название" maxlength="24" autocomplete="off">
        <button class="own-go" data-act="cat-own" aria-label="Добавить">${I('plus')}</button>
      </div>
      <p class="cat-limit">Можно добавить ещё ${left}. Иконку и цвет потом поменяешь в профиле.</p>
    </div>`;
}
function toggleCatAdd(force) {
  const cur = $('#cat-add');
  if (cur && force !== true) { cur.remove(); return; }
  if (cur) cur.remove();
  const anchor = $('#f-cat') || $('.cats-edit');
  if (!anchor) return;
  anchor.insertAdjacentHTML('afterend', catAddPanel());
  $('#cat-own-in')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('[data-act=cat-own]')?.click(); } });
}

// удалить категорию с возможностью вернуть (5 секунд)
function removeCat(id) {
  const i = S.cats.findIndex((c) => c.id === id);
  if (i < 0) return;
  const [c] = S.cats.splice(i, 1);
  const pick = $('#f-cat');
  const sel = pick?.querySelector('.on')?.dataset.v;
  const redraw = (selId) => { if (pick) pick.innerHTML = catChips(selId); else render(); };
  redraw(sel === id ? '' : sel);
  const timer = setTimeout(() => safe(() => db.deleteCategory(id)), 5000);
  toast(`«${c.name}» удалена`, false, {
    label: 'Вернуть',
    fn: () => { clearTimeout(timer); S.cats.splice(i, 0, c); redraw(pick?.querySelector('.on')?.dataset.v || (sel === id ? id : sel)); },
  });
}

function nextCatColor() {
  const used = new Set(S.cats.map((c) => c.color));
  return CAT_COLORS.find((c) => !used.has(c)) || CAT_COLORS[S.cats.length % CAT_COLORS.length];
}
async function addCat(name, icon) {
  name = name.trim();
  if (!name) return null;
  if (S.cats.some((c) => c.name.trim().toLowerCase() === name.toLowerCase())) { toast('Такая категория уже есть', true); return null; }
  if (S.cats.length >= CAT_MAX) { toast(`Максимум ${CAT_MAX} категорий`, true); return null; }
  const row = await safe(() => db.addCategory({ name, emoji: icon, color: nextCatColor(), sort: S.cats.length + 1 }));
  if (!row) return null;
  if (!S.cats.some((c) => c.id === row.id)) S.cats.push(row);
  // если открыта задача — сразу выбрать новую категорию, не трогая остальные поля
  const pick = $('#f-cat');
  if (pick) pick.innerHTML = catChips(row.id);
  else render();
  $('#cat-add')?.remove();
  toast(`Категория «${row.name}» добавлена`);
  return row;
}

function openSheet(t) {
  S.editing = { ...t };
  const box = $('#sheet');
  box.innerHTML = sheet(S.editing);
  box.classList.add('open');
  if (!t.id) setTimeout(() => $('#f-text')?.focus(), 50);
  else fillTaskLogs(t.id);
}
function closeSheet() {
  S.editing = null;
  $('#sheet').classList.remove('open');
  $('#sheet').innerHTML = '';
}

function readSheet() {
  const box = $('#sheet');
  const on = (id) => box.querySelector(`#${id} .on`)?.dataset.v;
  const rep = $('#f-repeat').value;
  let repeat = null;
  if (rep === 'daily') repeat = { freq: 'daily' };
  if (rep === 'monthly') repeat = { freq: 'monthly' };
  if (rep === 'weekly') {
    const days = [...box.querySelectorAll('#f-days .on')].map((b) => Number(b.dataset.v));
    repeat = days.length ? { freq: 'weekly', days } : null;
  }
  const remind = $('#f-remind').value;
  let due_date = $('#f-date').value || null;
  if (repeat && !due_date) due_date = today();
  // одно поле: первая строка — название задачи, всё ниже — подробности
  const lines = $('#f-text').value.replace(/\r/g, '').split('\n');
  while (lines.length && !lines[0].trim()) lines.shift();
  const first = (lines.shift() || '').trim();
  const title = first.slice(0, 140);
  const notes = [first.slice(140), ...lines].join('\n').trim();
  return {
    title,
    notes: notes || null,
    status: on('f-status') || (S.editing?.status === 'paused' ? 'paused' : 'todo'),
    category_id: on('f-cat') || null,
    due_date,
    due_time: $('#f-time').value || null,
    remind_before_min: remind === '' ? null : Number(remind),
    repeat,
  };
}

// ---------- действия ----------
async function setStatus(id, status) {
  const t = S.tasks.find((x) => x.id === id);
  if (!t || t.status === status) return;
  t.status = status; render(); // сразу, не дожидаясь сервера
  await safe(() => db.updateTask(id, { status }), status === 'done' ? (t.repeat ? 'Готово ✓ Следующий раз уже в плане' : 'Готово ✓') : null);
  reloadSoon();
}

async function quickAdd(text) {
  const p = parseQuick(text, today(), S.cats, nowHM());
  if (!p.title) return;
  if (!p.category_id && S.cat !== 'all') p.category_id = S.cat;
  const task = { ...p, remind_before_min: p.due_time ? 0 : null };
  const created = await safe(() => db.addTask(task));
  if (created) {
    S.tasks.push(created); render();
    toast(`Добавлено${p.due_date ? ' на ' + humanDate(p.due_date, today()) : ''}${p.due_time ? ' в ' + p.due_time : ''}`);
  }
}

// ---------- журнал работы и итоги ----------
const AUTHORS = {
  me: { name: 'Я', cls: 'a-me' },
  claude: { name: 'Claude', cls: 'a-claude' },
  codex: { name: 'Codex', cls: 'a-codex' },
};
const authorOf = (a) => AUTHORS[a] || { name: a, cls: 'a-other' };
// запись может быть совместной: author = 'me+claude' — время в итогах делится поровну между участниками
const authorsIn = (a) => { const x = String(a || 'me').split('+').filter(Boolean); return x.length ? x : ['me']; };
function addBy(by, author, minutes) { const who = authorsIn(author); for (const w of who) by[w] = (by[w] || 0) + minutes / who.length; }
const AORDER = (a) => { const i = Object.keys(AUTHORS).indexOf(a); return i < 0 ? 99 : i; };
const sortedBy = (by) => Object.entries(by).sort((x, y) => AORDER(x[0]) - AORDER(y[0]));
const RESULT = {
  done: { icon: 'check', label: 'Готово' },
  needs_work: { icon: 'wrench', label: 'Нужна доработка', short: 'Доработка' },
  progress: { icon: 'hourglass', label: 'В процессе' },
};
function fmtMin(m) {
  m = Math.round(m || 0);
  if (m < 60) return `${m} мин`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} ч ${r} мин` : `${h} ч`;
}
const linkify = (s) => /^https?:\/\//.test(s)
  ? `<a href="${esc(s)}" target="_blank" rel="noopener">${esc(s.replace(/^https?:\/\//, '').slice(0, 48))}</a>`
  : `<code>${esc(s)}</code>`;

S.report = { range: load('range', 'today'), logs: [], done: [], loading: false };

function reportRange(range) {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + 1);
  if (range === 'yesterday') { start.setDate(start.getDate() - 1); end.setDate(end.getDate() - 1); }
  if (range === 'week') start.setDate(start.getDate() - 6);
  if (range === 'month') start.setDate(start.getDate() - 29);
  return { from: start, to: end };
}

async function loadReport() {
  const { from, to } = reportRange(S.report.range);
  S.report.loading = true;
  const [logs, done] = await Promise.all([db.logs(from.toISOString(), to.toISOString()), db.doneTasks(from.toISOString(), to.toISOString())]);
  Object.assign(S.report, { logs, done, loading: false });
  if (S.view === 'report') render();
}

const taskTitle = (id) => S.tasks.find((t) => t.id === id)?.title || S.report.done.find((t) => t.id === id)?.title || S.logTitles?.[id] || 'Без задачи';

// полоска из сегментов по авторам
function stackBar(byAuthor, total, max, { tall = false } = {}) {
  const segs = sortedBy(byAuthor).filter(([, m]) => m > 0);
  return `<div class="stack ${tall ? 'tall' : ''}" style="width:${Math.max(4, (total / max) * 100)}%">
    ${segs.map(([a, m]) => `<span class="sg ${authorOf(a).cls}" style="flex:${m}" data-tip="${esc(authorOf(a).name)}: ${fmtMin(m)}"></span>`).join('')}
  </div>`;
}

function viewReport() {
  const R = S.report;
  const ranges = [['today', 'Сегодня'], ['yesterday', 'Вчера'], ['week', '7 дней'], ['month', '30 дней']];
  // задачи «В процессе» прямо сейчас: их время считаем вживую, запись в журнал появится, когда сменишь статус
  const { from: rFrom, to: rTo } = reportRange(R.range);
  const now = new Date();
  const live = now < rTo ? S.tasks.filter((t) => t.status === 'in_progress' && t.started_at).map((t) => {
    const start = Math.max(new Date(t.started_at).getTime(), rFrom.getTime());
    return { task_id: t.id, author: 'me', minutes: Math.max(0, Math.min(720, Math.round((now - start) / 60000))), logged_at: now.toISOString(), result: 'progress', live: true };
  }).filter((l) => l.minutes > 0) : [];
  const logs = [...R.logs, ...live];
  const total = logs.reduce((s, l) => s + l.minutes, 0);
  const byAuthor = {};
  const byTask = {};
  for (const l of logs) {
    addBy(byAuthor, l.author, l.minutes);
    const k = l.task_id || '_none';
    (byTask[k] ||= { total: 0, by: {} });
    byTask[k].total += l.minutes;
    addBy(byTask[k].by, l.author, l.minutes);
  }
  const needsWork = logs.filter((l) => l.result === 'needs_work');
  const authorsSorted = Object.keys(byAuthor).sort((a, b) => Object.keys(AUTHORS).indexOf(a) - Object.keys(AUTHORS).indexOf(b));

  const tasksRows = Object.entries(byTask).sort((a, b) => b[1].total - a[1].total);
  const maxTask = tasksRows[0]?.[1].total || 1;

  // по дням (для недели/месяца)
  let daysHtml = '';
  if (R.range === 'week' || R.range === 'month') {
    const { from } = reportRange(R.range);
    const n = R.range === 'week' ? 7 : 30;
    const days = [];
    for (let i = 0; i < n; i++) {
      const d = new Date(from); d.setDate(d.getDate() + i);
      const key = ymd(d);
      const by = {};
      let tot = 0;
      for (const l of logs) if (ymd(new Date(l.logged_at)) === key) { addBy(by, l.author, l.minutes); tot += l.minutes; }
      days.push({ key, d, by, tot });
    }
    const td = today();
    const MON = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
    // за 30 дней — группируем по календарным неделям (пн–вс), за 7 — по дням
    let bins;
    if (n > 7) {
      bins = [];
      for (const x of days) {
        const last = bins[bins.length - 1];
        if (!last || isoDow(x.key) === 1) bins.push({ first: x, lastDay: x, by: {}, tot: 0, today: false });
        const b = bins[bins.length - 1];
        b.lastDay = x; b.tot += x.tot; if (x.key === td) b.today = true;
        for (const [a, m] of Object.entries(x.by)) b.by[a] = (b.by[a] || 0) + m;
      }
      bins = bins.map((b) => {
        const a = b.first.d, z = b.lastDay.d;
        const label = a.getMonth() === z.getMonth()
          ? `${a.getDate()}–${z.getDate()} ${MON[z.getMonth()]}`
          : `${a.getDate()} ${MON[a.getMonth()]} – ${z.getDate()} ${MON[z.getMonth()]}`;
        return { label, tip: label, by: b.by, tot: b.tot, today: b.today };
      });
    } else {
      bins = days.map((x) => ({ label: DOW_SHORT[isoDow(x.key) - 1], tip: humanDate(x.key, td), by: x.by, tot: x.tot, today: x.key === td }));
    }
    const maxBin = Math.max(1, ...bins.map((b) => b.tot));
    daysHtml = `
      <section class="card">
        <h3>${I('chart')} ${n > 7 ? 'По неделям' : 'По дням'}</h3>
        <div class="mb-title">${n > 7 ? 'Сколько часов работы за каждую неделю' : 'Сколько часов работы за каждый день'}</div>
        <div class="dbars ${n > 7 ? 'weeks' : ''}" style="--n:${bins.length}">
          <div class="db-plot">
            ${bins.map((b) => `
              <div class="db" data-tip="${b.tip}: ${b.tot ? fmtMin(b.tot) : 'нет записей'}">
                ${b.tot ? `<span class="db-val">${fmtMin(b.tot).replace(' мин', 'м').replace(' ч', 'ч')}</span>` : ''}
                <div class="db-bar" style="height:${b.tot ? Math.max(4, (b.tot / maxBin) * 78) : 0}%">
                  ${sortedBy(b.by).map(([a, m]) => `<span class="sg ${authorOf(a).cls}" style="flex:${m}"></span>`).join('')}
                </div>
              </div>`).join('')}
          </div>
          <div class="db-labels">${bins.map((b) => `<span class="${b.today ? 'today' : ''}">${b.label}</span>`).join('')}</div>
        </div>
        <div class="mb-legend">${Object.entries(AUTHORS).map(([k, a]) => `<span><i class="dot ${a.cls}"></i>${a.name}</span>`).join('')}</div>
      </section>`;
  }

  // журнал по дням
  const feedDays = {};
  for (const l of R.logs) (feedDays[ymd(new Date(l.logged_at))] ||= []).push(l);

  return `
    <div class="report">
      <nav class="filters">${ranges.map(([k, l]) => `<button data-range="${k}" class="${R.range === k ? 'on' : ''}">${l}</button>`).join('')}</nav>

      ${R.loading && !logs.length ? '<div class="empty">Загружаю…</div>' : ''}

      <div class="tiles">
        <div class="tile"><div class="num">${R.done.length}</div><div class="lbl">задач выполнено</div></div>
        <div class="tile"><div class="num">${total ? fmtMin(total).replace(' мин', 'м').replace(' ч', 'ч') : '—'}</div><div class="lbl">в работе</div></div>
        <div class="tile ${needsWork.length ? 'warn' : ''}"><div class="num">${needsWork.length}</div><div class="lbl">на доработку</div></div>
      </div>

      ${total ? `
      <section class="card">
        <h3>Кто сколько работал</h3>
        <div class="bar-full">${stackBar(byAuthor, total, total, { tall: true })}</div>
        <div class="legend">
          ${authorsSorted.map((a) => `<span class="lg-item"><i class="dot ${authorOf(a).cls}"></i><span class="lg-name">${esc(authorOf(a).name)}</span><b>${fmtMin(byAuthor[a])}</b><span class="lg-pct">${Math.round((byAuthor[a] / total) * 100)}%</span></span>`).join('')}
        </div>
      </section>

      ${daysHtml}

      <section class="card">
        <h3>Время по задачам</h3>
        <div class="hbars">
          ${tasksRows.slice(0, 12).map(([id, v]) => `
            <div class="hrow" ${id !== '_none' ? `data-act="open-task" data-task="${id}"` : ''}>
              <div class="hlbl"><span class="t">${esc(id === '_none' ? 'Без задачи' : taskTitle(id))}</span><span class="v">${fmtMin(v.total)}</span></div>
              <div class="htrack">${stackBar(v.by, v.total, maxTask)}</div>
            </div>`).join('')}
        </div>
      </section>` : `<div class="empty">За этот период записей о работе нет.<br><span class="muted">Нажми «В процессе» у задачи — время посчитается само. Или добавь запись в карточке задачи.</span></div>`}

      ${R.done.length ? `
      <section class="card">
        <h3>Выполнено</h3>
        ${R.done.map((t) => {
          const spent = logs.filter((l) => l.task_id === t.id).reduce((s, l) => s + l.minutes, 0);
          return `<div class="done-row" data-act="open-task" data-task="${t.id}"><span class="done-ic">${I('check')}</span><span class="done-t">${esc(t.title)}</span>${spent ? `<span class="done-v">${fmtMin(spent)}</span>` : ''}</div>`;
        }).join('')}
      </section>` : ''}

      ${logs.length ? `
      <section class="card">
        <h3>Журнал</h3>
        ${Object.entries(feedDays).map(([day, list]) => `
          <div class="feed-day">${humanDate(day, today())}</div>
          ${list.map(logCard).join('')}`).join('')}
      </section>` : ''}

      <button class="btn" data-act="new-log">+ Записать работу</button>
    </div>`;
}

function logCard(l, { withTask = true } = {}) {
  const who = authorsIn(l.author).map(authorOf);
  const a = { cls: who[0].cls, name: who.map((x) => x.name).join(' + ') };
  const r = RESULT[l.result] || RESULT.progress;
  const time = new Date(l.logged_at).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
  return `
    <div class="log" data-act="edit-log" data-log="${l.id}">
      <div class="log-head">
        <span class="who"><span class="dots">${who.map((x) => `<i class="dot ${x.cls}"></i>`).join('')}</span><span>${esc(a.name)}<span class="log-time">${time}${l.minutes ? ' · ' + fmtMin(l.minutes) : ''}</span></span></span>
        <span class="status s-${l.result === 'done' ? 'done' : l.result === 'needs_work' ? 'overdue' : 'progress'}">${r.label}</span>
      </div>
      ${withTask && l.task_id ? `<div class="log-task">${esc(taskTitle(l.task_id))}</div>` : ''}
      ${l.summary ? `<div class="log-sum">${esc(l.summary).replace(/\n/g, '<br>')}</div>` : ''}
      ${l.location ? `<div class="log-loc">${I('folder', 'sm')}<span>${linkify(l.location)}</span></div>` : ''}
    </div>`;
}

// журнал внутри карточки задачи
function updateTaskTimer() {
  const box = $('#task-timer');
  const task = S.editing;
  if (!box || !task) return;
  const running = task.status === 'in_progress' && task.started_at;
  const seconds = running ? Math.max(0, Math.floor((Date.now() - new Date(task.started_at).getTime()) / 1000)) : 0;
  const saved = (S.taskLogs || []).filter((l) => l.task_id === task.id).reduce((sum, l) => sum + (Number(l.minutes) || 0), 0);
  const clock = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map((n) => String(n).padStart(2, '0')).join(':');
  box.innerHTML = `<div>Сейчас работаю: <strong>${clock}</strong>${task.status === 'paused' ? ' · На паузе' : ''}</div><div>Всего потрачено: <strong>${fmtMin(saved + Math.floor(seconds / 60))}</strong></div>`;
}

async function fillTaskLogs(taskId) {
  const box = $('#task-logs');
  if (!box) return;
  const logs = await safe(() => db.logsForTask(taskId)) || [];
  if (S.editing?.id !== taskId || $('#task-logs') !== box) return;
  S.taskLogs = logs;
  const total = logs.reduce((s, l) => s + l.minutes, 0);
  if (!$('#task-logs')) return;
  $('#task-logs').innerHTML = `
    <div class="tl-head"><b>Журнал работы</b>${total ? `<span class="muted">всего ${fmtMin(total)}</span>` : ''}</div>
    <div id="task-timer" role="timer"></div>
    ${logs.map((l) => logCard(l, { withTask: false })).join('') || '<div class="muted small">Пока пусто. Сюда пишем, что сделано, сколько времени ушло и где лежит результат.</div>'}
    <button class="btn small" data-act="new-log" data-task="${taskId}">+ Записать работу</button>`;
  updateTaskTimer();
}

// окно записи о работе
function openLog(log) {
  S.logEditing = { author: 'me', minutes: 30, result: 'progress', ...log };
  const l = S.logEditing;
  const box = $('#logsheet');
  const taskOptions = S.tasks.filter((t) => t.status !== 'cancelled');
  box.innerHTML = `
    <div class="sheet-bg" data-act="close-log"></div>
    <div class="sheet">
      <div class="sheet-top"><div class="sheet-handle"></div><button class="close-x" data-act="close-log">${I('x')}</button></div>
      <h3 class="lg-title">${l.id ? 'Запись о работе' : 'Записать работу'}</h3>
      <label>Задача
        <select id="lg-task">
          <option value="">— без задачи —</option>
          ${taskOptions.map((t) => `<option value="${t.id}" ${l.task_id === t.id ? 'selected' : ''}>${esc(t.title)}</option>`).join('')}
        </select>
      </label>
      <div class="chips" id="lg-author" title="Можно выбрать несколько">
        ${Object.entries(AUTHORS).map(([k, a]) => `<button data-v="${k}" class="${authorsIn(l.author).includes(k) ? 'on' : ''}"><i class="dot ${a.cls}"></i> ${a.name}</button>`).join('')}
      </div>
      <p class="hint lg-hint">Работали вместе — отметь всех. Время в итогах поделится между вами поровну.</p>
      <label>Сколько времени (минут)
        <input type="number" id="lg-min" min="0" step="5" value="${l.minutes}">
      </label>
      <div class="quick">${[15, 30, 60, 90, 120, 180].map((m) => `<button data-min="${m}">${fmtMin(m)}</button>`).join('')}</div>
      <textarea id="lg-sum" rows="3" placeholder="Что сделали">${esc(l.summary || '')}</textarea>
      <input id="lg-loc" class="plain-in path-in" placeholder="Где лежит: папка или ссылка" value="${esc(l.location || '')}">
      <label>Итог</label>
      <div class="res-pick" id="lg-res">
        ${Object.entries(RESULT).map(([k, r]) => `<button data-v="${k}" class="rp rp-${k} ${l.result === k ? 'on' : ''}"><span class="rp-dot">${I(r.icon)}</span>${r.short || r.label}</button>`).join('')}
      </div>
      <div class="sheet-actions">
        ${l.id ? '<button class="btn danger-ghost" data-act="del-log">Удалить</button>' : '<button class="btn" data-act="close-log">Отмена</button>'}
        <button class="btn primary" data-act="save-log">Сохранить</button>
      </div>
    </div>`;
  box.classList.add('open');
}
function closeLog() { S.logEditing = null; S.foodEditing = null; $('#logsheet').classList.remove('open'); $('#logsheet').innerHTML = ''; }

async function saveLog() {
  const box = $('#logsheet');
  const on = (id) => box.querySelector(`#${id} .on`)?.dataset.v;
  const data = {
    task_id: $('#lg-task').value || null,
    author: [...box.querySelectorAll('#lg-author .on')].map((b) => b.dataset.v).join('+') || 'me',
    minutes: Math.max(0, Number($('#lg-min').value) || 0),
    summary: $('#lg-sum').value.trim() || null,
    location: $('#lg-loc').value.trim() || null,
    result: on('lg-res') || 'progress',
  };
  const ed = S.logEditing;
  const ok = ed.id ? await safe(() => db.updateLog(ed.id, data)) : await safe(() => db.addLog(data));
  if (!ok) return;
  // «Готово» — отмечаем задачу выполненной
  const t = S.tasks.find((x) => x.id === data.task_id);
  if (data.result === 'done' && t && t.status !== 'done') await safe(() => db.updateTask(t.id, { status: 'done' }));
  closeLog();
  toast(data.result === 'done' && t ? 'Записал ✓ Задача отмечена выполненной' : 'Записал ✓');
  if (S.editing?.id) fillTaskLogs(S.editing.id);
  reloadSoon();
  if (S.view === 'report') loadReport();
}

// всплывающая подсказка на графиках
document.addEventListener('pointerover', (e) => {
  const el = e.target.closest('[data-tip]');
  const tip = $('#tip');
  if (!el) { tip.classList.remove('show'); return; }
  tip.textContent = el.dataset.tip;
  const r = el.getBoundingClientRect();
  tip.style.left = Math.min(window.innerWidth - 12, Math.max(12, r.left + r.width / 2)) + 'px';
  tip.style.top = (r.top - 8) + 'px';
  tip.classList.add('show');
});
document.addEventListener('scroll', () => $('#tip')?.classList.remove('show'), true);


// ---------- здоровье ----------
S.health = { date: null, day: null, week: [], workouts: [], sleep: [], food: [], foodWeek: [], water: [], photos: {}, busy: false };

function dayIso(date) {
  const start = parseYmd(date);
  const end = parseYmd(addDays(date, 1));
  return [start.toISOString(), end.toISOString()];
}

async function loadHealth() {
  const H = S.health;
  H.date ||= today();
  const d = H.date;
  const [from, to] = dayIso(d);
  const weekFrom = addDays(d, -6);
  const [week, workouts, sleep, food, water, foodWeek] = await Promise.all([
    db.healthRange(weekFrom, d), db.workouts(d), db.sleep(d), db.food(from, to), db.water(from, to),
    db.food(dayIso(weekFrom)[0], to),
  ]);
  Object.assign(H, { week, day: week.find((x) => x.date === d) || null, workouts, sleep, food, water, foodWeek });
  const paths = food.map((f) => f.photo_path).filter((p) => p && !H.photos[p]);
  if (paths.length) Object.assign(H.photos, await db.photoUrls(paths).catch(() => ({})));
  if (S.view === 'health') render();
  maybeCelebrateRings();
}

function goals() {
  const s = S.settings || {};
  return { move: s.move_goal || 750, ex: s.exercise_goal || 30, stand: s.stand_goal || 12, kcal: s.kcal_goal || 1800, water: s.water_goal || 2000, steps: s.steps_goal || 8000 };
}

function activityRings(day) {
  const g = goals();
  const rings = [
    { k: 'move', v: day?.move_kcal || 0, goal: g.move, r: 44, label: 'Подвижность', unit: 'ккал' },
    { k: 'ex', v: day?.exercise_min || 0, goal: g.ex, r: 32, label: 'Упражнения', unit: 'мин' },
    { k: 'stand', v: day?.stand_hours || 0, goal: g.stand, r: 20, label: 'Стоя', unit: 'ч' },
  ];
  // «Команды» на части iOS не отдают упражнения и стойку — такие кольца остаются пустыми с прочерком
  rings.forEach((x) => { x.none = day?.[{ move: 'move_kcal', ex: 'exercise_min', stand: 'stand_hours' }[x.k]] == null; });
  return `
    <div class="rings">
      <svg viewBox="0 0 100 100" aria-hidden="true">
        ${rings.map((x) => {
          const C = 2 * Math.PI * x.r, p = Math.min(1, x.v / x.goal);
          return `<circle cx="50" cy="50" r="${x.r}" class="rg-bg rg-${x.k}"/>
                  <circle cx="50" cy="50" r="${x.r}" class="rg-fg rg-${x.k}" style="stroke-dasharray:${C};stroke-dashoffset:${C * (1 - p)}"/>`;
        }).join('')}
      </svg>
      <div class="ring-list">
        ${rings.map((x) => `
          <div class="ring-row rg-${x.k}">
            <div class="rr-lbl"><i class="rr-dot"></i>${x.label}</div>
            <div class="rr-val"><b class="num">${x.none ? '—' : Math.round(x.v)}</b><span>/ ${x.goal} ${x.unit}</span></div>
          </div>`).join('')}
      </div>
    </div>`;
}

function maybeCelebrateRings() {
  const H = S.health, d = H.day, g = goals();
  if (!d || H.date !== today()) return;
  if (d.move_kcal >= g.move && (d.exercise_min == null || d.exercise_min >= g.ex) && (d.stand_hours == null || d.stand_hours >= g.stand)) {
    const k = 'rings_' + H.date;
    if (!load(k, false)) { save(k, true); playDayDone(); celebrate(); toast('Все кольца закрыты!'); }
  }
}

// столбики недели; state(v) → 'low' | 'ok' | 'over' красит столбик
function miniBars(values, days, { goal = null, fmt = (v) => v, state = () => 'ok' } = {}) {
  const max = Math.max(goal || 0, ...values, 1) * 1.08;
  const td = today();
  return `
    <div class="minibars">
      <div class="mb-plot">
        ${goal ? `<div class="goal-line" style="bottom:${(goal / max) * 100}%"><span>${fmt(goal)}</span></div>` : ''}
        ${values.map((v, i) => `
          <div class="mb" data-tip="${humanDate(days[i], td)}: ${fmt(v)}">
            <div class="mb-bar ${v ? state(v) : 'none'}" style="height:${Math.max(v ? 3 : 0, (v / max) * 100)}%"></div>
          </div>`).join('')}
      </div>
      <div class="mb-labels">${days.map((x) => `<span class="${x === td ? 'today' : ''}">${DOW_SHORT[isoDow(x) - 1]}</span>`).join('')}</div>
    </div>`;
}

// иконка тренировки по типу, как в Apple Watch
function workoutIcon(type = '') {
  const t = type.toLowerCase();
  if (/пилатес|йог|растяж|stretch|yoga|pilates/.test(t)) return 'yoga';
  if (/ходьб|прогулк|walk/.test(t)) return 'walk';
  if (/бег|run/.test(t)) return 'run';
  if (/вело|cycl|bike/.test(t)) return 'bike';
  if (/плав|бассейн|swim/.test(t)) return 'swim';
  if (/сил|зал|strength|функц/.test(t)) return 'dumbbell';
  if (/танц|dance/.test(t)) return 'music';
  return 'bolt';
}

function workoutColor(type = '') {
  return { yoga: '#9b77ee', walk: '#4ed093', run: '#f8984f', bike: '#359ee9', swim: '#25b4d0', dumbbell: '#da62b6' }[workoutIcon(type)] || '#c973de';
}

function viewHealth() {
  const H = S.health, g = goals();
  const d = H.date || today();
  const day = H.day;
  const kcal = Math.round(H.food.reduce((a, f) => a + Number(f.kcal || 0), 0));
  const macro = (k) => Math.round(H.food.reduce((a, f) => a + Number(f[k] || 0), 0));
  const water = H.water.reduce((a, w) => a + w.ml, 0);
  const days = Array.from({ length: 7 }, (_, i) => addDays(d, i - 6));
  const dl = (x) => DOW_SHORT[isoDow(x) - 1];
  const stepsWeek = days.map((x) => H.week.find((w) => w.date === x)?.steps || 0);
  const kcalWeek = days.map((x) => { const [f, t] = dayIso(x); return Math.round(H.foodWeek.filter((r) => r.eaten_at >= f && r.eaten_at < t).reduce((a, r) => a + Number(r.kcal || 0), 0)); });
  const sleeps = (Array.isArray(H.sleep) ? H.sleep : (H.sleep ? [H.sleep] : [])).filter((x) => x.bed_at && x.wake_at);
  const slMins = (x) => Math.max(0, Math.round((new Date(x.wake_at) - new Date(x.bed_at)) / 60000));
  const slTotal = sleeps.reduce((a, x) => a + slMins(x), 0);
  const hm = (iso) => new Date(iso).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });

  return `
    <div class="health">
      <div class="date-nav">
        <button class="icon-btn" data-hday="-1" aria-label="Назад">${I('left')}</button>
        <div class="dn-title">${humanDate(d, today())[0].toUpperCase() + humanDate(d, today()).slice(1)}</div>
        <button class="icon-btn" data-hday="1" ${d >= today() ? 'disabled' : ''} aria-label="Вперёд">${I('right')}</button>
      </div>

      <section class="card">
        <h3>${I('bolt')} Активность</h3>
        ${activityRings(day)}
        <div class="tiles">
          <div class="tile"><div class="num">${day?.steps != null ? day.steps.toLocaleString('ru') : '—'}</div><div class="lbl">шагов</div></div>
          <div class="tile"><div class="num">${day?.distance_km != null ? Number(day.distance_km).toFixed(2).replace('.', ',') : '—'}</div><div class="lbl">км</div></div>
          <div class="tile"><div class="num">${day?.flights ?? '—'}</div><div class="lbl">пролётов</div></div>
        </div>
        ${H.workouts.length ? `<div class="workouts">${H.workouts.map((w) => `
          <div class="wk ${w.ext_id ? '' : 'wk-manual'}" ${w.ext_id ? '' : `data-act="wk-edit" data-wk="${w.id}"`}><span class="plate md" style="${pcVars(workoutColor(w.type))}">${I(workoutIcon(w.type))}</span><div class="wk-body"><div class="wk-t">${esc(w.type)}</div>
            <div class="wk-s">${[w.duration_min ? Math.round(w.duration_min) + ' мин' : '', w.kcal ? Math.round(w.kcal) + ' ккал' : '', w.distance_km ? Number(w.distance_km).toFixed(2).replace('.', ',') + ' км' : ''].filter(Boolean).map((x) => `<span>${x}</span>`).join('')}</div></div></div>`).join('')}</div>` : ''}
        <div class="wk-foot">
          <div class="muted small">${day ? 'С часов: обновлено в ' + hm(day.updated_at) : 'Данных с часов пока нет — настрой команду (в «Ещё»)'}</div>
          <button class="pill-add" data-act="wk-new">${I('plus')}Добавить</button>
        </div>
      </section>

      <section class="card">
        <div class="card-head"><h3>${I('food')} Еда</h3><span class="muted">${kcal} из ${g.kcal} ккал</span></div>
        <div class="meter ${kcal > g.kcal ? 'over' : ''}"><span style="width:${Math.min(100, (kcal / g.kcal) * 100)}%"></span></div>
        <div class="macros"><span>Белки <b>${macro('protein')} г</b></span><span>Жиры <b>${macro('fat')} г</b></span><span>Углеводы <b>${macro('carbs')} г</b></span></div>
        <div class="meals">
          ${H.food.length ? `<div class="meal meal-head"><span></span><span></span><span>ккал</span><span>Б</span><span>Ж</span><span>У</span></div>` : ''}
          ${H.food.map((f) => `
            <div class="meal" data-act="edit-food" data-food="${f.id}">
              <button type="button" class="meal-pic" data-act="meal-photo" data-food="${f.id}" aria-label="Сфотографировать блюдо">${f.photo_path && H.photos[f.photo_path] ? `<img src="${H.photos[f.photo_path]}" alt="">` : `<div class="meal-ph">${I('food')}</div>`}</button>
              <div class="meal-body"><div class="meal-t">${esc(f.title)}</div><div class="meal-s">${hm(f.eaten_at)}${f.note ? ' · ' + esc(f.note) : ''}</div></div>
              <b>${Math.round(f.kcal)}</b>
              <span>${f.protein ?? '—'}</span><span>${f.fat ?? '—'}</span><span>${f.carbs ?? '—'}</span>
            </div>`).join('') || '<p class="muted small">Пока ничего не записано. Нажми «Добавить» — можно сфоткать тарелку, описать словами или вписать калории вручную.</p>'}
        </div>
        <button class="pill-add pill-wide" data-act="food-new" ${H.busy ? 'disabled' : ''}>${I('plus')}Добавить</button>
        ${H.busy ? '<div class="muted small center">Нейросеть смотрит на тарелку…</div>' : ''}
      </section>

      <section class="card">
        <div class="card-head"><h3>${I('drop')} Вода</h3><span class="muted">${water} из ${g.water} мл</span></div>
        <div class="meter water"><span style="width:${Math.min(100, (water / g.water) * 100)}%"></span></div>
        <div class="row-btns">
          <button class="btn" data-water="250">+250 мл</button>
          <button class="btn" data-water="500">+500 мл</button>
          ${H.water.length ? '<button class="btn ghost" data-act="water-undo" title="Отменить последний">' + I('undo') + '</button>' : ''}
        </div>
      </section>

      <section class="card">
        <div class="card-head"><h3>${I('moon')} Сон</h3>${slTotal ? `<span class="muted small head-val">всего ${Math.floor(slTotal / 60)} ч ${slTotal % 60} мин</span>` : ''}</div>
        ${sleeps.length ? `<div class="workouts">${sleeps.map((x) => {
          const m = slMins(x); const nap = new Date(x.bed_at).getHours() >= 9 && new Date(x.bed_at).getHours() < 20;
          return `<div class="wk wk-manual" data-act="sleep-open" data-sl="${x.id}"><span class="plate md" style="${pcVars(nap ? '#c973de' : '#537bea')}">${I(nap ? 'sun' : 'moon')}</span><div class="wk-body"><div class="wk-t">${nap ? 'Дневной сон' : 'Ночной сон'} · ${Math.floor(m / 60) ? Math.floor(m / 60) + ' ч ' : ''}${m % 60} мин</div>
            <div class="wk-s"><span>${hm(x.bed_at)} → ${hm(x.wake_at)}</span>${x.quality ? `<span class="stars">${'★'.repeat(x.quality)}${'☆'.repeat(5 - x.quality)}</span>` : ''}</div></div></div>`;
        }).join('')}</div>` : '<p class="muted small">Сон пока не записан.</p>'}
        <button class="pill-add pill-wide" data-act="sleep-open">${I('plus')}Добавить</button>
      </section>

      <section class="card">
        <h3>${I('chart')} Неделя</h3>
        <div class="mb-title">Шаги · цель ${g.steps.toLocaleString('ru')}</div>
        ${miniBars(stepsWeek, days, { goal: g.steps, fmt: (v) => v.toLocaleString('ru'), state: (v) => (v >= g.steps ? 'ok' : 'over') })}
        <div class="mb-legend"><span><i class="ok"></i>цель есть</span><span><i class="over"></i>меньше цели</span></div>
        <div class="mb-sep"></div>
        <div class="mb-title">Калории из еды · норма ${g.kcal}</div>
        ${miniBars(kcalWeek, days, { goal: g.kcal, fmt: (v) => v + ' ккал', state: (v) => (v > g.kcal ? 'over' : v >= g.kcal * 0.8 ? 'ok' : 'low') })}
        <div class="mb-legend"><span><i class="low"></i>мало</span><span><i class="ok"></i>норма</span><span><i class="over"></i>перебор</span></div>
      </section>
    </div>`;
}

function openSleep(x = null) {
  S.slEditing = x;
  const h = new Date().getHours();
  const defBed = x ? new Date(x.bed_at).toTimeString().slice(0, 5) : (h >= 12 && h < 20 ? '14:00' : '23:30');
  const defWake = x ? new Date(x.wake_at).toTimeString().slice(0, 5) : (h >= 12 && h < 20 ? '15:00' : '07:30');
  const box = $('#logsheet');
  box.innerHTML = `
    <div class="sheet-bg" data-act="close-log"></div>
    <div class="sheet">
      <div class="sheet-top"><div class="sheet-handle"></div><button class="close-x" data-act="close-log" aria-label="Закрыть">${I('x')}</button></div>
      <h3 class="sheet-h">${x ? 'Сон' : 'Добавить сон'}</h3>
      <p class="muted small">Можно записать и ночной, и дневной сон — они сложатся.</p>
      <div class="grid2">
        <label>Уснула<input type="time" id="sl-bed" value="${defBed}"></label>
        <label>Проснулась<input type="time" id="sl-wake" value="${defWake}"></label>
      </div>
      <label>Как поспала</label>
      <div class="stars-in" id="sl-q">${[1, 2, 3, 4, 5].map((i) => `<button data-q5="${i}" class="${(x?.quality || 0) >= i ? 'on' : ''}">★</button>`).join('')}</div>
      <div class="sheet-actions">
        ${x ? '<button class="btn danger-ghost" data-act="sleep-del">Удалить</button>' : '<button class="btn" data-act="close-log">Отмена</button>'}
        <button class="btn primary" data-act="sleep-save">${x ? 'Сохранить' : 'Добавить'}</button>
      </div>
    </div>`;
  box.classList.add('open');
}
function sleepForm(sl) {
  sl = sl?._edit || sl;
  return `
    <div class="sleep-form">
      <label>Уснула<input type="time" id="sl-bed" value="${sl?.bed_at ? new Date(sl.bed_at).toTimeString().slice(0, 5) : '23:30'}"></label>
      <label>Проснулась<input type="time" id="sl-wake" value="${sl?.wake_at ? new Date(sl.wake_at).toTimeString().slice(0, 5) : '07:30'}"></label>
    </div>
    <div class="stars-in" id="sl-q">${[1, 2, 3, 4, 5].map((i) => `<button data-q5="${i}" class="${(sl?.quality || 0) >= i ? 'on' : ''}">★</button>`).join('')}</div>
    <button class="btn primary" data-act="sleep-save">Записать сон</button>`;
}

// сжать фото до 1280px, чтобы быстро улетало
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 1280 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', 0.82));
      URL.revokeObjectURL(img.src);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

async function addFood(body) {
  S.health.busy = true; render();
  try {
    const row = await db.foodAI(body);
    toast(`${row.title} — ${Math.round(row.kcal)} ккал`);
    playDone();
  } catch (e) {
    toast(e.message, true);
  }
  S.health.busy = false;
  await safe(loadHealth);
}

function openFoodNew() {
  const box = $('#logsheet');
  box.innerHTML = `
    <div class="sheet-bg" data-act="close-log"></div>
    <div class="sheet">
      <div class="sheet-top"><div class="sheet-handle"></div><button class="close-x" data-act="close-log" aria-label="Закрыть">${I('x')}</button></div>
      <h3 class="sheet-h">Добавить еду</h3>
      <label class="btn fn-photo">${I('camera')} Сфотографировать<input type="file" accept="image/*" id="food-photo" hidden></label>
      <p class="muted small">Нейросеть сама посчитает калории и БЖУ по фото.</p>
      <label>Или опиши словами</label>
      <textarea id="fn-text" rows="2" placeholder="2 яйца, тост с авокадо, капучино"></textarea>
      <button class="btn" data-act="fn-ai">${I('sparkle')} Посчитать</button>
      <div class="fn-sep"><span>или вручную</span></div>
      <input class="plain-in" id="fn-title" placeholder="Название, например «Гречка с курицей»">
      <div class="grid4">
        <label>Ккал<input type="number" id="fn-kcal" inputmode="numeric" placeholder="—"></label>
        <label>Б<input type="number" id="fn-p" inputmode="numeric" placeholder="—"></label>
        <label>Ж<input type="number" id="fn-f" inputmode="numeric" placeholder="—"></label>
        <label>У<input type="number" id="fn-c" inputmode="numeric" placeholder="—"></label>
      </div>
      <label>Во сколько<input type="time" id="fn-time" value="${nowHM()}"></label>
      <div class="sheet-actions">
        <button class="btn" data-act="close-log">Отмена</button>
        <button class="btn primary" data-act="fn-manual">Добавить</button>
      </div>
    </div>`;
  box.classList.add('open');
}

function openFood(f) {
  S.foodEditing = f;
  const box = $('#logsheet');
  box.innerHTML = `
    <div class="sheet-bg" data-act="close-log"></div>
    <div class="sheet">
      <div class="sheet-top"><div class="sheet-handle"></div><button class="close-x" data-act="close-log">${I('x')}</button></div>
      ${f.photo_path && S.health.photos[f.photo_path] ? `<img class="food-big" src="${S.health.photos[f.photo_path]}" alt="">` : ''}
      <input class="title-in" id="fd-title" value="${esc(f.title)}">
      <div class="grid4">
        <label>Ккал<input type="number" id="fd-kcal" data-nostep value="${Math.round(f.kcal)}"></label>
        <label>Б<input type="number" id="fd-p" data-nostep value="${f.protein ?? ''}"></label>
        <label>Ж<input type="number" id="fd-f" data-nostep value="${f.fat ?? ''}"></label>
        <label>У<input type="number" id="fd-c" data-nostep value="${f.carbs ?? ''}"></label>
      </div>
      ${Array.isArray(f.items) && f.items.length ? `<div class="items muted small">${f.items.map((i) => `${esc(i.name)}${i.grams ? ' ~' + i.grams + ' г' : ''} — ${i.kcal} ккал`).join('<br>')}</div>` : ''}
      ${f.ai ? `<div class="fix-row"><input class="plain-in" id="fd-fix" placeholder="Уточнить: «было 150 г», «без соуса»"><button class="btn" data-act="food-fix">Пересчитать</button></div>` : ''}
      <div class="sheet-actions">
        <button class="btn danger-ghost" data-act="food-del">Удалить</button>
        <button class="btn primary" data-act="food-save">Сохранить</button>
      </div>
    </div>`;
  box.classList.add('open');
}

// ---------- тренировка вручную (если часы не засчитали или была без часов) ----------
const WK_TYPES = ['Пилатес', 'Йога', 'Ходьба', 'Бег', 'Велосипед', 'Плавание', 'Силовая', 'Танцы', 'Растяжка'];
function openWorkout(w = null) {
  S.wkEditing = w;
  const t = w?.type || 'Пилатес';
  const known = WK_TYPES.includes(t);
  const start = w?.started_at ? hm(w.started_at) : nowHM();
  const box = $('#logsheet');
  box.innerHTML = `
    <div class="sheet-bg" data-act="close-log"></div>
    <div class="sheet">
      <div class="sheet-top"><div class="sheet-handle"></div><button class="close-x" data-act="close-log" aria-label="Закрыть">${I('x')}</button></div>
      <h3 class="sheet-h">${w ? 'Тренировка' : 'Добавить тренировку'}</h3>
      <label>Что делала</label>
      <div class="wk-pick" id="wk-type">
        ${WK_TYPES.map((n) => `<button data-v="${n}" class="${n === t ? 'on' : ''}"><span class="plate xs" style="${pcVars(workoutColor(n))}">${I(workoutIcon(n))}</span>${n}</button>`).join('')}
      </div>
      <input class="plain-in" id="wk-other" placeholder="Или своё: «Теннис», «Хайкинг»…" value="${known ? '' : esc(t)}">
      <label>Сколько минут</label>
      <input type="number" id="wk-min" min="1" step="5" value="${w?.duration_min ? Math.round(w.duration_min) : 30}">
      <div class="quick">${[20, 30, 45, 60, 90].map((m) => `<button data-wmin="${m}">${m} мин</button>`).join('')}</div>
      <div class="grid2">
        <label>Ккал (если знаешь)<input type="number" id="wk-kcal" min="0" data-step="10" value="${w?.kcal ? Math.round(w.kcal) : ''}" placeholder="—"></label>
        <label>Км (если были)<input type="number" id="wk-km" min="0" step="0.1" value="${w?.distance_km ?? ''}" placeholder="—"></label>
      </div>
      <label>Во сколько начала<input type="time" id="wk-time" value="${start}"></label>
      <div class="sheet-actions">
        ${w ? '<button class="btn danger-ghost" data-act="wk-del">Удалить</button>' : '<button class="btn" data-act="close-log">Отмена</button>'}
        <button class="btn primary" data-act="wk-save">${w ? 'Сохранить' : 'Добавить'}</button>
      </div>
    </div>`;
  box.classList.add('open');
}
async function saveWorkout() {
  const box = $('#logsheet');
  const other = $('#wk-other').value.trim();
  const type = other || box.querySelector('#wk-type .on')?.dataset.v || 'Тренировка';
  const d = S.health.date || today();
  const tm = $('#wk-time').value || nowHM();
  const row = {
    date: d, type,
    duration_min: Math.max(1, Number($('#wk-min').value) || 0),
    kcal: $('#wk-kcal').value ? Number($('#wk-kcal').value) : null,
    distance_km: $('#wk-km').value ? Number($('#wk-km').value) : null,
    started_at: new Date(`${d}T${tm}`).toISOString(),
  };
  const ed = S.wkEditing;
  const res = await safe(() => (ed ? db.updateWorkout(ed.id, row) : db.addWorkout(row)), ed ? 'Тренировка сохранена' : 'Тренировка добавлена');
  if (res) { closeLog(); await safe(loadHealth); }
}

// выбор иконки и цвета категории
function openCatStyle(c) {
  S.catEditing = c.id;
  const box = $('#logsheet');
  box.innerHTML = `
    <div class="sheet-bg" data-act="close-log"></div>
    <div class="sheet">
      <div class="sheet-top"><div class="sheet-handle"></div><button class="close-x" data-act="close-log">${I('x')}</button></div>
      <div class="cat-preview">${plate(c, 'lg')}<b>${esc(c.name)}</b></div>
      <label>Цвет</label>
      <div class="swatches">${CAT_COLORS.map((col) => `<button class="swatch ${c.color === col ? 'on' : ''}" style="${pcVars(col)}" data-act="cat-pick" data-color="${col}" aria-label="${col}"></button>`).join('')}</div>
      <label>Иконка</label>
      <div class="icon-grid">${CAT_ICONS.map((ic) => `<button class="${(c.emoji === ic) ? 'on' : ''}" data-act="cat-pick" data-icon="${ic}">${plate({ ...c, emoji: ic }, 'md')}</button>`).join('')}</div>
    </div>`;
  box.classList.add('open');
}

// ---------- голосовой ввод ----------
let rec = null;
function startVoice(btn) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    toast('Тут браузер не умеет слушать — нажми на микрофон на клавиатуре', true);
    $('#quick-in')?.focus();
    return;
  }
  if (rec) { rec.stop(); return; }
  rec = new SR();
  rec.lang = 'ru-RU';
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  const inp = $('#quick-in');
  btn.classList.add('listening');
  toast('Говори… например «завтра в 7 вечера тренировка»');
  let finalText = '';
  rec.onresult = (e) => {
    let text = '';
    for (const r of e.results) text += r[0].transcript;
    finalText = text;
    inp.value = text;
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  };
  rec.onerror = (e) => {
    toast(e.error === 'not-allowed' ? 'Разреши доступ к микрофону в настройках браузера' : 'Не расслышал, попробуй ещё раз', true);
  };
  rec.onend = async () => {
    btn.classList.remove('listening');
    rec = null;
    if (finalText.trim()) {
      inp.value = '';
      $('#quick-hint').textContent = '';
      await quickAdd(finalText.trim());
    }
  };
  rec.start();
}

// ---------- отрисовка ----------
function render() {
  const app = $('#app');
  if (!S.session) {
    app.innerHTML = `
      <form class="login" id="login">
        <div class="logo">${I('sparkle')}</div>
        <h1>Планер</h1>
        <input type="email" name="email" placeholder="Почта" autocomplete="username" required>
        <input type="password" name="password" placeholder="Пароль" autocomplete="current-password" required>
        <button class="btn primary" type="submit">Войти</button>
      </form>`;
    return;
  }

  const viewPlan = () => `<nav class="seg plan-seg">${[['week', 'Неделя'], ['board', 'Доска'], ['archive', 'Архив']].map(([k, l]) => `<button data-plan="${k}" class="${S.planMode === k ? 'on' : ''}">${l}</button>`).join('')}</nav>${S.planMode === 'archive' ? viewArchive() : S.planMode === 'board' ? viewBoard() : viewWeek()}`;
  const views = { today: viewToday, plan: viewPlan, health: viewHealth, habits: viewHabits, report: viewReport, settings: viewSettings };
  const tabs = [['today', 'sun', 'Сегодня'], ['plan', 'calendar', 'Задачи'], ['health', 'heart', 'Здоровье'], ['habits', 'flame', 'Привычки'], ['report', 'chart', 'Итоги'], ['settings', 'user', 'Профиль']];
  const keepInput = $('#quick-in')?.value || '';
  app.innerHTML = `
    <header class="top">
      <div class="brandbar">
        <div class="brand">${{ today: 'Планер', plan: 'Задачи', report: 'Итоги', health: 'Здоровье', habits: 'Привычки', settings: 'Профиль' }[S.view]}</div>
        <div class="brand-date">${S.view === 'today' ? '' : new Date().toLocaleDateString('ru', { day: 'numeric', month: 'short', weekday: 'short' })}</div>
      </div>
      ${['today', 'plan'].includes(S.view) ? `
      <div class="mini-add" aria-hidden="true">
        <button type="button" class="mini-in" data-act="mini-add">${I('plus')}<span>Новая задача…</span></button>
        <button type="button" class="icon-btn mic" data-act="mini-mic" title="Сказать голосом">${I('mic')}</button>
      </div>
      <div class="add-hero">
        <div class="ah-title">Новая<br>задача</div>
        <div class="ah-sub">текстом или голосом</div>
        <form class="quick-add" id="quick">
          <input id="quick-in" placeholder="завтра в 19:00 тренировка" autocomplete="off" enterkeyhint="done">
          <button type="button" class="icon-btn mic" data-act="mic" title="Сказать голосом">${I('mic')}</button>
        </form>
        <div class="hint" id="quick-hint"></div>
        <button type="button" class="btn primary ah-btn" data-act="new">${I('plus')} Создать задачу</button>
      </div>
      <nav class="filters">
        <button data-cat="all" class="${S.cat === 'all' ? 'on' : ''}">Все</button>
        ${S.cats.map((c) => `<button data-cat="${c.id}" class="${S.cat === c.id ? 'on' : ''}" style="--cat:${c.color};${pcVars(c.color)}">${plate(c, 'xs')} ${esc(c.name)}</button>`).join('')}
      </nav>` : ''}
    </header>
    <main class="view view-${S.view}">${views[S.view]()}</main>
    <nav class="tabs">
      ${tabs.map(([k, i, l]) => `<button data-view="${k}" class="${S.view === k ? 'on' : ''}" title="${l}" aria-label="${l}">${I(i)}<span>${l}</span></button>`).join('')}
    </nav>`;
  if (keepInput && $('#quick-in')) $('#quick-in').value = keepInput;
}

// ---------- события (делегирование) ----------
document.addEventListener('click', (e) => {
  const pop = document.getElementById('dp');
  if (pop && !pop.hidden && !e.target.closest('#dp') && !e.target.closest('[data-act=dp-open]')) pop.hidden = true;
  const tp = document.getElementById('tp');
  if (tp && !tp.hidden && !e.target.closest('#tp') && !e.target.closest('[data-act=tp-open]')) tp.hidden = true;
}, true);
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act],[data-view],[data-cat],[data-q],[data-range],[data-min],[data-plan],[data-hday],[data-water],[data-q5],#f-status button,#f-cat button,#f-days button,#wk-type button,[data-wmin],#lg-author button,#lg-res button,#hb-icons button,#hb-colors button,[data-hdays]');
  if (!el) return;

  if (el.dataset.view) { S.view = el.dataset.view; save('view', S.view); render(); window.scrollTo(0, 0); if (S.view === 'report') safe(loadReport); if (S.view === 'health') safe(loadHealth); return; }
  if (el.dataset.plan) { S.planMode = el.dataset.plan; save('planMode', S.planMode); render(); return; }
  if (el.dataset.hday) { const nd = addDays(S.health.date || today(), Number(el.dataset.hday)); if (nd <= today()) { S.health.date = nd; render(); safe(loadHealth); } return; }
  if (el.dataset.water) {
    const ml = Number(el.dataset.water);
    const before = S.health.water.reduce((a, w) => a + w.ml, 0);
    const row = await safe(() => db.addWater(ml));
    if (row) {
      S.health.water.push(row); render(); playDone(); buzz();
      const g = goals().water;
      if (before < g && before + ml >= g) { celebrate(); toast('Норма воды выполнена'); } else toast(`+${ml} мл`);
    }
    return;
  }
  if (el.dataset.q5) { el.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', Number(b.dataset.q5) <= Number(el.dataset.q5))); return; }
  if (el.dataset.range) { S.report.range = el.dataset.range; save('range', S.report.range); S.report.logs = []; S.report.done = []; render(); safe(loadReport); return; }
  if (el.dataset.min) { $('#lg-min').value = el.dataset.min; return; }
  if (el.closest('#hb-icons') || el.closest('#hb-colors')) { el.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === el)); if (el.closest('#hb-colors')) $('#hb-icons').setAttribute('style', pcVars(el.dataset.v)); return; }
  if (el.dataset.hdays) { $('#hb-days').value = el.dataset.hdays; el.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === el)); return; }
  if (el.closest('#lg-author')) { // можно несколько: работали вместе
    const others = [...el.parentElement.querySelectorAll('.on')].filter((b) => b !== el);
    if (!el.classList.contains('on') || others.length) el.classList.toggle('on');
    return;
  }
  if (el.closest('#lg-res')) {
    el.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === el));
    return;
  }
  if (el.dataset.cat) { S.cat = el.dataset.cat; save('cat', S.cat); render(); return; }

  // кнопки внутри окна редактирования
  if ((el.closest('#f-status') || el.closest('#f-cat')) && !el.dataset.act) {
    el.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === el));
    return;
  }
  if (el.closest('#f-days')) { el.classList.toggle('on'); return; }
  if (el.closest('#wk-type')) { el.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === el)); const o = $('#wk-other'); if (o) o.value = ''; return; }
  if (el.dataset.wmin) { $('#wk-min').value = el.dataset.wmin; return; }
  if (el.dataset.q) {
    const d = $('#f-date'), tm = $('#f-time');
    const now = new Date();
    if (el.dataset.q === 'hour') { now.setMinutes(now.getMinutes() + 60); d.value = ymd(now); tm.value = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`; }
    if (el.dataset.q === 'evening') { d.value = today(); tm.value = '19:00'; }
    if (el.dataset.q === 'tomorrow') { d.value = addDays(d.value && d.value >= today() ? d.value : today(), 1); }
    if (el.dataset.q === 'nodate') { d.value = ''; tm.value = ''; }
    syncDateBtn(); syncTimeBtn();
    return;
  }

  const act = el.dataset.act;
  if (act && act.startsWith('dp-')) { datePickerAct(act, el); return; }
  if (act && act.startsWith('tp-')) { timePickerAct(act, el); return; }
  const id = el.closest('[data-id]')?.dataset.id;
  const task = S.tasks.find((t) => t.id === id);

  switch (act) {
    case 'toggle': {
      if (!task) break;
      const row = el.closest('.task');
      if (task.status === 'done') { playUndo(); setStatus(id, 'todo'); break; }
      const before = dayProgress();
      const r = el.getBoundingClientRect();
      row.classList.add('just-done');
      playDone(); buzz();
      burst(r.left + r.width / 2, r.top + r.height / 2);
      setTimeout(() => {
        setStatus(id, 'done');
        const after = dayProgress();
        if (task.due_date === today() && after.total && after.done === after.total && before.done < before.total) {
          playDayDone(); celebrate(); buzz(40);
          toast('День закрыт! Ты огонь');
        }
      }, 420);
      break;
    }
    case 'sound':
      setSound(!isSoundOn()); render(); if (isSoundOn()) playDone();
      break;
    case 'open':
      if (task) openSheet(task);
      break;
    case 'new':
      openSheet({ title: $('#quick-in')?.value || '', status: 'todo', category_id: S.cat !== 'all' ? S.cat : null, due_date: S.view === 'today' ? today() : null, remind_before_min: 0 });
      if ($('#quick-in')) $('#quick-in').value = '';
      break;
    case 'add-on':
      openSheet({ title: '', status: 'todo', category_id: S.cat !== 'all' ? S.cat : null, due_date: el.dataset.date, remind_before_min: 0 });
      break;
    case 'close':
      closeSheet();
      break;
    case 'save': {
      const data = readSheet();
      if (!data.title) { toast('Напиши, что сделать', true); return; }
      const ed = S.editing;
      el.disabled = true;
      const res = ed.id ? await safe(() => db.updateTask(ed.id, data)) : await safe(() => db.addTask(data));
      el.disabled = false;
      if (res) { closeSheet(); await safe(reload); toast(ed.id ? 'Сохранено' : 'Добавлено'); }
      break;
    }
    case 'pause':
    case 'resume':
    case 'cancel': {
      const ed = S.editing;
      if (!ed?.id) break;
      if (act === 'cancel' && !sure(el, 'Точно снять? Ещё раз')) break;
      const patch = act === 'pause' ? { status: 'paused' } : act === 'resume' ? { status: 'todo' } : { status: 'cancelled', archived: true };
      const ok = await safe(() => db.updateTask(ed.id, patch), act === 'pause' ? 'На паузе. Напоминать не буду' : act === 'resume' ? 'Задача снова в работе' : 'Задача снята');
      if (ok) { closeSheet(); reloadSoon(); }
      break;
    }
    case 'new-log':
      openLog({ task_id: el.dataset.task || S.editing?.id || null });
      break;
    case 'edit-log': {
      const lid = el.dataset.log;
      const log = (S.taskLogs || []).find((x) => x.id === lid) || S.report.logs.find((x) => x.id === lid);
      if (log) openLog(log);
      break;
    }
    case 'close-log':
      closeLog();
      break;
    case 'save-log':
      el.disabled = true; await saveLog(); el.disabled = false;
      break;
    case 'del-log':
      if (S.logEditing?.id && sure(el, 'Точно удалить?')) {
        await safe(() => db.deleteLog(S.logEditing.id), 'Удалено');
        closeLog();
        if (S.editing?.id) fillTaskLogs(S.editing.id);
        if (S.view === 'report') safe(loadReport);
      }
      break;
    case 'open-task': {
      const t = S.tasks.find((x) => x.id === el.dataset.task);
      if (t) openSheet(t); else toast('Задача уже в архиве');
      break;
    }
    case 'food-text':
    case 'food-new':
      openFoodNew();
      break;
    case 'fn-ai': {
      const t = ($('#fn-text')?.value || '').trim();
      if (!t) { toast('Напиши или надиктуй, что съела', true); break; }
      closeLog(); addFood({ text: t });
      break;
    }
    case 'fn-manual': {
      const title = ($('#fn-title')?.value || '').trim();
      const kcal = Number($('#fn-kcal')?.value);
      if (!title || !kcal) { toast('Нужны название и калории', true); break; }
      const d = S.health.date || today(); const tm = $('#fn-time')?.value || nowHM();
      const num = (id) => ($(id)?.value === '' ? null : Number($(id).value));
      const row = await safe(() => db.addFoodManual({ title, kcal, protein: num('#fn-p'), fat: num('#fn-f'), carbs: num('#fn-c'), eaten_at: new Date(`${d}T${tm}`).toISOString() }), 'Записала');
      if (row) { closeLog(); playDone(); await safe(loadHealth); }
      break;
    }
    case 'avatar': {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'image/*';
      inp.onchange = async () => {
        const file = inp.files?.[0]; if (!file) return;
        const url = await squareThumb(file, 256);
        const ok = await safe(async () => { await db.updateSettings({ avatar: url }); return true; }, 'Фото обновлено');
        if (ok) { S.settings.avatar = url; render(); }
      };
      inp.click();
      break;
    }
    case 'wk-new':
      openWorkout();
      break;
    case 'wk-edit': {
      const w = S.health.workouts.find((x) => String(x.id) === el.dataset.wk);
      if (w) openWorkout(w);
      break;
    }
    case 'wk-save':
      el.disabled = true; await saveWorkout(); el.disabled = false;
      break;
    case 'wk-del':
      if (S.wkEditing && await safe(() => db.deleteWorkout(S.wkEditing.id), 'Тренировка удалена') !== undefined) { closeLog(); await safe(loadHealth); }
      break;
    case 'meal-photo': {
      // фото к уже записанному блюду: сразу камера (на телефоне), без галереи
      e.stopPropagation();
      const fid = el.dataset.food;
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'image/*'; inp.setAttribute('capture', 'environment');
      inp.onchange = async () => {
        const file = inp.files?.[0]; if (!file) return;
        const row = await safe(() => db.addFoodPhoto(fid, file), 'Фото добавлено');
        if (row) { const H = S.health; H.photos[row.photo_path] = URL.createObjectURL(file); const f = H.food.find((x) => x.id === fid); if (f) f.photo_path = row.photo_path; render(); }
      };
      inp.click();
      break;
    }
    case 'edit-food': {
      const f = S.health.food.find((x) => x.id === el.dataset.food);
      if (f) openFood(f);
      break;
    }
    case 'food-save': {
      const n = (id) => ($(id).value === '' ? null : Number($(id).value));
      const ok = await safe(() => db.updateFood(S.foodEditing.id, { title: $('#fd-title').value.trim() || 'Еда', kcal: n('#fd-kcal') || 0, protein: n('#fd-p'), fat: n('#fd-f'), carbs: n('#fd-c') }), 'Сохранено');
      if (ok) { closeLog(); safe(loadHealth); }
      break;
    }
    case 'food-del':
      if (sure(el, 'Точно удалить?')) { await safe(() => db.deleteFood(S.foodEditing.id), 'Удалено'); closeLog(); safe(loadHealth); }
      break;
    case 'food-fix': {
      const fix = $('#fd-fix').value.trim();
      if (!fix) break;
      el.disabled = true; el.textContent = 'Считаю…';
      try { const r = await db.foodAI({ id: S.foodEditing.id, correction: fix }); toast(`${r.title} — ${Math.round(r.kcal)} ккал`); closeLog(); }
      catch (err) { toast(err.message, true); el.disabled = false; el.textContent = 'Пересчитать'; }
      safe(loadHealth);
      break;
    }
    case 'water-undo': {
      const last = S.health.water[S.health.water.length - 1];
      if (last) { await safe(() => db.deleteWater(last.id), 'Отменил'); S.health.water.pop(); render(); }
      break;
    }
    case 'sleep-open': {
      const x = el.dataset.sl ? (S.health.sleep || []).find((y) => String(y.id) === el.dataset.sl) : null;
      openSleep(x);
      break;
    }
    case 'sleep-save': {
      const d = S.health.date || today();
      const bed = $('#sl-bed').value, wake = $('#sl-wake').value;
      if (!bed || !wake) break;
      const bedDate = bed > wake ? addDays(d, -1) : d;
      const q = $('#sl-q').querySelectorAll('.on').length || null;
      const row = { date: d, bed_at: new Date(`${bedDate}T${bed}`).toISOString(), wake_at: new Date(`${d}T${wake}`).toISOString(), quality: q };
      const ed = S.slEditing;
      const ok = await safe(() => (ed ? db.updateSleep(ed.id, row) : db.addSleep(row)), 'Сон записан');
      if (ok) { closeLog(); await safe(loadHealth); }
      break;
    }
    case 'sleep-del':
      if (S.slEditing && await safe(() => db.deleteSleep(S.slEditing.id), 'Сон удалён')) { closeLog(); await safe(loadHealth); }
      break;
    case 'mini-add':
    case 'mini-mic': {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      document.body.classList.remove('scrolled');
      setTimeout(() => {
        if (act === 'mini-mic') startVoice($('.add-hero .mic'));
        else $('#quick-in')?.focus();
      }, 450);
      break;
    }
    case 'mic':
      startVoice(el);
      break;
    case 'delete':
      if (S.editing?.id && sure(el, 'Точно удалить?')) {
        await safe(() => db.deleteTask(S.editing.id), 'Удалено');
        closeSheet(); reloadSoon();
      }
      break;
    case 'archive':
      await safe(() => db.archiveDone(), 'Выполненные убраны в архив');
      reloadSoon();
      break;
    case 'restore-task': {
      const task = (S.archivedTasks || []).find((t) => t.id === el.dataset.id);
      if (!task) break;
      const restored = await safe(() => db.updateTask(task.id, { archived: false, status: ['done', 'cancelled'].includes(task.status) ? 'todo' : task.status, started_at: null }), 'Задача возвращена');
      if (restored) reloadSoon();
      break;
    }
    case 'copy':
      try { await navigator.clipboard.writeText(el.dataset.text); toast('Ссылка скопирована'); } catch { prompt('Скопируй ссылку:', el.dataset.text); }
      break;
    case 'refresh':
      await safe(reload);
      toast(S.settings?.telegram_chat_id ? 'Telegram подключён ✓' : 'Пока не вижу — нажми Start в боте', !S.settings?.telegram_chat_id);
      break;
    case 'hb-today': toggleHabit(el.dataset.id, today()); break;
    case 'hb-cell': toggleHabit(el.dataset.id, el.dataset.d); break;
    case 'hb-new': openHabit(); break;
    case 'habit-mode': S.habitMode = el.dataset.mode; render(); break;
    case 'red-new': openReduction(); break;
    case 'red-save': {
      const title = $('#red-title').value.trim(), unit = $('#red-unit').value.trim();
      const baseline = Number($('#red-baseline').value);
      if (!title || !unit || !Number.isSafeInteger(baseline) || baseline < 1) { toast('Укажи название, единицу и исходное количество от 1', true); break; }
      el.disabled = true;
      const result = await safe(() => db.addReduction({ title, unit, baseline }), 'Трекер создан');
      el.disabled = false;
      if (result) { closeLog(); await safe(reload); }
      break;
    }
    case 'red-edit-entry':
      openReductionEntry(el.dataset.id, el.dataset.date, Number(el.dataset.amount));
      break;
    case 'red-open': openReductionEntry(el.dataset.id); break;
    case 'red-entry': {
      const input = $(`#red-amount-${el.dataset.id}`);
      const date = $(`#red-date-${el.dataset.id}`).value, amount = Number(input.value);
      if (!input.value.trim() || !Number.isSafeInteger(amount) || amount < 0 || !date || date > today()) { toast('Укажи прошедшую или сегодняшнюю дату и количество от 0', true); break; }
      el.disabled = true;
      const result = await safe(() => db.saveReductionEntry({ reduction_id: el.dataset.id, date, amount }), 'День сохранён');
      el.disabled = false;
      if (result) { closeLog(); await safe(reload); }
      break;
    }
    case 'hb-edit': openHabit(S.habits.find((h) => h.id === el.dataset.id)); break;
    case 'hb-save': await saveHabit(); break;
    case 'hb-del': {
      if (!sure(el, 'Точно удалить?')) break;
      const id = S.hbEditing?.id;
      await safe(() => db.deleteHabit(id), 'Удалено');
      S.habits = S.habits.filter((h) => h.id !== id); closeLog(); render();
      break;
    }
    case 'hb-restart': {
      const h = S.habits.find((x) => x.id === el.dataset.id);
      const upd = await safe(() => db.updateHabit(h.id, { start_date: today(), archived: false }), 'Начали заново — день 1');
      if (upd) { Object.assign(h, upd); render(); }
      break;
    }
    case 'feed-add': {
      const name = $('#feed-name')?.value.trim();
      const url = $('#feed-url')?.value.trim();
      if (!url || !/^(https|webcals?):\/\//i.test(url)) { toast('Вставь ссылку iCal — она начинается с https:// или webcal://', true); break; }
      if (S.feeds.some((f) => f.url === url)) { toast('Этот календарь уже подключён', true); break; }
      const used = new Set(S.feeds.map((f) => f.color));
      const color = CAT_COLORS.find((c) => !used.has(c)) || CAT_COLORS[S.feeds.length % CAT_COLORS.length];
      const host = url.includes('google.com') ? 'Google' : url.includes('icloud.com') ? 'iCloud' : 'Календарь';
      const f = await safe(() => db.addFeed({ name: name || host, url, color }), 'Календарь подключён');
      if (f) { if (!S.feeds.some((x) => x.id === f.id)) S.feeds.push(f); render(); loadEvents(true); }
      break;
    }
    case 'feed-del': {
      if (!sure(el, 'Отключить?')) break;
      const id = el.dataset.id;
      await safe(() => db.deleteFeed(id), 'Календарь отключён');
      S.feeds = S.feeds.filter((f) => f.id !== id);
      S.events = S.events.filter((e) => e.feed_id !== id); save('events', S.events);
      render();
      break;
    }
    case 'ev-task': {
      const e = S.events.find((x) => x.key === el.dataset.key);
      if (!e) break;
      const created = await safe(() => db.addTask({
        title: e.title, due_date: e.date, due_time: e.all_day ? null : e.start,
        notes: e.location || null, source_uid: e.key, remind_before_min: e.all_day ? null : 0,
      }), 'Добавлено в задачи');
      if (created) { S.tasks.push(created); render(); }
      break;
    }
    case 'add-cat':
    case 'cat-new':
      toggleCatAdd();
      setTimeout(() => $('#cat-add')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 30);
      break;
    case 'cat-preset':
      await addCat(el.dataset.name, el.dataset.icon);
      break;
    case 'cat-own':
      await addCat($('#cat-own-in')?.value || '', 'tag');
      break;
    case 'cat-del':
      e.stopPropagation();
      removeCat(el.dataset.id);
      break;
    case 'cat-style': {
      const c = S.cats.find((x) => x.id === el.closest('[data-id]').dataset.id);
      if (c) openCatStyle(c);
      break;
    }
    case 'cat-pick': {
      const c = S.cats.find((x) => x.id === S.catEditing);
      if (!c) break;
      const patch = el.dataset.icon ? { emoji: el.dataset.icon } : { color: el.dataset.color };
      Object.assign(c, patch);
      openCatStyle(c);
      await safe(() => db.updateCategory(c.id, patch));
      render();
      { const pick = $('#f-cat'); if (pick) pick.innerHTML = catChips(pick.querySelector('.on')?.dataset.v || null); }
      break;
    }
    case 'del-cat':
      removeCat(el.closest('[data-id]').dataset.id);
      break;
    case 'logout':
      await db.signOut();
      break;
  }
});

// изменение категорий и времени утреннего плана
document.addEventListener('change', async (e) => {
  if (e.target.id === 'food-photo' && e.target.files?.[0]) {
    const file = e.target.files[0];
    e.target.value = '';
    closeLog();
    try { const image = await compressImage(file); addFood({ image }); } catch { toast('Не получилось открыть фото', true); }
    return;
  }
  if (e.target.dataset.prof) {
    const k = e.target.dataset.prof;
    const v = k === 'display_name' ? e.target.value.trim() || null : (e.target.value === '' ? null : Number(String(e.target.value).replace(',', '.')));
    await safe(() => db.updateSettings({ [k]: v }), 'Сохранено');
    S.settings[k] = v; render();
    return;
  }
  if (e.target.dataset.goal) {
    await safe(() => db.updateSettings({ [e.target.dataset.goal]: Number(e.target.value) || null }), 'Сохранено');
    S.settings[e.target.dataset.goal] = Number(e.target.value);
    return;
  }
  const row = e.target.closest('.cat-row');
  if (row) {
    await safe(() => db.updateCategory(row.dataset.id, { [e.target.dataset.field]: e.target.value }), 'Сохранено');
    reloadSoon();
  }
  if (e.target.id === 'digest') await safe(() => db.updateSettings({ digest_time: e.target.value }), 'Сохранено');
  if (e.target.id === 'f-repeat') {
    const weekly = e.target.value === 'weekly';
    $('#f-days').classList.toggle('hidden', !weekly);
    // сразу отмечаем день недели из даты задачи — можно добавить ещё дни
    if (weekly && !$('#f-days .on')) {
      const d = $('#f-date').value || today();
      $(`#f-days [data-v="${isoDow(d)}"]`)?.classList.add('on');
    }
  }
});

// подсказка при быстром вводе
document.addEventListener('input', (e) => {
  if (e.target.id !== 'quick-in') return;
  const v = e.target.value.trim();
  const hint = $('#quick-hint');
  if (!v) { hint.textContent = ''; return; }
  const p = parseQuick(v, today(), S.cats, nowHM());
  const bits = [];
  if (p.due_date) bits.push(humanDate(p.due_date, today()));
  if (p.due_time) bits.push(p.due_time);
  if (p.repeat) bits.push('↻ ' + repeatLabel(p.repeat));
  if (p.category_id) bits.push(catById(p.category_id)?.name);
  hint.textContent = bits.length ? '→ ' + bits.join(' · ') : '';
});

document.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (e.target.id === 'login') {
    const f = new FormData(e.target);
    const btn = e.target.querySelector('button');
    btn.disabled = true; btn.textContent = 'Входим…';
    try { await db.signIn(f.get('email'), f.get('password')); }
    catch { toast('Неверная почта или пароль', true); btn.disabled = false; btn.textContent = 'Войти'; }
  }
  if (e.target.id === 'quick') {
    const inp = $('#quick-in');
    const v = inp.value.trim();
    if (!v) return;
    inp.value = ''; $('#quick-hint').textContent = '';
    await quickAdd(v);
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && S.logEditing) { closeLog(); return; }
  if (e.key === 'Escape' && S.editing) closeSheet();
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && S.editing) $('[data-act="save"]')?.click();
});

// перетаскивание на доске (компьютер/iPad с мышкой)
document.addEventListener('dragstart', (e) => {
  const t = e.target.closest('.task');
  if (t) { e.dataTransfer.setData('text/plain', t.dataset.id); t.classList.add('dragging'); }
});
document.addEventListener('dragend', (e) => e.target.closest?.('.task')?.classList.remove('dragging'));
document.addEventListener('dragover', (e) => {
  const col = e.target.closest('.col');
  if (col) { e.preventDefault(); document.querySelectorAll('.col').forEach((c) => c.classList.toggle('over', c === col)); }
});
document.addEventListener('drop', (e) => {
  const col = e.target.closest('.col');
  document.querySelectorAll('.col').forEach((c) => c.classList.remove('over'));
  if (!col) return;
  e.preventDefault();
  setStatus(e.dataTransfer.getData('text/plain'), col.dataset.status);
});

// ---------- старт ----------
async function start() {
  const cache = load('cache', null);
  if (cache) Object.assign(S, { tasks: cache.tasks || [], cats: cache.cats || [], settings: cache.settings });

  S.session = await db.session().catch(() => null);
  render();
  let unsub = null;

  const afterLogin = async () => {
    await safe(reload);
    unsub?.();
    unsub = db.subscribe(reloadSoon);
  };
  if (S.session) afterLogin();

  db.onAuth((session) => {
    const was = !!S.session;
    S.session = session;
    if (session && !was) afterLogin();
    if (!session) { unsub?.(); save('cache', null); S.tasks = []; render(); }
  });

  // при прокрутке показываем мини-строку «Новая задача» (без изменения раскладки — плавно)
  let ticking = false;
  // прокрутка может идти у окна или у body (во встроенных просмотрщиках) — слушаем всё и берём реальную позицию
  const scrollTopNow = () => Math.max(window.scrollY || 0, document.documentElement.scrollTop || 0, document.body.scrollTop || 0);
  const pageHeight = () => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
  const onScroll = (ev) => {
    const t = ev?.target;
    if (t && t !== document && t !== document.body && t !== document.documentElement && t !== window) return; // внутренние списки не трогают меню
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const hero = document.querySelector('.add-hero');
      const past = hero ? hero.getBoundingClientRect().bottom < 60 : false;
      document.body.classList.toggle('scrolled', past);
      // меню снизу: прячем, когда листаешь вниз; показываем, когда вверх или в самом конце
      const y = scrollTopNow(), dy = y - (window._lastY || 0);
      const atEnd = window.innerHeight + y >= pageHeight() - 40;
      if (y < 40 || atEnd || dy < -6) document.body.classList.remove('tabs-hidden');
      else if (dy > 6) document.body.classList.add('tabs-hidden');
      window._lastY = y;
      ticking = false;
    });
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  document.addEventListener('scroll', onScroll, { passive: true, capture: true });

  // вернулась в приложение — обновить
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.session) reloadSoon(); });
  setInterval(() => { if (!document.hidden && S.editing) updateTaskTimer(); }, 1000);
  setInterval(() => { if (!document.hidden && S.session) loadEvents(); }, 10 * 60 * 1000);
  // раз в минуту перерисовать (просрочки, смена дня)
  setInterval(() => { if (S.session && !S.editing && document.activeElement?.id !== 'quick-in') render(); }, 60000);

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}

start();


// квадратная миниатюра для аватарки (обрезка по центру), чтобы не хранить большие фото
function squareThumb(file, size) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = c.height = size;
      const m = Math.min(img.width, img.height);
      c.getContext('2d').drawImage(img, (img.width - m) / 2, (img.height - m) / 2, m, m, 0, 0, size, size);
      URL.revokeObjectURL(img.src);
      res(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = rej;
    img.src = URL.createObjectURL(file);
  });
}

// ---------- голосовой ввод в текстовых полях (заметки, «что сделали», уточнения) ----------
let fieldRec = null;
function dictateInto(field, btn) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { toast('Тут браузер не умеет слушать — нажми на микрофон на клавиатуре', true); field.focus(); return; }
  if (fieldRec) { fieldRec.stop(); return; }
  fieldRec = new SR();
  fieldRec.lang = 'ru-RU'; fieldRec.interimResults = true;
  const base = field.value ? field.value.replace(/\s*$/, ' ') : '';
  btn.classList.add('listening');
  fieldRec.onresult = (e) => {
    let t = ''; for (const r of e.results) t += r[0].transcript;
    field.value = base + t;
    field.dispatchEvent(new Event('input', { bubbles: true }));
  };
  fieldRec.onerror = (e) => toast(e.error === 'not-allowed' ? 'Разреши доступ к микрофону в настройках браузера' : 'Не расслышал, попробуй ещё раз', true);
  fieldRec.onend = () => { btn.classList.remove('listening'); fieldRec = null; field.dispatchEvent(new Event('change', { bubbles: true })); };
  fieldRec.start();
}
function autoGrow(t) { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }
function enhanceFields(root = document) {
  root.querySelectorAll('textarea:not([data-mic]), #fd-fix:not([data-mic])').forEach((f) => {
    f.dataset.mic = '1';
    const wrap = document.createElement('span');
    wrap.className = 'mic-field';
    f.parentNode.insertBefore(wrap, f);
    wrap.appendChild(f);
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'field-mic'; b.setAttribute('aria-label', 'Надиктовать'); b.innerHTML = I('mic');
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); dictateInto(f, b); });
    wrap.appendChild(b);
    if (f.tagName === 'TEXTAREA') { autoGrow(f); f.addEventListener('input', () => autoGrow(f)); }
  });
}
new MutationObserver(() => { cancelAnimationFrame(enhanceFields._r); enhanceFields._r = requestAnimationFrame(() => enhanceFields()); })
  .observe(document.body, { childList: true, subtree: true });

// ---------- свой календарь выбора даты (в стиле приложения) ----------
const MON_FULL = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const MON_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const MON_SH = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
function fmtDateRu(iso) { const [y, m, d] = iso.split('-').map(Number); const dt = new Date(y, m - 1, d); return `${WD[dt.getDay()]}, ${d} ${MON_SH[m - 1]}${y !== new Date().getFullYear() ? ' ' + y : ''}`; }
function syncDateBtn() { const v = $('#f-date')?.value; const b = $('#f-date-btn span'); if (b) b.textContent = v ? fmtDateRu(v) : 'Без даты'; }
function renderDP() {
  const pop = $('#dp'); if (!pop) return;
  const { y, m } = S.dp; const sel = $('#f-date').value; const td = today();
  const first = new Date(y, m, 1); const shift = (first.getDay() + 6) % 7; const days = new Date(y, m + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < shift; i++) cells.push('<span></span>');
  for (let d = 1; d <= days; d++) {
    const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push(`<button type="button" data-act="dp-day" data-d="${iso}" class="${iso === sel ? 'sel' : ''} ${iso === td ? 'today' : ''}">${d}</button>`);
  }
  pop.innerHTML = `
    <div class="dp-head"><button type="button" class="dp-nav" data-act="dp-prev" aria-label="Предыдущий месяц">${I('left')}</button>
      <b>${MON_FULL[m]} ${y}</b>
      <button type="button" class="dp-nav" data-act="dp-next" aria-label="Следующий месяц">${I('right')}</button></div>
    <div class="dp-wd">${['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'].map((w) => `<span>${w}</span>`).join('')}</div>
    <div class="dp-grid">${cells.join('')}</div>
    <div class="dp-foot"><button type="button" class="link-btn dp-link" data-act="dp-clear">Без даты</button><button type="button" class="link-btn dp-link" data-act="dp-today">Сегодня</button></div>`;
}
function datePickerAct(act, el) {
  const pop = $('#dp'), inp = $('#f-date');
  if (act === 'dp-open') {
    if (!pop.hidden) { pop.hidden = true; return; }
    $('#tp') && ($('#tp').hidden = true);
    const base = inp.value || today(); const [y, m] = base.split('-').map(Number);
    S.dp = { y, m: m - 1 }; renderDP(); pop.hidden = false; return;
  }
  if (act === 'dp-prev' || act === 'dp-next') { const d = new Date(S.dp.y, S.dp.m + (act === 'dp-next' ? 1 : -1), 1); S.dp = { y: d.getFullYear(), m: d.getMonth() }; renderDP(); return; }
  if (act === 'dp-day') inp.value = el.dataset.d;
  if (act === 'dp-today') inp.value = today();
  if (act === 'dp-clear') { inp.value = ''; const tm = $('#f-time'); if (tm) tm.value = ''; syncTimeBtn(); }
  syncDateBtn(); pop.hidden = true;
}

// выбор времени в стиле календаря: сетка часов + сетка минут (шаг 5)
function syncTimeBtn() { const v = $('#f-time')?.value; const b = $('#f-time-btn span'); if (b) b.textContent = v || 'Без времени'; }
function renderTP() {
  const pop = $('#tp'); if (!pop) return;
  const [h, m] = ($('#f-time').value || '').split(':');
  const hSel = S.tp?.h ?? h, mSel = m;
  const hh = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
  const mm = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'));
  pop.innerHTML = `
    <div class="tp-lbl">Часы</div>
    <div class="tp-grid">${hh.map((x) => `<button type="button" data-act="tp-h" data-v="${x}" class="${x === hSel ? 'sel' : ''}">${x}</button>`).join('')}</div>
    <div class="tp-lbl">Минуты</div>
    <div class="tp-grid">${mm.map((x) => `<button type="button" data-act="tp-m" data-v="${x}" class="${x === mSel && hSel === h ? 'sel' : ''}">:${x}</button>`).join('')}</div>
    <div class="dp-foot"><button type="button" class="link-btn dp-link" data-act="tp-clear">Без времени</button><button type="button" class="link-btn dp-link" data-act="tp-now">Сейчас</button></div>`;
}
function timePickerAct(act, el) {
  const pop = $('#tp'), inp = $('#f-time');
  if (act === 'tp-open') {
    if (!pop.hidden) { pop.hidden = true; return; }
    $('#dp') && ($('#dp').hidden = true);
    S.tp = { h: (inp.value || '').split(':')[0] || null }; renderTP(); pop.hidden = false; return;
  }
  if (act === 'tp-h') { S.tp.h = el.dataset.v; if (!inp.value) inp.value = `${el.dataset.v}:00`; else inp.value = `${el.dataset.v}:${inp.value.split(':')[1]}`; syncTimeBtn(); renderTP(); return; }
  if (act === 'tp-m') { inp.value = `${S.tp.h || '09'}:${el.dataset.v}`; }
  if (act === 'tp-now') { const n = new Date(); inp.value = `${String(n.getHours()).padStart(2, '0')}:${String(Math.ceil(n.getMinutes() / 5) * 5 % 60).padStart(2, '0')}`; }
  if (act === 'tp-clear') inp.value = '';
  if (inp.value && !$('#f-date').value) { $('#f-date').value = today(); syncDateBtn(); }
  syncTimeBtn(); pop.hidden = true;
}

// подтверждение вторым нажатием (вместо системного окна): первый тап — «Точно…?», второй — действие
function sure(el, label) {
  if (el.dataset.armed === '1') { delete el.dataset.armed; return true; }
  const html = el.innerHTML;
  el.dataset.armed = '1'; el.classList.add('armed');
  el.innerHTML = `${el.querySelector('.ic')?.outerHTML || ''} ${label}`;
  setTimeout(() => { if (el.isConnected && el.dataset.armed) { delete el.dataset.armed; el.classList.remove('armed'); el.innerHTML = html; } }, 3000);
  return false;
}
