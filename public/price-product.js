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
// Что показывать в истории — период и включённые линии; запоминается в браузере.
const priceView={days:30,base:false,club:true,orders:true};
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
// Круглые деления шкалы цены: шаг 1, 2, 2,5 или 5 × 10ⁿ рублей, но не дробный.
function priceAxisTicks(min,max,count=4){
  const raw=Math.max(1,(max-min)/count),power=10**Math.floor(Math.log10(raw)),step=[1,2,2.5,5,10].map(factor=>factor*power).find(value=>value>=raw&&Number.isInteger(value));
  const low=Math.max(0,Math.floor(min/step)*step),high=Math.max(low+step,Math.ceil(max/step)*step),ticks=[];
  for(let value=low;value<=high+step/2;value+=step)ticks.push(value);
  return {low,high,ticks};
}
// Деления оси времени: полночи по местному времени с шагом в целые дни; у периода короче двух суток — часы.
// Шаг — такой, чтобы подписи не слипались (room — место под одну подпись).
function priceTimeTicks(from,to,width,room=52){
  const span=to-from,ticks=[],pad=value=>String(value).padStart(2,'0');
  if(span<2*86_400_000){
    const step=[1,2,3,4,6,12].find(hours=>width/(span/3_600_000)*hours>=room)||24,date=new Date(from);date.setMinutes(0,0,0);
    while(date.getTime()<from||date.getHours()%step)date.setHours(date.getHours()+1);
    for(;date.getTime()<=to;date.setHours(date.getHours()+step))ticks.push({time:date.getTime(),label:date.getHours()?`${pad(date.getHours())}:00`:priceDay(date)});
    if(ticks.length&&!ticks.some(tick=>!new Date(tick.time).getHours()))ticks[0].label=`${priceDay(ticks[0].time)} ${ticks[0].label}`;
    return ticks;
  }
  const step=[1,2,3,5,7,10,14,30,60,90,180].find(days=>width/(span/86_400_000)*days>=room)||365,date=new Date(to);date.setHours(0,0,0,0);
  for(;date.getTime()>=from;date.setDate(date.getDate()-step))ticks.unshift({time:date.getTime(),label:priceDay(date)});
  return ticks;
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
  period.innerHTML=PRICE_PERIODS.map(([days,label])=>`<button type="button" class="funnel-metric${days===priceView.days?' active':''}" data-price-period="${days}" aria-pressed="${days===priceView.days}">${label}</button>`).join('');period.classList.remove('hidden');
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
  const toggle=(key,className,label,title='')=>`<button type="button" class="price-toggle" data-price-series="${key}" aria-pressed="${Boolean(priceView[key])}"${title?` title="${title}"`:''}><i class="price-legend ${className}"></i>${label}</button>`;
  const legend=`<span><i class="price-legend"></i>Цена со скидкой</span>${toggle('base','base','Цена до скидки')}${hasClub?toggle('club','club','Цена в WB Клубе'):''}${state.demo?'':toggle('orders','orders','Заказы в день','Заказы товара за сутки по московскому времени — из воронки продаж')}`;
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
    `<div class="price-history-legend">${legend}</div><div class="summary-chart price-history-chart" id="priceHistoryChart"></div>${sentNote}`+
    `<p class="price-product-note">Таблица проверяет цены раз в час: время на графике и в списке — когда она заметила изменение, а не когда цену поменяли.</p>`+
    `<div class="table-wrap price-history-table" data-no-resize><table><thead><tr><th>Замечено</th><th>Цена до скидки</th><th>Скидка</th><th>Со скидкой</th>${hasClub?'<th>В WB Клубе</th>':''}</tr></thead><tbody>${rows}</tbody></table></div>`;
  box.querySelector('.price-history-table').scrollTop=scroll;
  box.onclick=event=>{const button=event.target.closest('[data-price-series]');if(!button)return;
    const key=button.dataset.priceSeries;priceView[key]=!priceView[key];savePriceView();button.setAttribute('aria-pressed',priceView[key]);renderPriceHistoryChart()};
  renderPriceHistoryChart();
  // Ширина окна изменилась — график рисуется заново под новую ширину.
  const el=$('#priceHistoryChart');
  if(window.ResizeObserver){priceProduct.observer=new ResizeObserver(()=>{if(!el.isConnected)return priceProduct.observer.disconnect();if(el.clientWidth&&Math.abs(el.clientWidth-priceProduct.chartWidth)>1)renderPriceHistoryChart()});priceProduct.observer.observe(el)}
}
// Ступенчатый график: цена меняется скачком и держится до следующего изменения. Шкала — по включённым линиям и не от
// нуля, иначе изменения в несколько процентов не видны. Под ценой, на той же оси времени, — заказы по дням (своя шкала
// в своей полосе). Наведение и стрелки с клавиатуры показывают одно и то же: точку последнего изменения до курсора.
function renderPriceHistoryChart(){
  const el=$('#priceHistoryChart'),model=priceProduct.model;if(!el||!model)return;
  const view=priceHistoryView(model,priceView.days,priceProduct.now),points=view.points,times=points.map(point=>Date.parse(point.takenAt));
  const hasClub=priceProduct.hasClub,orders=priceView.orders&&!state.demo,round=value=>Math.round(value*10)/10;
  const series=[{key:'price',className:'base',on:priceView.base},{key:'clubDiscountedPrice',className:'club',on:hasClub&&priceView.club},{key:'discountedPrice',className:'current',on:true}].filter(item=>item.on);
  // Куда встаёт подсказка: точки истории и, пока изменения нет в таблице, текущая цена у правого края.
  const targets=[...points.map((point,index)=>({point,time:times[index]})),...(model.unrecorded?[{point:{...model.current,kind:'now'},time:view.to}]:[])];
  const values=targets.flatMap(({point})=>series.map(item=>point[item.key])).filter(Number.isFinite);
  priceProduct.chartWidth=el.clientWidth;
  if(!values.length){el.innerHTML='<p class="price-product-note">За этот период цены в таблице нет.</p>';return}
  const minValue=Math.min(...values),maxValue=Math.max(...values),pad=(maxValue-minValue)*.08||maxValue*.05||1,axis=priceAxisTicks(Math.max(0,minValue-pad),maxValue+pad);
  const w=Math.max(280,Math.round(el.clientWidth)),left=8,right=Math.max(56,Math.round(18+6.4*`${fmtNum(axis.high)} ₽`.length)),top=12,priceH=170,stripTop=top+priceH+18,stripH=44,bottom=orders?stripTop+stripH:top+priceH,h=bottom+26,plotW=w-left-right;
  const x=time=>round(left+(Math.min(Math.max(time,view.from),view.to)-view.from)/(view.to-view.from)*plotW),y=value=>round(top+priceH-(value-axis.low)/(axis.high-axis.low)*priceH);
  // Линия рвётся там, где значения нет: до появления товара и пока он пропадал из таблицы.
  const step=key=>{let path='',drawing=false;points.forEach((point,index)=>{const value=point[key],px=x(times[index]);
      if(!Number.isFinite(value)){if(drawing)path+=`H${px}`;drawing=false;return}
      path+=drawing?`H${px}V${y(value)}`:`M${px} ${y(value)}`;drawing=true});
    return drawing?`${path}H${x(view.to)}`:path};
  const grid=axis.ticks.map(value=>`<line class="trend-grid" x1="${left}" x2="${w-right}" y1="${y(value)}" y2="${y(value)}"/><text class="trend-axis" x="${w-right+10}" y="${y(value)+4}">${fmtNum(value)} ₽</text>`).join('')+
    priceTimeTicks(view.from,view.to,plotW).map(tick=>{const px=x(tick.time);return `<line class="trend-grid" x1="${px}" x2="${px}" y1="${top}" y2="${bottom}"/><text class="trend-axis" x="${px}" y="${h-8}" text-anchor="${px<left+18?'start':px>w-right-18?'end':'middle'}">${tick.label}</text>`}).join('');
  const gaps=points.map((point,index)=>{if(!point.absent)return '';const x1=x(times[index]),x2=x(times[index+1]??view.to);
    return `<rect class="price-gap" x="${x1}" y="${top}" width="${Math.max(1,round(x2-x1))}" height="${priceH}"/>${x2-x1>=96?`<text class="trend-axis" x="${round((x1+x2)/2)}" y="${top+priceH/2+4}" text-anchor="middle">нет в таблице</text>`:''}`}).join('');
  // Точки — на изменениях цены со скидкой; если их слишком много для ширины графика, остаётся одна линия.
  const marks=points.map((point,index)=>({point,index})).filter(({point})=>(point.kind==='change'||point.kind==='appear')&&point.discountedPrice!=null);
  const lastValue=points.at(-1)?.discountedPrice,nowValue=model.current.discountedPrice;
  const dots=(marks.length<=plotW/10?marks.map(({point,index})=>`<circle class="price-dot${point.kind==='appear'?' appear':''}" cx="${x(times[index])}" cy="${y(point.discountedPrice)}" r="3.5"/>`).join(''):'')+
    (model.unrecorded&&lastValue!=null&&nowValue!=null?`<line class="price-jump" x1="${x(view.to)}" x2="${x(view.to)}" y1="${y(lastValue)}" y2="${y(nowValue)}"/>`:'')+
    (nowValue!=null?`<circle class="price-dot now" cx="${x(view.to)}" cy="${y(nowValue)}" r="4.5"/>`:'');
  // Заказы: столбик на сутки по Москве (так их считает воронка WB), сегодняшний — до текущего момента.
  const info=priceProduct.orders,days=orders?(info?.days||[]).map(day=>{const start=Date.parse(`${day.date}T00:00:00+03:00`);return {...day,start,end:start+86_400_000}}).filter(day=>day.end>view.from&&day.start<view.to):[];
  const peak=Math.max(0,...days.map(day=>day.orderCount)),barMax=stripH-6;
  const bars=days.map((day,index)=>{if(!day.orderCount)return '';const x1=x(day.start)+1,x2=Math.max(x1+1,x(day.end)-1),barTop=bottom-Math.max(2,round(day.orderCount/peak*barMax)),radius=Math.min(2,(x2-x1)/2);
    return `<path class="price-order-bar" data-order-day="${index}" d="M${x1} ${bottom}V${barTop+radius}Q${x1} ${barTop} ${x1+radius} ${barTop}H${x2-radius}Q${x2} ${barTop} ${x2} ${barTop+radius}V${bottom}Z"/>`}).join('');
  const stripNote=!info||info.loading?'Загружаем заказы…':info.error?`Заказы не загрузились: ${escapeHtml(info.error)}`:'Заказов за этот период нет';
  const strip=!orders?'':`<line class="trend-grid" x1="${left}" x2="${w-right}" y1="${bottom}" y2="${bottom}"/>`+(peak?`<line class="trend-grid" x1="${left}" x2="${w-right}" y1="${bottom-barMax}" y2="${bottom-barMax}"/><text class="trend-axis" x="${w-right+10}" y="${bottom-barMax+4}">${fmtNum(peak)} шт</text>${bars}`
    :`<text class="trend-axis" x="${left+4}" y="${stripTop+stripH/2+4}">${stripNote}</text>`);
  const summary=`История цены со скидкой с ${priceDateTime(new Date(view.from).toISOString())} по сейчас: от ${priceRub(Math.min(...targets.map(({point})=>point.discountedPrice).filter(Number.isFinite)))} до ${priceRub(Math.max(...targets.map(({point})=>point.discountedPrice).filter(Number.isFinite)))}. Стрелки влево и вправо — по изменениям цены, те же данные — в списке ниже.`;
  el.innerHTML=`<svg viewBox="0 0 ${w} ${h}" role="img" tabindex="0" aria-label="${escapeHtml(summary)}">${gaps}${grid}${strip}${series.map(item=>`<path class="price-step ${item.className}" d="${step(item.key)}"/>`).join('')}${dots}`+
    `<g class="chart-hover hidden"><line class="hover-line" y1="${top}" y2="${top+priceH}"/></g><rect x="${left}" y="${top}" width="${plotW}" height="${bottom-top}" fill="transparent"/></svg><div class="chart-tooltip hidden" aria-live="polite"></div>`;
  const svg=el.querySelector('svg'),tip=el.querySelector('.chart-tooltip'),hover=svg.querySelector('.chart-hover'),line=hover.querySelector('line');let shown=-1;
  const unmark=()=>svg.querySelector('.price-order-bar.active')?.classList.remove('active');
  const hide=()=>{hover.classList.add('hidden');tip.classList.add('hidden');unmark();shown=-1};
  // Подсказка — сбоку от курсора, у правого края — слева от него; на узком экране — над графиком, чтобы не закрывать линию.
  const showTip=(html,px,py)=>{tip.innerHTML=html;tip.classList.remove('hidden');const width=tip.offsetWidth,height=tip.offsetHeight,narrow=el.clientWidth<440;
    tip.style.left=`${Math.min(Math.max(4,narrow?px-width/2:px+14+width>el.clientWidth-4?px-14-width:px+14),Math.max(4,el.clientWidth-width-4))}px`;
    tip.style.top=`${narrow?-height-6:Math.min(Math.max(0,py-height/2),Math.max(0,el.clientHeight-height))}px`};
  const title=(point,index)=>{const time=point.kind==='now'?'':priceDateTime(point.takenAt);
    return point.kind==='now'?'Сейчас · ещё не в таблице':point.kind==='start'?`С ${time}`:point.kind==='carry'?`На ${time}`:point.kind==='appear'?`Появился ${time}`:point.kind==='gone'?`Пропал ${time}`:time+(index===points.length-1&&!model.unrecorded?' · сейчас':'')};
  const showTarget=(index,px,py)=>{const {point,time}=targets[index],value=point.discountedPrice,scale=svg.getBoundingClientRect().width/w;shown=index;unmark();
    hover.classList.remove('hidden');line.setAttribute('x1',x(time));line.setAttribute('x2',x(time));
    showTip(`<strong>${title(point,index)}</strong>`+(point.absent?'<span>Товара нет в таблице</span>':`<span style="--dot:var(--purple)"><i></i>Со скидкой<b>${priceRub(point.discountedPrice)}</b></span><span style="--dot:#9aa39e"><i></i>До скидки<b>${priceRub(point.price)}</b></span>`+
      `${hasClub?`<span style="--dot:#d77b28"><i></i>В WB Клубе<b>${priceRub(point.clubDiscountedPrice)}</b></span>`:''}<span>Скидка<b>${pricePct(point.discount)}</b></span>`),px??x(time)*scale,py??(Number.isFinite(value)?y(value):top+priceH/2)*scale)};
  const today=new Date(priceProduct.now+3*3_600_000).toISOString().slice(0,10);
  const showDay=(day,px,py)=>{shown=-1;unmark();hover.classList.add('hidden');svg.querySelector(`[data-order-day="${days.indexOf(day)}"]`)?.classList.add('active');
    showTip(`<strong>${day.date.slice(8,10)}.${day.date.slice(5,7)}${day.date===today?' · сегодня, сутки ещё идут':' · сутки по Москве'}</strong><span style="--dot:var(--green)"><i></i>Заказы<b>${fmtNum(day.orderCount)} шт</b></span><span>Сумма заказов<b>${priceRub(day.orderSum)}</b></span>`,px,py)};
  const move=event=>{const rect=svg.getBoundingClientRect(),frame=el.getBoundingClientRect(),sx=(event.clientX-rect.left)/rect.width*w,sy=(event.clientY-rect.top)/rect.height*h,px=event.clientX-frame.left,py=event.clientY-frame.top;
    const time=view.from+(sx-left)/plotW*(view.to-view.from);
    if(orders&&sy>=stripTop-9){const day=days.find(item=>time>=item.start&&time<item.end);return day?showDay(day,px,py):hide()}
    let index=0;times.forEach((value,i)=>{if(value<=time)index=i});if(model.unrecorded&&sx>=w-right-10)index=targets.length-1;
    showTarget(index,px,py)};
  svg.onpointermove=svg.onpointerdown=move;
  // На телефоне подсказка остаётся после касания и убирается, когда график теряет фокус или начинается прокрутка страницы.
  svg.onpointerleave=event=>{if(event.pointerType!=='touch')hide()};
  svg.onpointercancel=svg.onblur=hide;
  svg.onfocus=()=>{if(svg.matches(':focus-visible'))showTarget(targets.length-1)};
  svg.onkeydown=event=>{const end=targets.length-1,index={ArrowLeft:shown<0?end:Math.max(0,shown-1),ArrowRight:shown<0?end:Math.min(end,shown+1),Home:0,End:end}[event.key];
    if(event.key==='Escape'&&shown>=0){event.stopPropagation();return hide()}
    if(index==null)return;event.preventDefault();showTarget(index)};
}
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
