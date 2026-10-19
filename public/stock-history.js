// --- «История остатков» на вкладках «Остатки FBW» и «Остатки FBS»: кнопка слева от «Обновить» ---
// Данные — лист «История остатков» Google Таблицы (/api/sheet-history, раздел «Остатки FBW» или «Остатки FBS»):
// таблица раз в час записывает каждое изменение остатка по складу и артикулу, плюс текущие остатки (current).
// Окно: фильтры по кабинету, складам и артикулам, период; график — сумма по фильтру (жирная) и линии складов
// (до 6, остальные — «Прочие склады»); ниже — список изменений. Остаток между изменениями не меняется — ступеньки.
// Файл подключается до app.js: $, api, state и прочее используются только внутри функций.
const STOCK_HISTORY_COLORS=['#2a78d6','#eb6834','#1baf7a','#e87ba4','#8a6a1f','#0e8ea8','#9aa39e'];
const stockHistory={type:'FBW',days:14,data:null,error:'',loading:false,request:0,cabinet:'',warehouses:new Set(),articles:new Set(),articleSearch:''};
const shTime=iso=>new Date(iso).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).replace(',','');

function openStockHistory(){
  stockHistory.type=state.activePage==='stocks'?'FBS':'FBW';
  Object.assign(stockHistory,{data:null,error:'',warehouses:new Set(),articles:new Set(),articleSearch:'',cabinet:''});
  openModal(`<div class="stock-history"><p class="eyebrow">Остатки ${stockHistory.type}</p><h2>История остатков</h2><p class="stock-history-note" id="shNote">Загрузка из Google Таблицы…</p>
    <div class="stock-history-filters" id="shFilters"></div><div class="summary-chart stock-history-chart" id="shChart"></div><div class="stock-history-legend" id="shLegend"></div><div id="shChanges"></div></div>`,true);
  loadStockHistory();
}
async function loadStockHistory(){
  const request=++stockHistory.request;stockHistory.loading=true;
  try{
    const data=await api(`/api/sheet-history?${new URLSearchParams({sections:`Остатки ${stockHistory.type}`,days:String(stockHistory.days)})}`);
    if(request!==stockHistory.request)return;
    stockHistory.data=data;stockHistory.error='';
    // Кабинет по умолчанию — тот, что выбран на сайте, если в таблице он назван так же.
    const cabinets=stockHistoryCabinets(),siteName=(state.cabinets||[]).find(item=>item.id===state.cabinet)?.name;
    if(!stockHistory.cabinet||!cabinets.includes(stockHistory.cabinet))stockHistory.cabinet=cabinets.includes(siteName)?siteName:cabinets.length===1?cabinets[0]:'';
  }catch(error){if(request!==stockHistory.request)return;stockHistory.error=error.message}
  finally{if(request===stockHistory.request){stockHistory.loading=false;renderStockHistory()}}
}
function stockHistoryCabinets(){const data=stockHistory.data||{};return [...new Set([...(data.current||[]).map(row=>row.cabinet),...(data.items||[]).map(item=>item.cabinet)].filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),'ru'))}

// Строки и изменения по текущему фильтру (кабинет, склады, артикулы).
function stockHistoryFiltered(){
  const data=stockHistory.data||{},f=stockHistory;
  const pass=(cabinet,warehouse,nmId)=>(!f.cabinet||cabinet===f.cabinet)&&(!f.warehouses.size||f.warehouses.has(warehouse))&&(!f.articles.size||f.articles.has(String(nmId)));
  const current=(data.current||[]).filter(row=>pass(row.cabinet,row.warehouse,row.nmId));
  const changes=(data.items||[]).filter(item=>pass(item.cabinet,item.what,item.id)).sort((a,b)=>String(a.at).localeCompare(String(b.at)));
  return {current,changes};
}
// Ступенчатые ряды: остаток каждого «склад + артикул» на начало окна — «было» первого изменения в окне (или текущий,
// если изменений не было); дальше применяются изменения по времени. Сумма и склады считаются на каждом изменении.
function stockHistorySeries(current,changes,fromTime){
  const key=(cabinet,warehouse,nmId)=>`${cabinet}|${warehouse}|${nmId}`,value=new Map(),warehouseOf=new Map();
  current.forEach(row=>{const k=key(row.cabinet,row.warehouse,row.nmId);value.set(k,Number(row.quantity)||0);warehouseOf.set(k,row.warehouse)});
  const seen=new Set();
  changes.forEach(item=>{const k=key(item.cabinet,item.what,item.id);warehouseOf.set(k,item.what);if(!seen.has(k)){seen.add(k);value.set(k,Number(item.before)||0)}});
  const totals=()=>{const byWarehouse=new Map();let total=0;for(const [k,v] of value){total+=v;const w=warehouseOf.get(k);byWarehouse.set(w,(byWarehouse.get(w)||0)+v)}return {total,byWarehouse}};
  const points=[{time:fromTime,...totals()}];
  let index=0;
  while(index<changes.length){
    const at=changes[index].at;
    while(index<changes.length&&changes[index].at===at){const item=changes[index];value.set(key(item.cabinet,item.what,item.id),Number(item.after)||0);index++}
    points.push({time:new Date(at).getTime(),...totals()});
  }
  points.push({time:Date.now(),...totals(),now:true});
  return points;
}

function renderStockHistory(){
  const note=$('#shNote');if(!note)return;
  const data=stockHistory.data;
  if(stockHistory.error){note.textContent=`Не удалось загрузить: ${stockHistory.error}`;return}
  if(!data){note.textContent='Загрузка из Google Таблицы…';return}
  if(!data.configured){note.innerHTML='Google Таблица не подключена: впишите в .env сайта WB_SHEET_URL и WB_SHEET_KEY (ключ — в таблице «WB → Ключ для сайта») и перезапустите сервер. Инструкция — google-sheets/README.md.';return}
  renderStockHistoryFilters();
  const {current,changes}=stockHistoryFiltered();
  const since=data.since?new Date(data.since).getTime():0,fromTime=Math.max(Date.now()-stockHistory.days*86400000,since||0);
  const total=current.reduce((sum,row)=>sum+(Number(row.quantity)||0),0);
  note.textContent=`Сейчас по фильтру: ${fmtNum(total)} шт · изменений за ${stockHistory.days} дн.: ${fmtNum(changes.length)}${since?` · таблица следит за остатками с ${shTime(data.since)}`:''} · обновляется раз в час`;
  const points=stockHistorySeries(current,changes,fromTime);
  // Линии складов: до 6 крупнейших по текущему остатку, остальные — одной линией «Прочие склады».
  const warehouses=[...new Set(points.flatMap(point=>[...point.byWarehouse.keys()]))];
  const size=w=>Math.max(...points.map(point=>point.byWarehouse.get(w)||0));
  const top=warehouses.sort((a,b)=>size(b)-size(a)).slice(0,6),rest=warehouses.filter(w=>!top.includes(w));
  const series=[{label:'Всего',color:'#17211d',width:2.6,value:point=>point.total}];
  if(warehouses.length>1){top.forEach((w,i)=>series.push({label:w,color:STOCK_HISTORY_COLORS[i],width:1.6,value:point=>point.byWarehouse.get(w)||0}));if(rest.length)series.push({label:`Прочие склады (${rest.length})`,color:STOCK_HISTORY_COLORS[6],width:1.6,value:point=>rest.reduce((sum,w)=>sum+(point.byWarehouse.get(w)||0),0)})}
  renderStockHistoryChart(points,series,fromTime);
  $('#shLegend').innerHTML=series.map(item=>`<span><i style="background:${item.color};height:${item.width>2?4:3}px"></i>${escapeHtml(item.label)}</span>`).join('');
  const rows=changes.slice().reverse().slice(0,300);
  $('#shChanges').innerHTML=rows.length?`<div class="table-wrap stock-history-table"><table><thead><tr><th>Когда</th><th>Склад</th><th>Товар</th><th>Было</th><th>Стало</th><th>Изменение</th></tr></thead><tbody>${rows.map(item=>{const diff=(Number(item.after)||0)-(Number(item.before)||0);
    return `<tr><td>${shTime(item.at)}</td><td>${escapeHtml(item.what)}</td><td><span class="sh-product">${escapeHtml(item.title||'')}</span><small>${escapeHtml(item.id)}</small></td><td>${fmtNum(item.before)}</td><td><strong>${fmtNum(item.after)}</strong></td><td class="${diff<0?'sh-down':'sh-up'}">${diff>0?'+':''}${fmtNum(diff)}</td></tr>`}).join('')}</tbody></table></div>${changes.length>rows.length?`<p class="stock-history-note">Показаны последние ${fmtNum(rows.length)} изменений из ${fmtNum(changes.length)}.</p>`:''}`:
    '<p class="stock-history-note">За период изменений нет — таблица записывает изменения остатков раз в час.</p>';
}
function renderStockHistoryFilters(){
  const box=$('#shFilters');if(!box)return;
  const data=stockHistory.data||{},f=stockHistory,cabinets=stockHistoryCabinets();
  const inCabinet=row=>!f.cabinet||row.cabinet===f.cabinet;
  const warehouses=[...new Set([...(data.current||[]).filter(inCabinet).map(row=>row.warehouse),...(data.items||[]).filter(inCabinet).map(item=>item.what)])].sort((a,b)=>String(a).localeCompare(String(b),'ru'));
  const articles=new Map();
  (data.current||[]).filter(inCabinet).forEach(row=>articles.set(String(row.nmId),[row.vendorCode,row.name].filter(Boolean).join(' · ')));
  (data.items||[]).filter(inCabinet).forEach(item=>{if(!articles.has(String(item.id)))articles.set(String(item.id),item.title||'')});
  const term=f.articleSearch.trim().toLowerCase();
  const articleList=[...articles].filter(([id,label])=>!term||`${id} ${label}`.toLowerCase().includes(term)).sort((a,b)=>String(a[1]).localeCompare(String(b[1]),'ru')).slice(0,300);
  const openWarehouses=box.querySelector('[data-sh-filter="warehouses"]')?.open,openArticles=box.querySelector('[data-sh-filter="articles"]')?.open;
  box.innerHTML=`<div class="sh-periods" role="group" aria-label="Период">${[7,14,30,90].map(days=>`<button type="button" data-sh-days="${days}" aria-pressed="${days===f.days}">${days} дн.</button>`).join('')}</div>`+
    (cabinets.length>1?`<select data-sh-cabinet aria-label="Кабинет"><option value="">Все кабинеты</option>${cabinets.map(name=>`<option value="${escapeHtml(name)}"${name===f.cabinet?' selected':''}>${escapeHtml(name)}</option>`).join('')}</select>`:'')+
    `<details class="multi-filter" data-sh-filter="warehouses"${openWarehouses?' open':''}><summary>${f.warehouses.size?`Склады (${f.warehouses.size})`:'Все склады'}</summary><div>${warehouses.map(w=>`<label><input type="checkbox" data-sh-warehouse value="${escapeHtml(w)}"${f.warehouses.has(w)?' checked':''}> ${escapeHtml(w)}</label>`).join('')||'<span class="filter-empty">Нет складов</span>'}${f.warehouses.size?'<button type="button" class="sh-clear" data-sh-clear="warehouses">Сбросить</button>':''}</div></details>`+
    `<details class="multi-filter" data-sh-filter="articles"${openArticles?' open':''}><summary>${f.articles.size?`Артикулы (${f.articles.size})`:'Все артикулы'}</summary><div><input class="sh-search" data-sh-search placeholder="Артикул или название" value="${escapeHtml(f.articleSearch)}">${articleList.map(([id,label])=>`<label><input type="checkbox" data-sh-article value="${escapeHtml(id)}"${f.articles.has(id)?' checked':''}> <span>${escapeHtml(label||'Товар')}<small>${escapeHtml(id)}</small></span></label>`).join('')||'<span class="filter-empty">Ничего не найдено</span>'}${f.articles.size?'<button type="button" class="sh-clear" data-sh-clear="articles">Сбросить</button>':''}</div></details>`;
}
function renderStockHistoryChart(points,series,fromTime){
  const el=$('#shChart');if(!el)return;
  const w=Math.max(520,Math.round(el.clientWidth||820)),h=260,left=10,right=64,top=14,bottom=28,plotW=w-left-right,plotH=h-top-bottom;
  const start=fromTime,end=Math.max(Date.now(),start+3600000),max=Math.max(1,...points.flatMap(point=>series.map(item=>item.value(point))));
  const step=niceStockStep(max),high=Math.ceil(max/step)*step;
  const x=time=>left+(time-start)/(end-start)*plotW,y=value=>top+plotH-value/high*plotH;
  const path=item=>points.map((point,index)=>`${index?`H${x(point.time).toFixed(1)}V`:`M${x(point.time).toFixed(1)} `}${y(item.value(point)).toFixed(1)}`).join('')+`H${x(end).toFixed(1)}`;
  let grid='';for(let value=0;value<=high+1e-9;value+=step)grid+=`<line class="trend-grid" x1="${left}" x2="${w-right}" y1="${y(value)}" y2="${y(value)}"/><text class="trend-axis" x="${w-right+8}" y="${y(value)+4}">${fmtNum(value)}</text>`;
  const labels=[start,(start+end)/2,end].map((time,index)=>`<text class="trend-axis" x="${x(time)}" y="${h-8}" text-anchor="${index===0?'start':index===2?'end':'middle'}">${shTime(new Date(time).toISOString())}</text>`).join('');
  el.innerHTML=`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Остатки по времени">${grid}${labels}${series.slice().reverse().map(item=>`<path d="${path(item)}" fill="none" stroke="${item.color}" stroke-width="${item.width}" stroke-linejoin="round"/>`).join('')}`+
    `<line class="sh-hover hidden" y1="${top}" y2="${top+plotH}" stroke="#a7afaa"/><rect x="${left}" y="${top}" width="${plotW}" height="${plotH}" fill="transparent"/></svg><div class="chart-tooltip hidden"></div>`;
  const svg=el.querySelector('svg'),tip=el.querySelector('.chart-tooltip'),line=svg.querySelector('.sh-hover');
  svg.onpointermove=event=>{
    const rect=svg.getBoundingClientRect(),time=start+((event.clientX-rect.left)/rect.width*w-left)/plotW*(end-start);
    let index=0;points.forEach((point,i)=>{if(point.time<=time)index=i});
    const point=points[index];line.classList.remove('hidden');line.setAttribute('x1',x(Math.max(point.time,start)));line.setAttribute('x2',x(Math.max(point.time,start)));
    tip.innerHTML=`<strong>${point.now?'Сейчас':index===0?`На ${shTime(new Date(point.time).toISOString())}`:shTime(new Date(point.time).toISOString())}</strong>${series.map(item=>`<span style="--dot:${item.color}"><i></i>${escapeHtml(item.label)}<b>${fmtNum(item.value(point))} шт</b></span>`).join('')}`;
    tip.classList.remove('hidden');
    const px=(x(Math.max(point.time,start))/w)*rect.width,half=tip.offsetWidth/2;
    tip.style.left=`${Math.min(Math.max(px,half+6),el.clientWidth-half-6)}px`;
  };
  svg.onpointerleave=()=>{line.classList.add('hidden');tip.classList.add('hidden')};
}
function niceStockStep(max){const raw=max/4,power=10**Math.floor(Math.log10(raw||1)),fraction=raw/power;return Math.max(1,(fraction<=1?1:fraction<=2?2:fraction<=5?5:10)*power)}

document.addEventListener('click',event=>{
  if(event.target.closest('#stockHistoryButton'))return openStockHistory();
  if(!event.target.closest('.stock-history'))return;
  const days=event.target.closest('[data-sh-days]');
  if(days){stockHistory.days=Number(days.dataset.shDays);$('#shNote').textContent='Загрузка из Google Таблицы…';loadStockHistory();return}
  const clear=event.target.closest('[data-sh-clear]');
  if(clear){stockHistory[clear.dataset.shClear].clear();renderStockHistory()}
});
document.addEventListener('change',event=>{
  if(!event.target.closest('.stock-history'))return;
  if(event.target.matches('[data-sh-cabinet]')){stockHistory.cabinet=event.target.value;stockHistory.warehouses.clear();stockHistory.articles.clear();renderStockHistory();return}
  const warehouse=event.target.closest('[data-sh-warehouse]'),article=event.target.closest('[data-sh-article]');
  if(warehouse){warehouse.checked?stockHistory.warehouses.add(warehouse.value):stockHistory.warehouses.delete(warehouse.value);renderStockHistory()}
  if(article){article.checked?stockHistory.articles.add(article.value):stockHistory.articles.delete(article.value);renderStockHistory()}
});
// Поиск артикула: перерисовываем только список фильтра, фокус остаётся в поле.
document.addEventListener('input',event=>{
  if(!event.target.matches?.('.stock-history [data-sh-search]'))return;
  stockHistory.articleSearch=event.target.value;const field=event.target,position=field.selectionStart;
  renderStockHistoryFilters();
  const again=$('#shFilters [data-sh-search]');if(again){again.focus();again.setSelectionRange(position,position)}
});
