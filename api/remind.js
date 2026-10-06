// Вызывается каждую минуту из Supabase (pg_cron): шлёт напоминания и утренний план
import { rest, getSettings, getCategories, tg, esc, taskButtons } from './_lib.js';
import { nowIn, zonedToDate, addDays, shortTime } from '../js/dates.js';

export default async function handler(req, res) {
  const key = req.headers['x-cron-secret'] || req.query?.key;
  if (!process.env.CRON_SECRET || key !== process.env.CRON_SECRET) return res.status(401).send('нет доступа');

  try {
    const s = await getSettings();
    if (!s?.telegram_chat_id) return res.status(200).json({ ok: true, skipped: 'telegram не подключён' });
    const tz = s.timezone || 'Europe/Istanbul';
    const now = new Date();
    const local = nowIn(tz, now);
    const sent = [];

    // 1) напоминания по задачам
    const from = addDays(local.date, -1), to = addDays(local.date, 2);
    const tasks = await rest(
      `tasks?select=*&user_id=eq.${s.user_id}&status=in.(todo,in_progress)&archived=is.false&reminded_at=is.null` +
      `&remind_before_min=not.is.null&due_time=not.is.null&due_date=gte.${from}&due_date=lte.${to}`
    );
    const cats = await getCategories(s.user_id);
    for (const t of tasks) {
      const start = zonedToDate(t.due_date, shortTime(t.due_time), tz);
      const at = new Date(start.getTime() - (t.remind_before_min || 0) * 60000);
      if (at > now) continue;
      const late = now - at > 6 * 3600 * 1000; // слишком старое — не спамим
      if (!late) {
        const c = cats.find((x) => x.id === t.category_id);
        const when = t.remind_before_min ? `через ${t.remind_before_min >= 60 ? t.remind_before_min / 60 + ' ч' : t.remind_before_min + ' мин'} (${shortTime(t.due_time)})` : `сейчас (${shortTime(t.due_time)})`;
        await tg('sendMessage', {
          chat_id: s.telegram_chat_id,
          parse_mode: 'HTML',
          text: `🔔 <b>${esc(t.title)}</b>\n${when}${c ? ' · ' + (c.emoji || '') + ' ' + esc(c.name) : ''}${t.notes ? '\n\n' + esc(t.notes) : ''}`,
          reply_markup: taskButtons(t.id),
        });
        sent.push(t.title);
      }
      await rest(`tasks?id=eq.${t.id}`, { method: 'PATCH', body: { reminded_at: now.toISOString() } });
    }

    // 2) утренний план
    const digestAt = shortTime(s.digest_time) || '08:30';
    if (s.digest_time !== null && local.time >= digestAt && s.last_digest_date !== local.date) {
      await rest(`settings?user_id=eq.${s.user_id}`, { method: 'PATCH', body: { last_digest_date: local.date } });
      const list = await rest(
        `tasks?select=*&user_id=eq.${s.user_id}&status=in.(todo,in_progress)&archived=is.false&due_date=lte.${local.date}&order=due_date.asc,due_time.asc.nullsfirst`
      );
      const overdue = list.filter((t) => t.due_date < local.date);
      const todays = list.filter((t) => t.due_date === local.date);
      const line = (t) => {
        const c = cats.find((x) => x.id === t.category_id);
        return `• ${t.due_time ? '<b>' + shortTime(t.due_time) + '</b> ' : ''}${esc(t.title)}${c?.emoji ? ' ' + c.emoji : ''}`;
      };
      let text = `☀️ <b>Доброе утро! План на сегодня:</b>\n\n`;
      text += todays.length ? todays.map(line).join('\n') : 'На сегодня задач нет 🌿';
      if (overdue.length) text += `\n\n⚠️ <b>Хвосты (${overdue.length}):</b>\n` + overdue.slice(0, 10).map(line).join('\n');
      await tg('sendMessage', { chat_id: s.telegram_chat_id, parse_mode: 'HTML', text });
      sent.push('утренний план');
    }

    // 3) вечерние итоги дня
    const reportAt = shortTime(s.report_time) || '21:00';
    if (s.report_time !== null && s.report_time !== undefined && local.time >= reportAt && s.last_report_date !== local.date) {
      await rest(`settings?user_id=eq.${s.user_id}`, { method: 'PATCH', body: { last_report_date: local.date } });
      const from = zonedToDate(local.date, '00:00', tz).toISOString();
      const logs = await rest(`task_logs?select=*,tasks(title)&user_id=eq.${s.user_id}&logged_at=gte.${from}&order=logged_at.asc`);
      const done = await rest(`tasks?select=title&user_id=eq.${s.user_id}&status=eq.done&completed_at=gte.${from}`);
      // здоровье за день
      const [hd] = await rest(`health_daily?user_id=eq.${s.user_id}&date=eq.${local.date}&select=*`);
      const food = await rest(`food_log?user_id=eq.${s.user_id}&eaten_at=gte.${from}&select=kcal,protein,fat,carbs`);
      const water = await rest(`water_log?user_id=eq.${s.user_id}&at=gte.${from}&select=ml`);
      const sleeps = await rest(`sleep_log?user_id=eq.${s.user_id}&date=eq.${local.date}&select=*&order=bed_at`);
      const sleep = sleeps.length ? { bed_at: sleeps[0].bed_at, wake_at: new Date(new Date(sleeps[0].bed_at).getTime() + sleeps.reduce((a, x) => a + (new Date(x.wake_at) - new Date(x.bed_at)), 0)).toISOString(), quality: sleeps[sleeps.length - 1].quality } : null;
      const wks = await rest(`workouts?user_id=eq.${s.user_id}&date=eq.${local.date}&select=*`);
      let health = '';
      if (hd) {
        const ring = (v, g) => (v != null && g ? (v >= g ? '🟢' : '⚪️') : '');
        health += `\n❤️ <b>Активность:</b>\n` +
          `${ring(hd.move_kcal, s.move_goal)} Подвижность ${Math.round(hd.move_kcal || 0)}/${s.move_goal || 750} ккал\n` +
          `${ring(hd.exercise_min, s.exercise_goal)} Упражнения ${Math.round(hd.exercise_min || 0)}/${s.exercise_goal || 30} мин\n` +
          `${ring(hd.stand_hours, s.stand_goal)} Стоя ${Math.round(hd.stand_hours || 0)}/${s.stand_goal || 12} ч\n` +
          `👣 ${hd.steps ?? '—'} шагов · ${hd.distance_km != null ? Number(hd.distance_km).toFixed(2).replace('.', ',') + ' км' : '—'} · ${hd.flights ?? 0} пролётов\n`;
      }
      if (wks.length) health += wks.map((w) => `🏃‍♀️ ${esc(w.type)}${w.kcal ? ' · ' + Math.round(w.kcal) + ' ккал' : ''}${w.distance_km ? ' · ' + Number(w.distance_km).toFixed(2).replace('.', ',') + ' км' : ''}`).join('\n') + '\n';
      if (food.length) {
        const k = Math.round(food.reduce((a, f) => a + Number(f.kcal || 0), 0));
        const P = Math.round(food.reduce((a, f) => a + Number(f.protein || 0), 0));
        health += `\n🍽 Еда: <b>${k} из ${s.kcal_goal || 1800} ккал</b>${k > (s.kcal_goal || 1800) ? ' ⚠️' : ''} · белок ${P} г\n`;
      }
      const wt = water.reduce((a, w) => a + w.ml, 0);
      if (wt) health += `💧 Вода: ${wt} из ${s.water_goal || 2000} мл${wt >= (s.water_goal || 2000) ? ' ✅' : ''}\n`;
      if (sleep?.bed_at) { const sm = Math.round((new Date(sleep.wake_at) - new Date(sleep.bed_at)) / 60000); health += `😴 Сон: ${Math.floor(sm / 60)} ч ${sm % 60} мин${sleep.quality ? ' ' + '★'.repeat(sleep.quality) : ''}\n`; }

      if (logs.length || done.length || health) {
        const NAMES = { me: 'Я', claude: 'Claude', codex: 'Codex' };
        const fmt = (m) => (m >= 60 ? `${Math.floor(m / 60)} ч${m % 60 ? ' ' + (m % 60) + ' мин' : ''}` : `${m} мин`);
        const total = logs.reduce((a, l) => a + l.minutes, 0);
        const byA = {}, byT = {};
        for (const l of logs) {
          const who = String(l.author || 'me').split('+').filter(Boolean); // совместная работа — время делится поровну
          for (const w of who) byA[w] = (byA[w] || 0) + Math.round(l.minutes / who.length);
          const k = l.tasks?.title || 'Без задачи';
          byT[k] = (byT[k] || 0) + l.minutes;
        }
        const bar = (m, max) => '▇'.repeat(Math.max(1, Math.round((m / max) * 10)));
        let text = `🌙 <b>Итоги дня</b>\n`;
        if (done.length) text += `\n✅ <b>Выполнено (${done.length}):</b>\n` + done.map((t) => '• ' + esc(t.title)).join('\n') + '\n';
        if (total) {
          text += `\n⏱ <b>В работе: ${fmt(total)}</b>\n` + Object.entries(byA).map(([a, m]) => `${esc(NAMES[a] || a)}: ${fmt(m)}`).join(' · ') + '\n';
          const top = Object.entries(byT).sort((a, b) => b[1] - a[1]).slice(0, 6);
          text += `\n📊 <b>По задачам:</b>\n` + top.map(([t, m]) => `<code>${bar(m, top[0][1])}</code> ${esc(t)} — ${fmt(m)}`).join('\n') + '\n';
        }
        const nw = logs.filter((l) => l.result === 'needs_work');
        if (nw.length) text += `\n🔧 <b>На доработку:</b>\n` + nw.map((l) => '• ' + esc(l.tasks?.title || l.summary || 'запись')).join('\n');
        text += health;
        await tg('sendMessage', { chat_id: s.telegram_chat_id, parse_mode: 'HTML', text });
        sent.push('итоги дня');
      }
    }

    res.status(200).json({ ok: true, sent });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
}
