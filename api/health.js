// Активность с Apple Watch. Принимает два формата:
//  1) приложение Health Auto Export (REST API): { data: { metrics: [...], workouts: [...] } }
//  2) своя команда (Shortcuts): POST /api/health   (Authorization: Bearer <PLANNER_API_KEY>)
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
    // формат приложения Health Auto Export: { data: { metrics: [...], workouts: [...] } }
    if (b?.data && (Array.isArray(b.data.metrics) || Array.isArray(b.data.workouts))) {
      const r = await saveHAE(b.data, s);
      return res.status(200).json({ ok: true, ...r });
    }
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

// ---------- Health Auto Export ----------
const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z]/g, '');
const METRIC = {
  stepcount: 'steps', steps: 'steps',
  activeenergy: 'move_kcal', activeenergyburned: 'move_kcal',
  appleexercisetime: 'exercise_min', exercisetime: 'exercise_min',
  applestandhour: 'stand_hours', standhour: 'stand_hours', applestandhours: 'stand_hours',
  walkingrunningdistance: 'distance_km', distancewalkingrunning: 'distance_km',
  flightsclimbed: 'flights',
};
const dayOf = (d) => String(d || '').slice(0, 10); // «2026-10-06 08:30:00 +0300» → местная дата телефона
const toDate = (d) => { const m = String(d || '').match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})\s*([+-]\d{2}):?(\d{2})?/); return m ? new Date(`${m[1]}T${m[2]}${m[3]}:${m[4] || '00'}`) : (d ? new Date(d) : null); };
function energyKcal(v, units) {
  const q = num(v); if (q == null) return null;
  return /kj/i.test(units || '') ? q / 4.184 : q;
}
function distKm(v, units) {
  const q = num(v); if (q == null) return null;
  const u = String(units || '').toLowerCase();
  if (u === 'mi' || u.startsWith('mile')) return q * 1.609344;
  if (u === 'm' || u.startsWith('meter') || u.startsWith('metre')) return q / 1000;
  return q;
}
const WK_RU = { run: 'Бег', walk: 'Ходьба', cycle: 'Велосипед', swim: 'Плавание', running: 'Бег', walking: 'Ходьба', cycling: 'Велосипед', swimming: 'Плавание', yoga: 'Йога', pilates: 'Пилатес', hiit: 'ВИИТ', dance: 'Танцы', hiking: 'Хайкинг', elliptical: 'Эллипс', rowing: 'Гребля', functionalstrengthtraining: 'Функциональная', traditionalstrengthtraining: 'Силовая', coretraining: 'Кор', flexibility: 'Растяжка', cooldown: 'Заминка', mixedcardio: 'Кардио', boxing: 'Бокс', stairclimbing: 'Лестница', other: 'Тренировка' };
const wkName = (n) => { const k = norm(n).replace(/^(indoor|outdoor|pool|openwater)/, ''); return WK_RU[k] || n || 'Тренировка'; };

async function saveHAE(data, s) {
  const days = {};
  for (const m of data.metrics || []) {
    const col = METRIC[norm(m.name)];
    if (!col) continue;
    for (const p of m.data || []) {
      const day = dayOf(p.date); if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
      let v = num(p.qty ?? p.Avg ?? p.value);
      if (v == null) continue;
      if (col === 'move_kcal') v = energyKcal(v, m.units);
      if (col === 'distance_km') v = distKm(v, m.units);
      if (col === 'exercise_min' && /^s/i.test(m.units || '')) v = v / 60;
      if (col === 'stand_hours' && /min/i.test(m.units || '')) v = v / 60;
      const row = (days[day] ||= {});
      row[col] = (row[col] || 0) + v;
    }
  }
  const rows = Object.entries(days).map(([date, r]) => {
    const out = { user_id: s.user_id, date, updated_at: new Date().toISOString() };
    for (const [k, v] of Object.entries(r)) out[k] = ['steps', 'flights'].includes(k) ? Math.round(v) : Math.round(v * 100) / 100;
    return out;
  });
  // одинаковый набор колонок в пачке — иначе PostgREST ругается; пишем по дням
  for (const r of rows) await rest('health_daily?on_conflict=user_id,date', { method: 'POST', body: r, prefer: 'resolution=merge-duplicates' });

  const wks = (data.workouts || []).map((w, i) => {
    const start = toDate(w.start), end = toDate(w.end);
    let dur = num(w.duration?.qty ?? w.duration);
    if (start && end && !isNaN(start) && !isNaN(end)) dur = (end - start) / 60000;
    else if (dur != null && (/^s/i.test(w.duration?.units || '') || dur > 400)) dur = dur / 60;
    const en = w.activeEnergyBurned ?? w.activeEnergy;
    const kcal = Array.isArray(en) ? en.reduce((a, x) => a + (energyKcal(x.qty, x.units) || 0), 0) : energyKcal(en?.qty ?? en, en?.units);
    const dist = w.distance ? distKm(w.distance.qty ?? w.distance, w.distance.units) : null;
    return {
      user_id: s.user_id, date: dayOf(w.start) || nowIn(s.timezone || 'Europe/Istanbul').date,
      type: wkName(w.name),
      kcal: kcal != null ? Math.round(kcal) : null,
      distance_km: dist != null ? Math.round(dist * 100) / 100 : null,
      duration_min: dur != null ? Math.round(dur) : null,
      started_at: start && !isNaN(start) ? start.toISOString() : null,
      ext_id: w.id || `hae-${w.start || i}-${norm(w.name)}`,
    };
  }).filter((w) => /^\d{4}-\d{2}-\d{2}$/.test(w.date));
  if (wks.length) await rest('workouts?on_conflict=user_id,ext_id', { method: 'POST', body: wks, prefer: 'resolution=merge-duplicates' });
  return { days: rows.length, saved: rows, workouts: wks.length };
}
