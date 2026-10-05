// Активность с Apple Watch: присылает команда (Shortcuts) с iPhone
// POST /api/health   (Authorization: Bearer <PLANNER_API_KEY>)
// {
//   "date": "2026-10-01",            // необязательно, по умолчанию сегодня
//   "move_kcal": 512, "exercise_min": 34, "stand_hours": 9,
//   "steps": 8450, "distance_km": "5,04", "flights": 7,
//   "workouts": [ { "type": "Пилатес", "kcal": 73, "duration_min": 40, "distance_km": null, "start": "..." } ]
// }
// Числа можно присылать строками с единицами («5,04 км») — разберу сам.
import { rest, getSettings, readJson, num } from './_lib.js';
import { nowIn } from '../js/dates.js';

export default async function handler(req, res) {
  const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || req.query?.key;
  if (!process.env.PLANNER_API_KEY || auth !== process.env.PLANNER_API_KEY) return res.status(401).json({ error: 'нет доступа' });
  try {
    const s = await getSettings();
    const b = await readJson(req);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : nowIn(s.timezone || 'Europe/Istanbul').date;
    const sum = (v) => (Array.isArray(v) ? v.reduce((a, x) => a + (num(x) || 0), 0) : num(v));
    const row = { user_id: s.user_id, date, updated_at: new Date().toISOString() };
    const map = { move_kcal: 'move_kcal', exercise_min: 'exercise_min', stand_hours: 'stand_hours', steps: 'steps', distance_km: 'distance_km', flights: 'flights' };
    for (const [k, col] of Object.entries(map)) if (b[k] !== undefined && b[k] !== '') {
      let v = sum(b[k]);
      if (v != null && (col === 'steps' || col === 'flights')) v = Math.round(v);
      if (v != null && col === 'distance_km' && v > 200) v = v / 1000; // прислали метры
      row[col] = v;
    }
    await rest('health_daily?on_conflict=user_id,date', { method: 'POST', body: row, prefer: 'resolution=merge-duplicates' });

    let w = b.workouts;
    if (typeof w === 'string') { try { w = JSON.parse(w); } catch { w = null; } }
    if (Array.isArray(w) && w.length) {
      const rows = w.filter((x) => x && (x.type || x.name)).map((x, i) => ({
        user_id: s.user_id, date,
        type: String(x.type || x.name),
        kcal: num(x.kcal ?? x.calories), distance_km: num(x.distance_km ?? x.distance), duration_min: num(x.duration_min ?? x.duration),
        started_at: x.start || null,
        ext_id: x.id || `${date}-${x.start || i}-${x.type || x.name}`,
      }));
      if (rows.length) await rest('workouts?on_conflict=user_id,ext_id', { method: 'POST', body: rows, prefer: 'resolution=merge-duplicates' });
    }
    res.status(200).json({ ok: true, date, saved: row });
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
}
