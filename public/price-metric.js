// --- «Цены и скидки», окно товара: карточка «История цены» ---
// Переложение Metric Card из Kokonut UI (MIT, @dorianbaffier, https://kokonutui.com/docs/cards/metric-card) на простой
// JS сайта: React, Tailwind и shadcn в проекте нет, поэтому компонент не ставится через `npx shadcn add`, а повторён здесь.
// Как в оригинале: ряд периодов с бегунком; крупное значение, цифры которого прокручиваются; изменение и подпись под ним;
// линия яркая до курсора и бледная после; пунктир прошлого периода; оранжевые отметки событий (курсор к ним липнет);
// чтение под курсором, диапазон протяжкой, стрелки (с Shift — диапазон), Home/End, Esc; линии перетекают при смене
// периода и линии; внизу список — что рисовать, со значениями в выбранной точке.
// Отличия: цена — ступенька (держится до следующего изменения), а не сглаженная кривая: сглаживание рисовало бы цены,
// которых не было. У шкалы — подписи минимума и максимума, иначе по линии не понять размах. Под линией — заказы по дням
// из воронки на той же оси времени: видно, как цена сказалась на заказах.
const PM_SAMPLES=120,PM_MORPH=420,PM_SNAP=6;
const PM_PERIOD_LABELS={7:'7 дн',14:'14 дн',30:'30 дн',0:'Всё'};
const PM_SERIES=[
  {key:'discountedPrice',label:'Цена со скидкой'},
  {key:'price',label:'Цена до скидки'},
  {key:'discount',label:'Скидка продавца',pct:true},
  {key:'clubDiscountedPrice',label:'Цена в WB Клубе',club:true}];
// Состояние между перерисовками: форма линий (для перетекания), курсор и диапазон (время, мс), прежний период (бегунок).
const priceMetric={nmId:null,days:null,shape:null,raf:0,cursor:null,range:null,drag:null,periodIndex:null};
const pmReduced=()=>window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const pmNum=value=>Number.isFinite(value)?value:null;
const pmSame=(key,a,b)=>Math.abs(a-b)<(key==='discount'?.01:1);

// Значение линии в момент t: последняя точка истории не позже t. До первой точки — цена «до» (если известна),
// на «Пропало» — пусто. Пока изменение не записано в таблицу, у правого края — цена с сайта.
function pmValueAt(model,key,t,end){
  if(model.unrecorded&&t>=end)return pmNum(model.current[key]);
  let found=null;for(const point of model.points){if(Date.parse(point.takenAt)<=t)found=point;else break}
  if(!found)return model.before?pmNum(model.before[key]):null;
  return found.absent?null:pmNum(found[key]);
}
// Последнее изменение линии не позже t: когда и какое значение было до него.
function pmLastChange(model,key,t,end){
  let prev=model.before?pmNum(model.before[key]):null,last=null;
  const step=(at,value)=>{if(value==null)return;if(prev!=null&&!pmSame(key,value,prev))last={at,before:prev};prev=value};
  for(const point of model.points){const at=Date.parse(point.takenAt);if(at>t)break;step(at,point.absent?null:pmNum(point[key]))}
  if(model.unrecorded&&t>=end)step(end,pmNum(model.current[key]));
  return last;
}
// Ступенчатая линия и заливка под ней по точкам {x,y}: значение держится до следующей точки, y = null — разрыв.
function pmPaths(seq,endX,bottom){
  let line='',area='',open=false;
  const close=x=>{if(!open)return;line+=`H${x}`;area+=`H${x}V${bottom}Z`;open=false};
  seq.forEach(({x,y})=>{if(y==null)return close(x);
    if(!open){line+=`M${x} ${y}`;area+=`M${x} ${bottom}V${y}`;open=true}else{line+=`H${x}V${y}`;area+=`H${x}V${y}`}});
  close(endX);
  return {line,area};
}
// Крупное значение: каждая цифра — на своём колесе и прокручивается к новой; остальные знаки стоят на месте.
function pmRoll(el,text){
  const chars=[...text],digit=char=>/\d/.test(char),nodes=[...el.children];
  if(nodes.length!==chars.length||nodes.some((node,index)=>node.classList.contains('pm-digit')!==digit(chars[index])))
    el.innerHTML=chars.map(char=>digit(char)?`<span class="pm-digit"><span class="pm-ghost">0</span><span class="pm-wheel">${[...'0123456789'].map(d=>`<span>${d}</span>`).join('')}</span></span>`:'<span class="pm-sep"></span>').join('');
  [...el.children].forEach((node,index)=>{const char=chars[index];
    if(digit(char))node.lastChild.style.transform=`translateY(-${Number(char)*10}%)`;else node.textContent=char});
}

function renderPriceHistoryChart(){
  const el=$('#priceHistoryChart'),model=priceProduct.model;if(!el||!model)return;
  cancelAnimationFrame(priceMetric.raf);
  const view=priceHistoryView(model,priceView.days,priceProduct.now),from=view.from,to=view.to,span=Math.max(1,to-from);
  const series=PM_SERIES.filter(item=>!item.club||priceProduct.hasClub);
  if(!series.some(item=>item.key===priceView.focus))priceView.focus='discountedPrice';
  const focus=series.find(item=>item.key===priceView.focus),key=focus.key;
  const fmt=item=>value=>value==null?'—':item.pct?fmtPercent(value):priceRub(value);
  const at=(t,k=key)=>pmValueAt(model,k,t,to);
  // Другой товар или период — чтение сбрасывается, как в оригинале при смене периода.
  if(priceMetric.nmId!==priceProduct.nmId||priceMetric.days!==priceView.days)Object.assign(priceMetric,{cursor:null,range:null,drag:null});
  const sameProduct=priceMetric.nmId===priceProduct.nmId;
  priceMetric.nmId=priceProduct.nmId;priceMetric.days=priceView.days;
  // Прошлый период — те же дни перед выбранными; у «Всё время» его нет.
  const back=priceView.days?span:0,inside=(t,a,b)=>t>a&&t<=b;
  const pointTimes=model.points.map(point=>Date.parse(point.takenAt));
  // Точка ровно на начале периода (например, товар появился в таблице) относится к нему, а не к прошлому периоду.
  const seqOf=(a,b,k,withNow)=>{const seq=[{t:a,v:at(a,k)}];
    model.points.forEach((point,index)=>{const t=pointTimes[index];if(t>a&&(withNow?t<=b:t<b))seq.push({t,v:point.absent?null:pmNum(point[k])})});
    if(withNow&&model.unrecorded)seq.push({t:b,v:pmNum(model.current[k])});
    return seq};
  const nowSeq=seqOf(from,to,key,true),prevSeq=back?seqOf(from-back,from,key,false):[];
  const hasPrev=prevSeq.some(item=>item.v!=null);
  const known=[...nowSeq,...(hasPrev?prevSeq:[])].map(item=>item.v).filter(value=>value!=null);
  priceProduct.chartWidth=el.clientWidth;
  if(!known.length){el.innerHTML='<p class="price-product-note">За этот период цены в таблице нет.</p>';return}

  // Размеры: линия цены, под ней — полоса заказов. Шкала — по линии и прошлому периоду, не от нуля.
  const style=getComputedStyle(el),W=Math.max(260,Math.round(el.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight)));
  const orders=priceView.orders&&!state.demo,padL=2,padR=10,plotW=W-padL-padR;
  const top=16,lineH=150,lineBottom=top+lineH,stripTop=lineBottom+14,stripH=34,H=orders?stripTop+stripH:lineBottom+4;
  const nowValues=nowSeq.map(item=>item.v).filter(value=>value!=null),min=Math.min(...known),max=Math.max(...known),pad=(max-min)*.18||Math.max(1,max*.05);
  const lo=Math.max(0,min-pad),hi=max+pad,round=value=>Math.round(value*10)/10;
  const x=t=>round(padL+(Math.min(Math.max(t,from),to)-from)/span*plotW),y=value=>round(top+(1-(value-lo)/(hi-lo||1))*lineH);
  const exact={now:pmPaths(nowSeq.map(item=>({x:x(item.t),y:item.v==null?null:y(item.v)})),x(to),lineBottom),
    prev:hasPrev?pmPaths(prevSeq.map(item=>({x:x(item.t+back),y:item.v==null?null:y(item.v)})),x(to),lineBottom).line:''};
  // Форма для перетекания: значения в PM_SAMPLES равных шагах, в долях высоты (0 — низ, 1 — верх).
  const norm=value=>value==null?null:(value-lo)/(hi-lo||1);
  const sample=(a,b,withNow)=>Array.from({length:PM_SAMPLES},(_,i)=>norm(pmValueAt(model,key,a+i/(PM_SAMPLES-1)*(b-a),withNow?b:Infinity)));
  const shape={now:sample(from,to,true),prev:hasPrev?sample(from-back,from,false):null};
  const shapePaths=s=>{const sx=i=>round(padL+i/(PM_SAMPLES-1)*plotW),sy=h=>h==null?null:round(top+(1-h)*lineH);
    return {now:pmPaths(s.now.map((h,i)=>({x:sx(i),y:sy(h)})),x(to),lineBottom),prev:s.prev?pmPaths(s.prev.map((h,i)=>({x:sx(i),y:sy(h)})),x(to),lineBottom).line:''}};

  // События — оранжевые отметки: появился в таблице, пропал, цена отправлена с сайта. Пропуски — серым фоном.
  const pins=model.points.map((point,index)=>({t:pointTimes[index],label:point.kind==='appear'?'Появился в таблице':point.kind==='gone'?'Пропал из таблицы':''})).filter(pin=>pin.label&&inside(pin.t,from,to));
  const sent=priceProduct.sent;if(sent&&String(sent.nmId)===String(priceProduct.nmId)&&sent.at>=from&&sent.at<=to)pins.push({t:sent.at,label:'Отправлено в WB'});
  const gaps=model.points.map((point,index)=>{if(!point.absent)return '';const a=Math.max(from,pointTimes[index]),b=Math.min(to,pointTimes[index+1]??to);
    return b>a?`<rect class="pm-gap" x="${x(a)}" y="${top}" width="${Math.max(1,round(x(b)-x(a)))}" height="${lineH}"/>`:''}).join('');
  // Минимум и максимум выбранной линии за период — подписи на шкале.
  const nowMin=Math.min(...nowValues),nowMax=Math.max(...nowValues),show=fmt(focus);
  const guides=nowValues.length?[...new Set([nowMax,nowMin])].map((value,index)=>`<line class="pm-guide" x1="${padL}" x2="${W-padR}" y1="${y(value)}" y2="${y(value)}"/><text class="pm-guide-label" x="${W-padR}" y="${index?y(value)+13:y(value)-5}" text-anchor="end">${index||nowMin===nowMax?'мин ':'макс '}${show(value)}</text>`).join(''):'';
  // Заказы: столбик на сутки по Москве (так их считает воронка WB).
  const info=priceProduct.orders,days=orders?(info?.days||[]).map(day=>{const start=Date.parse(`${day.date}T00:00:00+03:00`);return {...day,start,end:start+86_400_000}}).filter(day=>day.end>from&&day.start<to):[];
  const peak=Math.max(0,...days.map(day=>day.orderCount)),stripBottom=stripTop+stripH;
  const bars=days.map((day,index)=>{if(!day.orderCount)return '';const x1=x(day.start)+1,x2=Math.max(x1+1,x(day.end)-1),barTop=stripBottom-Math.max(2,round(day.orderCount/peak*stripH)),r=Math.min(2,(x2-x1)/2);
    return `<path class="pm-bar" data-day="${index}" d="M${x1} ${stripBottom}V${barTop+r}Q${x1} ${barTop} ${x1+r} ${barTop}H${x2-r}Q${x2} ${barTop} ${x2} ${barTop+r}V${stripBottom}Z"/>`}).join('');
  const stripNote=!info||info.loading?'Загружаем заказы…':info.error?`Заказы не загрузились: ${escapeHtml(info.error)}`:'Заказов за этот период нет';
  const strip=!orders?'':`<line class="pm-base" x1="${padL}" x2="${W-padR}" y1="${stripBottom}" y2="${stripBottom}"/>`+(peak?`${bars}<text class="pm-guide-label" x="${W-padR}" y="${stripTop-3}" text-anchor="end">${fmtNum(peak)} шт в день макс.</text>`:`<text class="pm-strip-note" x="${padL+4}" y="${stripTop+stripH/2+4}">${stripNote}</text>`);
  const endValue=at(to),firstKey=PRICE_PERIODS.findIndex(([d])=>d===priceView.days);

  el.innerHTML=`<div class="pm-head"><p class="pm-label">История · <b>${focus.label}</b></p>
      <div class="pm-periods" role="group" aria-label="Период истории цены"><span class="pm-pill" style="transform:translateX(${(sameProduct&&priceMetric.periodIndex!=null?priceMetric.periodIndex:firstKey)*100}%)"></span>${PRICE_PERIODS.map(([d,label])=>`<button type="button" data-price-period="${d}" aria-pressed="${d===priceView.days}" title="${label}">${PM_PERIOD_LABELS[d]}</button>`).join('')}</div></div>
    <p class="pm-value"><span class="pm-sr pm-value-text"></span><span class="pm-roll" aria-hidden="true"></span></p>
    <div class="pm-delta"><span class="pm-change"></span><span class="pm-caption" aria-live="polite"></span><button type="button" class="pm-clear hidden">Сбросить</button></div>
    <div class="pm-chart" role="slider" tabindex="0" aria-valuemin="1" aria-valuemax="${PM_SAMPLES}" aria-label="${escapeHtml(`${focus.label} за ${priceView.days?`${priceView.days} дней`:'всё время'}. Стрелки — по изменениям, с Shift — выбрать отрезок, Esc — сбросить`)}">
      <svg viewBox="0 0 ${W} ${H}" height="${H}" aria-hidden="true"><defs><clipPath id="pmLit"><rect class="pm-lit" x="0" y="${top-10}" width="${W}" height="${lineH+20}"/></clipPath></defs>
        ${gaps}<line class="pm-base" x1="${padL}" x2="${W-padR}" y1="${lineBottom}" y2="${lineBottom}"/>${guides}
        <path class="pm-prev" d="${exact.prev}"/><path class="pm-area" clip-path="url(#pmLit)" d="${exact.now.area}"/><path class="pm-dim" d="${exact.now.line}"/><path class="pm-line" clip-path="url(#pmLit)" d="${exact.now.line}"/>
        ${pins.map(pin=>`<g class="pm-pin"><line x1="${x(pin.t)}" x2="${x(pin.t)}" y1="${top}" y2="${lineBottom}"/><circle cx="${x(pin.t)}" cy="${lineBottom}" r="3"/></g>`).join('')}${strip}
        <line class="pm-cursor-line hidden" y1="${top}" y2="${orders?stripBottom:lineBottom}"/><line class="pm-range-line a hidden" y1="${top}" y2="${orders?stripBottom:lineBottom}"/><line class="pm-range-line b hidden" y1="${top}" y2="${orders?stripBottom:lineBottom}"/>
        <circle class="pm-prev-dot hidden" r="3.5"/><circle class="pm-dot hidden" r="4.5"/><circle class="pm-dot pm-today" cx="${x(to)}" cy="${endValue==null?lineBottom:y(endValue)}" r="4" ${endValue==null?'opacity="0"':''}/>
      </svg></div>
    <div class="pm-axis"><span>${priceDay(from)}</span>${hasPrev?`<span class="pm-prev-key"><i></i>прошлые ${priceView.days} дн.</span>`:''}<span>сейчас</span></div>
    <ul class="pm-list">${series.map(item=>`<li><button type="button" data-pm-series="${item.key}" aria-pressed="${item.key===key}" title="${item.key===key?'Эта линия на графике':'Показать эту линию на графике'}"><i class="sw"></i><span class="nm">${item.label}</span><span class="v"></span><span class="c"></span></button></li>`).join('')}
      ${state.demo?'':`<li><button type="button" class="orders" data-pm-orders aria-pressed="${orders}" title="${orders?'Скрыть':'Показать'} заказы по дням под графиком — из воронки продаж, сутки по Москве"><i class="sw"></i><span class="nm">Заказы</span><span class="v"></span><span class="c"></span></button></li>`}</ul>`;

  const chart=el.querySelector('.pm-chart'),svg=chart.querySelector('svg'),q=selector=>svg.querySelector(selector);
  const lit=q('.pm-lit'),cursorLine=q('.pm-cursor-line'),rangeA=q('.pm-range-line.a'),rangeB=q('.pm-range-line.b'),dot=q('.pm-dot:not(.pm-today)'),prevDot=q('.pm-prev-dot'),today=q('.pm-today');
  const paint=paths=>{q('.pm-dim').setAttribute('d',paths.now.line);q('.pm-line').setAttribute('d',paths.now.line);q('.pm-area').setAttribute('d',paths.now.area);q('.pm-prev').setAttribute('d',paths.prev)};
  // Бегунок периода едет от прежнего периода к новому.
  const pill=el.querySelector('.pm-pill');requestAnimationFrame(()=>{pill.style.transform=`translateX(${firstKey*100}%)`});priceMetric.periodIndex=firstKey;
  // Перетекание: от формы, которая была на экране, к новой; в конце — точная ступенька по записям.
  const from0=sameProduct?priceMetric.shape:null;priceMetric.shape=shape;
  const changed=from0&&(['now','prev'].some(part=>JSON.stringify(from0[part])!==JSON.stringify(shape[part])));
  if(changed&&!pmReduced()){
    const start=performance.now(),ease=t=>t<.5?4*t*t*t:1-(-2*t+2)**3/2;
    const mix=(a,b,t)=>b?b.map((value,i)=>value==null||a?.[i]==null?value:a[i]+(value-a[i])*t):null;
    const frame=time=>{const t=ease(Math.min(1,(time-start)/PM_MORPH));
      if(t<1){const current={now:mix(from0.now,shape.now,t),prev:mix(from0.prev||shape.prev?.map(()=>0),shape.prev,t)};priceMetric.shape=current;paint(shapePaths(current));priceMetric.raf=requestAnimationFrame(frame)}
      else{priceMetric.shape=shape;paint(exact)}};
    paint(shapePaths(from0));priceMetric.raf=requestAnimationFrame(frame);
  }

  // Чтение: отрезок (протяжкой или Shift+стрелки), момент под курсором или весь период.
  const valueOf=(item,t)=>at(t,item.key);
  const changeHtml=(item,value,before)=>{
    if(value==null||before==null)return {text:'',cls:'pm-flat'};
    if(pmSame(item.key,value,before))return {text:'без изменений',cls:'pm-flat'};
    const up=value>before,size=item.pct?`${fmtNum(Math.round(Math.abs(value-before)*10)/10)} п.п.`:`${(Math.abs(value-before)/before*100).toLocaleString('ru-RU',{maximumFractionDigits:1})}%`;
    return {text:`${up?'▲':'▼'} ${size}`,cls:up?'pm-up':'pm-down'}};
  const nearPin=t=>pins.find(pin=>Math.abs(x(pin.t)-x(t))<PM_SNAP);
  const daysIn=(a,b)=>days.filter(day=>day.end>a&&day.start<=b);
  function update(){
    const {cursor,range}=priceMetric,ranged=Boolean(range&&range.a!==range.b),a=ranged?Math.min(range.a,range.b):from,b=ranged?Math.max(range.a,range.b):cursor??to,mode=ranged?'range':cursor!=null?'day':'idle';
    // С чем сравнивать: у отрезка — его начало, у момента — цена до последнего изменения, у периода — его начало.
    const compareOf=item=>mode==='day'?pmLastChange(model,item.key,b,to)?.before??null:valueOf(item,a);
    const value=valueOf(focus,b),before=compareOf(focus),change=changeHtml(focus,value,before);
    const text=show(value);pmRoll(el.querySelector('.pm-roll'),text);
    const pin=mode==='day'?nearPin(b):null;let caption;
    if(mode==='range')caption=`${priceDateTime(new Date(a).toISOString())} – ${priceDateTime(new Date(b).toISOString())}`;
    else if(mode==='day'){const last=pmLastChange(model,key,b,to);caption=(model.unrecorded&&b>=to?'Сейчас · ещё не в таблице':priceDateTime(new Date(b).toISOString()))+(last&&value!=null?` · ${x(last.at)===x(b)?'':`до ${priceDateTime(new Date(last.at).toISOString())} `}было ${show(last.before)}`:'')}
    else caption=priceView.days?`за ${priceView.days} дней · с ${priceDateTime(new Date(from).toISOString())}`:`с начала записей · ${priceDateTime(new Date(from).toISOString())}`;
    if(value==null)caption+=' · товара нет в таблице';
    el.querySelector('.pm-caption').innerHTML=escapeHtml(caption)+(pin?` · <em>${escapeHtml(pin.label)}</em>`:'');
    const changeEl=el.querySelector('.pm-change');changeEl.textContent=change.text;changeEl.className=`pm-change ${change.cls}`;
    el.querySelector('.pm-clear').classList.toggle('hidden',!ranged);
    el.querySelector('.pm-value-text').textContent=text;
    chart.setAttribute('aria-valuetext',`${caption}: ${text}`);chart.setAttribute('aria-valuenow',String(Math.round((b-from)/span*(PM_SAMPLES-1))+1));
    // Яркая часть линии: до курсора, внутри отрезка или вся.
    const litFrom=ranged?x(a):0,litTo=mode==='idle'?W:x(b);lit.setAttribute('x',litFrom);lit.setAttribute('width',Math.max(0,litTo-litFrom));
    cursorLine.classList.toggle('hidden',mode!=='day');cursorLine.setAttribute('x1',x(b));cursorLine.setAttribute('x2',x(b));
    [[rangeA,a],[rangeB,b]].forEach(([line,t])=>{line.classList.toggle('hidden',!ranged);line.setAttribute('x1',x(t));line.setAttribute('x2',x(t))});
    const showDot=mode==='day'&&value!=null;dot.classList.toggle('hidden',!showDot);if(showDot){dot.setAttribute('cx',x(b));dot.setAttribute('cy',y(value))}
    const twin=mode==='day'&&hasPrev?at(b-back):null;prevDot.classList.toggle('hidden',twin==null);if(twin!=null){prevDot.setAttribute('cx',x(b));prevDot.setAttribute('cy',y(twin))}
    today.classList.toggle('hidden',mode!=='idle');
    // Список: значение каждой линии в точке чтения и изменение; заказы — за сутки под курсором, отрезок или период.
    el.querySelectorAll('[data-pm-series]').forEach(button=>{const item=series.find(s=>s.key===button.dataset.pmSeries),v=valueOf(item,b),c=changeHtml(item,v,compareOf(item));
      button.querySelector('.v').textContent=fmt(item)(v);const cell=button.querySelector('.c');cell.textContent=c.text==='без изменений'?'':c.text;cell.className=`c ${c.cls}`});
    const ordersButton=el.querySelector('[data-pm-orders]');
    if(ordersButton){const list=!orders?[]:mode==='day'?days.filter(day=>b>=day.start&&b<day.end):daysIn(a,b);
      const count=list.reduce((s,day)=>s+day.orderCount,0),sum=list.reduce((s,day)=>s+day.orderSum,0);
      ordersButton.querySelector('.v').textContent=!orders?'скрыты':!info||info.loading?'…':info.error?'—':`${fmtNum(count)} шт`;
      ordersButton.querySelector('.c').textContent=orders&&info&&!info.loading&&!info.error?priceRub(sum):'';
      svg.querySelectorAll('.pm-bar').forEach(bar=>bar.classList.toggle('on',mode!=='idle'&&list.includes(days[Number(bar.dataset.day)])))}
  }

  // Указатель: мышь читает при наведении, палец — пока прижат; протяжка — отрезок. Курсор липнет к событиям и изменениям.
  const snaps=[...pins.map(pin=>pin.t),...pointTimes.filter(t=>inside(t,from,to))];
  const timeAt=clientX=>{const rect=chart.getBoundingClientRect(),sx=Math.min(Math.max(clientX-rect.left,0),rect.width)/rect.width*W;
    const near=snaps.find(t=>Math.abs(x(t)-sx)<PM_SNAP);
    return near??Math.min(to,Math.max(from,from+(sx-padL)/plotW*span))};
  chart.onpointerdown=event=>{if(event.pointerType==='mouse'&&event.button!==0)return;chart.setPointerCapture(event.pointerId);
    const t=timeAt(event.clientX);priceMetric.drag=t;priceMetric.range=null;priceMetric.cursor=t;update()};
  chart.onpointermove=event=>{const t=timeAt(event.clientX);
    if(priceMetric.drag!=null){const anchor=priceMetric.drag;if(priceMetric.range||Math.abs(x(t)-x(anchor))>=3)priceMetric.range={a:anchor,b:t};priceMetric.cursor=t;update()}
    else if(event.pointerType==='mouse'&&!priceMetric.range){priceMetric.cursor=t;update()}};
  const release=event=>{if(priceMetric.drag==null)return;priceMetric.drag=null;if(event.pointerType!=='mouse')priceMetric.cursor=null;update()};
  chart.onpointerup=chart.onpointercancel=chart.onlostpointercapture=release;
  chart.onpointerleave=()=>{if(priceMetric.drag==null&&!priceMetric.range&&priceMetric.cursor!=null){priceMetric.cursor=null;update()}};
  chart.onblur=()=>{if(priceMetric.cursor!=null&&!priceMetric.range){priceMetric.cursor=null;update()}};
  // Клавиатура: стрелки — по изменениям и событиям, Shift — тянет отрезок, Home/End — края, Esc — сброс.
  const stops=[...new Set([from,...snaps,to])].sort((p,q2)=>p-q2);
  chart.onkeydown=event=>{
    if(event.key==='Escape'){if(priceMetric.cursor==null&&!priceMetric.range)return;event.stopPropagation();event.preventDefault();Object.assign(priceMetric,{cursor:null,range:null});return update()}
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();
    const current=priceMetric.range?priceMetric.range.b:priceMetric.cursor??to;
    const next=event.key==='Home'?stops[0]:event.key==='End'?stops.at(-1):event.key==='ArrowLeft'?[...stops].reverse().find(t=>t<current-1)??stops[0]:stops.find(t=>t>current+1)??stops.at(-1);
    priceMetric.range=event.shiftKey?{a:priceMetric.range?priceMetric.range.a:current,b:next}:null;priceMetric.cursor=next;update()};
  el.querySelector('.pm-clear').onclick=()=>{Object.assign(priceMetric,{cursor:null,range:null});update();chart.focus()};
  el.querySelectorAll('[data-pm-series]').forEach(button=>button.onclick=()=>{if(button.dataset.pmSeries===priceView.focus)return;priceView.focus=button.dataset.pmSeries;savePriceView();renderPriceHistoryChart()});
  const ordersButton=el.querySelector('[data-pm-orders]');if(ordersButton)ordersButton.onclick=()=>{priceView.orders=!priceView.orders;savePriceView();renderPriceHistoryChart()};
  update();
}
