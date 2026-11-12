// --- «Цены и скидки»: окно товара — текущие цены, история цены из Google Таблицы и изменение цены ---
// История — /api/sheet-history: таблица (google-sheets/) раз в час записывает изменения цен в «Историю».
// Заказы под графиком цены — /api/funnel/history: сохранённая воронка товара по дням.
// Изменение — тот же /api/prices/update, что и у массового «Задать цену и скидку», но с подтверждением:
// показываем, что было и что станет, прежде чем отправить в WB.
const priceChange=(now,before)=>{if(!before||now===before)return '';const change=Math.round((now-before)/before*100);return change?`<span class="${change<0?'price-down':'price-up'}">${change>0?'▲':'▼'} ${Math.abs(change)}%</span>`:''};
const priceProduct={nmId:null,row:null,data:null,key:'',model:null,hasClub:false,now:0,orders:null,sent:null,chartWidth:0,observer:null,pollTimer:0,request:0};
// Столбец «Что изменилось» в «Истории» таблицы → поле строки цен.
const PRICE_HISTORY_FIELDS={'Цена до скидки, ₽':'price','Скидка продавца, %':'discount','Цена со скидкой, ₽':'discountedPrice','Скидка WB Клуба, %':'clubDiscount','Цена в WB Клубе, ₽':'clubDiscountedPrice'};
const PRICE_KEYS=Object.values(PRICE_HISTORY_FIELDS);
const PRICE_PERIODS=[[7,'7 дней'],[14,'14 дней'],[30,'30 дней'],[0,'Всё время']];
const priceDateTime=iso=>new Date(iso).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).replace(',','');
const priceDay=time=>new Date(time).toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'});
// Цены — до рубля: копейки в истории только мешают сравнивать (fmtRub всегда пишет «,00»). Неизвестное значение
// (товара не было в таблице) — прочерк.
const priceRub=value=>Number.isFinite(value)?`${fmtNum(Math.round(value))} ₽`:'—';
const pricePct=value=>Number.isFinite(value)?fmtPercent(value):'—';
const priceDuration=ms=>{const hours=Math.floor(ms/3_600_000),days=Math.floor(hours/24);return hours<1?'меньше часа':days?`${fmtNum(days)} дн.${hours%24?` ${hours%24} ч`:''}`:`${hours} ч`};
const priceNowTiles=row=>[['Цена до скидки',priceRub(row.price)],['Скидка продавца',fmtPercent(row.discount)],['Цена со скидкой',priceRub(row.discountedPrice)],['Скидка WB Клуба',fmtPercent(row.clubDiscount)],['Цена в WB Клубе',priceRub(row.clubDiscountedPrice)]].map(([label,value])=>`<div><span>${label}</span><strong>${value}</strong></div>`).join('');
// Что показывать в истории — период, линия на графике (focus) и заказы под ним; запоминается в браузере.
const priceView={days:30,focus:'discountedPrice',orders:true};
try{Object.assign(priceView,JSON.parse(localStorage.getItem('wb-price-history-view')||'{}'))}catch{/* настройки не читаются — остаются обычные */}
if(!PRICE_PERIODS.some(([days])=>days===priceView.days))priceView.days=30;
const savePriceView=()=>{try{localStorage.setItem('wb-price-history-view',JSON.stringify(priceView))}catch{/* без сохранения */}};

function openPriceProduct(nmId){
  const row=(state.prices?.rows||[]).find(item=>String(item.nmId)===String(nmId));if(!row)return;
  clearTimeout(priceProduct.pollTimer);
  Object.assign(priceProduct,{nmId:row.nmId,row,data:null,key:'',model:null,orders:null});
  const request=++priceProduct.request;
  openModal(`<div class="price-product">
    <div class="price-product-head">${row.photo?`<img class="price-product-photo" src="${escapeHtml(row.photo)}" alt="">`:''}<div><p class="eyebrow">Цена товара</p><h2>${escapeHtml(row.name)}</h2><p>${escapeHtml(row.vendorCode||'—')} · nmID ${row.nmId} · ${escapeHtml(row.category)} · ${escapeHtml(row.brand)}</p></div></div>
    <div class="price-product-now" id="priceProductNow">${priceNowTiles(row)}</div>
    <section class="price-product-section"><div class="price-history-head"><h3>История цены</h3><div class="hourly-switch hidden" id="pricePeriod" role="group" aria-label="Период истории цены"></div></div><p class="sheet-hint" id="priceHistoryHint"></p><div id="priceHistoryBox"><p class="price-product-note">Загрузка истории…</p></div></section>
    <section class="price-product-section"><h3>Изменить цену</h3>${priceEditForm(row)}</section>
  </div>`,true);
  bindPriceEditForm(row);
  // Сначала история с компьютера (data/Sheet), потом дозагрузка из Google Таблицы. Если дозагрузка ничего не изменила,
  // окно второй раз не рисуется: подсказка на графике и прокрутка списка остаются на месте.
  const count=data=>(data?.items||[]).filter(item=>PRICE_HISTORY_FIELDS[item.what]).length;
  window.SheetSync?.load(`/api/sheet-history?id=${row.nmId}&sections=${encodeURIComponent('Цены')}&cabinet=${encodeURIComponent(state.cabinet)}`,(data,phase,error,previous)=>{
    if(request!==priceProduct.request||!$('#priceHistoryBox'))return;
    $('#priceHistoryHint').textContent=SheetSync.hint(data,phase,error,previous,count);
    if(!data){if(error)$('#priceHistoryBox').innerHTML=`<p class="price-product-note error">Не удалось загрузить историю: ${escapeHtml(error.message)}</p>`;return}
    const key=JSON.stringify([data.configured,data.cabinetSince||'',(data.items||[]).map(item=>[item.at,item.what,item.before,item.after])]);
    if(key===priceProduct.key)return;
    Object.assign(priceProduct,{data,key});renderPriceHistory();loadPriceOrders(request);
  });
}

// История цены по записям таблицы. Таблица хранит только изменения (было → стало), поэтому идём назад от текущей цены:
// «было» каждой записи даёт цену до неё. «Появилось в списке» — раньше товара в таблице не было, истории до этой записи
// нет. «Пропало из списка» — с этого момента и до следующей записи цена неизвестна (absent). Изменения одного обновления
// таблицы — одна точка. known — с какого момента таблица ведёт цены кабинета (cabinetSince): у товара без «Появилось»
// цена известна с него; если known нет или он позже первой записи, цена до первой записи — в before, без даты начала.
// unrecorded — цена на сайте уже другая, а записи в таблице ещё нет (таблица проверяет цены раз в час).
function priceHistoryModel(row,items,known){
  const num=value=>{const number=value===''||value==null||value==='—'?NaN:Number(value);return Number.isFinite(number)?number:null};
  const pick=source=>Object.fromEntries(PRICE_KEYS.map(key=>[key,num(source[key])])),empty=()=>pick({});
  const groups=new Map();
  items.slice().sort((a,b)=>String(a.at).localeCompare(String(b.at))).forEach(item=>{
    const kind=item.what==='Появилось в списке'?'appear':item.what==='Пропало из списка'?'gone':PRICE_HISTORY_FIELDS[item.what]?'fields':'';if(!kind)return;
    if(!groups.has(item.at))groups.set(item.at,{fields:[],appear:null,gone:null});
    const group=groups.get(item.at);if(kind==='fields')group.fields.push(item);else group[kind]=item});
  const current=pick(row),points=[];let state={...current};
  for(const [at,group] of [...groups].reverse()){
    const after={...state},before={...state},gone=Boolean(group.gone&&!group.appear);
    group.fields.forEach(item=>{after[PRICE_HISTORY_FIELDS[item.what]]=num(item.after);before[PRICE_HISTORY_FIELDS[item.what]]=num(item.before)});
    if(group.appear&&num(group.appear.after)!=null)after.discountedPrice=num(group.appear.after);
    points.unshift({takenAt:at,kind:gone?'gone':group.appear?'appear':'change',absent:gone,...(gone?empty():after)});
    // У «Пропало» записана только цена со скидкой; если она не сходится с восстановленной, остальные поля неизвестны.
    if(group.gone){const price=num(group.gone.before);if(price!=null&&price!==before.discountedPrice)Object.assign(before,empty(),{discountedPrice:price})}
    state=group.appear?empty():before;
  }
  let before=null;const oldest=points[0];
  if(!oldest){if(known)points.push({takenAt:known,kind:'start',absent:false,...current})}
  else if(oldest.kind!=='appear'&&PRICE_KEYS.some(key=>state[key]!=null)){
    if(known&&known<oldest.takenAt)points.unshift({takenAt:known,kind:'start',absent:false,...state});else before=state}
  // Сравнение с запасом в рубль: таблица и сайт могут по-разному округлять копейки.
  const last=points.at(-1),differs=key=>last[key]==null||current[key]==null?last[key]!==current[key]:Math.abs(last[key]-current[key])>=(key==='discount'?.01:1);
  return {points,before,current,unrecorded:Boolean(last)&&(last.absent||['price','discount','discountedPrice'].some(differs)),changes:points.filter(point=>point.kind==='change').length};
}
// Период графика: точки с его начала; цена на начало периода — последняя точка до него (kind 'carry').
function priceHistoryView(model,days,now){
  const points=model.points;if(!points.length)return {from:now,to:now,points:[],whole:true};
  const first=Date.parse(points[0].takenAt),from=days?Math.max(first,now-days*86_400_000):first;
  const shown=points.filter(point=>Date.parse(point.takenAt)>=from),carried=points.filter(point=>Date.parse(point.takenAt)<from).at(-1);
  if(carried)shown.unshift({...carried,takenAt:new Date(from).toISOString(),kind:'carry'});
  return {from,to:Math.max(now,from+3_600_000,Date.parse(points.at(-1).takenAt)),points:shown,whole:from===first};
}

function renderPriceHistory(){
  const box=$('#priceHistoryBox'),{row,data}=priceProduct,period=$('#pricePeriod');if(!box||!row||!data)return;
  priceProduct.observer?.disconnect();
  if(!data.configured){period.classList.add('hidden');box.innerHTML='<p class="price-product-note">Google Таблица не подключена: впишите в .env сайта WB_SHEET_URL и WB_SHEET_KEY (ключ — в таблице «WB → Ключ для сайта») и перезапустите сервер. Инструкция — google-sheets/README.md.</p>';return}
  const now=priceProduct.now=Date.now(),model=priceProduct.model=priceHistoryModel(row,data.items||[],data.cabinetSince||null),points=model.points;
  if(!points.length){period.classList.add('hidden');box.innerHTML='<p class="price-product-note">Истории цены в таблице пока нет — таблица записывает изменения раз в час.</p>';return}
  const view=priceHistoryView(model,priceView.days,now),shown=view.points,span=priceView.days?` за ${priceView.days} дней`:'';
  // Клубная цена показывается, только если она хоть раз отличалась от цены со скидкой.
  const hasClub=priceProduct.hasClub=[...points,model.current,...(model.before?[model.before]:[])].some(point=>point.clubDiscount>0||(point.clubDiscountedPrice!=null&&point.discountedPrice!=null&&Math.abs(point.clubDiscountedPrice-point.discountedPrice)>=1));
  // Период выбирается в карточке графика (price-metric.js).
  period.classList.add('hidden');
  // Сводка: сколько держится текущая цена (по всей истории), минимум, максимум и число изменений — за выбранный период.
  const seen=shown.filter(point=>point.discountedPrice!=null).map(point=>({value:point.discountedPrice,when:point.kind==='carry'?'на начало периода':point.kind==='start'?`с ${priceDateTime(point.takenAt)}`:priceDateTime(point.takenAt)}));
  if(model.unrecorded&&model.current.discountedPrice!=null)seen.push({value:model.current.discountedPrice,when:'сейчас'});
  const min=seen.reduce((best,item)=>!best||item.value<best.value?item:best,null),max=seen.reduce((best,item)=>!best||item.value>best.value?item:best,null);
  let hold={text:'только что',note:'изменение ещё не записано в таблицу'};
  if(!model.unrecorded){let index=points.length-1;while(index>0&&points[index-1].discountedPrice!=null&&points[index-1].discountedPrice===points[index].discountedPrice)index--;
    const since=points[index],time=priceDateTime(since.takenAt),length=priceDuration(now-Date.parse(since.takenAt));
    hold=since.kind==='start'?{text:`от ${length}`,note:`не менялась с ${time} — с начала записей в таблице`}:{text:length,note:since.kind==='appear'?`с появления в таблице ${time}`:`с ${time}`}}
  const changes=shown.filter(point=>point.kind==='change').length,lastChange=points.filter(point=>point.kind==='change').at(-1);
  const stats=[['Текущая цена держится',hold.text,hold.note],[`Минимум${span}`,priceRub(min?.value),min?.when||''],[`Максимум${span}`,priceRub(max?.value),max?.when||''],
    [`Изменений${span}`,fmtNum(changes),lastChange?`последнее ${priceDateTime(lastChange.takenAt)}${view.whole?'':` · за всё время ${fmtNum(model.changes)}`}`:'изменений в таблице нет']];
  // Список — те же точки, что на графике, новые сверху. «Сейчас» отдельной строкой — только пока изменения нет в таблице.
  const cells=(point,previous,label,current)=>`<tr${current?' class="price-history-now"':''}><td>${label}</td><td>${priceRub(point.price)}</td><td>${pricePct(point.discount)}</td><td><strong>${priceRub(point.discountedPrice)}</strong>${previous&&point.discountedPrice!=null&&previous.discountedPrice!=null?` ${priceChange(point.discountedPrice,previous.discountedPrice)}`:''}</td>${hasClub?`<td>${priceRub(point.clubDiscountedPrice)}</td>`:''}</tr>`;
  const label=(point,latest)=>{const time=priceDateTime(point.takenAt);
    return (point.kind==='start'?`С ${time}`:point.kind==='carry'?`На ${time}`:point.kind==='appear'?`Появился ${time}`:point.kind==='gone'?`Пропал ${time}`:time)+(latest&&!model.unrecorded?' <small>сейчас</small>':'')};
  const older=view.whole?model.before:null,rows=[model.unrecorded?cells(model.current,shown.at(-1),'Сейчас <small>ещё не в таблице</small>',true):'',
    ...shown.map((point,index)=>cells(point,index?shown[index-1]:older,label(point,index===shown.length-1),index===shown.length-1&&!model.unrecorded)).reverse(),
    older?cells(older,null,`До ${priceDateTime(shown[0].takenAt)}`,false):''].join('');
  const sent=priceProduct.sent,lastAt=Date.parse(points.at(-1).takenAt);
  const sentNote=sent&&String(sent.nmId)===String(row.nmId)&&lastAt<sent.at?`<p class="price-edit-done">Отправлено в WB в ${new Date(sent.at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}: ${priceRub(sent.price)}, скидка ${fmtPercent(sent.discount)} — со скидкой ${priceRub(sent.discounted)}. WB применяет цену несколько минут; на графике изменение появится после ближайшего обновления таблицы (раз в час).</p>`:'';
  const scroll=box.querySelector('.price-history-table')?.scrollTop||0;
  box.innerHTML=`<div class="price-history-stats">${stats.map(([name,value,note])=>`<div><span>${name}</span><strong>${value}</strong><small>${note}</small></div>`).join('')}</div>`+
    `<div class="pm-card" id="priceHistoryChart"></div>${sentNote}`+
    `<p class="price-product-note">Таблица проверяет цены раз в час: время на графике и в списке — когда она заметила изменение, а не когда цену поменяли.</p>`+
    `<div class="table-wrap price-history-table" data-no-resize><table><thead><tr><th>Замечено</th><th>Цена до скидки</th><th>Скидка</th><th>Со скидкой</th>${hasClub?'<th>В WB Клубе</th>':''}</tr></thead><tbody>${rows}</tbody></table></div>`;
  box.querySelector('.price-history-table').scrollTop=scroll;
  renderPriceHistoryChart();
  // Ширина окна изменилась — график рисуется заново под новую ширину.
  const el=$('#priceHistoryChart');
  if(window.ResizeObserver){priceProduct.observer=new ResizeObserver(()=>{if(!el.isConnected)return priceProduct.observer.disconnect();if(el.clientWidth&&Math.abs(el.clientWidth-priceProduct.chartWidth)>1)renderPriceHistoryChart()});priceProduct.observer.observe(el)}
}
// График истории — карточка в price-metric.js (renderPriceHistoryChart).
// Заказы товара по дням — из сохранённой воронки (сутки по Москве, глубина — 364 дня): видно, как цена сказалась на
// заказах. Пока сервер дозагружает недостающие дни из WB, спрашиваем ещё раз. Ответ после смены товара или кабинета не нужен.
async function loadPriceOrders(request,attempt=0){
  const model=priceProduct.model,cabinet=state.cabinet;if(state.demo||!model?.points.length)return;
  const moscowDay=time=>new Date(time+3*3_600_000).toISOString().slice(0,10),to=moscowDay(Date.now()),from=[moscowDay(Date.parse(model.points[0].takenAt)),moscowDay(Date.now()-364*86_400_000)].sort().at(-1);
  if(!attempt){if(priceProduct.orders?.from===from&&!priceProduct.orders.error)return;priceProduct.orders={from,days:[],loading:true,error:''}}
  try{
    const data=await api('/api/funnel/history',{method:'POST',body:JSON.stringify({cabinet,from,to,grouping:'day',nmIds:[String(priceProduct.nmId)]})});
    if(request!==priceProduct.request||cabinet!==state.cabinet)return;
    const before=JSON.stringify(priceProduct.orders);
    priceProduct.orders={from,days:(data.current||[]).map(day=>({date:day.date,orderCount:Number(day.orderCount)||0,orderSum:Number(day.orderSum)||0})),loading:false,error:''};
    if(data.sync?.pending&&attempt<12)priceProduct.pollTimer=setTimeout(()=>{if(request===priceProduct.request&&$('#modal').classList.contains('open'))loadPriceOrders(request,attempt+1)},5000);
    // Повторный ответ без новых данных график не перерисовывает — иначе пропадает подсказка под курсором.
    if(before===JSON.stringify(priceProduct.orders))return;
  }catch(error){if(request!==priceProduct.request)return;priceProduct.orders={from,days:[],loading:false,error:error.message}}
  renderPriceHistoryChart();
}

// Изменение цены: поля → предпросмотр → «Сохранить в WB» → подтверждение с «было → станет» → отправка.
function priceEditForm(row){
  if(state.demo)return '<p class="price-product-note">В демо-режиме изменение цен отключено.</p>';
  return `<div class="price-edit"><label class="stock-modal-label">Цена до скидки, ₽<input id="productPriceInput" type="number" min="1" step="1" value="${Math.round(row.price)}"></label>`+
    `<label class="stock-modal-label">Скидка продавца, %<input id="productDiscountInput" type="number" min="0" max="99" step="1" value="${row.discount}"></label></div>`+
    `<p class="price-edit-preview" id="productPricePreview"></p>${row.editableSizePrice?`<p class="price-product-note">У товара цены по размерам — новая цена применится ко всем размерам (${row.sizes}).</p>`:''}`+
    `<div id="productPriceActions"><button class="primary" id="productPriceSave">Сохранить в WB</button></div>`;
}
function priceEditValues(){const price=Number($('#productPriceInput').value),discount=Number($('#productDiscountInput').value);return {price,discount,valid:Number.isFinite(price)&&price>0&&Number.isInteger(discount)&&discount>=0&&discount<=99,discounted:Math.round(price*(100-discount)/100)}}
function bindPriceEditForm(row){
  if(state.demo)return;
  // Каждый раз заново рисуем кнопку «Сохранить в WB» — после «Отмена» на месте подтверждения её ещё нет.
  const preview=()=>{const value=priceEditValues(),el=$('#productPricePreview');
    $('#productPriceActions').innerHTML='<button class="primary" id="productPriceSave">Сохранить в WB</button>';
    const save=$('#productPriceSave');save.onclick=confirm;
    if(!value.valid){el.innerHTML='<span class="price-down">Цена — больше 0, скидка — целое число от 0 до 99%</span>';save.disabled=true;return}
    const club=row.clubDiscount?` · в WB Клубе ≈ ${fmtRub(Math.round(value.discounted*(100-row.clubDiscount)/100))}`:'';
    el.innerHTML=`Цена со скидкой: <strong>${fmtRub(value.discounted)}</strong> ${priceChange(value.discounted,row.discountedPrice)}${club}`};
  const confirm=()=>{const value=priceEditValues();if(!value.valid)return;
    if(value.price===Math.round(row.price)&&value.discount===row.discount)return toast('Цена и скидка не изменились');
    const drop=row.discountedPrice?(row.discountedPrice-value.discounted)/row.discountedPrice:0;
    $('#productPriceActions').innerHTML=`<div class="price-edit-confirm"><p>Цена до скидки: ${fmtRub(row.price)} → <strong>${fmtRub(value.price)}</strong><br>Скидка: ${fmtPercent(row.discount)} → <strong>${fmtPercent(value.discount)}</strong><br>Цена со скидкой: ${fmtRub(row.discountedPrice)} → <strong>${fmtRub(value.discounted)}</strong> ${priceChange(value.discounted,row.discountedPrice)}</p>`+
      (drop>=.3?`<p class="price-down">Цена со скидкой падает на ${Math.round(drop*100)}% — проверьте, нет ли опечатки.</p>`:'')+
      `<p class="price-product-note">Изменение сразу уйдёт в WB; в карточке оно появится через несколько минут.</p><div class="modal-actions"><button id="productPriceCancel">Отмена</button><button class="primary" id="productPriceConfirm">Подтвердить</button></div></div>`;
    $('#productPriceCancel').onclick=preview;
    $('#productPriceConfirm').onclick=async()=>{const button=$('#productPriceConfirm');button.disabled=true;button.textContent='Отправляем…';
      try{await api('/api/prices/update',{method:'POST',body:JSON.stringify({cabinet:state.cabinet,confirm:true,items:[{nmId:row.nmId,price:value.price,discount:value.discount,editableSizePrice:row.editableSizePrice,sizeItems:row.sizeItems}]})})}
      catch(error){toast(error.message);return preview()}
      $('#productPriceActions').innerHTML=`<p class="price-edit-done">Загрузка создана в WB: ${fmtRub(value.price)}, скидка ${fmtPercent(value.discount)}. Таблица обновится, когда WB применит цену.</p>`;
      toast('Цена отправлена в WB');
      // В истории сразу видно, что и когда отправлено. Когда список цен перечитается, окно берёт свежую строку товара:
      // плитки сверху и «сейчас» на графике — то, что уже применил WB.
      const request=priceProduct.request;priceProduct.sent={nmId:row.nmId,at:Date.now(),price:value.price,discount:value.discount,discounted:value.discounted};renderPriceHistory();
      Promise.resolve(loadPrices(true)).then(()=>{const fresh=(state.prices?.rows||[]).find(item=>String(item.nmId)===String(row.nmId));
        if(!fresh||request!==priceProduct.request||!$('#modal').classList.contains('open')||!$('#priceProductNow'))return;
        priceProduct.row=fresh;$('#priceProductNow').innerHTML=priceNowTiles(fresh);renderPriceHistory()}).catch(()=>{})}};
  $('#productPriceInput').oninput=$('#productDiscountInput').oninput=preview;
  preview();
}
document.addEventListener('click',event=>{
  const cell=event.target.closest('[data-price-open]');if(cell&&!event.target.closest('input,button'))return openPriceProduct(cell.dataset.priceOpen);
  const period=event.target.closest('[data-price-period]');if(period){priceView.days=Number(period.dataset.pricePeriod);savePriceView();renderPriceHistory()}
});
