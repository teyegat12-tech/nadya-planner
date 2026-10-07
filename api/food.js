// Еда из приложения: фото или описание → Claude оценивает калории → запись в дневник
// POST /api/food  (Authorization: Bearer <токен входа в приложение>)
//   { "image": "data:image/jpeg;base64,...", "note": "съела половину" }   — по фото
//   { "text": "2 яйца и тост с авокадо" }                                  — по описанию
//   { "id": "<запись>", "correction": "было 150 г" }                        — пересчитать
import { rest, readJson, claudeFood, uploadPhoto, downloadPhoto, userFromToken } from './_lib.js';


export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'только POST' });
  const user = await userFromToken(req);
  if (!user?.id) return res.status(401).json({ error: 'нужно войти' });
  try {
    const b = await readJson(req);

    if (b.id && b.correction) {
      const [row] = await rest(`food_log?id=eq.${encodeURIComponent(b.id)}&user_id=eq.${user.id}&select=*`);
      if (!row) return res.status(404).json({ error: 'запись не найдена' });
      // показываем нейросети и фото, и прошлую оценку, и уточнение
      const pic = row.photo_path ? await downloadPhoto(row.photo_path).catch(() => null) : null;
      const est = await claudeFood({ imageB64: pic?.b64 || null, mediaType: pic?.type, text: b.correction, previous: { title: row.title, items: row.items, kcal: row.kcal } });
      const [upd] = await rest(`food_log?id=eq.${row.id}`, {
        method: 'PATCH', prefer: 'return=representation',
        body: { title: est.title, kcal: est.kcal, protein: est.protein, fat: est.fat, carbs: est.carbs, items: est.items, note: [row.note, b.correction].filter(Boolean).join(' · ') },
      });
      if (!upd) throw new Error('Не получилось сохранить пересчёт');
      return res.status(200).json({ ...upd, comment: est.comment });
    }

    let imageB64 = null, mediaType = 'image/jpeg', photo_path = null;
    if (b.image) {
      const m = String(b.image).match(/^data:(image\/[\w+.-]+);base64,(.+)$/);
      if (!m) return res.status(400).json({ error: 'неверный формат фото' });
      mediaType = m[1]; imageB64 = m[2];
    }
    if (!imageB64 && !b.text) return res.status(400).json({ error: 'нужно фото или описание' });

    const est = await claudeFood({ imageB64, mediaType, text: b.note || b.text || '' });
    if (imageB64) {
      photo_path = `${user.id}/${Date.now()}.jpg`;
      await uploadPhoto(photo_path, Buffer.from(imageB64, 'base64'), mediaType);
    }
    const [row] = await rest('food_log', {
      method: 'POST', prefer: 'return=representation',
      body: {
        user_id: user.id, title: est.title, kcal: est.kcal, protein: est.protein, fat: est.fat, carbs: est.carbs,
        items: est.items, photo_path, note: b.note || null, ai: true, ...(b.eaten_at ? { eaten_at: b.eaten_at } : {}),
      },
    });
    res.status(200).json({ ...row, comment: est.comment });
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
}
