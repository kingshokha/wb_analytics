// --- «История изменений»: всё, что Google Таблица записала в историю, — одной лентой с фильтрами ---
// Данные — /api/sheet-history?all=1: цены, кампании (статус, название, места показа, состав), ставки, минус-фразы
// и остатки FBW / FBS. Сначала копия с компьютера (data/Sheet), потом дозагрузка из таблицы (SheetSync).
// Период — общий период сайта (даты сверху). Фильтры: поиск, разделы (кнопки со счётчиками), кабинет, вид изменения.
// Кампании (реклама, ставки, минус-фразы) — ссылками на детализацию кампании, товары — на детализацию товара.
// В таблице кабинет записан названием: ссылка ведёт в кабинет сайта с тем же названием, иначе — в выбранный на сайте.
// Файл подключается до app.js: $, state, escapeHtml и прочее из app.js используются только внутри функций.
const CHANGE_SECTIONS=['Реклама','Ставки','Ключевые слова','Цены','Остатки FBW','Остатки FBS'];
const CHANGE_CAMPAIGN_SECTIONS=['Реклама','Ставки','Ключевые слова'];
const CHANGE_PAGE_SIZE=100;
const changeView={data:null,error:'',loading:false,request:0,key:'',sections:new Set(),cabinet:'',kind:'',search:'',page:1};

const changeDay=iso=>new Date(iso).toLocaleDateString('sv-SE',{timeZone:'Europe/Moscow'});
const changeTime=iso=>new Date(iso).toLocaleString('ru-RU',{timeZone:'Europe/Moscow',day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'}).replace(',','');
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

// Строки периода (без фильтров) — для счётчиков на кнопках разделов.
function changePeriodItems(){
  const from=$('#dateFrom').value,to=$('#dateTo').value;
  return (changeView.data?.items||[]).filter(item=>{const day=changeDay(item.at);return day>=from&&day<=to});
}
function changeRows(period){
  const v=changeView,term=v.search.trim().toLowerCase();
  return period.filter(item=>(!v.sections.size||v.sections.has(item.section))&&(!v.cabinet||item.cabinet===v.cabinet)&&(!v.kind||changeKind(item)===v.kind)
    &&(!term||[item.cabinet,item.section,item.id,item.title,item.what,item.before,item.after].join(' ').toLowerCase().includes(term)));
}

// Кабинет сайта для ссылки: с тем же названием, что в таблице; иначе — выбранный на сайте.
function changeSiteCabinet(name){
  const found=(state.cabinets||[]).find(item=>String(item.name||'').trim().toLowerCase()===String(name||'').trim().toLowerCase());
  return found?.id||state.cabinet||'demo';
}
function changeLink(page,params,label,title){
  const query=new URLSearchParams({...params,from:$('#dateFrom').value,to:$('#dateTo').value});
  return `<a class="change-link" href="/${page}?${query}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(title)}">${escapeHtml(label)}</a>`;
}
// Объект изменения. У ставок и минус-фраз подпись таблицы — «Кампания · артикул (артикул продавца)», ID — кампания.
// У цен и остатков подпись — «артикул продавца · название», ID — артикул WB.
function changeObject(item){
  const cabinet=changeSiteCabinet(item.cabinet),title=String(item.title||'');
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
  // Кнопки разделов со счётчиками за период (с учётом кабинета, поиска и вида изменения не считаем — чтобы было видно, где что есть).
  const counts=new Map(CHANGE_SECTIONS.map(section=>[section,0]));period.forEach(item=>counts.set(item.section,(counts.get(item.section)||0)+1));
  $('#changeSections').innerHTML=`<button type="button" class="change-chip${v.sections.size?'':' active'}" data-change-section="">Все <b>${fmtNum(period.length)}</b></button>`+
    CHANGE_SECTIONS.map(section=>`<button type="button" class="change-chip${v.sections.has(section)?' active':''}" data-change-section="${escapeHtml(section)}" aria-pressed="${v.sections.has(section)}">${escapeHtml(section)} <b>${fmtNum(counts.get(section)||0)}</b></button>`).join('');
  // Кабинеты и виды изменений — из данных периода; выбранное значение остаётся в списке, даже если строк с ним нет.
  const cabinets=[...new Set([...period.map(item=>item.cabinet),v.cabinet].filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru'));
  $('#changeCabinet').innerHTML=`<option value="">Все кабинеты</option>${cabinets.map(name=>`<option value="${escapeHtml(name)}"${name===v.cabinet?' selected':''}>${escapeHtml(name)}</option>`).join('')}`;
  $('#changeCabinet').classList.toggle('hidden',cabinets.length<2&&!v.cabinet);
  const kinds=[...new Set([...period.filter(item=>!v.sections.size||v.sections.has(item.section)).map(changeKind),v.kind].filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru'));
  $('#changeKind').innerHTML=`<option value="">Все изменения</option>${kinds.map(kind=>`<option value="${escapeHtml(kind)}"${kind===v.kind?' selected':''}>${escapeHtml(kind)}</option>`).join('')}`;

  const rows=changeRows(period),pageCount=Math.ceil(rows.length/CHANGE_PAGE_SIZE);
  v.page=Math.min(Math.max(1,v.page),Math.max(1,pageCount));
  const since=data.since?` · таблица следит с ${changeTime(data.since)}`:'';
  $('#changeCount').textContent=`${fmtNum(rows.length)} из ${fmtNum(period.length)} за период${since}${data.truncated?' · показаны 50 000 самых новых — сократите период':''}`;
  body.innerHTML=rows.slice((v.page-1)*CHANGE_PAGE_SIZE,v.page*CHANGE_PAGE_SIZE).map(item=>`<tr>
    <td class="change-when">${escapeHtml(changeTime(item.at))}</td><td>${escapeHtml(item.cabinet||'—')}</td>
    <td><span class="change-section" data-section="${escapeHtml(item.section)}">${escapeHtml(item.section)}</span></td>
    <td class="change-object">${changeObject(item)}</td><td class="change-what">${changeWhat(item)}</td>
    <td>${changeValue(item,item.before)}</td><td>${changeValue(item,item.after)}${changeDelta(item)}</td></tr>`).join('');
  $('#emptyChangesText').textContent=period.length?'Измените фильтры.':'Таблица записывает изменения раз в час — за этот период их нет. Выберите другой период.';
  $('#emptyChanges').classList.toggle('hidden',rows.length>0);
  const el=$('#changePagination');
  if(pageCount<=1){el.innerHTML='';el.classList.add('hidden');return}
  el.classList.remove('hidden');
  el.innerHTML=`<button type="button" class="stock-page-button" data-change-page="prev" ${v.page===1?'disabled':''}>Назад</button><div class="stock-page-numbers">${Array.from({length:pageCount},(_,i)=>i+1).map(page=>`<button type="button" class="stock-page-button ${page===v.page?'active':''}" data-change-page="${page}" aria-current="${page===v.page?'page':'false'}">${page}</button>`).join('')}</div><button type="button" class="stock-page-button" data-change-page="next" ${v.page===pageCount?'disabled':''}>Вперёд</button>`;
}

// Через document: скрипт подключается раньше app.js, где объявлен $.
document.addEventListener('click',event=>{
  const chip=event.target.closest('[data-change-section]');
  if(chip){
    const section=chip.dataset.changeSection;
    if(!section)changeView.sections.clear();else changeView.sections.has(section)?changeView.sections.delete(section):changeView.sections.add(section);
    changeView.kind='';changeView.page=1;renderChangeHistory();return;
  }
  const page=event.target.closest('[data-change-page]');
  if(page&&!page.disabled){const target=page.dataset.changePage;changeView.page=target==='prev'?changeView.page-1:target==='next'?changeView.page+1:Number(target);renderChangeHistory();document.querySelector('#page-history .stock-panel')?.scrollIntoView({behavior:'smooth',block:'start'})}
});
document.addEventListener('input',event=>{if(event.target.id!=='changeSearch')return;changeView.search=event.target.value;changeView.page=1;if(changeView.data)renderChangeHistory()});
document.addEventListener('change',event=>{
  // Период: история берётся с компьютера быстро, поэтому пересчитываем сразу, без кнопки «Обновить».
  if(['dateFrom','dateTo'].includes(event.target.id)&&state.activePage==='history'){changeView.page=1;loadChangeHistory()}
  if(event.target.id==='changeCabinet'){changeView.cabinet=event.target.value;changeView.page=1;renderChangeHistory()}
  if(event.target.id==='changeKind'){changeView.kind=event.target.value;changeView.page=1;renderChangeHistory()}
});
