// События из подключённых календарей (Google, iCloud и др.) — только чтение
// GET /api/events?from=YYYY-MM-DD&to=YYYY-MM-DD   (Authorization: Bearer <токен входа в приложение>)
import { rest, userFromToken } from './_lib.js';
import { eventsInRange, normalizeFeedUrl } from './_ics.js';
import { nowIn, addDays } from '../js/dates.js';

const cache = new Map(); // адрес → { at, text } — не дёргаем календарь чаще раза в 5 минут
const TTL = 5 * 60 * 1000;
const MAX_DAYS = 31;

async function fetchIcs(url) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL) return hit.text;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'NadyaPlanner/1.0', Accept: 'text/calendar,*/*' }, redirect: 'follow' });
    if (!res.ok) throw new Error(`календарь ответил ${res.status}`);
    const text = await res.text();
    if (!text.includes('BEGIN:VCALENDAR')) throw new Error('по ссылке не календарь');
    if (text.length > 8_000_000) throw new Error('календарь слишком большой');
    cache.set(url, { at: Date.now(), text });
    return text;
  } finally { clearTimeout(timer); }
}

export default async function handler(req, res) {
  const user = await userFromToken(req);
  if (!user?.id) return res.status(401).json({ error: 'нужно войти' });
  try {
    const [settings] = await rest(`settings?user_id=eq.${user.id}&select=timezone`);
    const tz = settings?.timezone || 'Europe/Istanbul';
    const today = nowIn(tz).date;
    const ok = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
    const from = ok(req.query?.from) ? req.query.from : today;
    let to = ok(req.query?.to) ? req.query.to : addDays(from, 13);
    if (to < from) to = from;
    if (to > addDays(from, MAX_DAYS)) to = addDays(from, MAX_DAYS);

    const feeds = await rest(`calendar_feeds?user_id=eq.${user.id}&enabled=is.true&select=id,name,url,color&order=created_at`);
    const errors = [];
    const lists = await Promise.all(feeds.map(async (f) => {
      const url = normalizeFeedUrl(f.url);
      if (!url) { errors.push({ feed_id: f.id, error: 'ссылка не подходит' }); return []; }
      try {
        return eventsInRange(await fetchIcs(url), { userTz: tz, from, to, feedId: f.id });
      } catch (e) {
        errors.push({ feed_id: f.id, error: e.name === 'AbortError' ? 'календарь не ответил' : e.message });
        return [];
      }
    }));
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ from, to, events: lists.flat(), errors });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || 'ошибка' });
  }
}
