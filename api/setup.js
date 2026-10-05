// Одноразовая настройка бота: открыть https://<сайт>/api/setup?key=<CRON_SECRET>
import { tg } from './_lib.js';

export default async function handler(req, res) {
  if (!process.env.CRON_SECRET || req.query?.key !== process.env.CRON_SECRET) return res.status(401).send('нет доступа');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const hook = await tg('setWebhook', {
    url: `https://${host}/api/telegram`,
    secret_token: process.env.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true,
  });
  await tg('setMyCommands', { commands: [
    { command: 'today', description: 'План на сегодня' },
    { command: 'tomorrow', description: 'План на завтра' },
  ] });
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.status(200).send(hook.ok ? '✅ Бот подключён к приложению. Можно закрыть эту страницу.' : '❌ Ошибка: ' + JSON.stringify(hook));
}
