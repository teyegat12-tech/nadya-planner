// Бот: подключение, быстрое добавление задач, кнопки «Готово / Отложить»
import { rest, getSettings, getCategories, tg, esc, readJson, taskButtons, transcribe, claudeFood, uploadPhoto, foodLine } from './_lib.js';

import { nowIn, addDays, parseQuick, humanDate, shortTime, repeatLabel, pad, zonedToDate } from '../js/dates.js';

const reply = (chat_id, text, extra = {}) => tg('sendMessage', { chat_id, text, parse_mode: 'HTML', ...extra });

async function listDay(s, date, title) {
  const cats = await getCategories(s.user_id);
  const rows = await rest(`tasks?select=*&user_id=eq.${s.user_id}&archived=is.false&due_date=eq.${date}&order=due_time.asc.nullsfirst`);
  if (!rows.length) return `${title}: пусто 🌿`;
  return `<b>${title}:</b>\n\n` + rows.map((t) => {
    const c = cats.find((x) => x.id === t.category_id);
    const mark = t.status === 'done' ? '✅' : t.status === 'in_progress' ? '▶️' : t.status === 'paused' ? '⏸' : '▫️';
    return `${mark} ${t.due_time ? '<b>' + shortTime(t.due_time) + '</b> ' : ''}${esc(t.title)}${c?.emoji ? ' ' + c.emoji : ''}`;
  }).join('\n');
}

async function foodDay(s, date) {
  const tz = s.timezone || 'Europe/Istanbul';
  const rows = await rest(`food_log?user_id=eq.${s.user_id}&eaten_at=gte.${zonedToDate(date, '00:00', tz).toISOString()}&eaten_at=lt.${zonedToDate(addDays(date, 1), '00:00', tz).toISOString()}&select=kcal`);
  return Math.round(rows.reduce((a, r) => a + Number(r.kcal || 0), 0));
}

async function saveFood(s, chat, est, extra) {
  const [row] = await rest('food_log', {
    method: 'POST', prefer: 'return=representation',
    body: { user_id: s.user_id, title: est.title, kcal: est.kcal, protein: est.protein, fat: est.fat, carbs: est.carbs, items: est.items, ai: true, ...extra },
  });
  const day = await foodDay(s, nowIn(s.timezone || 'Europe/Istanbul').date);
  const goal = s.kcal_goal || 1800;
  const items = (est.items || []).slice(0, 6).map((i) => `• ${esc(i.name)}${i.grams ? ' ~' + i.grams + ' г' : ''} — ${i.kcal} ккал`).join('\n');
  const sent = await reply(chat,
    `🍽 ${foodLine({ ...est, title: esc(est.title) })}\n${items ? '\n' + items + '\n' : ''}${est.comment ? '\n<i>' + esc(est.comment) + '</i>\n' : ''}` +
    `\nЗа сегодня: <b>${day} из ${goal} ккал</b>${day > goal ? ' ⚠️' : ''}\n\n<i>Ошиблась оценка? Ответь на это сообщение, например «было 150 г».</i>`,
    { reply_markup: { inline_keyboard: [[{ text: '🗑 Удалить', callback_data: `fdel:${row.id}` }]] } });
  if (sent?.result?.message_id) await rest(`food_log?id=eq.${row.id}`, { method: 'PATCH', body: { tg_message_id: sent.result.message_id } });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).send('бот работает');
  if (process.env.TELEGRAM_WEBHOOK_SECRET && req.headers['x-telegram-bot-api-secret-token'] !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return res.status(401).send('нет доступа');
  }
  const u = await readJson(req);
  try {
    const s = await getSettings();
    const tz = s?.timezone || 'Europe/Istanbul';
    const local = nowIn(tz);

    // ----- нажатия на кнопки -----
    if (u.callback_query) {
      const q = u.callback_query;
      if (!s || q.message.chat.id !== Number(s.telegram_chat_id)) {
        await tg('answerCallbackQuery', { callback_query_id: q.id, text: 'Чужой чат' });
        return res.status(200).end();
      }
      const [act, id, arg] = q.data.split(':');
      if (act === 'fdel') {
        await rest(`food_log?id=eq.${id}&user_id=eq.${s.user_id}`, { method: 'DELETE' });
        await tg('answerCallbackQuery', { callback_query_id: q.id, text: 'Удалено' });
        await tg('editMessageText', { chat_id: q.message.chat.id, message_id: q.message.message_id, text: '🗑 Запись о еде удалена' });
        return res.status(200).end();
      }
      const [task] = await rest(`tasks?id=eq.${id}&select=*`);
      if (!task) {
        await tg('answerCallbackQuery', { callback_query_id: q.id, text: 'Задача уже удалена' });
        return res.status(200).end();
      }
      let patch, note;
      if (act === 'done') { patch = { status: 'done' }; note = task.repeat ? '✅ Готово! Следующий раз уже в плане' : '✅ Готово!'; }
      if (act === 'prog') { patch = { status: 'in_progress' }; note = '▶️ В процессе'; }
      if (act === 'snz') {
        const d = new Date(Date.now() + Number(arg) * 60000);
        const l = nowIn(tz, d);
        patch = { due_date: l.date, due_time: l.time, reminded_at: null, status: task.status === 'done' ? 'todo' : task.status };
        if (task.remind_before_min === null) patch.remind_before_min = 0;
        note = `⏰ Напомню в ${l.time}`;
      }
      if (act === 'tmr') {
        patch = { due_date: addDays(local.date, 1), reminded_at: null };
        note = `📅 Перенесено на завтра${task.due_time ? ' ' + shortTime(task.due_time) : ''}`;
      }
      if (act === 'pause') { patch = { status: 'paused' }; note = '⏸ На паузе — напоминать не буду'; }
      if (act === 'cancel') { patch = { status: 'cancelled', archived: true }; note = '✕ Задача снята'; }
      if (act === 'del') { await rest(`tasks?id=eq.${id}`, { method: 'DELETE' }); note = '🗑 Удалено'; }
      if (patch) await rest(`tasks?id=eq.${id}`, { method: 'PATCH', body: patch });
      await tg('answerCallbackQuery', { callback_query_id: q.id, text: note });
      await tg('editMessageText', {
        chat_id: q.message.chat.id, message_id: q.message.message_id, parse_mode: 'HTML',
        text: `${esc(q.message.text)}\n\n<i>${note}</i>`,
        reply_markup: act === 'snz' || act === 'prog' ? taskButtons(id) : undefined,
      });
      return res.status(200).end();
    }

    const m = u.message;
    if (!m) return res.status(200).end();
    const chat = m.chat.id;
    let text = (m.text || '').trim();
    let fromVoice = false;

    // ----- голосовое → текст -----
    const voice = m.voice || m.audio || m.video_note;
    if (voice) {
      if (!s || Number(s.telegram_chat_id) !== chat) { await reply(chat, 'Этот бот личный 🙂'); return res.status(200).end(); }
      await tg('sendChatAction', { chat_id: chat, action: 'typing' });
      try {
        text = await transcribe(voice.file_id);
      } catch (e) {
        await reply(chat, '😕 Не смог расшифровать голосовое: ' + esc(e.message));
        return res.status(200).end();
      }
      if (text === null) {
        await reply(chat, 'Голосовые пока не подключены. Можно надиктовать текстом — микрофон на клавиатуре 🎙');
        return res.status(200).end();
      }
      if (!text) { await reply(chat, 'Не расслышал 🙉 Попробуй ещё раз'); return res.status(200).end(); }
      fromVoice = true;
    }
    // ----- фото еды -----
    const photo = m.photo ? m.photo[m.photo.length - 1] : (m.document?.mime_type?.startsWith('image/') ? m.document : null);
    if (photo) {
      if (!s || Number(s.telegram_chat_id) !== chat) { await reply(chat, 'Этот бот личный 🙂'); return res.status(200).end(); }
      await tg('sendChatAction', { chat_id: chat, action: 'typing' });
      try {
        const f = await tg('getFile', { file_id: photo.file_id });
        const bin = Buffer.from(await (await fetch(`https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${f.result.file_path}`)).arrayBuffer());
        const est = await claudeFood({ imageB64: bin.toString('base64'), text: m.caption || '' });
        const path = `${s.user_id}/${Date.now()}.jpg`;
        await uploadPhoto(path, bin);
        await saveFood(s, chat, est, { photo_path: path, note: m.caption || null });
      } catch (e) {
        await reply(chat, '😕 ' + esc(e.message));
      }
      return res.status(200).end();
    }

    if (!text) return res.status(200).end();

    if (s && Number(s.telegram_chat_id) === chat) {
      // ----- поправка к оценке еды: ответом на сообщение бота -----
      if (m.reply_to_message && !text.startsWith('/')) {
        const [food] = await rest(`food_log?user_id=eq.${s.user_id}&tg_message_id=eq.${m.reply_to_message.message_id}&select=*`);
        if (food) {
          await tg('sendChatAction', { chat_id: chat, action: 'typing' });
          try {
            const est = await claudeFood({ text, previous: { title: food.title, items: food.items, kcal: food.kcal } });
            await rest(`food_log?id=eq.${food.id}`, { method: 'PATCH', body: { title: est.title, kcal: est.kcal, protein: est.protein, fat: est.fat, carbs: est.carbs, items: est.items, note: [food.note, text].filter(Boolean).join(' · ') } });
            const day = await foodDay(s, local.date);
            await reply(chat, `✏️ Пересчитал: ${foodLine(est)}\n\nЗа сегодня: <b>${day} из ${s.kcal_goal || 1800} ккал</b>`);
          } catch (e) { await reply(chat, '😕 ' + esc(e.message)); }
          return res.status(200).end();
        }
      }

      const low = text.toLowerCase();
      // ----- вода -----
      let wm = low.match(/^(?:\+?\s*)?(?:вода|воды|💧)\s*\+?\s*(\d+)?\s*(мл|л)?/) || low.match(/^\+?\s*(\d+)\s*(мл|л)?\s*вод/);
      if (wm) {
        let ml = wm[1] ? Number(wm[1]) : 250;
        if (wm[2] === 'л' || ml < 10) ml = Math.round(ml * 1000);
        await rest('water_log', { method: 'POST', body: { user_id: s.user_id, ml } });
        const from = zonedToDate(local.date, '00:00', tz).toISOString();
        const w = await rest(`water_log?user_id=eq.${s.user_id}&at=gte.${from}&select=ml`);
        const tot = w.reduce((a, x) => a + x.ml, 0), goal = s.water_goal || 2000;
        const bar = '💧'.repeat(Math.min(10, Math.round((tot / goal) * 10))) + '▫️'.repeat(Math.max(0, 10 - Math.round((tot / goal) * 10)));
        await reply(chat, `💧 +${ml} мл\nЗа сегодня: <b>${tot} из ${goal} мл</b>\n${bar}${tot >= goal ? '\n\nНорма воды выполнена 🎉' : ''}`);
        return res.status(200).end();
      }
      // ----- сон: «сон 23:40 7:15 хорошо» -----
      const sm = low.match(/^сон\s+(\d{1,2})[:.](\d{2})\s*[-–— ]\s*(\d{1,2})[:.](\d{2})\s*(.*)$/);
      if (sm) {
        const Q = { 'отлично': 5, 'супер': 5, 'хорошо': 4, 'норм': 3, 'нормально': 3, 'так себе': 2, 'плохо': 2, 'ужасно': 1 };
        const rest_ = sm[5].trim();
        const qd = rest_.match(/^[1-5]/);
        const quality = qd ? Number(qd[0]) : (Object.entries(Q).find(([k]) => rest_.startsWith(k))?.[1] ?? null);
        const bedHM = `${pad(sm[1])}:${sm[2]}`, wakeHM = `${pad(sm[3])}:${sm[4]}`;
        const bedDate = bedHM > wakeHM ? addDays(local.date, -1) : local.date;
        const bed_at = zonedToDate(bedDate, bedHM, tz), wake_at = zonedToDate(local.date, wakeHM, tz);
        const mins = Math.round((wake_at - bed_at) / 60000);
        await rest('sleep_log', { method: 'POST', body: { user_id: s.user_id, date: local.date, bed_at: bed_at.toISOString(), wake_at: wake_at.toISOString(), quality, note: rest_ || null } });
        await reply(chat, `😴 Сон записал: <b>${Math.floor(mins / 60)} ч ${mins % 60} мин</b>${quality ? ' · ' + '★'.repeat(quality) + '☆'.repeat(5 - quality) : ''}${mins < 420 ? '\nМаловато — постарайся сегодня лечь пораньше 🌙' : ''}`);
        return res.status(200).end();
      }
      // ----- еда текстом: «съела 2 яйца и тост» -----
      if (/^(еда|ела|съела|съел|поела|поел|завтрак|обед|ужин|перекус|выпила|выпил)(\s|$|[,.:!])/.test(low)) {
        await tg('sendChatAction', { chat_id: chat, action: 'typing' });
        try { await saveFood(s, chat, await claudeFood({ text }), { note: null }); }
        catch (e) { await reply(chat, '😕 ' + esc(e.message)); }
        return res.status(200).end();
      }
    }


    // ----- подключение: /start КОД -----
    if (text.startsWith('/start')) {
      const code = text.split(/\s+/)[1];
      if (code && s && code === s.telegram_link_code) {
        await rest(`settings?user_id=eq.${s.user_id}`, { method: 'PATCH', body: { telegram_chat_id: chat } });
        await reply(chat, '🎉 <b>Подключено!</b>\n\nТеперь я буду напоминать о задачах и присылать план на утро.\n\nМожешь писать мне задачи прямо сюда, например:\n<code>завтра 19:00 тренировка</code>\n<code>каждый пн ср пт 10:00 урок #учёба</code>\n\nКоманды: /today — план на сегодня, /tomorrow — на завтра.');
      } else if (s && Number(s.telegram_chat_id) === chat) {
        await reply(chat, 'Я уже подключён 👌 Пиши задачи сюда или /today.');
      } else {
        await reply(chat, 'Привет! Чтобы подключить меня, открой приложение → «Ещё» → «Подключить Telegram».');
      }
      return res.status(200).end();
    }

    if (!s || Number(s.telegram_chat_id) !== chat) {
      await reply(chat, 'Этот бот личный 🙂');
      return res.status(200).end();
    }

    if (text === '/today' || text.toLowerCase() === 'сегодня') {
      await reply(chat, await listDay(s, local.date, 'Сегодня'));
      return res.status(200).end();
    }
    if (text === '/tomorrow' || text.toLowerCase() === 'завтра') {
      await reply(chat, await listDay(s, addDays(local.date, 1), 'Завтра'));
      return res.status(200).end();
    }
    if (text.startsWith('/')) {
      await reply(chat, 'Команды: /today, /tomorrow. Или просто напиши задачу.');
      return res.status(200).end();
    }

    // ----- быстрое добавление -----
    const cats = await getCategories(s.user_id);
    const p = parseQuick(text, local.date, cats, local.time);
    const [t] = await rest('tasks', {
      method: 'POST', prefer: 'return=representation',
      body: { ...p, user_id: s.user_id, source: 'telegram', remind_before_min: p.due_time ? 0 : null },
    });
    const c = cats.find((x) => x.id === t.category_id);
    const bits = [p.due_date ? humanDate(p.due_date, local.date) : 'без даты'];
    if (p.due_time) bits.push(p.due_time);
    if (p.repeat) bits.push('↻ ' + repeatLabel(p.repeat));
    if (c) bits.push((c.emoji || '') + ' ' + c.name);
    await reply(chat, `${fromVoice ? '🎙 <i>«' + esc(text) + '»</i>\n\n' : ''}➕ <b>${esc(t.title)}</b>\n${esc(bits.join(' · '))}`, {
      reply_markup: { inline_keyboard: [[{ text: '✅ Готово', callback_data: `done:${t.id}` }, { text: '🗑 Отменить', callback_data: `del:${t.id}` }]] },
    });
    res.status(200).end();
  } catch (e) {
    console.error(e);
    res.status(200).end(); // Telegram не должен повторять запрос бесконечно
  }
}
