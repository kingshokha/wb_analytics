'use strict';
// --- Список дел: data/todos.json.
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, apiError, cabinets } = require('../core/base');
const { productCards } = require('../core/product-cards');
const { cardPhoto } = require('../core/photos');
const { keywordEventId } = require('../ads/keywords');

// --- Список дел (вкладка «Дела»): data/todos.json, { tasks: [...] } ---
// У задачи: текст, тип дела, приоритет, кабинет и артикул (последние два — необязательно). Выполненные не удаляются,
// а уходят в архив с датой выполнения; у каждой задачи журнал: создана, изменена (что было → что стало),
// комментарий, выполнена, возвращена в работу.
const TODOS_FILE = path.join(ROOT, 'data', 'todos.json');
const TODO_TYPES = ['review', 'client', 'ads', 'prices', 'stock', 'card', 'check', 'other'];
const TODO_PRIORITIES = ['normal', 'high', 'urgent'];
const TODO_LIMIT = 5000;
function readTodos() {
  try {
    const data = JSON.parse(fs.readFileSync(TODOS_FILE, 'utf8'));
    return Array.isArray(data?.tasks) ? data.tasks : [];
  } catch {
    return [];
  }
}
function writeTodos(tasks) {
  fs.mkdirSync(path.dirname(TODOS_FILE), { recursive: true });
  fs.writeFileSync(`${TODOS_FILE}.tmp`, JSON.stringify({ tasks }, null, 2));
  fs.renameSync(`${TODOS_FILE}.tmp`, TODOS_FILE);
}
// Артикул WB: число или ссылка на товар (…/catalog/123456/detail.aspx) — из ссылки берём nmID.
function todoNmId(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const match = text.match(/catalog\/(\d{4,12})(?:\/|$|\?)/) || text.match(/^(\d{4,12})$/);
  if (!match) throw apiError(400, 'Артикул WB — число или ссылка на товар WB');
  return Number(match[1]);
}
// Новая задача берёт все поля (пустые — по умолчанию), изменение — только присланные.
function todoFields(body = {}, isNew = true) {
  const fields = {},
    has = key => isNew || Object.hasOwn(body, key);
  if (has('text')) {
    const text = String(body.text || '').trim();
    if (!text) throw apiError(400, 'Пустая задача');
    if (text.length > 4000) throw apiError(400, 'Задача длиннее 4000 символов');
    fields.text = text;
  }
  if (has('type')) fields.type = TODO_TYPES.includes(body.type) ? body.type : 'other';
  if (has('priority')) fields.priority = TODO_PRIORITIES.includes(body.priority) ? body.priority : 'normal';
  if (has('cabinet')) {
    const cabinet = body.cabinet && body.cabinet !== 'demo' ? String(body.cabinet) : '';
    if (cabinet && !cabinets().some(item => item.id === cabinet)) throw apiError(400, 'Кабинет не найден');
    fields.cabinet = cabinet;
  }
  if (has('nmId')) fields.nmId = todoNmId(body.nmId);
  return fields;
}
// Название и фото товара — из карточек кабинета задачи (без кабинета — ищем во всех: артикул WB уникален).
async function todoProducts(tasks) {
  const wanted = new Set(tasks.filter(task => task.nmId).map(task => String(task.nmId))),
    products = new Map();
  if (!wanted.size) return products;
  const ids = new Set(tasks.filter(task => task.nmId).flatMap(task => (task.cabinet ? [task.cabinet] : cabinets().map(item => item.id))));
  for (const id of ids) {
    if (!cabinets().some(item => item.id === id)) continue;
    const cards = await productCards(id).catch(() => []);
    for (const card of cards)
      if (wanted.has(String(card.nmID)))
        products.set(String(card.nmID), { name: card.title || '', vendorCode: card.vendorCode || '', photo: cardPhoto(card) });
  }
  return products;
}
async function todos() {
  const tasks = readTodos(),
    products = await todoProducts(tasks);
  return { tasks: tasks.map(task => ({ ...task, product: task.nmId ? products.get(String(task.nmId)) || null : null })) };
}
// Без id — новая задача. С id: поля для изменения, done (выполнена / вернуть), comment (запись в журнал), remove.
function saveTodo(body = {}) {
  const tasks = readTodos(),
    now = new Date().toISOString();
  if (!body.id) {
    if (tasks.length >= TODO_LIMIT) throw apiError(400, `Задач больше ${TODO_LIMIT} — удалите старые из архива`);
    const task = {
      id: keywordEventId(),
      ...todoFields(body),
      createdAt: now,
      updatedAt: now,
      doneAt: null,
      log: [{ at: now, action: 'created' }]
    };
    tasks.push(task);
    writeTodos(tasks);
    return { task };
  }
  const index = tasks.findIndex(task => task.id === body.id);
  if (index < 0) throw apiError(404, 'Задача не найдена — обновите страницу');
  if (body.remove) {
    tasks.splice(index, 1);
    writeTodos(tasks);
    return { removed: body.id };
  }
  const task = { ...tasks[index] },
    log = [...(task.log || [])],
    fields = todoFields(body, false);
  const changes = Object.entries(fields)
    .filter(([key, value]) => value !== (task[key] ?? (key === 'nmId' ? null : '')))
    .map(([field, to]) => ({ field, from: task[field] ?? null, to }));
  if (changes.length) {
    Object.assign(task, fields);
    log.push({ at: now, action: 'edited', changes });
  }
  const comment = String(body.comment || '').trim();
  if (comment.length > 2000) throw apiError(400, 'Комментарий длиннее 2000 символов');
  if (comment) log.push({ at: now, action: 'comment', text: comment });
  if (Object.hasOwn(body, 'done') && Boolean(body.done) !== Boolean(task.doneAt)) {
    task.doneAt = body.done ? now : null;
    log.push({ at: now, action: body.done ? 'done' : 'reopened' });
  }
  if (log.length === (task.log || []).length) return { task };
  task.log = log;
  task.updatedAt = now;
  tasks[index] = task;
  writeTodos(tasks);
  return { task };
}

module.exports = { saveTodo, todoFields, todoNmId, todos };
