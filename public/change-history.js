// --- «История изменений»: всё, что Google Таблица записала в историю, — одной лентой с фильтрами ---
// Данные — /api/sheet-history?all=1: цены, кампании (статус, название, места показа, состав), ставки, минус-фразы
// и остатки FBW / FBS. Сначала копия с компьютера (data/Sheet), потом дозагрузка из таблицы (SheetSync).
// Период — общий период сайта (даты сверху), время и дни — местные (Душанбе), дни отделены строкой с датой. Фильтры: поиск, разделы (кнопки со счётчиками), вид изменения.
// Показываются только изменения кабинета, выбранного на сайте. Кампании (реклама, ставки, минус-фразы) — ссылками на детализацию кампании, товары — на детализацию товара.
// Цена в WB Клубе, изменившаяся так же, как цена со скидкой (клубной скидки нет), отдельной строкой не показывается.
// Файл подключается до app.js: $, state, escapeHtml и прочее из app.js используются только внутри функций.
const CHANGE_SECTIONS=['Реклама','Ставки','Ключевые слова','Цены','Остатки FBW','Остатки FBS'];
const CHANGE_CAMPAIGN_SECTIONS=['Реклама','Ставки','Ключевые слова'];
const changeView={data:null,error:'',loading:false,request:0,key:'',cabinet:'',sections:new Set(),kind:'',search:'',page:1,pageSize:pageSizeFor('history')};

// Время — местное, Душанбе (как в «Заказах по часам»); по нему же дни периода и разделители дней в таблице.
const CHANGE_TIMEZONE='Asia/Dushanbe';
const changeDay=iso=>new Date(iso).toLocaleDateString('sv-SE',{timeZone:CHANGE_TIMEZONE});
const changeTime=iso=>new Date(iso).toLocaleString('ru-RU',{timeZone:CHANGE_TIMEZONE,day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'}).replace(',','');
const changeClock=iso=>new Date(iso).toLocaleTimeString('ru-RU',{timeZone:CHANGE_TIMEZONE,hour:'2-digit',minute:'2-digit'});
// «Вторник, 20 октября 2026»: заглавная только первая буква, без «г.».
const changeDayTitle=iso=>{const text=new Date(iso).toLocaleDateString('ru-RU',{timeZone:CHANGE_TIMEZONE,day:'numeric',month:'long',year:'numeric',weekday:'long'}).replace(/\s*г\.$/,'');return text.charAt(0).toUpperCase()+text.slice(1)};
// Вид изменения для фильтра: у остатков «что» — склад, у минус-фраз и состава кампании — текст после двоеточия.
const changeKind=item=>item.section.startsWith('Остатки ')?'Остаток на складе':String(item.what||'').split(':')[0].replace(/, ₽$/,'').trim()||'—';

// Сначала копия с компьютера — таблица рисуется сразу, потом дозагрузка из Google Таблицы. Запрос — с начала периода
// до сегодня (сервер считает дни назад от текущего момента), лишнее по дате «по» отсекает фильтр.
function loadChangeHistory(force=false){
  const from=$('#dateFrom').value,days=Math.max(1,Math.ceil((Date.now()-Date.parse(`${from}T00:00:00+03:00`))/86_400_000)+1),key=String(days);
  if(!force&&changeView.key===key&&changeView.data){renderChangeHistory();return}
  const request=++changeView.request;changeView.key=key;changeView.loading=true;
  if(!changeView.data){$('#changeCount').textContent='Загрузка истории…';$('#changeBody').innerHTML=''}
  window.SheetSync?.load(`/api/sheet-history?${new URLSearchParams({all:'1',days:String(days)})}`,(data,phase,error,previous)=>{
    if(request!==changeView.request)return;
    $('#changeHint').textContent=SheetSync.hint(data,phase,error,previous);
    if(data){changeView.data=data;changeView.error=''}else if(error&&!changeView.data)changeView.error=error.message;
    if(phase==='sheet')changeView.loading=false;
    renderChangeHistory();
  });
}

// Кабинет сайта по названию из таблицы. Названия заданы отдельно на сайте и в таблице («2 ИП Шамсиддинов» и «ИП Шамсиддинов»),
// поэтому сравниваются без номера в начале и без регистра: сначала точно, потом — одно содержит другое, если такой кабинет один.
const changeCabinetKey=name=>String(name||'').toLowerCase().replace(/ё/g,'е').replace(/^[\s\d.,)№#-]+/,'').replace(/\s+/g,' ').trim();
function changeSiteCabinet(name){
  const key=changeCabinetKey(name),list=(state.cabinets||[]).map(item=>({id:item.id,key:changeCabinetKey(item.name)}));
  if(!key)return '';
  const exact=list.filter(item=>item.key===key);
  if(exact.length===1)return exact[0].id;
  const near=list.filter(item=>item.key&&(item.key.includes(key)||key.includes(item.key)));
  return near.length===1?near[0].id:'';
}

// Строки периода выбранного кабинета (без фильтров) — для счётчиков на кнопках разделов.
// Строка «Цена в WB Клубе» с теми же «было» и «стало», что у «Цены со скидкой» того же товара в то же время, — повтор, её нет.
function changePeriodItems(){
  const from=$('#dateFrom').value,to=$('#dateTo').value,cabinets=new Map();
  const ofCabinet=name=>{if(!cabinets.has(name))cabinets.set(name,changeSiteCabinet(name)===state.cabinet);return cabinets.get(name)};
  const priceKey=item=>[item.at,item.cabinet,item.id,item.before,item.after].map(value=>String(value??'')).join('|');
  const items=(changeView.data?.items||[]).filter(item=>{const day=changeDay(item.at);return day>=from&&day<=to&&ofCabinet(item.cabinet)});
  const discounted=new Set(items.filter(item=>item.section==='Цены'&&item.what==='Цена со скидкой, ₽').map(priceKey));
  return items.filter(item=>!(item.section==='Цены'&&item.what==='Цена в WB Клубе, ₽'&&discounted.has(priceKey(item))));
}
function changeRows(period){
  const v=changeView,term=v.search.trim().toLowerCase();
  return period.filter(item=>(!v.sections.size||v.sections.has(item.section))&&(!v.kind||changeKind(item)===v.kind)
    &&(!term||[item.section,item.id,item.title,item.what,item.before,item.after].join(' ').toLowerCase().includes(term)));
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
  // Другой кабинет — с первой страницы и без вида изменения: у него свои виды.
  if(v.cabinet!==state.cabinet){v.cabinet=state.cabinet;v.page=1;v.kind=''}
  const period=changePeriodItems();
  // Кнопки разделов со счётчиками за период (с учётом поиска и вида изменения не считаем — чтобы было видно, где что есть).
  const counts=new Map(CHANGE_SECTIONS.map(section=>[section,0]));period.forEach(item=>counts.set(item.section,(counts.get(item.section)||0)+1));
  $('#changeSections').innerHTML=`<button type="button" class="change-chip${v.sections.size?'':' active'}" data-change-section="">Все <b>${fmtNum(period.length)}</b></button>`+
    CHANGE_SECTIONS.map(section=>`<button type="button" class="change-chip${v.sections.has(section)?' active':''}" data-change-section="${escapeHtml(section)}" aria-pressed="${v.sections.has(section)}">${escapeHtml(section)} <b>${fmtNum(counts.get(section)||0)}</b></button>`).join('');
  // Виды изменений — из данных периода; выбранное значение остаётся в списке, даже если строк с ним нет.
  const kinds=[...new Set([...period.filter(item=>!v.sections.size||v.sections.has(item.section)).map(changeKind),v.kind].filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru'));
  $('#changeKind').innerHTML=`<option value="">Все изменения</option>${kinds.map(kind=>`<option value="${escapeHtml(kind)}"${kind===v.kind?' selected':''}>${escapeHtml(kind)}</option>`).join('')}`;

  const rows=changeRows(period),pageCount=Math.ceil(rows.length/v.pageSize);
  v.page=Math.min(Math.max(1,v.page),Math.max(1,pageCount));
  const since=data.since?` · таблица следит с ${changeTime(data.since)}`:'';
  $('#changeCount').textContent=`${fmtNum(rows.length)} из ${fmtNum(period.length)} за период${since} · время местное (Душанбе)${data.truncated?' · показаны 50 000 самых новых — сократите период':''}`;
  // Перед первой строкой каждого дня — строка-разделитель с датой (и в начале страницы, чтобы день был виден сразу).
  let lastDay='';
  body.innerHTML=rows.slice((v.page-1)*v.pageSize,v.page*v.pageSize).map(item=>{
    const day=changeDay(item.at),head=day!==lastDay?`<tr class="change-day-row"><td colspan="6">${escapeHtml(changeDayTitle(item.at))}</td></tr>`:'';lastDay=day;
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
document.addEventListener('input',event=>{if(event.target.id!=='changeSearch')return;changeView.search=event.target.value;changeView.page=1;if(changeView.data)renderChangeHistory()});
document.addEventListener('change',event=>{
  // Период: история берётся с компьютера быстро, поэтому пересчитываем сразу, без кнопки «Обновить».
  if(['dateFrom','dateTo'].includes(event.target.id)&&state.activePage==='history'){changeView.page=1;loadChangeHistory()}
  if(event.target.id==='changeKind'){changeView.kind=event.target.value;changeView.page=1;renderChangeHistory()}
});
