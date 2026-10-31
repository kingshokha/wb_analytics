const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const createCommunications = require('../communications');

// Модуль на заглушках: только демо-кабинет, запросы в WB запрещены.
function setup() {
  const cache = new Map(), chatsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-chats-'));
  const apiError = (status, message, details) => Object.assign(new Error(message), { status, details });
  const module = createCommunications({
    wbRequest: () => { throw new Error('WB вызывать нельзя'); }, tokenFor: () => { throw new Error('нет токена'); }, cabinets: () => [],
    cachedAnalytics: async (key, loader) => { if (!cache.has(key)) cache.set(key, await loader()); return cache.get(key); }, analyticsCache: cache,
    apiError, readJson: async req => JSON.parse(req.body || '{}'), send: (res, status, payload) => { res.status = status; res.payload = payload; }, chatsDir
  });
  const call = async (method, target, body) => {
    const url = new URL(`http://local${target}`), req = { method, body: body === undefined ? '' : JSON.stringify(body), async *[Symbol.asyncIterator]() { if (this.body) yield Buffer.from(this.body); } }, res = {};
    assert.equal(await module.handle(req, res, url), true);
    return res.payload;
  };
  return { module, call, cleanup: () => fs.rmSync(chatsDir, { recursive: true, force: true }) };
}

test('сообщения: чат ждёт ответа, если последнее сообщение от покупателя не старше 10 дней; новые чаты сверху', () => {
  const { module, cleanup } = setup();
  try {
    const day = 86_400_000, now = 100 * day;
    const chats = [{ chatID: 'a', clientName: 'Анна', goodCard: { nmID: 1, name: 'Футболка' } }, { chatID: 'b', clientName: 'Борис', goodCard: { nmID: 2 } }, { chatID: 'c', clientName: 'Вера', goodCard: { nmID: 3 } }];
    const events = [
      { chatID: 'a', eventID: '1', addTimestamp: now - 3 * day, sender: 'client', message: { text: 'Вопрос' } },
      { chatID: 'a', eventID: '2', addTimestamp: now - 2 * day, sender: 'seller', message: { text: 'Ответ' } },
      { chatID: 'b', eventID: '3', addTimestamp: now - day, sender: 'client', message: { text: 'Где заказ?' } },
      { chatID: 'c', eventID: '4', addTimestamp: now - 40 * day, sender: 'client', message: { text: 'Старый вопрос' } }
    ];
    const list = module.chatsFrom(chats, events, now);
    assert.deepEqual(list.map(chat => [chat.chatId, chat.awaiting, chat.unanswered, chat.lastText]), [['b', true, true, 'Где заказ?'], ['a', false, false, 'Ответ'], ['c', false, true, 'Старый вопрос']]);
    assert.equal(list[1].product.name, 'Футболка');
  } finally { cleanup(); }
});

test('сообщения: в заявке — только известные действия с подписями, ссылки на фото с https', () => {
  const { module, cleanup } = setup();
  try {
    const claim = module.claimOf({ id: 'x', claim_type: 3, status: 0, status_ex: 0, nm_id: 5, photos: ['//photos.wb.ru/1.webp'], video_paths: [], actions: ['approve1', 'rejectcustom', 'unknown'] });
    assert.equal(claim.source, 'чат');
    assert.deepEqual(claim.photos, ['https://photos.wb.ru/1.webp']);
    assert.deepEqual(claim.actions.map(item => item.action), ['approve1', 'rejectcustom']);
  } finally { cleanup(); }
});

test('сообщения (демо): ответы только с подтверждением и по правилам WB', async () => {
  const { call, cleanup } = setup();
  try {
    const summary = await call('GET', '/api/messages/summary?cabinet=demo');
    assert.deepEqual([summary.chats.count, summary.questions.count, summary.feedbacks.count, summary.claims.count], [2, 2, 2, 1]);
    // Вопрос: без подтверждения — отказ; с подтверждением — ответ, вопрос уходит из «без ответа».
    await assert.rejects(call('POST', '/api/messages/question', { cabinet: 'demo', id: 'demo-q-1', action: 'answer', text: 'Будет в ноябре' }), /Подтвердите/);
    await call('POST', '/api/messages/question', { cabinet: 'demo', id: 'demo-q-1', action: 'answer', text: 'Будет в ноябре', confirm: true });
    assert.deepEqual((await call('GET', '/api/messages/questions?cabinet=demo')).items.map(item => item.id), ['demo-q-2']);
    // Отзыв: ответ — от 2 символов.
    await assert.rejects(call('POST', '/api/messages/feedback', { cabinet: 'demo', id: 'demo-f-1', action: 'answer', text: 'О', confirm: true }), /не короче 2/);
    await call('POST', '/api/messages/feedback', { cabinet: 'demo', id: 'demo-f-1', action: 'answer', text: 'Спасибо, разберёмся', confirm: true });
    // Заявка: отклонение с комментарием — комментарий от 10 символов; после ответа заявка уходит в архив.
    const claimId = (await call('GET', '/api/messages/claims?cabinet=demo')).items[0].id;
    await assert.rejects(call('POST', '/api/messages/claim', { cabinet: 'demo', id: claimId, action: 'rejectcustom', comment: 'нет', confirm: true }), /не короче 10/);
    await call('POST', '/api/messages/claim', { cabinet: 'demo', id: claimId, action: 'approve1', confirm: true });
    assert.equal((await call('GET', '/api/messages/claims?cabinet=demo')).total, 0);
    assert.equal((await call('GET', '/api/messages/claims?cabinet=demo&archive=1')).items[0].statusEx, 10);
  } finally { cleanup(); }
});
