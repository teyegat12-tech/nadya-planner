// Подписка на календарь (Apple / Google): https://<сайт>/api/calendar?token=...
import { rest, getCategories } from './_lib.js';
import { zonedToDate, addDays, nowIn, shortTime } from '../js/dates.js';

const icsEsc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const utc = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const dateOnly = (s) => s.replace(/-/g, '');
// строки длиннее 75 байт переносим по стандарту iCalendar
function fold(line) {
  const out = [];
  let cur = '';
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch) > 73) { out.push(cur); cur = ' ' + ch; } else cur += ch;
  }
  out.push(cur);
  return out.join('\r\n');
}

export default async function handler(req, res) {
  const token = req.query?.token;
  if (!token || !/^[0-9a-f-]{36}$/i.test(token)) return res.status(401).send('нет доступа');
  try {
    const [s] = await rest(`settings?calendar_token=eq.${token}&select=*`);
    if (!s) return res.status(401).send('нет доступа');
    const tz = s.timezone || 'Europe/Istanbul';
    const today = nowIn(tz).date;
    const tasks = await rest(`tasks?select=*&user_id=eq.${s.user_id}&archived=is.false&due_date=gte.${addDays(today, -60)}&order=due_date.asc`);
    const cats = await getCategories(s.user_id);
    const stamp = utc(new Date());

    const lines = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Nadya Planner//RU', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      'X-WR-CALNAME:Планер', `X-WR-TIMEZONE:${tz}`,
      'REFRESH-INTERVAL;VALUE=DURATION:PT15M', 'X-PUBLISHED-TTL:PT15M',
    ];
    for (const t of tasks) {
      const c = cats.find((x) => x.id === t.category_id);
      const prefix = t.status === 'done' ? '✓ ' : t.status === 'in_progress' ? '▶ ' : t.status === 'paused' ? '⏸ ' : '';
      lines.push('BEGIN:VEVENT', `UID:${t.id}@planner`, `DTSTAMP:${stamp}`);
      if (t.due_time) {
        const start = zonedToDate(t.due_date, shortTime(t.due_time), tz);
        const end = new Date(start.getTime() + (t.duration_min || 30) * 60000);
        lines.push(`DTSTART:${utc(start)}`, `DTEND:${utc(end)}`);
      } else {
        lines.push(`DTSTART;VALUE=DATE:${dateOnly(t.due_date)}`, `DTEND;VALUE=DATE:${dateOnly(addDays(t.due_date, 1))}`);
      }
      lines.push(`SUMMARY:${icsEsc(prefix + (c?.emoji ? c.emoji + ' ' : '') + t.title)}`);
      if (t.notes) lines.push(`DESCRIPTION:${icsEsc(t.notes)}`);
      if (c) lines.push(`CATEGORIES:${icsEsc(c.name)}`);
      lines.push(`STATUS:${t.status === 'done' ? 'CONFIRMED' : 'TENTATIVE'}`, 'TRANSP:TRANSPARENT', 'END:VEVENT');
    }
    lines.push('END:VCALENDAR');

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="planner.ics"');
    res.status(200).send(lines.map(fold).join('\r\n') + '\r\n');
  } catch (e) {
    console.error(e);
    res.status(500).send('ошибка');
  }
}
