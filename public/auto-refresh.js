// --- Автообновление: «Сводка», «Реклама» и «Воронка» перезагружают данные каждые 2 минуты, пока вкладка браузера видна ---
// Тихо: без экрана загрузки, страница таблиц и выбранные фильтры не сбрасываются, при ошибке остаются прежние данные.
// Пропускается, пока открыто окно или идёт ручная загрузка. Ручное обновление, переход в раздел, смена дат или кабинета
// начинают отсчёт заново. Детализация кампании обновляется так же — её код в campaign.js.
const AUTO_REFRESH_MS=2*60_000;
const AUTO_REFRESH_PAGES={
  summary:()=>Promise.all([loadSummary(true,true),loadSummaryAds(summaryView.key)]),
  ads:()=>refreshAdsSilently(),
  funnel:()=>loadFunnelDetails(true)
};
let autoRefreshAt=Date.now();
document.addEventListener('click',event=>{if(event.target.closest('.nav-item,#refresh,#cabinetMenu'))autoRefreshAt=Date.now()},true);
document.addEventListener('change',event=>{if(event.target.closest('#dateFrom,#dateTo'))autoRefreshAt=Date.now()},true);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)autoRefreshTick()});
function autoRefreshBusy(){return document.hidden||$('#modal')?.classList.contains('open')||$('#refresh')?.classList.contains('loading')}
async function autoRefreshTick(){
  const run=AUTO_REFRESH_PAGES[state.activePage];
  if(!run||Date.now()-autoRefreshAt<AUTO_REFRESH_MS||autoRefreshBusy())return;
  autoRefreshAt=Date.now();
  await run().catch(()=>{});
}
setInterval(autoRefreshTick,10_000);
