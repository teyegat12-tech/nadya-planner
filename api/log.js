// Журнал работы для агентов (Claude, Codex и др.)
// Заголовок: Authorization: Bearer <PLANNER_API_KEY>
//
// POST /api/log — записать, что сделано:
// {
//   "author":   "claude" | "codex" | "me",
//   "task":     "Посты для УЛИЦЫ",      // название задачи (найду похожую) …
//   "task_id":  "uuid",                  // … или точный id
//   "create_task": true,                 // если задачи нет — создать её
//   "minutes":  45,                      // сколько времени ушло
//   "summary":  "Написал 5 текстов, сверстал 2 карусели",
//   "location": "My Passport/27_Студия 12/Проекты/УЛИЦЫ/Посты" или ссылка,
//   "result":   "done" | "needs_work" | "progress"   // done — задача отметится выполненной
// }
// Можно прислать массив таких объектов.
//
// GET   /api/log?date=2026-10-01      — записи за день
// PATCH /api/log?id=<id>  { ...поля } — поправить запись
import { rest, getSettings, readJson } from './_lib.js';
import { nowIn, zonedToDate, addDays } from '../js/dates.js';

const RESULTS = ['done', 'needs_work', 'progress'];

async function findTask(userId, x) {
  if (x.task_id) return (await rest(`tasks?id=eq.${encodeURIComponent(x.task_id)}&user_id=eq.${userId}&select=*`))[0] || null;
  if (!x.task) return null;
  const q = String(x.task).trim();
  // каждое слово (от 3 букв, без окончаний) должно встречаться в названии: «посты улицы» найдёт «Посты для УЛИЦЫ»
  const words = q.toLowerCase().replace(/[*,()."«»]/g, ' ').split(/\s+/).filter((w) => w.length >= 3).map((w) => (w.length > 5 ? w.slice(0, -2) : w));
  const cond = words.length
    ? `and=(${words.map((w) => `title.ilike.*${encodeURIComponent(w)}*`).join(',')})`
    : `title=ilike.${encodeURIComponent('*' + q + '*')}`;
  const rows = await rest(`tasks?select=*&user_id=eq.${userId}&archived=is.false&${cond}&order=due_date.asc.nullslast&limit=10`);
  return rows.find((t) => t.status !== 'done') || rows[0] || null;
}

export default async function handler(req, res) {
  const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!process.env.PLANNER_API_KEY || auth !== process.env.PLANNER_API_KEY) return res.status(401).json({ error: 'нет доступа' });
  try {
    const s = await getSettings();
    const tz = s.timezone || 'Europe/Istanbul';

    if (req.method === 'GET') {
      const d = req.query?.date || nowIn(tz).date;
      const from = zonedToDate(d, '00:00', tz).toISOString(), to = zonedToDate(addDays(d, 1), '00:00', tz).toISOString();
      const rows = await rest(`task_logs?select=*,tasks(title,status)&user_id=eq.${s.user_id}&logged_at=gte.${from}&logged_at=lt.${to}&order=logged_at.asc`);
      return res.status(200).json(rows);
    }

    if (req.method === 'PATCH') {
      const id = req.query?.id;
      if (!id) return res.status(400).json({ error: 'нужен ?id=' });
      const b = await readJson(req);
      const patch = {};
      for (const k of ['minutes', 'summary', 'location', 'result', 'author']) if (b[k] !== undefined) patch[k] = b[k];
      if (patch.result && !RESULTS.includes(patch.result)) return res.status(400).json({ error: 'result: done | needs_work | progress' });
      const [row] = await rest(`task_logs?id=eq.${encodeURIComponent(id)}&user_id=eq.${s.user_id}`, { method: 'PATCH', body: patch, prefer: 'return=representation' });
      if (row?.result === 'done' && row.task_id) await rest(`tasks?id=eq.${row.task_id}&status=neq.done`, { method: 'PATCH', body: { status: 'done' } });
      return res.status(200).json(row || null);
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'GET, POST или PATCH' });

    const b = await readJson(req);
    const items = Array.isArray(b) ? b : [b];
    const out = [];
    for (const x of items) {
      const result = RESULTS.includes(x.result) ? x.result : 'progress';
      let task = await findTask(s.user_id, x);
      if (!task && x.task && x.create_task) {
        [task] = await rest('tasks', {
          method: 'POST', prefer: 'return=representation',
          body: { user_id: s.user_id, title: String(x.task), source: x.author || 'api', due_date: nowIn(tz).date, status: 'in_progress' },
        });
      }
      const [log] = await rest('task_logs', {
        method: 'POST', prefer: 'return=representation',
        body: {
          user_id: s.user_id,
          task_id: task?.id || null,
          author: String(x.author || 'api').toLowerCase(),
          minutes: Math.max(0, Math.round(Number(x.minutes) || 0)),
          summary: x.summary || null,
          location: x.location || null,
          result,
          ...(x.logged_at ? { logged_at: x.logged_at } : {}),
        },
      });
      if (task && result === 'done' && task.status !== 'done') {
        await rest(`tasks?id=eq.${task.id}`, { method: 'PATCH', body: { status: 'done' } });
      } else if (task && result === 'needs_work' && task.status === 'done') {
        await rest(`tasks?id=eq.${task.id}`, { method: 'PATCH', body: { status: 'todo' } });
      }
      out.push({ ...log, task_title: task?.title || null, task_marked_done: !!(task && result === 'done') });
    }
    res.status(200).json(Array.isArray(b) ? out : out[0]);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
}
