// Даты и разбор быстрого ввода. Используется и в приложении, и в боте.

export const pad = (n) => String(n).padStart(2, '0');

// 'YYYY-MM-DD' из Date (по местному времени устройства)
export function ymd(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(s, n) {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

// Текущие дата/время в нужном часовом поясе: { date: 'YYYY-MM-DD', time: 'HH:MM', dow: 1..7 }
export function nowIn(tz, at = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short',
    }).formatToParts(at).map((p) => [p.type, p.value])
  );
  const hour = parts.hour === '24' ? '00' : parts.hour;
  const dowMap = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${hour}:${parts.minute}`, dow: dowMap[parts.weekday] };
}

// Местные дата+время в поясе tz → момент UTC (Date)
export function zonedToDate(dateStr, timeStr, tz) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = (timeStr || '00:00').split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  // смещение пояса в этот момент
  const local = nowIn(tz, new Date(guess));
  const asUtc = Date.UTC(...local.date.split('-').map((v, i) => (i === 1 ? Number(v) - 1 : Number(v))),
    ...local.time.split(':').map(Number));
  return new Date(guess - (asUtc - guess));
}

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const DOW_SHORT = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const DOW_FULL = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];
export { DOW_SHORT, DOW_FULL };

export function isoDow(s) {
  const d = parseYmd(s).getDay();
  return d === 0 ? 7 : d;
}

// «сегодня», «завтра», «пт, 3 октября»
export function humanDate(s, today) {
  if (!s) return 'без даты';
  if (s === today) return 'сегодня';
  if (s === addDays(today, 1)) return 'завтра';
  if (s === addDays(today, -1)) return 'вчера';
  const d = parseYmd(s);
  return `${DOW_SHORT[isoDow(s) - 1]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export const shortTime = (t) => (t ? t.slice(0, 5) : '');

// ---------- Быстрый ввод ----------
// «завтра 19:00 тренировка», «пт 10:30 урок 5», «12.10 записаться к врачу», «каждый пн ср пт 19:00 тренировка #тренировки»
const DOW_WORDS = {
  'пн': 1, 'понедельник': 1, 'вт': 2, 'вторник': 2, 'ср': 3, 'среда': 3, 'среду': 3,
  'чт': 4, 'четверг': 4, 'пт': 5, 'пятница': 5, 'пятницу': 5, 'сб': 6, 'суббота': 6, 'субботу': 6,
  'вс': 7, 'воскресенье': 7,
  'понедельникам': 1, 'вторникам': 2, 'средам': 3, 'четвергам': 4, 'пятницам': 5, 'субботам': 6, 'воскресеньям': 7,
};
const DATE_WORDS = new Set(['сегодня', 'завтра', 'послезавтра']);

const NUM_WORDS = { 'час': 1, 'один': 1, 'два': 2, 'две': 2, 'три': 3, 'четыре': 4, 'пять': 5, 'шесть': 6, 'семь': 7, 'восемь': 8, 'девять': 9, 'десять': 10, 'одиннадцать': 11, 'двенадцать': 12, 'полдень': 12 };
const PERIOD = { 'утра': 'am', 'утром': 'am', 'дня': 'pm', 'днём': 'pm', 'днем': 'pm', 'вечера': 'pm', 'вечером': 'pm', 'ночи': 'night' };
function applyPeriod(h, period) {
  if (period === 'pm' && h < 12) return h + 12;
  if (period === 'night' && h === 12) return 0;
  if (period === 'am' && h === 12) return 0;
  return h;
}

export function parseQuick(text, today, categories = [], nowTime = null) {
  let words = text.trim().replace(/[.!?]+$/, '').split(/\s+/);
  const out = { title: '', due_date: null, due_time: null, repeat: null, category_id: null };
  const rest = [];
  let repeatDays = null;
  let everyMode = false;
  let pendingWord = null; // «по»/«каждый», если дальше не день недели — вернём в текст

  for (let i = 0; i < words.length; i++) {
    const raw = words[i];
    const w = raw.toLowerCase().replace(/[,.]$/, '');
    if (w === 'сегодня') { out.due_date = today; continue; }
    if (w === 'завтра') { out.due_date = addDays(today, 1); continue; }
    if (w === 'послезавтра') { out.due_date = addDays(today, 2); continue; }
    if (w === 'каждый' || w === 'каждую' || w === 'каждое' || w === 'по') {
      if (pendingWord) rest.push(pendingWord);
      everyMode = true; pendingWord = raw; continue;
    }
    if (w === 'ежедневно' || (everyMode && w === 'день')) { out.repeat = { freq: 'daily' }; everyMode = false; pendingWord = null; continue; }
    const nextW = (words[i + 1] || '').toLowerCase().replace(/[,.]$/, '');
    if (w === 'в' && (/^\d{1,2}([:.]\d{2})?$/.test(nextW) || NUM_WORDS[nextW])) continue;
    if ((w === 'в' || w === 'во' || w === 'на') && (DOW_WORDS[nextW] || DATE_WORDS.has(nextW) || /^\d{1,2}\.\d{1,2}/.test(nextW))) continue;
    if (repeatDays && (w === 'и' || w === ',') && DOW_WORDS[nextW]) { everyMode = true; continue; }
    let m;
    const prevV = (words[i - 1] || '').toLowerCase() === 'в';
    // «через 30 минут», «через час», «через 2 часа», «через полчаса»
    if (w === 'через' && nowTime) {
      let mins = null, skip = 0;
      const n1 = nextW, n2 = (words[i + 2] || '').toLowerCase();
      if (n1 === 'полчаса') { mins = 30; skip = 1; }
      else if (/^час(а|ов)?$/.test(n1)) { mins = 60; skip = 1; }
      else if ((/^\d+$/.test(n1) || NUM_WORDS[n1]) && /^(минут|минуты|минуту|мин|час|часа|часов)/.test(n2)) {
        const n = /^\d+$/.test(n1) ? Number(n1) : NUM_WORDS[n1];
        mins = n2.startsWith('мин') ? n : n * 60; skip = 2;
      }
      if (mins != null) {
        const [hh, mm] = nowTime.split(':').map(Number);
        const total = hh * 60 + mm + mins;
        out.due_date = addDays(out.due_date || today, Math.floor(total / 1440));
        out.due_time = `${pad(Math.floor((total % 1440) / 60))}:${pad(total % 60)}`;
        i += skip; continue;
      }
    }
    if (w === 'полдень' && !out.due_time) { out.due_time = '12:00'; continue; }
    // «в 7», «в 7 вечера», «в семь утра», «в 19 часов»
    if (prevV && !out.due_time && ((/^\d{1,2}$/.test(w) && Number(w) < 24) || NUM_WORDS[w])) {
      let h = /^\d{1,2}$/.test(w) ? Number(w) : NUM_WORDS[w];
      let j = i + 1;
      if (/^час(а|ов)?$/.test((words[j] || '').toLowerCase())) j++;
      const per = PERIOD[(words[j] || '').toLowerCase().replace(/[,.]$/, '')];
      if (per) { h = applyPeriod(h, per); j++; }
      out.due_time = `${pad(h)}:00`;
      i = j - 1; continue;
    }
    if (everyMode && (w === 'будням' || w === 'будни')) { repeatDays = [1, 2, 3, 4, 5]; pendingWord = null; continue; }
    if (everyMode && (w === 'выходным' || w === 'выходные')) { repeatDays = [6, 7]; pendingWord = null; continue; }
    if ((m = raw.match(prevV ? /^(\d{1,2})[:.](\d{2})$/ : /^(\d{1,2}):(\d{2})$/)) && Number(m[1]) < 24 && Number(m[2]) < 60 && !out.due_time) {
      let h = Number(m[1]);
      const per = PERIOD[nextW];
      if (per) { h = applyPeriod(h, per); i++; }
      out.due_time = `${pad(h)}:${m[2]}`; continue;
    }
    if ((m = raw.match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?$/)) && Number(m[2]) <= 12) {
      const t = parseYmd(today);
      let y = m[3] ? Number(m[3].length === 2 ? '20' + m[3] : m[3]) : t.getFullYear();
      let cand = `${y}-${pad(m[2])}-${pad(m[1])}`;
      if (!m[3] && cand < today) cand = `${y + 1}-${pad(m[2])}-${pad(m[1])}`;
      out.due_date = cand; continue;
    }
    if (DOW_WORDS[w] && (everyMode || !out.due_date)) {
      if (everyMode) { (repeatDays ||= []).push(DOW_WORDS[w]); pendingWord = null; continue; }
      // ближайший такой день недели (сегодня не считается)
      let d = addDays(today, 1);
      while (isoDow(d) !== DOW_WORDS[w]) d = addDays(d, 1);
      out.due_date = d; continue;
    }
    if (raw.startsWith('#') && raw.length > 1) {
      const tag = raw.slice(1).toLowerCase();
      const c = categories.find((c) => c.name.toLowerCase().startsWith(tag));
      if (c) { out.category_id = c.id; continue; }
    }
    everyMode = false;
    if (pendingWord) { rest.push(pendingWord); pendingWord = null; }
    rest.push(raw);
  }

  if (repeatDays) {
    out.repeat = { freq: 'weekly', days: [...new Set(repeatDays)].sort() };
    if (!out.due_date) {
      let d = today;
      while (!repeatDays.includes(isoDow(d))) d = addDays(d, 1);
      out.due_date = d;
    }
  }
  if (out.repeat?.freq === 'daily' && !out.due_date) out.due_date = today;
  if (out.due_time && !out.due_date) out.due_date = today;
  out.title = rest.join(' ').trim() || text.trim();
  out.title = out.title.charAt(0).toUpperCase() + out.title.slice(1);
  return out;
}

export function repeatLabel(r) {
  if (!r) return '';
  if (r.freq === 'daily') return 'каждый день';
  if (r.freq === 'monthly') return 'каждый месяц';
  if (r.freq === 'weekly') {
    const d = r.days || [];
    if (d.length === 7) return 'каждый день';
    if (d.join() === '1,2,3,4,5') return 'по будням';
    return d.map((x) => DOW_SHORT[x - 1]).join(' ');
  }
  return '';
}
