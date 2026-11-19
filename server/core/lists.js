'use strict';
// --- Списки, которые сервер собирает по частям (цены, остатки): ответ — снимок того, что уже есть, сайт переспрашивает.
const { wait } = require('./base');
const { productCards, productCardsLoading } = require('./product-cards');

// --- Списки, которые сервер собирает по частям: цены, остатки FBS и FBW ---
// У кабинета с тысячами карточек одни карточки (по 100 за запрос) грузятся минуту. Чтобы не ждать, список собирается
// в фоне, а ответ — снимок того, что уже есть (partial: true): строки с названиями и фото тех карточек, что уже пришли.
// Сайт опрашивает, пока partial. Готовый список хранится ttl; force — собрать заново (кнопка «Обновить», после изменений).
const listJobs = new Map();
async function progressiveList(key, ttl, force, run) {
  let job = listJobs.get(key);
  const fresh = job?.done && Date.now() - job.doneAt < ttl;
  if (!job || (!job.running && (force || !fresh))) {
    let first;
    job = {
      running: true,
      done: false,
      snapshot: null,
      final: null,
      error: null,
      first: new Promise(resolve => {
        first = resolve;
      })
    };
    listJobs.set(key, job);
    const current = job;
    current.promise = run(snapshot => {
      current.snapshot = snapshot;
      first();
    })
      .then(
        final => {
          Object.assign(current, { final, done: true, doneAt: Date.now() });
        },
        error => {
          current.error = error;
        }
      )
      .finally(() => {
        current.running = false;
        first();
      });
  }
  // Показать ещё нечего — ждём первую порцию (до 20 с) или конец.
  if (!job.done && !job.snapshot) await Promise.race([job.first, wait(20_000)]);
  if (job.done) return { ...job.final, partial: false };
  if (job.error) {
    if (!job.snapshot) {
      listJobs.delete(key);
      throw job.error;
    }
    const data = job.snapshot();
    return { ...data, partial: false, warnings: [...(data.warnings || []), `Загрузка прервалась: ${job.error.message}`] };
  }
  return job.snapshot ? { ...job.snapshot(), partial: true } : { demo: false, rows: [], warnings: [], partial: true };
}
const forgetList = key => listJobs.delete(key);
// Карточки кабинета: готовые — сразу, а пока грузятся — те, что уже пришли. cards() — текущий список, done — промис конца.
function cardsSoFar(id, token, warnings) {
  let cards = null;
  const done = productCards(id, token).then(
    list => {
      cards = list;
    },
    error => {
      cards = [];
      warnings.push(`Карточки товаров: ${error.message}`);
    }
  );
  return { cards: () => cards || productCardsLoading.get(token) || [], loading: () => !cards, done };
}

module.exports = { cardsSoFar, forgetList, progressiveList };
