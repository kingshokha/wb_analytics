// --- «История изменений»: всё, что Google Таблица записала в историю, — одной лентой с фильтрами ---
// Данные — /api/sheet-history?all=1&cabinet=: цены, кампании (статус, название, места показа, состав), ставки, минус-фразы
// и остатки FBW / FBS. Сначала копия с компьютера (data/Sheet), потом дозагрузка из таблицы (SheetSync).
// Период — общий период сайта (даты сверху), время и дни — местные (Душанбе), дни отделены строкой с датой. Фильтры: поиск, разделы (кнопки со счётчиками), вид изменения.
// Только изменения кабинета, выбранного на сайте: сервер сопоставляет его с кабинетом таблицы по названию и убирает
// цену в WB Клубе, изменившуюся так же, как цена со скидкой. Кампании (реклама, ставки, минус-фразы) — ссылками на детализацию кампании, товары — на детализацию товара.
// В кабинете бывают десятки тысяч строк: день, вид изменения и текст для поиска считаются один раз при загрузке,
// строки периода запоминаются, поиск ждёт паузы в наборе — смена фильтров не пересчитывает время каждой строки.
// Файл подключается до app.js: $, state, escapeHtml и прочее из app.js используются только внутри функций.
const CHANGE_SECTIONS=['Реклама','Ставки','Ключевые слова','Цены','Остатки FBW','Остатки FBS'];
const CHANGE_CAMPAIGN_SECTIONS=['Реклама','Ставки','Ключевые слова'];
const changeView={data:null,error:'',loading:false,request:0,key:'',cabinet:'',period:null,periodKey:'',sections:new Set(),kind:'',search:'',searchTimer:0,page:1,pageSize:pageSizeFor('history')};

// Время — местное, Душанбе (как в «Заказах по часам»); по нему же дни периода и разделители дней в таблице.
// Форматы создаются один раз: toLocale…String с часовым поясом на каждую строку — это секунды на 20 000 строк.
const CHANGE_TIMEZONE='Asia/Dushanbe';
const CHANGE_FORMAT={
  day:new Intl.DateTimeFormat('sv-SE',{timeZone:CHANGE_TIMEZONE,year:'numeric',month:'2-digit',day:'2-digit'}),
  time:new Intl.DateTimeFormat('ru-RU',{timeZone:CHANGE_TIMEZONE,day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'}),
  clock:new Intl.DateTimeFormat('ru-RU',{timeZone:CHANGE_TIMEZONE,hour:'2-digit',minute:'2-digit'}),
  title:new Intl.DateTimeFormat('ru-RU',{timeZone:CHANGE_TIMEZONE,day:'numeric',month:'long',year:'numeric',weekday:'long'})
};
const changeFormat=(format,iso)=>{const date=new Date(iso);return Number.isNaN(date.getTime())?'':CHANGE_FORMAT[format].format(date)};
const changeDay=iso=>changeFormat('day',iso);
const changeTime=iso=>changeFormat('time',iso).replace(',','');
const changeClock=iso=>changeFormat('clock',iso);
// «Вторник, 20 октября 2026»: заглавная только первая буква, без «г.».
const changeDayTitle=iso=>{const text=changeFormat('title',iso).replace(/\s*г\.$/,'');return text.charAt(0).toUpperCase()+text.slice(1)};
// Вид изменения для фильтра: у остатков «что» — склад, у минус-фраз и состава кампании — текст после двоеточия.
const changeKind=item=>item.section.startsWith('Остатки ')?'Остаток на складе':String(item.what||'').split(':')[0].replace(/, ₽$/,'').trim()||'—';
// Один раз на загрузку: день, вид изменения и текст для поиска у каждой строки.
function prepareChangeItems(data){
  for(const item of data?.items||[]){item.day=changeDay(item.at);item.kind=changeKind(item);item.text=[item.section,item.id,item.title,item.what,item.before,item.after].join(' ').toLowerCase()}
  return data;
}

// Сначала копия с компьютера — таблица рисуется сразу, потом дозагрузка из Google Таблицы. Запрос — с начала периода
// до сегодня (сервер считает дни назад от текущего момента), лишнее по дате «по» отсекает фильтр.
// Другой кабинет — другой запрос; строки прежнего кабинета не показываются, пока грузятся новые.
function loadChangeHistory(force=false){
  const from=$('#dateFrom').value,days=Math.max(1,Math.ceil((Date.now()-Date.parse(`${from}T00:00:00+03:00`))/86_400_000)+1),cabinet=state.cabinet,key=`${cabinet}|${days}`;
  if(!force&&changeView.key===key&&changeView.data){renderChangeHistory();return}
  const request=++changeView.request;changeView.key=key;changeView.loading=true;
  if(changeView.cabinet!==cabinet){changeView.data=null;changeView.cabinet=cabinet;changeView.page=1;changeView.kind=''}
  if(!changeView.data){$('#changeCount').textContent='Загрузка истории…';$('#changeBody').innerHTML=''}
  window.SheetSync?.load(`/api/sheet-history?${new URLSearchParams({all:'1',days:String(days),cabinet})}`,(data,phase,error,previous)=>{
    if(request!==changeView.request)return;
    $('#changeHint').textContent=SheetSync.hint(data,phase,error,previous);
    if(data){changeView.data=prepareChangeItems(data);changeView.error=''}else if(error&&!changeView.data)changeView.error=error.message;
    if(phase==='sheet')changeView.loading=false;
    renderChangeHistory();
  });
}

// Строки периода (без фильтров) — для счётчиков на кнопках разделов; пересчитываются при новых данных или датах.
function changePeriodItems(){
  const v=changeView,from=$('#dateFrom').value,to=$('#dateTo').value,key=`${from}|${to}`;
  if(v.period?.data!==v.data||v.periodKey!==key){v.period={data:v.data,items:(v.data?.items||[]).filter(item=>item.day>=from&&item.day<=to)};v.periodKey=key}
  return v.period.items;
}
function changeRows(period){
  const v=changeView,term=v.search.trim().toLowerCase();
  return period.filter(item=>(!v.sections.size||v.sections.has(item.section))&&(!v.kind||item.kind===v.kind)&&(!term||item.text.includes(term)));
}
function changeLink(page,params,label,title){
  const query=new URLSearchParams({...params,from:$('#dateFrom').value,to:$('#dateTo').value});
  return `<a class="change-link" href="/${page}?${query}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(title)}">${escapeHtml(label)}</a>`;
}
// Объект изменения. У ставок и минус-фраз подпись таблицы — «Кампания · артикул (артикул продавца)», ID — кампания.
// У цен и остатков подпись — «артикул продавца · название», ID — артикул WB.
function changeObject(item){
  const cabinet=state.cabinet,title=String(item.title||'');
  if(CHANGE_CAMPAIGN_SECTIONS.includes(item.section)){
    const parts=title.split(' · '),product=item.section==='Реклама'?'':parts.slice(1).join(' · '),name=(item.section==='Реклама'?title:parts[0])||`Кампания ${item.id}`;
    const nmId=product.match(/^\d+/)?.[0];
    const productHtml=product?` · ${nmId?changeLink('product.html',{cabinet,nmId},product,'Открыть детализацию товара'):escapeHtml(product)}`:'';
    return `${changeLink('campaign.html',{cabinet,id:item.id},name,'Открыть детализацию кампании')}<small>Кампания ${escapeHtml(item.id)}${productHtml}</small>`;
  }
  return `${changeLink('product.html',{cabinet,nmId:item.id},title||`Артикул ${item.id}`,'Открыть детализацию товара')}<small>Артикул ${escapeHtml(item.id)}</small>`;
}
// Значение «было / стало»: рубли, штуки, «выкл.» для выключенного места показа, длинные списки артикулов — сокращённо.
function changeValue(item,value){
  if(value===''||value==null||value==='—')return item.section==='Ставки'?'<span class="change-muted">выкл.</span>':'<span class="change-muted">—</span>';
  const number=typeof value==='number'||/^-?\d+(\.\d+)?$/.test(String(value))?Number(value):null;
  if(number!=null&&/₽/.test(item.what||''))return `${fmtNum(number)} ₽`;
  if(number!=null&&item.section.startsWith('Остатки '))return `${fmtNum(number)} шт`;
  if(number!=null)return fmtNum(number);
  const text=String(value);
  return text.length>80?`<span title="${escapeHtml(text)}">${escapeHtml(text.slice(0,77))}…</span>`:escapeHtml(text);
}
function changeDelta(item){
  const before=Number(item.before),after=Number(item.after);
  if(item.before===''||item.after===''||!Number.isFinite(before)||!Number.isFinite(after)||before===after)return '';
  const diff=after-before;
  return `<small class="change-delta ${diff>0?'up':'down'}">${diff>0?'+':'−'}${fmtNum(Math.abs(diff))}</small>`;
}
function changeWhat(item){
  const what=String(item.what||'');
  if(item.section.startsWith('Остатки '))return `Остаток · ${escapeHtml(what)}`;
  return escapeHtml(what.replace(/, ₽$/,''));
}

function renderChangeHistory(){
  const v=changeView,data=v.data,body=$('#changeBody');
  if(!body)return;
  if(!data){
    $('#changeCount').textContent=v.error?`Не удалось загрузить историю: ${v.error}`:'Загрузка истории…';
    body.innerHTML='';$('#emptyChanges').classList.add('hidden');$('#changePagination').classList.add('hidden');$('#changeSections').innerHTML='';return;
  }
  if(!data.configured){
    $('#changeCount').textContent='Google Таблица не подключена';$('#changeSections').innerHTML='';body.innerHTML='';
    $('#emptyChangesText').textContent='Впишите в .env сайта WB_SHEET_URL и WB_SHEET_KEY (ключ — в таблице «WB → Ключ для сайта») и перезапустите сервер. Инструкция — google-sheets/README.md.';
    $('#emptyChanges').classList.remove('hidden');$('#changePagination').classList.add('hidden');return;
  }
  const period=changePeriodItems();
  // Кнопки разделов со счётчиками за период (с учётом поиска и вида изменения не считаем — чтобы было видно, где что есть).
  const counts=new Map(CHANGE_SECTIONS.map(section=>[section,0]));period.forEach(item=>counts.set(item.section,(counts.get(item.section)||0)+1));
  $('#changeSections').innerHTML=`<button type="button" class="change-chip${v.sections.size?'':' active'}" data-change-section="">Все <b>${fmtNum(period.length)}</b></button>`+
    CHANGE_SECTIONS.map(section=>`<button type="button" class="change-chip${v.sections.has(section)?' active':''}" data-change-section="${escapeHtml(section)}" aria-pressed="${v.sections.has(section)}">${escapeHtml(section)} <b>${fmtNum(counts.get(section)||0)}</b></button>`).join('');
  // Виды изменений — из данных периода; выбранное значение остаётся в списке, даже если строк с ним нет.
  const kinds=[...new Set([...period.filter(item=>!v.sections.size||v.sections.has(item.section)).map(item=>item.kind),v.kind].filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru'));
  $('#changeKind').innerHTML=`<option value="">Все изменения</option>${kinds.map(kind=>`<option value="${escapeHtml(kind)}"${kind===v.kind?' selected':''}>${escapeHtml(kind)}</option>`).join('')}`;

  const rows=changeRows(period),pageCount=Math.ceil(rows.length/v.pageSize);
  v.page=Math.min(Math.max(1,v.page),Math.max(1,pageCount));
  const since=data.since?` · таблица следит с ${changeTime(data.since)}`:'';
  $('#changeCount').textContent=`${fmtNum(rows.length)} из ${fmtNum(period.length)} за период${since} · время местное (Душанбе)${data.truncated?' · показаны 50 000 самых новых — сократите период':''}`;
  // Перед первой строкой каждого дня — строка-разделитель с датой (и в начале страницы, чтобы день был виден сразу).
  let lastDay='';
  body.innerHTML=rows.slice((v.page-1)*v.pageSize,v.page*v.pageSize).map(item=>{
    const day=item.day,head=day!==lastDay?`<tr class="change-day-row"><td colspan="6">${escapeHtml(changeDayTitle(item.at))}</td></tr>`:'';lastDay=day;
    return `${head}<tr>
    <td class="change-when">${escapeHtml(changeClock(item.at))}</td>
    <td><span class="change-section" data-section="${escapeHtml(item.section)}">${escapeHtml(item.section)}</span></td>
    <td class="change-object">${changeObject(item)}</td><td class="change-what">${changeWhat(item)}</td>
    <td class="change-value">${changeValue(item,item.before)}</td><td class="change-value">${changeValue(item,item.after)}${changeDelta(item)}</td></tr>`}).join('');
  $('#emptyChangesText').textContent=period.length?'Измените фильтры.':'Таблица записывает изменения раз в час — у этого кабинета за этот период их нет. Выберите другой период или кабинет.';
  $('#emptyChanges').classList.toggle('hidden',rows.length>0);
  renderPager($('#changePagination'),{page:v.page,pageCount,total:rows.length,sizeKey:'history',onPage:page=>{v.page=page;renderChangeHistory();document.querySelector('#page-history .stock-panel')?.scrollIntoView({behavior:'smooth',block:'start'})},onSize:size=>{v.pageSize=size;v.page=1;renderChangeHistory()}});
}

// Через document: скрипт подключается раньше app.js, где объявлен $.
document.addEventListener('click',event=>{
  const chip=event.target.closest('[data-change-section]');
  if(chip){
    const section=chip.dataset.changeSection;
    if(!section)changeView.sections.clear();else changeView.sections.has(section)?changeView.sections.delete(section):changeView.sections.add(section);
    changeView.kind='';changeView.page=1;renderChangeHistory();
  }
});
// Поиск — после паузы в наборе: не пересчитывать таблицу на каждую букву.
document.addEventListener('input',event=>{
  if(event.target.id!=='changeSearch')return;
  clearTimeout(changeView.searchTimer);
  changeView.searchTimer=setTimeout(()=>{changeView.search=event.target.value;changeView.page=1;if(changeView.data)renderChangeHistory()},250);
});
document.addEventListener('change',event=>{
  // Период: история берётся с компьютера быстро, поэтому пересчитываем сразу, без кнопки «Обновить».
  if(['dateFrom','dateTo'].includes(event.target.id)&&state.activePage==='history'){changeView.page=1;loadChangeHistory()}
  if(event.target.id==='changeKind'){changeView.kind=event.target.value;changeView.page=1;renderChangeHistory()}
});
