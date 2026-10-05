// Разбор календарей iCal (Google, iCloud, Outlook, Яндекс) → события в окне дат.
// Повторы (RRULE) разворачиваем сами: DAILY / WEEKLY / MONTHLY / YEARLY,
// INTERVAL, COUNT, UNTIL, BYDAY (в т.ч. 2MO, -1FR), BYMONTHDAY, BYMONTH, EXDATE, RECURRENCE-ID.
import { nowIn, zonedToDate } from '../js/dates.js';

const pad = (n) => String(n).padStart(2, '0');
const DOW = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 7 };

// ---------- дни как числа (UTC-полночь), чтобы не зависеть от пояса сервера ----------
const dayNum = (y, m, d) => Math.floor(Date.UTC(y, m - 1, d) / 864e5);
const fromStr = (s) => { const [y, m, d] = s.split('-').map(Number); return dayNum(y, m, d); };
const toStr = (n) => { const d = new Date(n * 864e5); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
const parts = (n) => { const d = new Date(n * 864e5); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), dow: ((d.getUTCDay() + 6) % 7) + 1 }; };
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

// ---------- строки файла ----------
function unfold(text) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}
function parseLine(line) {
  // ИМЯ;ПАРАМ=знач;ПАРАМ="знач":значение
  let i = 0, inQ = false;
  for (; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQ = !inQ;
    else if (c === ':' && !inQ) break;
  }
  const head = line.slice(0, i), value = line.slice(i + 1);
  const [name, ...ps] = head.split(';');
  const params = {};
  for (const p of ps) { const k = p.indexOf('='); if (k > 0) params[p.slice(0, k).toUpperCase()] = p.slice(k + 1).replace(/^"|"$/g, ''); }
  return { name: name.toUpperCase(), params, value };
}
const unesc = (s) => String(s || '').replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();

// Windows-названия поясов (Outlook) → IANA, самые частые
const WIN_TZ = {
  'Russian Standard Time': 'Europe/Moscow', 'Turkey Standard Time': 'Europe/Istanbul', 'GTB Standard Time': 'Europe/Bucharest',
  'W. Europe Standard Time': 'Europe/Berlin', 'Central European Standard Time': 'Europe/Warsaw', 'GMT Standard Time': 'Europe/London',
  'E. Europe Standard Time': 'Europe/Chisinau', 'FLE Standard Time': 'Europe/Kiev', 'Ekaterinburg Standard Time': 'Asia/Yekaterinburg',
  'Pacific Standard Time': 'America/Los_Angeles', 'Eastern Standard Time': 'America/New_York', 'UTC': 'UTC',
};
function validTz(tz) {
  if (!tz) return null;
  const t = WIN_TZ[tz] || tz.replace(/^\/.*?\/(?=[A-Z])/, ''); // «/mozilla.org/.../Europe/Moscow» → Europe/Moscow
  try { new Intl.DateTimeFormat('en', { timeZone: t }); return t; } catch { return null; }
}

// значение даты → { allDay, day (число), utc (Date), localTime 'HH:MM' в своём поясе, tz }
function parseDate(prop, defTz) {
  if (!prop) return null;
  const v = prop.value.trim();
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, hh, mi, , z] = m;
  if (prop.params.VALUE === 'DATE' || hh === undefined) {
    return { allDay: true, day: dayNum(+y, +mo, +d) };
  }
  const date = `${y}-${mo}-${d}`, time = `${hh}:${mi}`;
  if (z) {
    const utc = new Date(Date.UTC(+y, +mo - 1, +d, +hh, +mi));
    return { allDay: false, utc, tz: 'UTC', day: dayNum(+y, +mo, +d), time };
  }
  const tz = validTz(prop.params.TZID) || defTz;
  return { allDay: false, utc: zonedToDate(date, time, tz), tz, day: dayNum(+y, +mo, +d), time };
}

function parseDuration(s) {
  const m = String(s || '').match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return 0;
  const [, sign, w, d, h, mi, se] = m;
  const ms = ((+w || 0) * 7 * 864e5) + ((+d || 0) * 864e5) + ((+h || 0) * 36e5) + ((+mi || 0) * 6e4) + ((+se || 0) * 1e3);
  return sign === '-' ? -ms : ms;
}

function parseRule(s) {
  const r = {};
  for (const p of String(s).split(';')) { const [k, v] = p.split('='); if (k && v) r[k.toUpperCase()] = v; }
  const out = { freq: r.FREQ, interval: Math.max(1, +r.INTERVAL || 1), count: r.COUNT ? +r.COUNT : null, until: null };
  if (r.UNTIL) out.untilRaw = r.UNTIL;
  if (r.BYDAY) out.byday = r.BYDAY.split(',').map((x) => { const m = x.match(/^([+-]?\d+)?(MO|TU|WE|TH|FR|SA|SU)$/); return m ? { n: m[1] ? +m[1] : 0, dow: DOW[m[2]] } : null; }).filter(Boolean);
  if (r.BYMONTHDAY) out.bymonthday = r.BYMONTHDAY.split(',').map(Number);
  if (r.BYMONTH) out.bymonth = r.BYMONTH.split(',').map(Number);
  return out;
}

// n-й (или с конца) такой-то день недели месяца
function nthOfMonth(p, n) {
  if (n > 0) return Math.floor((p.d - 1) / 7) + 1 === n;
  const left = daysInMonth(p.y, p.m) - p.d; // сколько дней до конца месяца
  return Math.floor(left / 7) + 1 === -n;
}
function matchMonthDay(p, list) {
  const dim = daysInMonth(p.y, p.m);
  return list.some((x) => (x > 0 ? p.d === x : p.d === dim + x + 1));
}

// подходит ли день под правило (без учёта COUNT/UNTIL)
function ruleMatches(rule, start, n) {
  const p = parts(n), s = parts(start);
  if (rule.bymonth && !rule.bymonth.includes(p.m)) return false;
  switch (rule.freq) {
    case 'DAILY': {
      if ((n - start) % rule.interval) return false;
      if (rule.byday && !rule.byday.some((b) => b.dow === p.dow)) return false;
      if (rule.bymonthday && !matchMonthDay(p, rule.bymonthday)) return false;
      return true;
    }
    case 'WEEKLY': {
      const weekStart = (x) => x - (parts(x).dow - 1);
      if (((weekStart(n) - weekStart(start)) / 7) % rule.interval) return false;
      const days = rule.byday ? rule.byday.map((b) => b.dow) : [s.dow];
      return days.includes(p.dow);
    }
    case 'MONTHLY': {
      const months = (p.y - s.y) * 12 + (p.m - s.m);
      if (months % rule.interval) return false;
      if (rule.byday) return rule.byday.some((b) => b.dow === p.dow && (!b.n || nthOfMonth(p, b.n)));
      if (rule.bymonthday) return matchMonthDay(p, rule.bymonthday);
      return p.d === s.d;
    }
    case 'YEARLY': {
      if ((p.y - s.y) % rule.interval) return false;
      if (!rule.bymonth && p.m !== s.m) return false;
      if (rule.byday) return rule.byday.some((b) => b.dow === p.dow && (!b.n || nthOfMonth(p, b.n)));
      if (rule.bymonthday) return matchMonthDay(p, rule.bymonthday);
      return p.d === s.d;
    }
    default: return false;
  }
}

// ---------- главное ----------
// text — содержимое .ics; userTz — пояс пользователя; from/to — 'YYYY-MM-DD' включительно
export function eventsInRange(text, { userTz, from, to, feedId }) {
  const lines = unfold(text);
  const calTz = validTz((lines.find((l) => l.startsWith('X-WR-TIMEZONE')) || '').split(':')[1]) || userTz;
  const raw = [];
  let cur = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = { props: {}, exdates: [] }; continue; }
    if (line === 'END:VEVENT') { if (cur) raw.push(cur); cur = null; continue; }
    if (!cur || !line) continue;
    const p = parseLine(line);
    if (p.name === 'EXDATE') { for (const v of p.value.split(',')) cur.exdates.push({ ...p, value: v }); continue; }
    if (!(p.name in cur.props)) cur.props[p.name] = p;
  }

  const fromN = fromStr(from), toN = fromStr(to);
  const out = [];
  const overrides = new Set(); // uid|день — экземпляры повтора, заменённые отдельным событием

  // локальные дата/время пользователя для момента
  const local = (utc) => { const l = nowIn(userTz, utc); return { day: fromStr(l.date), time: l.time }; };

  const push = (ev, startUtc, endUtc, allDay, startDay, endDay) => {
    const base = {
      uid: ev.uid, feed_id: feedId, title: ev.title, location: ev.location,
    };
    if (allDay) {
      const last = Math.max(startDay, endDay - 1); // DTEND у событий на весь день — следующий день
      for (let n = Math.max(startDay, fromN); n <= Math.min(last, toN); n++) {
        out.push({ ...base, key: `${ev.uid}|${toStr(startDay)}`, date: toStr(n), all_day: true, start: null, end: null });
      }
      return;
    }
    const s = local(startUtc), e = local(endUtc);
    if (s.day < fromN || s.day > toN) return;
    out.push({
      ...base, key: `${ev.uid}|${toStr(s.day)}`, date: toStr(s.day), all_day: false,
      start: s.time, end: e.day === s.day ? e.time : null,
    });
  };

  const events = [];
  for (const r of raw) {
    const P = r.props;
    if ((P.STATUS?.value || '').toUpperCase() === 'CANCELLED') {
      if (P['RECURRENCE-ID']) { const rid = parseDate(P['RECURRENCE-ID'], calTz); if (rid) overrides.add(`${P.UID?.value}|${rid.allDay ? rid.day : local(rid.utc).day}`); }
      continue;
    }
    const start = parseDate(P.DTSTART, calTz);
    if (!start) continue;
    let end = parseDate(P.DTEND, calTz);
    const ev = {
      uid: P.UID?.value || `${P.SUMMARY?.value}-${P.DTSTART.value}`,
      title: unesc(P.SUMMARY?.value) || 'Без названия',
      location: unesc(P.LOCATION?.value) || null,
      start, end,
      dur: 0,
      rrule: P.RRULE ? parseRule(P.RRULE.value) : null,
      exdates: r.exdates.map((x) => parseDate(x, start.tz || calTz)).filter(Boolean),
      rid: P['RECURRENCE-ID'] ? parseDate(P['RECURRENCE-ID'], calTz) : null,
    };
    if (start.allDay) {
      const endDay = end?.allDay ? end.day : start.day + Math.max(1, Math.round(parseDuration(P.DURATION?.value) / 864e5) || 1);
      ev.dur = endDay - start.day; // в днях
    } else {
      ev.dur = end && !end.allDay ? end.utc - start.utc : (parseDuration(P.DURATION?.value) || 0);
    }
    if (ev.rid) overrides.add(`${ev.uid}|${ev.rid.allDay ? ev.rid.day : local(ev.rid.utc).day}`);
    events.push(ev);
  }

  for (const ev of events) {
    const { start } = ev;
    if (!ev.rrule || ev.rid) {
      if (start.allDay) push(ev, null, null, true, start.day, start.day + ev.dur);
      else push(ev, start.utc, new Date(+start.utc + ev.dur), false);
      continue;
    }
    const rule = ev.rrule;
    if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(rule.freq)) continue;
    let untilUtc = null, untilDay = null;
    if (rule.untilRaw) {
      const u = parseDate({ value: rule.untilRaw, params: {} }, start.tz || calTz);
      if (u) { untilDay = u.day; untilUtc = u.allDay ? null : u.utc; }
    }
    const exKeys = new Set(ev.exdates.map((x) => (x.allDay ? x.day : local(x.utc).day)));
    const evTz = start.tz || calTz;
    const limit = Math.min(toN + 1, start.day + 365 * 120);
    let count = 0;
    for (let n = start.day; n <= limit; n++) {
      if (untilDay != null && n > untilDay) break;
      if (!ruleMatches(rule, start.day, n)) continue;
      count++;
      if (rule.count && count > rule.count) break;
      let sUtc = null;
      if (!start.allDay) {
        sUtc = start.tz === 'UTC' ? new Date(Date.UTC(...toStr(n).split('-').map((v, i) => (i === 1 ? v - 1 : +v)), ...start.time.split(':').map(Number)))
          : zonedToDate(toStr(n), start.time, evTz);
        if (untilUtc && sUtc > untilUtc) break;
      }
      const userDay = start.allDay ? n : local(sUtc).day;
      if (exKeys.has(start.allDay ? n : userDay)) continue;
      if (overrides.has(`${ev.uid}|${userDay}`)) continue;
      if (start.allDay) push(ev, null, null, true, n, n + ev.dur);
      else push(ev, sUtc, new Date(+sUtc + ev.dur), false);
    }
  }

  out.sort((a, b) => a.date.localeCompare(b.date) || (a.all_day === b.all_day ? (a.start || '').localeCompare(b.start || '') : a.all_day ? -1 : 1));
  return out;
}

// webcal:// → https://, только внешние адреса
export function normalizeFeedUrl(u) {
  let s = String(u || '').trim();
  if (/^webcals?:\/\//i.test(s)) s = s.replace(/^webcals?:\/\//i, 'https://');
  let url;
  try { url = new URL(s); } catch { return null; }
  if (url.protocol !== 'https:') return null;
  const h = url.hostname;
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h.endsWith('.local') || h.endsWith('.internal')) return null;
  return url.toString();
}
