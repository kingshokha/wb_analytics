// --- Общая сводка: показатели периода, динамика, структура заказов, тренды и просадки товаров ---
// Файл подключается перед app.js и пользуется его общими помощниками ($, state, api, fmtNum, trendSmoothPath и др.).
const summaryView={data:null,ads:null,key:'',metric:'orderSum',requestId:0,adsRequestId:0,pollTimer:0,sparks:[],sparkActive:null,loading:false,error:'',adsLoading:false,adsError:''};
const SUMMARY_COLORS=['#7651e5','#f0a04b','#3f8fd6','#40a879','#c35fb8'],SUMMARY_OTHER_COLOR='#cfd4d1';
// unit задаёт формат и вид сравнения: для процентов — разница процентов (показывается со знаком %), для остального — относительное изменение.
// lowerBetter переворачивает цвет изменения, neutral красит его серым: рост расходов сам по себе не плох и не хорош.
const SUMMARY_METRICS={
  orderSum:{label:'Заказы',chart:'Заказы, ₽',unit:'₽'},
  orderCount:{label:'Заказы, шт',chart:'Заказы, шт',unit:'шт'},
  buyoutSum:{label:'Выкупы',chart:'Выкупы, ₽',unit:'₽'},
  buyoutCount:{label:'Выкупы, шт',unit:'шт'},
  openCount:{label:'Переходы',unit:'шт'},
  cartCount:{label:'Корзины',unit:'шт'},
  wishlist:{label:'Отложено',unit:'шт'},
  // phrase — полное название для текстовых выводов «Коротко о периоде», label — короткое для карточек и списков.
  orderConversion:{label:'Конв. в заказ',phrase:'конверсия в заказ',unit:'%'},
  cartConversion:{label:'Конв. в корзину',phrase:'конверсия в корзину',unit:'%'},
  cartToOrder:{label:'Из корзины в заказ',unit:'%'},
  buyoutPercent:{label:'Выкуп, %',phrase:'процент выкупа',unit:'%'},
  avgCheck:{label:'Средний чек',unit:'₽'},
  adSpend:{label:'Расходы на рекламу',chart:'Реклама, ₽',unit:'₽',neutral:true,ads:true},
  drr:{label:'ДРР',unit:'%',lowerBetter:true,ads:true},
  ctr:{label:'CTR рекламы',unit:'%',ads:true},
  cpc:{label:'Цена клика',unit:'₽',lowerBetter:true,ads:true,precise:true},
  adOrderShare:{label:'Доля рекламных заказов',unit:'%',neutral:true,ads:true}
};
const SUMMARY_CHART_KEYS=['orderSum','orderCount','buyoutSum','openCount','orderConversion','adSpend'];
const SUMMARY_TREND_KEYS=['avgCheck','cartConversion','cartToOrder','buyoutPercent','wishlist','ctr','cpc','adOrderShare'];
const SUMMARY_SEVERITY={high:'Сильная',medium:'Заметная',low:'Умеренная'};

function summaryRatio(value,base,multiplier=100){return Number(base)?Number(value||0)/Number(base)*multiplier:null}
function summaryValues(f,ad){
  const n=key=>f?Number(f[key]||0):null;
  return {orderSum:n('orderSum'),orderCount:n('orderCount'),buyoutSum:n('buyoutSum'),buyoutCount:n('buyoutCount'),openCount:n('openCount'),cartCount:n('cartCount'),wishlist:n('addToWishlistCount'),
    orderConversion:f?summaryRatio(f.orderCount,f.openCount):null,cartConversion:f?summaryRatio(f.cartCount,f.openCount):null,cartToOrder:f?summaryRatio(f.orderCount,f.cartCount):null,
    buyoutPercent:f?summaryRatio(f.buyoutCount,f.orderCount):null,avgCheck:f?summaryRatio(f.orderSum,f.orderCount,1):null,
    adSpend:ad?Number(ad.spend||0):null,drr:ad&&f?summaryRatio(ad.spend,f.orderSum):null,ctr:ad?summaryRatio(ad.clicks,ad.views):null,cpc:ad?summaryRatio(ad.spend,ad.clicks,1):null,adOrderShare:ad&&f?summaryRatio(ad.orders,f.orderCount):null};
}
function summaryAds(){return summaryView.ads?.available?summaryView.ads:null}
function summaryDays(period,funnelDays=[],adDays=[]){
  const funnel=new Map(funnelDays.map(day=>[day.date,day])),ads=new Map(adDays.map(day=>[day.date,day])),days=[];
  for(let date=period.from;date<=period.to;date=trendShift(date,1))days.push({date,values:summaryValues(funnel.get(date)||null,ads.get(date)||null)});
  return days;
}
function summaryNumber(value,digits=1){return Number(value).toLocaleString('ru-RU',{maximumFractionDigits:digits})}
function summaryFormat(key,value){
  if(value==null||!Number.isFinite(value))return '—';
  const metric=SUMMARY_METRICS[key];
  if(metric.unit==='%')return `${summaryNumber(value)}%`;
  if(metric.unit==='₽')return metric.precise?fmtRub(value):`${fmtNum(Math.round(value))} ₽`;
  return fmtNum(Math.round(value));
}
function summaryDelta(key,now,before){
  if(now==null||before==null||!Number.isFinite(now)||!Number.isFinite(before))return null;
  const text=(value,unit)=>Math.abs(value)<0.05?`0${unit}`:`${value>0?'+':'−'}${summaryNumber(Math.abs(value))}${unit}`;
  if(SUMMARY_METRICS[key].unit==='%'){const diff=now-before;return {value:diff,text:text(diff,'%')}}
  if(!before)return null;
  const change=(now-before)/before*100;
  return {value:change,text:text(change,'%')};
}
function summaryTone(key,delta){
  if(!delta||Math.abs(delta.value)<0.05)return 'flat';
  const metric=SUMMARY_METRICS[key];if(metric.neutral)return 'flat';
  return (metric.lowerBetter?delta.value<0:delta.value>0)?'up':'down';
}
function summaryDeltaBadge(key,now,before){
  const delta=summaryDelta(key,now,before);if(!delta)return '';
  const arrow=Math.abs(delta.value)<0.05?'→':delta.value>0?'↑':'↓';
  return `<span class="summary-delta ${summaryTone(key,delta)}">${arrow} ${delta.text}</span>`;
}
function summaryCompareLabel(){
  const period=summaryView.data?.periods?.current;if(!period)return '';
  const days=datesBetweenTrend(period.from,period.to);
  return days===1?'к прошлому дню':`к прошлым ${days} ${pluralRu(days,['дню','дням','дням'])}`;
}
// Мини-график растягивается по ширине блока, поэтому точка и линия наведения — HTML-элементы поверх SVG,
// а их положение хранится в долях: так круглая точка не превращается в эллипс.
function summarySpark(key,days=[],previousDays=[]){
  const values=days.map(day=>day.values[key]),points=values.map((value,index)=>value==null?null:[index,value]).filter(Boolean);
  if(points.length<2)return '<div class="summary-spark"></div>';
  const w=160,h=36,max=Math.max(...points.map(p=>p[1])),min=Math.min(...points.map(p=>p[1])),span=max-min||1;
  const x=i=>i/(values.length-1)*w,y=value=>h-3-(value-min)/span*(h-6);
  const index=summaryView.sparks.push({key,days,previousDays,ys:values.map(value=>value==null?null:y(value)/h)})-1;
  return `<div class="summary-spark summary-spark-wrap" data-spark="${index}"><svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polyline vector-effect="non-scaling-stroke" points="${points.map(([i,value])=>`${x(i).toFixed(1)},${y(value).toFixed(1)}`).join(' ')}"/></svg><i class="summary-spark-line"></i><i class="summary-spark-dot"></i></div>`;
}
function summarySparkTip(){
  let tip=$('#summarySparkTip');
  if(!tip){tip=document.createElement('div');tip.id='summarySparkTip';tip.className='chart-tooltip summary-spark-tip hidden';document.body.append(tip)}
  return tip;
}
function summarySparkHide(){
  summaryView.sparkActive?.classList.remove('active');summaryView.sparkActive=null;
  $('#summarySparkTip')?.classList.add('hidden');
}
function summarySparkHover(wrap,event){
  const spark=summaryView.sparks[wrap.dataset.spark];if(!spark)return;
  if(summaryView.sparkActive!==wrap)summarySparkHide();
  const rect=wrap.getBoundingClientRect(),count=spark.days.length,index=Math.max(0,Math.min(count-1,Math.round((event.clientX-rect.left)/rect.width*(count-1))));
  const ratio=index/(count-1),y=spark.ys[index],dot=wrap.querySelector('.summary-spark-dot');
  summaryView.sparkActive=wrap;wrap.classList.add('active');
  wrap.querySelector('.summary-spark-line').style.left=dot.style.left=`${ratio*100}%`;
  dot.style.top=`${(y??0)*100}%`;dot.style.visibility=y==null?'hidden':'visible';
  const metric=SUMMARY_METRICS[spark.key],day=spark.days[index],previous=spark.previousDays[index];
  const cv=day.values[spark.key],pv=previous?previous.values[spark.key]:null,delta=summaryDelta(spark.key,cv,pv),tip=summarySparkTip();
  tip.innerHTML=`<strong>${escapeHtml(metric.label)}</strong><span style="--dot:var(--purple)"><i></i>${trendFullDate(day.date)}<b>${summaryFormat(spark.key,cv)}</b></span>`+
    (previous?`<span style="--dot:#a78bfa"><i></i>${trendFullDate(previous.date)}<b>${summaryFormat(spark.key,pv)}</b></span>`:'')+(delta?`<span>Изменение<b>${delta.text}</b></span>`:'');
  tip.classList.remove('hidden');
  const half=tip.offsetWidth/2,left=rect.left+ratio*rect.width,above=rect.top-tip.offsetHeight-10;
  tip.style.left=`${Math.min(Math.max(left,half+6),window.innerWidth-half-6)}px`;
  tip.style.top=`${above>6?above:rect.bottom+10}px`;
}

async function loadSummary(force=false,silent=false){
  const cabinet=state.cabinet,from=$('#dateFrom').value,to=$('#dateTo').value,key=[cabinet,from,to].join(':'),request=++summaryView.requestId;
  clearTimeout(summaryView.pollTimer);
  if(!silent){
    if(summaryView.key!==key){summaryView.data=null;summaryView.ads=null}
    summaryView.key=key;summaryView.loading=true;summaryView.error='';$('#syncText').textContent='Собираем сводку…';renderSummary();loadSummaryAds(key);
  }
  try{
    const q=new URLSearchParams({cabinet,from,to});if(force)q.set('refresh','1');
    const data=await api('/api/summary?'+q);
    if(request!==summaryView.requestId)return;
    summaryView.data=data;summaryView.error='';
    if(!silent)$('#syncText').textContent=`Сводка · ${new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}`;
    // Пока сервер догружает дни воронки из WB, сводка переспрашивает его и дорисовывает графики.
    if(data.sync?.pending)summaryView.pollTimer=setTimeout(()=>{if(request===summaryView.requestId&&state.activePage==='summary'&&summaryView.key===[state.cabinet,$('#dateFrom').value,$('#dateTo').value].join(':'))loadSummary(false,true)},5000);
  }catch(e){if(request!==summaryView.requestId)return;summaryView.error=e.message;if(!silent){$('#syncText').textContent='Ошибка сводки';toast(e.message);addNotice('summary',`Ошибка загрузки сводки: ${e.message}`)}}
  finally{if(request===summaryView.requestId){summaryView.loading=false;renderSummary()}}
}
async function loadSummaryAds(key){
  const request=++summaryView.adsRequestId,[cabinet,from,to]=key.split(':');
  summaryView.adsLoading=true;summaryView.adsError='';
  try{
    const ads=await api('/api/summary/ads?'+new URLSearchParams({cabinet,from,to}));
    if(request!==summaryView.adsRequestId||summaryView.key!==key)return;
    summaryView.ads=ads;
  }catch(e){if(request===summaryView.adsRequestId)summaryView.adsError=e.message}
  finally{if(request===summaryView.adsRequestId){summaryView.adsLoading=false;renderSummary()}}
}

function renderSummary(){
  if(!$('#summaryKpis'))return;
  const data=summaryView.data,ads=summaryAds();
  summarySparkHide();summaryView.sparks=[];
  renderSummaryAlerts();
  if(!data){
    const text=summaryView.error?escapeHtml(summaryView.error):'Загрузка…';
    renderSummaryKpis(null,null,[],[]);
    ['#summaryChart','#summaryMix','#summaryText','#summaryTrends','#summaryDrops'].forEach(id=>$(id).innerHTML=`<div class="chart-empty summary-loading">${text}</div>`);
    $('#summaryChartMetrics').innerHTML='';$('#summaryChartLegend').innerHTML='';$('#summaryFoot').textContent='';
    return;
  }
  const {periods}=data,hasPrevious=Boolean(data.totals.previous);
  const now=summaryValues(data.totals.current,ads?.current?.totals),before=hasPrevious?summaryValues(data.totals.previous,ads?.previous?.totals):null;
  const days=summaryDays(periods.current,data.daily.current,ads?.current?.daily),previousDays=hasPrevious?summaryDays(periods.previous,data.daily.previous,ads?.previous?.daily):[];
  renderSummaryKpis(now,before,days,previousDays);
  renderSummaryChart(days,previousDays,periods);
  renderSummaryMix(data.top,hasPrevious);
  renderSummaryText(now,before,data);
  renderSummaryTrends(now,before,days,previousDays);
  renderSummaryDrops(data.drops,hasPrevious);
  renderSummaryFoot(data);
}
// Предупреждения сводки и её рекламной части — в уведомлениях раздела «Сводка» (колокольчик в шапке).
function renderSummaryAlerts(){
  setNotices('summary','load',[...(summaryView.data?.warnings||[]),...(summaryView.ads?.warnings||[])]);
}

const SUMMARY_KPIS=[
  {key:'orderSum',note:v=>`${fmtNum(v.orderCount)} шт`},
  {key:'buyoutSum',note:v=>`${fmtNum(v.buyoutCount)} шт · выкуп ${summaryFormat('buyoutPercent',v.buyoutPercent)}`},
  {key:'openCount',note:v=>`в корзину ${summaryFormat('cartConversion',v.cartConversion)}`},
  {key:'orderConversion',note:v=>`из корзины в заказ ${summaryFormat('cartToOrder',v.cartToOrder)}`},
  {key:'adSpend',note:()=>{const ads=summaryAds();return ads?`${fmtNum(ads.current.totals.orders)} рекламных заказов`:''}},
  {key:'drr',note:()=>'расходы / сумма заказов'}
];
function renderSummaryKpis(now,before,days,previousDays){
  const compare=summaryCompareLabel();
  $('#summaryKpis').innerHTML=SUMMARY_KPIS.map(kpi=>{
    const metric=SUMMARY_METRICS[kpi.key];
    let value='…',delta='',note='',spark='<div class="summary-spark"></div>';
    const adsMissing=metric.ads&&!summaryAds();
    if(adsMissing){
      value=summaryView.adsLoading?'…':'—';
      note=summaryView.adsLoading?'Загружаем рекламу…':escapeHtml(summaryView.adsError||summaryView.ads?.reason||'Нет данных рекламы');
    }else if(now){
      value=summaryFormat(kpi.key,now[kpi.key]);note=kpi.note(now);spark=summarySpark(kpi.key,days,previousDays);
      if(before){
        const badge=summaryDeltaBadge(kpi.key,now[kpi.key],before[kpi.key]);
        const diff=metric.unit==='₽'&&now[kpi.key]!=null&&before[kpi.key]!=null?now[kpi.key]-before[kpi.key]:null;
        delta=badge?`${badge}${diff?`<b class="summary-diff">${diff>0?'+':'−'}${fmtNum(Math.round(Math.abs(diff)))} ₽</b>`:''}<span>${compare}</span>`:'';
      }
    }else if(summaryView.error)value='—';
    return `<article class="summary-kpi"><div class="metric-label">${metric.label}</div><div class="summary-kpi-value">${value}</div><div class="summary-kpi-delta">${delta}</div><div class="summary-kpi-note">${note}</div>${spark}</article>`;
  }).join('');
}

function renderSummaryChart(days,previousDays,periods){
  const el=$('#summaryChart'),keys=SUMMARY_CHART_KEYS.filter(key=>!SUMMARY_METRICS[key].ads||summaryAds());
  if(!keys.includes(summaryView.metric))summaryView.metric=keys[0];
  const key=summaryView.metric,metric=SUMMARY_METRICS[key];
  $('#summaryChartMetrics').innerHTML=keys.map(item=>`<button type="button" class="funnel-metric ${item===key?'active':''}" data-summary-metric="${item}">${SUMMARY_METRICS[item].chart||SUMMARY_METRICS[item].label}</button>`).join('');
  $('#summaryChartLegend').innerHTML=`<span><i class="legend-solid"></i>${trendFullDate(periods.current.from)} – ${trendFullDate(periods.current.to)}</span>`+
    (previousDays.length?`<span><i class="legend-dashed"></i>${trendFullDate(periods.previous.from)} – ${trendFullDate(periods.previous.to)}</span>`:'');
  const current=days.map(day=>day.values[key]),previous=previousDays.map(day=>day.values[key]).slice(0,days.length);
  if(![...current,...previous].some(value=>value!=null)){el.innerHTML=`<div class="chart-empty">${summaryView.data?.sync?.pending?'Догружаем дни из WB…':'Нет данных по дням за выбранный период'}</div>`;return}
  const w=820,h=280,left=10,right=64,top=18,bottom=32,plotW=w-left-right,plotH=h-top-bottom,count=days.length;
  const x=i=>left+(count<=1?plotW/2:i*plotW/(count-1));
  const max=niceTrendMax(Math.max(0,...current.filter(v=>v!=null),...previous.filter(v=>v!=null))),y=value=>top+plotH-value/max*plotH;
  const axis=value=>metric.unit==='₽'?shortMoney(value):metric.unit==='%'?`${summaryNumber(value)}%`:fmtNum(Math.round(value));
  const segments=values=>{const parts=[];let part=[];values.forEach((value,i)=>{if(value==null){if(part.length)parts.push(part);part=[];return}part.push({x:x(i),y:y(value)})});if(part.length)parts.push(part);return parts};
  const lines=(values,kind)=>segments(values).map(points=>points.length===1?`<circle class="trend-dot ${kind}" cx="${points[0].x}" cy="${points[0].y}" r="3.5"/>`:`<path class="trend-line ${kind}" d="${trendSmoothPath(points)}"/>`).join('');
  const ticks=[0,.25,.5,.75,1].map(ratio=>`<line class="trend-grid" x1="${left}" x2="${w-right}" y1="${y(max*ratio)}" y2="${y(max*ratio)}"/><text class="trend-axis" x="${w-right+10}" y="${y(max*ratio)+4}">${axis(max*ratio)}</text>`).join('');
  const step=Math.max(1,Math.ceil(count/8));
  const labels=days.map((day,i)=>i%step===0||i===count-1?`<text class="trend-axis" x="${x(i)}" y="${h-8}" text-anchor="${count>1&&i===0?'start':count>1&&i===count-1?'end':'middle'}">${trendShortDate(day.date)}</text>`:'').join('');
  el.innerHTML=`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${escapeHtml(metric.label)} по дням">${ticks}${labels}${lines(previous,'previous')}${lines(current,'current')}`+
    `<g class="trend-hover hidden"><line class="hover-line" y1="${top}" y2="${top+plotH}"/><circle class="trend-hover-point previous" r="4.5"/><circle class="trend-hover-point current" r="5"/></g><rect x="${left}" y="${top}" width="${plotW}" height="${plotH}" fill="transparent"/></svg><div class="chart-tooltip hidden"></div>`;
  const svg=el.querySelector('svg'),tip=el.querySelector('.chart-tooltip'),hover=svg.querySelector('.trend-hover');
  svg.onpointermove=event=>{
    const rect=svg.getBoundingClientRect(),vx=(event.clientX-rect.left)/rect.width*w;
    let index=0,best=Infinity;days.forEach((day,i)=>{const distance=Math.abs(x(i)-vx);if(distance<best){best=distance;index=i}});
    const cv=current[index],pv=previous[index];
    hover.classList.remove('hidden');
    const line=hover.querySelector('line');line.setAttribute('x1',x(index));line.setAttribute('x2',x(index));
    [['current',cv],['previous',pv]].forEach(([kind,value])=>{const dot=hover.querySelector(`.trend-hover-point.${kind}`);dot.style.display=value==null?'none':'';if(value!=null){dot.setAttribute('cx',x(index));dot.setAttribute('cy',y(value))}});
    const delta=summaryDelta(key,cv,pv);
    tip.innerHTML=`<strong>${escapeHtml(metric.chart||metric.label)}</strong><span style="--dot:var(--purple)"><i></i>${trendFullDate(days[index].date)}<b>${summaryFormat(key,cv)}</b></span>`+
      (previousDays[index]?`<span style="--dot:#a78bfa"><i></i>${trendFullDate(previousDays[index].date)}<b>${summaryFormat(key,pv)}</b></span>`:'')+(delta?`<span>Изменение<b>${delta.text}</b></span>`:'');
    tip.classList.remove('hidden');
    const chartRect=el.getBoundingClientRect(),px=rect.left-chartRect.left+el.scrollLeft+x(index)/w*rect.width,half=tip.offsetWidth/2;
    tip.style.left=`${Math.min(Math.max(px,el.scrollLeft+half+6),el.scrollLeft+el.clientWidth-half-6)}px`;
  };
  svg.onpointerleave=()=>{hover.classList.add('hidden');tip.classList.add('hidden')};
}

function renderSummaryMix(top,hasPrevious){
  const el=$('#summaryMix');
  $('#summaryMixNote').textContent=top?.total?`${fmtNum(Math.round(top.total))} ₽ за период`:'Доля товаров в сумме заказов';
  if(!top?.total){el.innerHTML='<div class="summary-empty">За период заказов нет</div>';return}
  const rows=[...top.items.map((item,i)=>({...item,color:SUMMARY_COLORS[i]})),
    ...(top.other?[{...top.other,name:`Прочие · ${fmtNum(top.other.count)} ${pluralRu(top.other.count,['товар','товара','товаров'])}`,color:SUMMARY_OTHER_COLOR,other:true}]:[])];
  const r=68,c=2*Math.PI*r,gap=rows.length>1?2:0;let offset=0;
  const arcs=rows.map((row,i)=>{const length=row.share/100*c,visible=Math.max(0.5,length-gap),arc=`<circle data-mix="${i}" cx="85" cy="85" r="${r}" stroke="${row.color}" stroke-dasharray="${visible} ${c-visible}" stroke-dashoffset="${-offset}" transform="rotate(-90 85 85)"><title>${escapeHtml(row.name)}: ${summaryNumber(row.share)}%</title></circle>`;offset+=length;return arc}).join('');
  const shift=row=>{if(!hasPrevious||!top.previousTotal)return '';const diff=row.share-row.previousShare;return Math.abs(diff)<0.1?'±0%':`${diff>0?'+':'−'}${summaryNumber(Math.abs(diff))}%`};
  const leader=rows[0],leaderShift=hasPrevious&&top.previousTotal?leader.share-leader.previousShare:null;
  const lead=`<b>«${escapeHtml(leader.name)}»</b> даёт <b>${summaryNumber(leader.share)}%</b> суммы заказов`+
    (leaderShift==null?'.':Math.abs(leaderShift)<0.1?' — столько же, сколько в прошлом периоде.':` — на ${summaryNumber(Math.abs(leaderShift))}% ${leaderShift>0?'больше':'меньше'}, чем в прошлом периоде.`);
  el.innerHTML=`<svg class="summary-donut" viewBox="0 0 170 170" role="img" aria-label="Доли товаров в сумме заказов">${arcs}<text class="summary-donut-total" x="85" y="86" text-anchor="middle">${new Intl.NumberFormat('ru-RU',{notation:'compact',maximumFractionDigits:1}).format(top.total)}</text><text class="summary-donut-caption" x="85" y="104" text-anchor="middle">₽ в заказах</text></svg>`+
    `<div class="summary-mix-list">${rows.map((row,i)=>`<div class="summary-mix-row ${row.other?'':'clickable'}" data-mix="${i}" ${row.other?'':`data-summary-nm="${escapeHtml(row.nmId)}" title="Открыть в воронке"`}><i style="--dot:${row.color}"></i><span><strong>${escapeHtml(row.name)}</strong><small>${row.other?`${fmtNum(row.orderCount)} шт`:`${escapeHtml(row.vendorCode||row.nmId)} · ${fmtNum(row.orderCount)} шт`}</small></span><b>${summaryNumber(row.share)}%${shift(row)?`<em>${shift(row)}</em>`:''}</b></div>`).join('')}</div>`+
    `<p class="summary-mix-lead">${lead}</p>`;
  const highlight=index=>{el.classList.toggle('dimmed',index!=null);el.querySelectorAll('[data-mix]').forEach(item=>item.classList.toggle('active',item.dataset.mix===index))};
  el.querySelectorAll('[data-mix]').forEach(item=>{item.onmouseenter=()=>highlight(item.dataset.mix);item.onmouseleave=()=>highlight(null)});
}

// Короткие выводы по правилам: только то, что следует из цифр периода и сравнения с прошлым.
function summaryInsights(now,before,data){
  const items=[],ads=summaryAds(),has=key=>before&&summaryDelta(key,now[key],before[key]);
  const move=(key,up,down)=>{const d=summaryDelta(key,now[key],before[key]);return d.value>=0?up:down};
  if(now.orderCount){
    const d=has('orderSum');
    items.push([d?summaryTone('orderSum',d):'flat',d?`Сумма заказов ${move('orderSum','выросла','снизилась')} на ${d.text.replace(/^[+−]/,'')} (${now.orderSum>=before.orderSum?'+':'−'}${summaryFormat('orderSum',Math.abs(now.orderSum-before.orderSum))}) и составила ${summaryFormat('orderSum',now.orderSum)}, заказано ${fmtNum(now.orderCount)} шт.`:`Заказано ${fmtNum(now.orderCount)} шт на ${summaryFormat('orderSum',now.orderSum)}.`]);
  }else items.push(['flat','За период заказов не было.']);
  if(now.orderCount){const d=has('avgCheck');if(d&&Math.abs(d.value)>=3)items.push([summaryTone('avgCheck',d),`Средний чек ${move('avgCheck','вырос','снизился')} до ${summaryFormat('avgCheck',now.avgCheck)} (${d.text}).`])}
  if(now.openCount){
    const d=has('openCount');
    const stages=['cartConversion','cartToOrder'].map(key=>({key,delta:has(key)})).filter(item=>item.delta&&item.delta.value<=-0.3).sort((a,b)=>a.delta.value-b.delta.value);
    let text=`Переходов в карточки ${fmtNum(now.openCount)}${d?` (${d.text})`:''}, конверсия в заказ ${summaryFormat('orderConversion',now.orderConversion)}.`;
    if(stages.length)text+=` Сильнее всего просел этап «${(SUMMARY_METRICS[stages[0].key].phrase||SUMMARY_METRICS[stages[0].key].label).toLowerCase()}»: ${stages[0].delta.text}.`;
    items.push([stages.length?'down':d?summaryTone('openCount',d):'flat',text]);
  }
  if(now.buyoutCount){const d=has('buyoutPercent');items.push([d?summaryTone('buyoutPercent',d):'flat',`Выкуплено ${fmtNum(now.buyoutCount)} шт на ${summaryFormat('buyoutSum',now.buyoutSum)}, процент выкупа ${summaryFormat('buyoutPercent',now.buyoutPercent)}${d?` (${d.text})`:''}.`])}
  if(ads&&now.adSpend){const d=has('drr');items.push([d?summaryTone('drr',d):'flat',`На рекламу ушло ${summaryFormat('adSpend',now.adSpend)}, ДРР ${summaryFormat('drr',now.drr)}${d?` (${d.text})`:''}; из рекламы ${summaryFormat('adOrderShare',now.adOrderShare)} заказов.`])}
  const leader=data.top?.items?.[0];
  if(leader)items.push(['flat',`Лидер по сумме заказов — «${leader.name}»: ${summaryNumber(leader.share)}% от всех заказов.`]);
  if(before)items.push(data.drops.total?['down',`У ${fmtNum(data.drops.total)} ${pluralRu(data.drops.total,['товара','товаров','товаров'])} заметная просадка — список в блоке «Что проверить».`]:['up','Заметных просадок по товарам нет.']);
  return items;
}
function renderSummaryText(now,before,data){
  $('#summaryTextNote').textContent=before?`Сравнение ${summaryCompareLabel()}`:'Без сравнения с прошлым периодом';
  const icons={up:'↑',down:'↓',flat:'•'};
  $('#summaryText').innerHTML=summaryInsights(now,before,data).map(([tone,text])=>`<li><i class="${tone}" aria-hidden="true">${icons[tone]}</i><span>${escapeHtml(text)}</span></li>`).join('');
}

function renderSummaryTrends(now,before,days,previousDays){
  const keys=SUMMARY_TREND_KEYS.filter(key=>!SUMMARY_METRICS[key].ads||summaryAds());
  $('#summaryTrends').innerHTML=keys.map(key=>`<div class="summary-trend"><span>${SUMMARY_METRICS[key].label}<small>${summaryFormat(key,now[key])}</small></span>${summarySpark(key,days,previousDays)}${before?summaryDeltaBadge(key,now[key],before[key])||'<span class="summary-delta flat">—</span>':'<span class="summary-delta flat">—</span>'}</div>`).join('')+
    (!summaryAds()?`<p class="summary-trends-note">${summaryView.adsLoading?'Рекламные показатели загружаются…':'Рекламные показатели недоступны за этот период'}</p>`:'');
}

function renderSummaryDrops(drops,hasPrevious){
  const el=$('#summaryDrops');
  $('#summaryDropsNote').textContent=drops?.total>drops?.items?.length?`Показаны ${drops.items.length} из ${fmtNum(drops.total)} товаров с просадкой`:'Товары с просадкой к прошлому периоду';
  if(!hasPrevious){el.innerHTML='<div class="summary-empty">Нет данных прошлого периода для сравнения</div>';return}
  if(!drops?.items?.length){el.innerHTML='<div class="summary-empty">Просадок нет: заказы, переходы и конверсия товаров не упали на 30% и больше</div>';return}
  const value=reason=>reason.unit==='%'?`${summaryNumber(reason.from)}% → ${summaryNumber(reason.to)}%`:`${fmtNum(reason.from)} → ${fmtNum(reason.to)}`;
  el.innerHTML=drops.items.map(item=>{
    const main=item.reasons[0],more=item.reasons.slice(1).map(reason=>reason.label.toLowerCase()).join(', ');
    const picture=item.photo?`<img src="${escapeHtml(item.photo)}" alt="" loading="lazy">`:`<span class="summary-drop-stub">${escapeHtml(String(item.name||'Т')[0])}</span>`;
    return `<button type="button" class="summary-drop" data-summary-nm="${escapeHtml(item.nmId)}" title="Открыть в воронке">${picture}<span><strong>${escapeHtml(item.name)}</strong><small class="summary-drop-reason">${escapeHtml(main.label)}: ${value(main)} (−${summaryNumber(Math.abs(main.change),0)}%)${more?`; также ${escapeHtml(more)}`:''}</small><small>${escapeHtml(item.vendorCode||'')} · ${escapeHtml(item.nmId)}</small></span>`+
      `<span class="summary-drop-side"><span class="summary-severity ${item.severity}">${SUMMARY_SEVERITY[item.severity]}</span>${item.lostSum?`<b>−${fmtNum(Math.round(item.lostSum))} ₽</b>`:''}</span></button>`;
  }).join('');
}

function renderSummaryFoot(data){
  const notes=[],{periods}=data,today=new Date(Date.now()+3*3_600_000).toISOString().slice(0,10);
  if(data.totals.previous)notes.push(`Сравнение с периодом ${trendFullDate(periods.previous.from)} – ${trendFullDate(periods.previous.to)}.`);
  if(periods.current.to>=today)notes.push('Сегодняшний день ещё не закончился, поэтому последние цифры могут быть ниже прошлого периода.');
  if(data.sync?.pending){const eta=data.sync.etaSeconds>=60?`${Math.ceil(data.sync.etaSeconds/60)} мин`:`${Math.max(1,data.sync.etaSeconds)} сек`;notes.push(`Графики по дням догружаются из WB: осталось ${fmtNum(data.sync.pending)} дн., примерно ${eta}.`)}
  if(data.fetchedAt&&!data.demo)notes.push(`Итоги воронки WB на ${formatDate(data.fetchedAt)}.`);
  if(summaryView.loading&&summaryView.data)notes.push('Обновляем…');
  $('#summaryFoot').textContent=notes.join(' ');
}

function summaryOpenFunnel(nmId){
  state.funnelFilters.articles.clear();if(nmId)state.funnelFilters.articles.add(String(nmId));
  state.funnelArticlesCabinet=state.cabinet;state.funnelPage=1;
  $('.nav-item[data-page="funnel"]').click();
}
document.addEventListener('click',event=>{
  const metric=event.target.closest('[data-summary-metric]');
  if(metric){summaryView.metric=metric.dataset.summaryMetric;renderSummary();return}
  const product=event.target.closest('[data-summary-nm]');
  if(product){summaryOpenFunnel(product.dataset.summaryNm);return}
  if(event.target.closest('[data-summary-go="funnel"]'))summaryOpenFunnel(null);
});
// Мини-графики: наведение мышью или касание показывает значение дня и тот же день прошлого периода.
['pointermove','pointerdown'].forEach(type=>document.addEventListener(type,event=>{
  const wrap=event.target.closest?.('[data-spark]');
  if(wrap)summarySparkHover(wrap,event);else if(summaryView.sparkActive)summarySparkHide();
}));
window.addEventListener('scroll',()=>{if(summaryView.sparkActive)summarySparkHide()},true);
