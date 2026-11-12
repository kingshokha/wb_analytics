// --- «Цены Сималенда»: история оптовых цен артикулов Сималенда из отдельной Google Таблицы ---
// Данные — /api/sima/history?days= (модуль sima-land.js): сервер раз в час загружает цены с Сималенда в таблицу
// google-sheets/sima-land, она записывает изменения цены и цены по акции «Опт», а ещё добавленные и убранные артикулы
// и товары, которых нет на Сималенде. Сначала копия с компьютера (data/Sima), потом дозагрузка из таблицы (SheetSync).
// «Загрузить цены сейчас» — POST /api/sima/refresh, не дожидаясь часа. Раздел не зависит от кабинета WB.
// Устроен как «История изменений»: дни отделены строкой с датой, время — местное (Душанбе, функции change-history.js),
// поиск по артикулу и названию, вид изменения (по умолчанию — цена по акции «Опт») и свой период (по умолчанию
// 14 дней); вид и период запоминаются в браузере; при одном виде колонка «Что изменилось» скрыта. Над таблицей —
// одна строка: последняя загрузка цен с Сималенда, ошибки и новые изменения из таблицы.
// Файл подключается до app.js: $, escapeHtml и прочее из app.js используются только внутри функций.
const SIMA_PERIODS=[[7,'7 дней'],[14,'14 дней'],[30,'30 дней'],[90,'90 дней'],[365,'Год'],[0,'Всё время']];
const SIMA_WHOLESALE='Цена по акции «Опт»';
const simaView={data:null,error:'',request:0,days:14,search:'',kind:SIMA_WHOLESALE,hint:'',searchTimer:0,page:1,pageSize:pageSizeFor('sima'),refreshing:false};
try{const saved=Number(localStorage.getItem('wb-sima-period'));if(SIMA_PERIODS.some(([days])=>days===saved)&&localStorage.getItem('wb-sima-period')!==null)simaView.days=saved}catch{/* период по умолчанию */}
try{const kind=localStorage.getItem('wb-sima-kind');if(kind!==null)simaView.kind=kind}catch{/* вид по умолчанию */}
// Цены Сималенда бывают в копейках (0,14 ₽), поэтому до двух знаков после запятой.
const simaNumber=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2});
// В «было / стало» — цены: у изменений цены и у «Добавлен в список», «Убран из списка…», «Нет на Сималенде» и т. п.
const simaIsPrice=item=>/₽|списк|Сималенд/.test(item.what||'');

// Один раз на загрузку: день, вид изменения и текст для поиска у каждой строки.
function prepareSimaItems(data){
  for(const item of data?.items||[]){item.day=changeDay(item.at);item.kind=String(item.what||'').replace(/, ₽$/,'')||'—';item.text=[item.id,item.title,item.what].join(' ').toLowerCase()}
  return data;
}
function loadSimaHistory(force=false){
  const v=simaView,key=String(v.days);
  if(!force&&v.key===key&&v.data){renderSimaHistory();return}
  const request=++v.request;v.key=key;
  if(!v.data){$('#simaCount').textContent='Загрузка истории…';$('#simaBody').innerHTML=''}
  window.SheetSync?.load(`/api/sima/history?days=${v.days}`,(data,phase,error,previous)=>{
    if(request!==v.request)return;
    // Из состояния копирования — только недоступность таблицы и «+N изменений»; «проверяем…» и «нового нет» не нужны.
    const hint=SheetSync.hint(data,phase,error,previous);
    v.hint=phase==='sheet'&&(error||data?.syncError||/^Обновлено/.test(hint))?hint:'';
    if(data){v.data=prepareSimaItems(data);v.error=''}else if(error&&!v.data)v.error=error.message;
    renderSimaHistory();
  });
}
function simaValue(item,value){
  if(value===''||value==null||value==='—')return '<span class="change-muted">—</span>';
  const number=typeof value==='number'||/^-?\d+(\.\d+)?$/.test(String(value))?Number(value):null;
  if(number!=null)return simaIsPrice(item)?`${simaNumber.format(number)} ₽`:simaNumber.format(number);
  return escapeHtml(String(value));
}
// Разница у изменения цены: в рублях и в процентах от прежней цены.
function simaDelta(item){
  const before=Number(item.before),after=Number(item.after);
  if(!/₽/.test(item.what||'')||item.before===''||item.after===''||!Number.isFinite(before)||!Number.isFinite(after)||before===after||before<=0)return '';
  const diff=after-before,sign=diff>0?'+':'−',percent=Math.abs(diff)/before*100,text=percent<0.05?'<0,1':Number(percent.toFixed(1)).toLocaleString('ru-RU');
  return `<small class="change-delta change-delta-price ${diff>0?'up':'down'}">${sign}${simaNumber.format(Math.abs(diff))} ₽ · ${sign}${text}%</small>`;
}
// Последнее обновление таблицы и, если последняя загрузка цен с компьютера не удалась, — почему.
function simaStatusText(data){
  const refresh=data.refresh||{},parts=[];
  if(refresh.running||simaView.refreshing)parts.push('Загружаем цены с Сималенда…');
  if(data.updatedAt)parts.push(`Цены загружены ${changeTime(data.updatedAt)}${data.articles?` · артикулов ${fmtNum(data.articles)}`:''}`);
  else parts.push('Цены ещё не загружались: компьютер с сайтом загружает их раз в час, или нажмите «Загрузить цены сейчас».');
  if(refresh.ok===false&&refresh.error)parts.push(`Последняя загрузка цен (${changeTime(refresh.at)}) не удалась: ${refresh.error}`);
  return parts.join(' · ');
}
// Загрузить цены сейчас: сервер берёт артикулы из таблицы, запрашивает Сималенд и записывает цены в таблицу (около
// минуты на 10 000 артикулов), потом раздел перечитывает историю.
async function refreshSimaPrices(){
  const button=$('#simaRefresh');if(simaView.refreshing)return;
  simaView.refreshing=true;button.disabled=true;button.textContent='Загружаем цены…';if(simaView.data)renderSimaHistory();
  try{
    const result=await api('/api/sima/refresh',{method:'POST',body:'{}'});
    toast(result.ok?`Цены загружены: ${result.result||'готово'}${result.first?' — первое обновление, изменения начнут записываться со следующего':''}`:`Цены не загружены: ${result.error}`);
  }catch(error){toast(error.message)}
  finally{simaView.refreshing=false;button.disabled=false;button.textContent='Загрузить цены сейчас'}
  loadSimaHistory(true);
}
function simaObject(item){
  const title=String(item.title||'')||`Артикул ${item.id}`;
  return `<a class="change-link" href="https://www.sima-land.ru/${encodeURIComponent(item.id)}/" target="_blank" rel="noopener noreferrer" title="Открыть товар на Сималенде">${escapeHtml(title)}</a><small>Артикул ${escapeHtml(item.id)}</small>`;
}

function renderSimaHistory(){
  const v=simaView,data=v.data,body=$('#simaBody');
  if(!body)return;
  $('#simaPeriod').innerHTML=SIMA_PERIODS.map(([days,label])=>`<option value="${days}"${days===v.days?' selected':''}>${label}</option>`).join('');
  const empty=text=>{body.innerHTML='';$('#simaKind').innerHTML='<option value="">Все изменения</option>';$('#simaHint').textContent=v.hint;$('#emptySimaText').textContent=text;$('#emptySima').classList.toggle('hidden',!text);$('#simaPagination').classList.add('hidden')};
  if(!data){$('#simaCount').textContent=v.error?`Не удалось загрузить историю: ${v.error}`:'Загрузка истории…';return empty('')}
  if(!data.configured){$('#simaCount').textContent='Таблица Сималенда не подключена';return empty('Впишите в .env сайта SIMA_SHEET_URL и SIMA_SHEET_KEY (ключ — в таблице «Сималенд → Ключ для сайта») и перезапустите сервер. Инструкция — google-sheets/sima-land/README.md.')}
  const all=data.items||[],term=v.search.trim().toLowerCase();
  const kinds=[...new Set([...all.map(item=>item.kind),v.kind].filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru'));
  $('#simaKind').innerHTML=`<option value="">Все изменения</option>${kinds.map(kind=>`<option value="${escapeHtml(kind)}"${kind===v.kind?' selected':''}>${escapeHtml(kind)}</option>`).join('')}`;
  const rows=all.filter(item=>(!v.kind||item.kind===v.kind)&&(!term||item.text.includes(term))),pageCount=Math.ceil(rows.length/v.pageSize);
  v.page=Math.min(Math.max(1,v.page),Math.max(1,pageCount));
  $('#simaCount').textContent=`${fmtNum(rows.length)} из ${fmtNum(all.length)} за период${data.truncated?' · показаны 200 000 самых новых — сократите период':''}`;
  // Выбран один вид изменения — колонка «Что изменилось» везде одинаковая, её не видно.
  $('#page-sima .change-table').classList.toggle('sima-one-kind',Boolean(v.kind));
  $('#simaHint').textContent=[v.hint,simaStatusText(data)].filter(Boolean).join(' · ');
  let lastDay='';
  body.innerHTML=rows.slice((v.page-1)*v.pageSize,v.page*v.pageSize).map(item=>{
    const head=item.day!==lastDay?`<tr class="change-day-row"><td colspan="${v.kind?4:5}">${escapeHtml(changeDayTitle(item.at))}</td></tr>`:'';lastDay=item.day;
    return `${head}<tr><td class="change-when">${escapeHtml(changeClock(item.at))}</td><td class="change-object">${simaObject(item)}</td><td class="change-what">${escapeHtml(item.kind)}</td>`+
      `<td class="change-value">${simaValue(item,item.before)}</td><td class="change-value">${simaValue(item,item.after)}${simaDelta(item)}</td></tr>`}).join('');
  $('#emptySimaText').textContent=all.length?'Измените поиск или вид изменения.':'Таблица проверяет цены раз в час — за этот период изменений нет. Выберите период длиннее.';
  $('#emptySima').classList.toggle('hidden',rows.length>0);
  renderPager($('#simaPagination'),{page:v.page,pageCount,total:rows.length,sizeKey:'sima',onPage:page=>{v.page=page;renderSimaHistory();document.querySelector('#page-sima .stock-panel')?.scrollIntoView({behavior:'smooth',block:'start'})},onSize:size=>{v.pageSize=size;v.page=1;renderSimaHistory()}});
}

document.addEventListener('click',event=>{if(event.target.closest('#simaRefresh'))refreshSimaPrices()});
// Поиск — после паузы в наборе: не пересчитывать таблицу на каждую букву.
document.addEventListener('input',event=>{
  if(event.target.id!=='simaSearch')return;
  clearTimeout(simaView.searchTimer);
  simaView.searchTimer=setTimeout(()=>{simaView.search=event.target.value;simaView.page=1;if(simaView.data)renderSimaHistory()},250);
});
document.addEventListener('change',event=>{
  if(event.target.id==='simaKind'){simaView.kind=event.target.value;simaView.page=1;try{localStorage.setItem('wb-sima-kind',simaView.kind)}catch{/* без сохранения */}renderSimaHistory()}
  if(event.target.id==='simaPeriod'){simaView.days=Number(event.target.value);simaView.page=1;try{localStorage.setItem('wb-sima-period',String(simaView.days))}catch{/* без сохранения */}loadSimaHistory()}
});
