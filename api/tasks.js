// API для твоих ботов и агентов.
// POST /api/tasks  (заголовок Authorization: Bearer <PLANNER_API_KEY>)
//   { "text": "завтра 19:00 тренировка" }                         — как быстрый ввод
//   { "title": "Урок 5", "date": "2026-10-03", "time": "10:00",
//     "category": "Учёба", "notes": "...", "source": "gconf", "external_id": "lesson-5" }
//   С одинаковыми source + external_id задача обновится, а не задублируется.
// GET  /api/tasks?date=2026-10-03 — список задач на день (или все без ?date)
import { rest, getSettings, getCategories, readJson } from './_lib.js';
import { nowIn, parseQuick } from '../js/dates.js';

export default async function handler(req, res) {
  const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!process.env.PLANNER_API_KEY || auth !== process.env.PLANNER_API_KEY) return res.status(401).json({ error: 'нет доступа' });
  try {
    const s = await getSettings();
    const tz = s.timezone || 'Europe/Istanbul';
    const today = nowIn(tz).date;
    const cats = await getCategories(s.user_id);

    if (req.method === 'GET') {
      const d = req.query?.date;
      const rows = await rest(`tasks?select=*&user_id=eq.${s.user_id}&archived=is.false${d ? `&due_date=eq.${d}` : ''}&order=due_date.asc,due_time.asc`);
      return res.status(200).json(rows);
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'только GET или POST' });

    const b = await readJson(req);
    const items = Array.isArray(b) ? b : [b];
    const rows = items.map((x) => {
      let t;
      if (x.text) t = parseQuick(x.text, nowIn(tz).date, cats, nowIn(tz).time);
      else t = { title: x.title, due_date: x.date ?? x.due_date ?? null, due_time: x.time ?? x.due_time ?? null, repeat: x.repeat ?? null, category_id: null };
      if (x.category) t.category_id = cats.find((c) => c.name.toLowerCase().startsWith(String(x.category).toLowerCase()))?.id ?? null;
      if (!t.title) throw new Error('нужен title или text');
      return {
        ...t,
        user_id: s.user_id,
        notes: x.notes ?? null,
        status: x.status ?? 'todo',
        source: x.source ?? 'api',
        external_id: x.external_id ?? null,
        remind_before_min: x.remind ?? (t.due_time ? 0 : null),
        duration_min: x.duration ?? 30,
      };
    });
    // при обновлении из бота не сбрасываем статус, если его не прислали
    items.forEach((x, i) => { if (x.status === undefined && rows[i].external_id) delete rows[i].status; });
    const withId = rows.filter((r) => r.external_id);
    if (withId.some((r) => !('status' in r))) withId.forEach((r) => delete r.status);
    const noId = rows.filter((r) => !r.external_id);
    const out = [];
    if (withId.length) out.push(...await rest('tasks?on_conflict=user_id,source,external_id', { method: 'POST', body: withId, prefer: 'return=representation,resolution=merge-duplicates' }));
    if (noId.length) out.push(...await rest('tasks', { method: 'POST', body: noId, prefer: 'return=representation' }));
    res.status(200).json(out);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
}
