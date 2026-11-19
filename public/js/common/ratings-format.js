// --- Оценки на WB: общие для главной страницы, страницы карточки и детализации товара ---
// word(5) → «оценок», number(12179) → «12 179», star(4.1) → «4,1», starsTitle([1★, 2★, 3★, 4★, 5★]) — строки
// «5★ — 8 806 (72%)» для подсказки. Подключается до скриптов, которые берут window.WBRatings.
(() => {
  const word = count => {
    const a = count % 100,
      b = count % 10;
    return a > 10 && a < 20 ? 'оценок' : b === 1 ? 'оценка' : b > 1 && b < 5 ? 'оценки' : 'оценок';
  };
  const number = value => Number(value || 0).toLocaleString('ru-RU');
  const star = value => Number(value).toLocaleString('ru-RU', { minimumFractionDigits: value >= 10 ? 0 : 1, maximumFractionDigits: 2 });
  const starsTitle = stars => {
    const total = stars.reduce((sum, value) => sum + value, 0);
    return total
      ? [5, 4, 3, 2, 1].map(item => `${item}★ — ${number(stars[item - 1])} (${Math.round((stars[item - 1] / total) * 100)}%)`).join('\n')
      : '';
  };
  window.WBRatings = { word, number, star, starsTitle };
})();
