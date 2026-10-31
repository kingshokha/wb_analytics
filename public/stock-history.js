// --- «История остатков» на вкладке «Остатки FBS»: кнопка слева от «Обновить» ---
// Данные — лист «История остатков» Google Таблицы (/api/sheet-history, раздел «Остатки FBS»): таблица раз в час
// записывает каждое изменение остатка по складу и артикулу, плюс текущие остатки (current). Окно отвечает на вопросы
// продавца FBS, который пополняет остатки сам: обнулялся ли товар между пополнениями и надолго ли, сколько ушло
// и сколько пополнено — по товарам и по дням. Три блока: обнуления, товары (строка раскрывается: склады и дни), по дням.
// Уменьшение остатка — «ушло» (заказы и ваши ручные уменьшения), увеличение — «пополнено». Таблица видит остатки раз
// в час, поэтому время обнуления — с точностью до часа. Время и дни — местные (Душанбе, UTC+5), как на сайте.
// Только кабинет, выбранный на сайте: сервер сопоставляет его с кабинетом таблицы по названию (как в «Истории изменений»).
// Файл подключается до app.js: $, state, escapeHtml и прочее используются только внутри функций.
const STOCK_OFFSET_HOURS=5;
const stockHistory={days:7,data:null,error:'',loading:false,request:0,warehouse:'',search:'',sort:{key:'zeroHours',dir:'desc'},open:new Set(),zeroAll:false};
const shDayOf=time=>new Date(time+STOCK_OFFSET_HOURS*3_600_000).toISOString().slice(0,10);
const shDayStart=day=>Date.parse(`${day}T00:00:00Z`)-STOCK_OFFSET_HOURS*3_600_000;
const shTime=time=>{const d=new Date(time+STOCK_OFFSET_HOURS*3_600_000).toISOString();return `${d.slice(8,10)}.${d.slice(5,7)} ${d.slice(11,16)}`};
const shDayTitle=day=>{const text=new Date(`${day}T00:00:00Z`).toLocaleDateString('ru-RU',{timeZone:'UTC',weekday:'short',day:'numeric',month:'long'});return text.charAt(0).toUpperCase()+text.slice(1)};
const shHours=hours=>hours<1?'<1 ч':hours<24?`${Math.round(hours)} ч`:`${Math.floor(hours/24)} дн ${Math.round(hours%24)} ч`;
// Склады FBS почти все называются «Склад продавца …» — приставку не показываем, иначе названия не помещаются.
const shWarehouse=name=>String(name||'').replace(/^склад продавца\s+/i,'')||String(name||'');
const shPlural=(n,forms)=>{const a=Math.abs(n)%100,b=a%10;return forms[a>10&&a<20?2:b>1&&b<5?1:b===1?0:2]};

function openStockHistory(){
  Object.assign(stockHistory,{data:null,error:'',warehouse:'',search:'',open:new Set(),zeroAll:false});
  openModal(`<div class="stock-history"><p class="eyebrow">Остатки FBS</p><h2>История остатков</h2><p class="sheet-hint" id="shHint"></p>
    <div class="stock-history-filters"><div class="sh-periods" role="group" aria-label="Период">${[1,3,7,14,30].map(days=>`<button type="button" data-sh-days="${days}" aria-pressed="${days===stockHistory.days}">${days===1?'Сутки':`${days} дн.`}</button>`).join('')}</div>
      <select id="shWarehouse" aria-label="Склад"></select>
      <label class="sh-find">⌕ <input id="shSearch" placeholder="Артикул или название"></label></div>
    <p class="stock-history-note" id="shNote">Загрузка…</p>
    <section class="sh-block"><h3>Обнуления</h3><p class="sh-summary" id="shZeroSummary"></p><div id="shZeros"></div></section>
    <section class="sh-block"><h3>Товары</h3><div id="shProducts"></div></section>
    <section class="sh-block"><h3>По дням</h3><div id="shDays"></div></section></div>`,true);
  loadStockHistory();
}
// Сначала копия с компьютера (data/Sheet) — окно рисуется сразу; потом дозагрузка из таблицы — рисуется ещё раз.
// Берём всю историю остатков (без days): товар, обнулившийся до начала периода и так и стоящий на нуле, иначе не
// найти — его нет ни в текущих остатках, ни в изменениях за период. Период отсекается на странице.
function loadStockHistory(){
  const request=++stockHistory.request;stockHistory.loading=true;
  window.SheetSync?.load(`/api/sheet-history?${new URLSearchParams({sections:'Остатки FBS',cabinet:state.cabinet})}`,(data,phase,error,previous)=>{
    if(request!==stockHistory.request||!$('#shNote'))return;
    if($('#shHint'))$('#shHint').textContent=SheetSync.hint(data,phase,error,previous);
    if(data){stockHistory.data=data;stockHistory.error=''}else if(error&&!stockHistory.data)stockHistory.error=error.message;
    if(phase==='sheet')stockHistory.loading=false;
    renderStockHistory();
  });
}

// Ряды «кабинет + склад + артикул» за период: остаток на начало (до первого изменения — его «было», без изменений —
// текущий), изменения по времени, сейчас. По ним — ушло, пополнено, минимум, периоды на нуле и итоги по дням.
function stockHistoryModel(){
  const data=stockHistory.data||{},f=stockHistory,now=Date.now();
  const since=data.since?Date.parse(data.since):0,from=Math.max(now-f.days*86_400_000,since);
  const labels=new Map(),series=new Map(),key=(cabinet,warehouse,nmId)=>`${cabinet}|${warehouse}|${nmId}`;
  const get=(cabinet,warehouse,nmId)=>{const k=key(cabinet,warehouse,nmId);if(!series.has(k))series.set(k,{cabinet,warehouse,nmId:String(nmId),current:null,changes:[]});return series.get(k)};
  for(const row of data.current||[]){labels.set(String(row.nmId),{vendorCode:row.vendorCode||'',name:row.name||''});get(row.cabinet,row.warehouse,row.nmId).current=Number(row.quantity)||0}
  for(const item of data.items||[]){
    const time=Date.parse(item.at);
    if(!labels.has(String(item.id))){const [vendorCode,...name]=String(item.title||'').split(' · ');labels.set(String(item.id),{vendorCode,name:name.join(' · ')})}
    const row=get(item.cabinet,item.what,item.id),change={time,before:Number(item.before)||0,after:Number(item.after)||0};
    // До периода — только последнее изменение: остаток на начало периода, если в периоде изменений нет.
    if(time>=from)row.changes.push(change);else if(!row.lastBefore||time>row.lastBefore.time)row.lastBefore=change;
  }
  const term=f.search.trim().toLowerCase();
  const pass=row=>(!f.warehouse||row.warehouse===f.warehouse)&&(!term||[row.nmId,labels.get(row.nmId)?.vendorCode,labels.get(row.nmId)?.name].join(' ').toLowerCase().includes(term));
  const rows=[];
  for(const row of series.values()){
    row.changes.sort((a,b)=>a.time-b.time);
    // Без изменений в периоде: остаток — текущий, а если его нет — последнее «стало» до периода (обычно 0).
    if(!row.changes.length&&row.current==null&&row.lastBefore?.after!==0)continue;
    row.start=row.changes.length?row.changes[0].before:row.current??row.lastBefore.after;row.end=row.current??(row.changes.at(-1)?.after??row.start);    row.sold=0;row.added=0;row.min=row.start;row.zeros=[];row.byDay=new Map();
    let value=row.start,zeroFrom=value===0?from:null;
    const day=time=>{const d=shDayOf(time);if(!row.byDay.has(d))row.byDay.set(d,{sold:0,added:0,zeroHours:0});return row.byDay.get(d)};
    for(const change of row.changes){
      const diff=change.after-change.before;
      if(diff<0){row.sold-=diff;day(change.time).sold-=diff}else if(diff>0){row.added+=diff;day(change.time).added+=diff}
      if(value>0&&change.after===0)zeroFrom=change.time;
      if(value===0&&change.after>0&&zeroFrom!=null){row.zeros.push({from:zeroFrom,to:change.time,fromStart:zeroFrom===from});zeroFrom=null}
      value=change.after;row.min=Math.min(row.min,value);
    }
    if(value===0&&zeroFrom!=null)row.zeros.push({from:zeroFrom,to:now,fromStart:zeroFrom===from,ongoing:true});
    // Часы на нуле — всего и по дням (период на нуле может захватывать несколько дней).
    row.zeroHours=0;
    for(const zero of row.zeros){
      row.zeroHours+=(zero.to-zero.from)/3_600_000;
      for(let d=shDayOf(zero.from);shDayStart(d)<zero.to;d=shDayOf(shDayStart(d)+36*3_600_000)){
        const overlap=Math.min(zero.to,shDayStart(d)+86_400_000)-Math.max(zero.from,shDayStart(d));if(overlap>0)day(Math.max(zero.from,shDayStart(d))).zeroHours+=overlap/3_600_000;
      }
    }
    if(pass(row))rows.push(row);
  }
  return {rows,labels,from,since,warehouses:[...new Set([...series.values()].map(row=>row.warehouse))].sort((a,b)=>a.localeCompare(b,'ru'))};
}
// Товар: склады вместе. Минимум — по сумме складов во времени.
function stockHistoryProducts(rows){
  const products=new Map();
  for(const row of rows){
    const k=`${row.cabinet}|${row.nmId}`;
    if(!products.has(k))products.set(k,{key:k,cabinet:row.cabinet,nmId:row.nmId,rows:[],now:0,sold:0,added:0,zeroCount:0,zeroHours:0,zeroNow:0});
    const p=products.get(k);p.rows.push(row);p.now+=row.end;p.sold+=row.sold;p.added+=row.added;p.zeroCount+=row.zeros.length;p.zeroHours+=row.zeroHours;p.zeroNow+=row.zeros.some(zero=>zero.ongoing)?1:0;
  }
  for(const p of products.values()){
    let total=p.rows.reduce((sum,row)=>sum+row.start,0);p.min=total;
    p.rows.flatMap(row=>row.changes).sort((a,b)=>a.time-b.time).forEach(change=>{total+=change.after-change.before;p.min=Math.min(p.min,total)});
  }
  return [...products.values()];
}

function renderStockHistory(){
  const note=$('#shNote');if(!note)return;
  const data=stockHistory.data,f=stockHistory;
  if(stockHistory.error){note.textContent=`Не удалось загрузить: ${stockHistory.error}`;return}
  if(!data){note.textContent='Загрузка…';return}
  if(!data.configured){note.innerHTML='Google Таблица не подключена: впишите в .env сайта WB_SHEET_URL и WB_SHEET_KEY (ключ — в таблице «WB → Ключ для сайта») и перезапустите сервер. Инструкция — google-sheets/README.md.';['#shZeroSummary','#shZeros','#shProducts','#shDays'].forEach(id=>{$(id).innerHTML=''});return}
  const model=stockHistoryModel();
  $('#shWarehouse').innerHTML=`<option value="">Все склады</option>${model.warehouses.map(name=>`<option value="${escapeHtml(name)}"${name===f.warehouse?' selected':''}>${escapeHtml(shWarehouse(name))}</option>`).join('')}`;
  $$('[data-sh-days]').forEach(button=>button.setAttribute('aria-pressed',String(Number(button.dataset.shDays)===f.days)));
  const limited=model.since&&model.from===model.since;
  note.textContent=`С ${shTime(model.from)} по сейчас${limited?' (раньше таблица остатки не записывала)':''} · таблица записывает остатки раз в час, поэтому время — с точностью до часа · время местное`;
  renderStockZeros(model);renderStockProducts(model);renderStockDays(model);
}
const shName=(model,nmId)=>{const label=model.labels.get(nmId)||{};return label.vendorCode||label.name||`Артикул ${nmId}`};
const shTitle=(model,nmId)=>{const label=model.labels.get(nmId)||{};return [label.vendorCode,label.name].filter(Boolean).join(' · ')||`Артикул ${nmId}`};

// Блок 1 — обнуления: итог за период и список «товар · склад · с … до … (сколько)», текущие — сверху.
function renderStockZeros(model){
  const zeros=model.rows.flatMap(row=>row.zeros.map(zero=>({...zero,row}))).sort((a,b)=>(b.ongoing-a.ongoing)||b.from-a.from);
  const products=new Set(zeros.map(zero=>`${zero.row.cabinet}|${zero.row.nmId}`)).size,hours=zeros.reduce((sum,zero)=>sum+(zero.to-zero.from)/3_600_000,0),now=zeros.filter(zero=>zero.ongoing).length;
  $('#shZeroSummary').innerHTML=zeros.length?`Обнулялось <b>${fmtNum(products)} ${shPlural(products,['товар','товара','товаров'])}</b> (${fmtNum(zeros.length)} ${shPlural(zeros.length,['раз','раза','раз'])}), всего <b>${shHours(hours)}</b> без остатка${now?` · сейчас на нуле: <b class="sh-down">${fmtNum(now)} ${shPlural(now,['позиция','позиции','позиций'])}</b>`:''}`:'За период ни один товар не обнулялся.';
  const shown=stockHistory.zeroAll?zeros:zeros.slice(0,12);
  $('#shZeros').innerHTML=zeros.length?`<div class="sh-zero-list">${shown.map(zero=>`<div class="sh-zero${zero.ongoing?' now':''}"><span><b>${escapeHtml(shName(model,zero.row.nmId))}</b><small>${escapeHtml(shWarehouse(zero.row.warehouse))} · ${escapeHtml(zero.row.nmId)}</small></span>`+
    `<span>${zero.fromStart?'с начала периода':`с ${shTime(zero.from)}`} ${zero.ongoing?'— <b>до сих пор</b>':`до ${shTime(zero.to)}`}</span><b class="sh-zero-hours">${shHours((zero.to-zero.from)/3_600_000)}</b></div>`).join('')}</div>`+
    (zeros.length>shown.length?`<button type="button" class="sh-more" data-sh-zero-all>Показать все ${fmtNum(zeros.length)}</button>`:''):'';
}

// Блок 2 — товары: сейчас, минимум, ушло, пополнено, обнулений, часов на нуле. Строка раскрывается: склады и дни.
const SH_COLUMNS=[['name','Товар',''],['now','Сейчас','Остаток сейчас, все склады'],['min','Минимум','Самый маленький остаток за период, все склады вместе'],['sold','Ушло','Все уменьшения остатка: заказы покупателей и ваши ручные уменьшения'],['added','Пополнено','Все увеличения остатка: ваши обновления и возвраты'],['zeroCount','Обнулений','Сколько раз остаток на складе становился 0'],['zeroHours','На нуле','Сколько времени остаток был 0 (по складам, суммарно)']];
function renderStockProducts(model){
  const f=stockHistory,products=stockHistoryProducts(model.rows),dir=f.sort.dir==='asc'?1:-1;
  products.sort((a,b)=>f.sort.key==='name'?dir*shName(model,a.nmId).localeCompare(shName(model,b.nmId),'ru'):dir*(a[f.sort.key]-b[f.sort.key])||b.sold-a.sold);
  if(!products.length){$('#shProducts').innerHTML='<p class="stock-history-note">Нет товаров по фильтру.</p>';return}
  const cell=(value,cls='')=>`<td class="${cls}">${value}</td>`;
  $('#shProducts').innerHTML=`<div class="table-wrap sh-table"><table data-resizable="1"><thead><tr>${SH_COLUMNS.map(([k,label,hint])=>`<th data-sh-sort="${k}"${hint?` title="${escapeHtml(hint)}"`:''}>${label} <span>${f.sort.key===k?(f.sort.dir==='asc'?'↑':'↓'):''}</span></th>`).join('')}</tr></thead><tbody>${products.map(p=>{
    const open=f.open.has(p.key);
    const head=`<tr class="sh-row${open?' open':''}" data-sh-open="${escapeHtml(p.key)}"><td><span class="sh-caret">${open?'▾':'▸'}</span><span class="sh-name"><b>${escapeHtml(shName(model,p.nmId))}</b><small>${escapeHtml(p.nmId)}${p.rows.length>1?` · ${p.rows.length} ${shPlural(p.rows.length,['склад','склада','складов'])}`:` · ${escapeHtml(shWarehouse(p.rows[0].warehouse))}`}</small></span></td>`+
      cell(`${fmtNum(p.now)}${p.zeroNow?` <small class="sh-down">0 на ${p.zeroNow} скл.</small>`:''}`)+cell(fmtNum(p.min),p.min===0?'sh-down':'')+cell(p.sold?`−${fmtNum(p.sold)}`:'0')+cell(p.added?`+${fmtNum(p.added)}`:'0',p.added?'sh-up':'')+cell(fmtNum(p.zeroCount),p.zeroCount?'sh-down':'')+cell(p.zeroHours?shHours(p.zeroHours):'—',p.zeroHours?'sh-down':'')+'</tr>';
    return head+(open?`<tr class="sh-detail"><td colspan="${SH_COLUMNS.length}">${stockProductDetail(model,p)}</td></tr>`:'');
  }).join('')}</tbody></table></div>`;
}
// Раскрытая строка товара: склады с изменениями (те же показатели; склады без изменений — одной строкой) и дни
// «склад: ушло / пополнено / на нуле».
function stockProductDetail(model,p){
  const all=p.rows.slice().sort((a,b)=>b.zeroHours-a.zeroHours||b.sold-a.sold),rows=all.filter(row=>row.changes.length||row.zeros.length),quiet=all.filter(row=>!rows.includes(row));
  const quietLine=quiet.length?`<p class="sh-quiet">Без изменений за период — ${quiet.length} ${shPlural(quiet.length,['склад','склада','складов'])}: ${quiet.map(row=>`${escapeHtml(shWarehouse(row.warehouse))} ${fmtNum(row.end)}`).join(', ')}</p>`:'';
  const warehouses=(rows.length?`<table class="sh-sub" data-resizable="1"><thead><tr><th>Склад</th><th>Сейчас</th><th>Минимум</th><th>Ушло</th><th>Пополнено</th><th>Обнулений</th><th>На нуле</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${escapeHtml(shWarehouse(row.warehouse))}</td><td>${fmtNum(row.end)}</td><td class="${row.min===0?'sh-down':''}">${fmtNum(row.min)}</td><td>${row.sold?`−${fmtNum(row.sold)}`:'0'}</td><td class="${row.added?'sh-up':''}">${row.added?`+${fmtNum(row.added)}`:'0'}</td><td>${fmtNum(row.zeros.length)}</td><td class="${row.zeroHours?'sh-down':''}">${row.zeroHours?shHours(row.zeroHours):'—'}</td></tr>`).join('')}</tbody></table>`:'')+quietLine;
  const days=[...new Set(rows.flatMap(row=>[...row.byDay.keys()]))].sort().reverse();
  const daily=days.length?`<div class="sh-product-days">${days.map(day=>`<div><b>${escapeHtml(shDayTitle(day))}</b>${rows.filter(row=>row.byDay.has(day)).map(row=>stockDayLine(row.warehouse,row.byDay.get(day))).join('')}</div>`).join('')}</div>`:'<p class="stock-history-note">За период остаток не менялся.</p>';
  return `<p class="sh-full-name">${escapeHtml(shTitle(model,p.nmId))}</p>${warehouses}${daily}`;
}
function stockDayLine(label,stat,extra=''){
  const parts=[stat.sold?`ушло <b>${fmtNum(stat.sold)}</b>`:'',stat.added?`пополнено <b class="sh-up">+${fmtNum(stat.added)}</b>`:'',stat.zeroHours?`на нуле <b class="sh-down">${shHours(stat.zeroHours)}</b>${extra}`:''].filter(Boolean);
  return `<p class="sh-day-line"><span title="${escapeHtml(label)}">${escapeHtml(shWarehouse(label))}</span><span class="sh-day-vals">${parts.join(' · ')||'без изменений'}</span></p>`;
}

// Блок 3 — по дням: по каждому складу за день — ушло, пополнено, на нуле (и сколько товаров обнулялось).
function renderStockDays(model){
  const byDay=new Map();
  for(const row of model.rows)for(const [day,stat] of row.byDay){
    if(!byDay.has(day))byDay.set(day,new Map());
    const warehouses=byDay.get(day);if(!warehouses.has(row.warehouse))warehouses.set(row.warehouse,{sold:0,added:0,zeroHours:0,zeroProducts:new Set()});
    const total=warehouses.get(row.warehouse);total.sold+=stat.sold;total.added+=stat.added;total.zeroHours+=stat.zeroHours;if(stat.zeroHours)total.zeroProducts.add(row.nmId);
  }
  const days=[...byDay.keys()].sort().reverse();
  $('#shDays').innerHTML=days.length?`<div class="sh-days">${days.map(day=>{
    const warehouses=[...byDay.get(day)].sort((a,b)=>b[1].sold+b[1].added-a[1].sold-a[1].added);
    const sum=warehouses.reduce((total,[,stat])=>({sold:total.sold+stat.sold,added:total.added+stat.added}),{sold:0,added:0});
    return `<div class="sh-day"><p class="sh-day-head"><b>${escapeHtml(shDayTitle(day))}</b><span>${[`ушло ${fmtNum(sum.sold)}`,sum.added?`пополнено +${fmtNum(sum.added)}`:''].filter(Boolean).join(' · ')}</span></p>${warehouses.map(([warehouse,stat])=>stockDayLine(warehouse,stat,stat.zeroProducts.size?` (${stat.zeroProducts.size} ${shPlural(stat.zeroProducts.size,['товар','товара','товаров'])})`:'')).join('')}</div>`;
  }).join('')}</div>`:'<p class="stock-history-note">За период остатки не менялись.</p>';
}

document.addEventListener('click',event=>{
  if(event.target.closest('#stockHistoryButton'))return openStockHistory();
  if(!event.target.closest('.stock-history'))return;
  const days=event.target.closest('[data-sh-days]');
  if(days){stockHistory.days=Number(days.dataset.shDays);renderStockHistory();return}
  const sort=event.target.closest('[data-sh-sort]');
  if(sort){const key=sort.dataset.shSort;stockHistory.sort=stockHistory.sort.key===key?{key,dir:stockHistory.sort.dir==='asc'?'desc':'asc'}:{key,dir:key==='name'?'asc':'desc'};renderStockHistory();return}
  const open=event.target.closest('[data-sh-open]');
  if(open){const key=open.dataset.shOpen;stockHistory.open.has(key)?stockHistory.open.delete(key):stockHistory.open.add(key);renderStockHistory();return}
  if(event.target.closest('[data-sh-zero-all]')){stockHistory.zeroAll=true;renderStockHistory()}
});
document.addEventListener('change',event=>{
  if(event.target.id==='shWarehouse'){stockHistory.warehouse=event.target.value;renderStockHistory()}
});
// Поиск перерисовывает только блоки — поле ввода остаётся на месте, фокус не теряется.
document.addEventListener('input',event=>{if(event.target.id!=='shSearch')return;stockHistory.search=event.target.value;if(stockHistory.data)renderStockHistory()});
