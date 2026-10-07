// Общие помощники для серверных функций (файлы с «_» Vercel не публикует как адреса)
const URL_ = process.env.SUPABASE_URL || 'https://wjsgkhlkhjwdsikixglw.supabase.co';
const KEY = process.env.SUPABASE_SECRET_KEY;
const TG = process.env.TELEGRAM_BOT_TOKEN;

// Запрос к базе с секретным ключом (видит всё, поэтому только на сервере)
export async function rest(path, { method = 'GET', body, prefer } = {}) {
  if (!KEY) throw new Error('SUPABASE_SECRET_KEY не задан в Vercel');
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

// Приложение личное — берём единственного пользователя
export async function getSettings() {
  const rows = await rest('settings?select=*&order=created_at.asc&limit=1');
  return rows[0] || null;
}

export async function getCategories(userId) {
  return rest(`categories?select=*&user_id=eq.${userId}&order=sort`);
}

export async function tg(method, payload) {
  if (!TG) throw new Error('TELEGRAM_BOT_TOKEN не задан в Vercel');
  const res = await fetch(`https://api.telegram.org/bot${TG}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// Расшифровка голосовых (Groq Whisper — бесплатно; или любой OpenAI-совместимый сервис)
export async function transcribe(fileId) {
  const key = process.env.STT_API_KEY;
  if (!key) return null;
  const f = await tg('getFile', { file_id: fileId });
  if (!f.ok) throw new Error('Не смог скачать голосовое');
  const audio = await fetch(`https://api.telegram.org/file/bot${TG}/${f.result.file_path}`);
  const blob = await audio.blob();
  const form = new FormData();
  form.append('file', new Blob([await blob.arrayBuffer()], { type: 'audio/ogg' }), 'voice.ogg');
  form.append('model', process.env.STT_MODEL || 'whisper-large-v3-turbo');
  form.append('language', 'ru');
  form.append('response_format', 'json');
  const res = await fetch(process.env.STT_URL || 'https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form,
  });
  const j = await res.json();
  if (!res.ok) throw new Error('Ошибка распознавания: ' + (j.error?.message || res.status));
  return (j.text || '').trim();
}

export async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { return {}; }
}

// Кнопки под напоминанием
export function taskButtons(id) {
  return {
    inline_keyboard: [
      [{ text: '✅ Готово', callback_data: `done:${id}` }, { text: '▶️ В процессе', callback_data: `prog:${id}` }],
      [{ text: '⏰ +15 мин', callback_data: `snz:${id}:15` }, { text: '⏰ +1 час', callback_data: `snz:${id}:60` }, { text: '📅 Завтра', callback_data: `tmr:${id}` }],
      [{ text: '⏸ Пауза', callback_data: `pause:${id}` }, { text: '✕ Снять', callback_data: `cancel:${id}` }],
    ],
  };
}

// ---------- еда: оценка калорий через Claude ----------
const FOOD_SYSTEM = `Ты — нутрициолог. По фото и/или описанию еды оцени состав и калорийность порции.
Отвечай ТОЛЬКО JSON без пояснений вокруг, строго в формате:
{"title":"короткое название блюда по-русски","items":[{"name":"продукт","grams":число,"kcal":число,"protein":число,"fat":число,"carbs":число}],"kcal":число,"protein":число,"fat":число,"carbs":число,"comment":"одна короткая фраза: на что опиралась оценка или совет"}
Правила: граммы и калории — реалистичная оценка видимой порции; БЖУ в граммах; итоговые kcal/protein/fat/carbs — сумма по items.
Если это напиток — тоже оцени (вода = 0 ккал). Если на фото не еда — верни {"error":"не еда"}.
Если пользователь уточняет (например «было 150 г», «без соуса», «съела половину», «вместо капусты был сыр») — это главнее фото и предыдущей оценки: замени, убери или добавь продукты ровно как он сказал, пересчитай граммы и калории и верни ПОЛНЫЙ обновлённый список items и новое название, если оно изменилось.`;

export async function claudeFood({ imageB64 = null, mediaType = 'image/jpeg', text = '', previous = null }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY не задан в Vercel');
  const content = [];
  if (imageB64) content.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: imageB64 } });
  let prompt = '';
  if (previous) prompt += `Предыдущая оценка: ${JSON.stringify(previous)}\n`;
  prompt += text ? `Комментарий пользователя: ${text}` : 'Оцени эту еду.';
  content.push({ type: 'text', text: prompt });
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: process.env.CLAUDE_MODEL || 'claude-sonnet-5-5',
      max_tokens: 2000,
      system: FOOD_SYSTEM,
      messages: [{ role: 'user', content }],
    }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error('Claude: ' + (j.error?.message || res.status));
  const raw = (j.content || []).map((c) => c.text || '').join('');
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('Не понял ответ нейросети');
  const data = JSON.parse(m[0]);
  if (data.error) throw new Error(data.error === 'не еда' ? 'На фото не вижу еду 🤔' : data.error);
  const r = (x) => (x == null || isNaN(Number(x)) ? null : Math.round(Number(x)));
  return {
    title: String(data.title || 'Еда').slice(0, 120),
    items: Array.isArray(data.items) ? data.items : [],
    kcal: r(data.kcal) ?? 0, protein: r(data.protein), fat: r(data.fat), carbs: r(data.carbs),
    comment: data.comment || '',
  };
}

// скачать фото из закрытой папки «food» (для пересчёта)
export async function downloadPhoto(path) {
  const res = await fetch(`${URL_}/storage/v1/object/food/${path}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  if (!res.ok) return null;
  const type = res.headers.get('content-type') || 'image/jpeg';
  return { b64: Buffer.from(await res.arrayBuffer()).toString('base64'), type: type.startsWith('image/') ? type : 'image/jpeg' };
}

// загрузка фото в закрытую папку «food»
export async function uploadPhoto(path, bytes, contentType = 'image/jpeg') {
  const res = await fetch(`${URL_}/storage/v1/object/food/${path}`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': contentType, 'x-upsert': 'true' },
    body: bytes,
  });
  if (!res.ok) throw new Error('Не смог сохранить фото: ' + (await res.text()));
  return path;
}

// проверка, что запрос пришёл от залогиненной тебя (из приложения)
export async function userFromToken(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const res = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_s9nMuB6q89_kUWWediyqug_K-GQiTMY', Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  return res.json();
}

// число из строки «5,04 км», «1 234», «73 ккал»
export function num(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  const m = String(v).replace(/\s/g, '').replace(',', '.').match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

export const foodLine = (f) => `${f.title} — <b>${f.kcal} ккал</b>${f.protein != null ? ` · Б ${f.protein} / Ж ${f.fat} / У ${f.carbs}` : ''}`;
