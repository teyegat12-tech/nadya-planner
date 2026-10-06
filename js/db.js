// Работа с базой Supabase. Весь доступ к данным — только через этот файл.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

const check = ({ data, error }) => {
  if (error) throw error;
  return data;
};

export const db = {
  async session() {
    const { data } = await sb.auth.getSession();
    return data.session;
  },
  onAuth(cb) {
    sb.auth.onAuthStateChange((_e, session) => cb(session));
  },
  async signIn(email, password) {
    check(await sb.auth.signInWithPassword({ email, password }));
  },
  async signOut() {
    await sb.auth.signOut();
  },

  async categories() {
    return check(await sb.from('categories').select('*').order('sort'));
  },
  async addCategory(cat) {
    return check(await sb.from('categories').insert(cat).select().single());
  },
  async updateCategory(id, patch) {
    return check(await sb.from('categories').update(patch).eq('id', id).select().single());
  },
  async deleteCategory(id) {
    check(await sb.from('categories').delete().eq('id', id));
  },

  async settings() {
    return check(await sb.from('settings').select('*').maybeSingle());
  },
  async updateSettings(patch) {
    const s = await this.settings();
    return check(await sb.from('settings').update(patch).eq('user_id', s.user_id).select().single());
  },

  async tasks() {
    return check(await sb.from('tasks').select('*').eq('archived', false)
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('due_time', { ascending: true, nullsFirst: true })
      .order('created_at'));
  },
  async addTask(task) {
    return check(await sb.from('tasks').insert(task).select().single());
  },
  async archivedTasks() {
    return check(await sb.from('tasks').select('*').eq('archived', true).order('created_at', { ascending: false }));
  },
  async reductions() {
    return check(await sb.from('reductions').select('*').order('created_at'));
  },
  async reductionEntries() {
    return check(await sb.from('reduction_entries').select('*').order('date'));
  },
  async addReduction(row) {
    return check(await sb.from('reductions').insert(row).select().single());
  },
  async saveReductionEntry(row) {
    return check(await sb.from('reduction_entries').upsert(row, { onConflict: 'reduction_id,date' }).select().single());
  },
  async updateTask(id, patch) {
    return check(await sb.from('tasks').update(patch).eq('id', id).select().single());
  },
  async deleteTask(id) {
    check(await sb.from('tasks').delete().eq('id', id));
  },
  async archiveDone() {
    check(await sb.from('tasks').update({ archived: true }).eq('status', 'done').eq('archived', false));
  },

  // журнал работы
  async logs(fromIso, toIso) {
    return check(await sb.from('task_logs').select('*').gte('logged_at', fromIso).lt('logged_at', toIso).order('logged_at', { ascending: false }));
  },
  // задачи, у которых последняя запись в журнале — «нужна доработка»
  async reworkIds() {
    const rows = check(await sb.from('task_logs').select('task_id,result,logged_at').not('task_id', 'is', null).order('logged_at', { ascending: false }).limit(500));
    const last = {};
    for (const r of rows) if (!(r.task_id in last)) last[r.task_id] = r.result;
    return Object.keys(last).filter((k) => last[k] === 'needs_work');
  },
  async logsForTask(taskId) {
    return check(await sb.from('task_logs').select('*').eq('task_id', taskId).order('logged_at', { ascending: false }));
  },
  async doneTasks(fromIso, toIso) {
    return check(await sb.from('tasks').select('*').eq('status', 'done').gte('completed_at', fromIso).lt('completed_at', toIso).order('completed_at'));
  },
  async addLog(log) {
    return check(await sb.from('task_logs').insert(log).select().single());
  },
  async updateLog(id, patch) {
    return check(await sb.from('task_logs').update(patch).eq('id', id).select().single());
  },
  async deleteLog(id) {
    check(await sb.from('task_logs').delete().eq('id', id));
  },

  // здоровье
  async healthRange(fromDate, toDate) {
    return check(await sb.from('health_daily').select('*').gte('date', fromDate).lte('date', toDate).order('date'));
  },
  async workouts(date) {
    return check(await sb.from('workouts').select('*').eq('date', date).order('started_at'));
  },
  async addWorkout(row) {
    return check(await sb.from('workouts').insert(row).select().single());
  },
  async updateWorkout(id, patch) {
    return check(await sb.from('workouts').update(patch).eq('id', id).select().single());
  },
  async deleteWorkout(id) {
    check(await sb.from('workouts').delete().eq('id', id));
    return true;
  },
  async sleep(date) {
    return check(await sb.from('sleep_log').select('*').eq('date', date).order('bed_at'));
  },
  async addSleep(row) {
    return check(await sb.from('sleep_log').insert(row).select().single());
  },
  async updateSleep(id, patch) {
    return check(await sb.from('sleep_log').update(patch).eq('id', id).select().single());
  },
  async deleteSleep(id) {
    check(await sb.from('sleep_log').delete().eq('id', id));
    return true;
  },
  async food(fromIso, toIso) {
    return check(await sb.from('food_log').select('*').gte('eaten_at', fromIso).lt('eaten_at', toIso).order('eaten_at'));
  },
  async addFoodManual(row) {
    return check(await sb.from('food_log').insert({ ...row, ai: false }).select().single());
  },
  async updateFood(id, patch) {
    return check(await sb.from('food_log').update(patch).eq('id', id).select().single());
  },
  async deleteFood(id) {
    check(await sb.from('food_log').delete().eq('id', id));
  },
  async photoUrls(paths) {
    if (!paths.length) return {};
    const { data } = await sb.storage.from('food').createSignedUrls(paths, 3600);
    return Object.fromEntries((data || []).map((x) => [x.path, x.signedUrl]));
  },
  // фото к уже записанному блюду
  async addFoodPhoto(id, file) {
    const { data } = await sb.auth.getSession();
    const ext = (file.type || '').includes('png') ? 'png' : 'jpg';
    const path = `${data.session.user.id}/${id}-${Date.now()}.${ext}`;
    check(await sb.storage.from('food').upload(path, file, { contentType: file.type || 'image/jpeg', upsert: true }));
    return this.updateFood(id, { photo_path: path });
  },
  async water(fromIso, toIso) {
    return check(await sb.from('water_log').select('*').gte('at', fromIso).lt('at', toIso).order('at'));
  },
  async addWater(ml) {
    return check(await sb.from('water_log').insert({ ml }).select().single());
  },
  async deleteWater(id) {
    check(await sb.from('water_log').delete().eq('id', id));
  },
  // оценка еды через сервер (там ключ Claude)
  async foodAI(body) {
    const { data } = await sb.auth.getSession();
    const res = await fetch('/api/food', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token}` },
      body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || 'Не получилось оценить');
    return j;
  },

  // ---------- календари (Google, iCloud) — только чтение ----------
  async feeds() {
    return check(await sb.from('calendar_feeds').select('id,name,url,color,enabled').order('created_at'));
  },
  async addFeed(row) {
    return check(await sb.from('calendar_feeds').insert(row).select('id,name,url,color,enabled').single());
  },
  async updateFeed(id, patch) {
    check(await sb.from('calendar_feeds').update(patch).eq('id', id));
  },
  async deleteFeed(id) {
    check(await sb.from('calendar_feeds').delete().eq('id', id));
  },
  async events(from, to) {
    const { data } = await sb.auth.getSession();
    const res = await fetch(`/api/events?from=${from}&to=${to}`, {
      headers: { Authorization: `Bearer ${data.session?.access_token}` },
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || 'Не получилось загрузить календари');
    return j;
  },

  // ---------- трекеры привычек ----------
  async habits() {
    return check(await sb.from('habits').select('*').order('created_at'));
  },
  async addHabit(row) {
    return check(await sb.from('habits').insert(row).select().single());
  },
  async updateHabit(id, patch) {
    return check(await sb.from('habits').update(patch).eq('id', id).select().single());
  },
  async deleteHabit(id) {
    check(await sb.from('habit_checks').delete().eq('habit_id', id));
    check(await sb.from('habits').delete().eq('id', id));
  },
  async habitChecks() {
    return check(await sb.from('habit_checks').select('habit_id,date'));
  },
  async setHabitCheck(habit_id, date, on) {
    if (on) check(await sb.from('habit_checks').upsert({ habit_id, date }, { onConflict: 'habit_id,date' }));
    else check(await sb.from('habit_checks').delete().eq('habit_id', habit_id).eq('date', date));
  },

  // Живая синхронизация: любое изменение на другом устройстве → cb()
  subscribe(cb) {
    const ch = sb.channel('planner-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, cb)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'categories' }, cb)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_logs' }, cb)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'health_daily' }, cb)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'food_log' }, cb)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'water_log' }, cb)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'habits' }, cb)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'habit_checks' }, cb)
      .subscribe();
    return () => sb.removeChannel(ch);
  },
};
