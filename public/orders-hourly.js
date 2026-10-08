// --- Лента заказов: заказы и выкупы по часам. Сегодня (столбики) против вчера или среднего за 7 дней (пунктир) ---
// Время московское, как в кабинете WB и в расписании показов рекламы. Данные — /api/orders/hourly (8 дней ленты заказов).
// Заказ — по времени оформления, выкуп — по времени, когда покупатель забрал товар.
const ordersHourly={data:null,error:'',series:'orders',metric:'count',compare:'yesterday',request:0,cabinet:''};
const HOURLY_SERIES=[['orders','Заказы'],['buyouts','Выкупы']];
const HOURLY_METRICS=[['count','шт'],['sum','₽']];
const HOURLY_COMPARE=[['yesterday','Вчера'],['week','Среднее за 7 дней']];
const hourLabel=hour=>`${String(hour%24).padStart(2,'0')}:00`;
const hourRange=(from,to)=>`${hourLabel(from)}–${hourLabel(to)}`;

async function loadOrdersHourly(){
  const request=++ordersHourly.request,cabinet=state.cabinet;
  if(ordersHourly.cabinet!==cabinet){ordersHourly.data=null;ordersHourly.error='';renderOrdersHourly()}
  try{
    const data=await api('/api/orders/hourly?'+new URLSearchParams({cabinet}));
    if(request!==ordersHourly.request)return;
    Object.assign(ordersHourly,{data,cabinet,error:''});
  }catch(e){if(request!==ordersHourly.request)return;ordersHourly.error=e.message}
  renderOrdersHourly();
}
// Заказы или выкупы ячейки часа (дня) — количество и сумма.
const hourlyPick=(cell,series=ordersHourly.series)=>series==='buyouts'?{count:cell.buyoutCount||0,sum:cell.buyoutSum||0}:{count:cell.count,sum:cell.sum};
function hourlyValue(cell){const value=hourlyPick(cell);return ordersHourly.metric==='sum'?value.sum:value.count}
const hourlySeriesLabel=()=>HOURLY_SERIES.find(([key])=>key===ordersHourly.series)[1];
// Среднее бывает дробным (2,4 заказа в час) — один знак после запятой; суммы — целыми рублями.
function hourlyFormat(value){
  if(value==null)return '—';
  return ordersHourly.metric==='sum'?`${fmtNum(Math.round(value))} ₽`:Number(value).toLocaleString('ru-RU',{maximumFractionDigits:1});
}
function hourlyDelta(now,before){
  if(!before)return now?'<span class="hourly-up">новое</span>':'';
  const change=Math.round((now-before)/before*100);
  return change===0?'<span>±0%</span>':`<span class="${change>0?'hourly-up':'hourly-down'}">${change>0?'▲':'▼'} ${Math.abs(change)}%</span>`;
}
// Ряды графика: сегодня (будущие часы — пусто) и выбранное сравнение.
function hourlySeries(data){
  const days=data.days,today=days[days.length-1],yesterday=days[days.length-2],week=days.slice(0,-1);
  const todayValues=today.hours.map((cell,hour)=>hour>data.now.hour?null:hourlyValue(cell));
  const weekValues=Array.from({length:24},(_,hour)=>week.reduce((sum,day)=>sum+hourlyValue(day.hours[hour]),0)/week.length);
  const yesterdayValues=yesterday.hours.map(hourlyValue);
  return {today,yesterday,week,todayValues,yesterdayValues,weekValues,compareValues:ordersHourly.compare==='yesterday'?yesterdayValues:weekValues};
}
// Пиковые часы — три часа с наибольшим средним за 7 дней (соседние склеиваются в интервал);
// «тихое окно» — 6 подряд идущих часов с наименьшей долей заказов (через полночь тоже).
function hourlyPeaks(values){
  const total=values.reduce((sum,value)=>sum+value,0);if(!total)return null;
  const top=values.map((value,hour)=>({value,hour})).filter(item=>item.value>0).sort((a,b)=>b.value-a.value).slice(0,3).map(item=>item.hour).sort((a,b)=>a-b);
  const ranges=[];for(const hour of top){const last=ranges[ranges.length-1];if(last&&last.to===hour)last.to=hour+1;else ranges.push({from:hour,to:hour+1})}
  let quiet={from:0,share:Infinity};
  for(let start=0;start<24;start++){const share=Array.from({length:6},(_,i)=>values[(start+i)%24]).reduce((sum,value)=>sum+value,0)/total;if(share<quiet.share)quiet={from:start,share}}
  return {ranges,peakShare:top.reduce((sum,hour)=>sum+values[hour],0)/total,quiet};
}
function renderOrdersHourly(){
  const el=$('#ordersHourlyChart');if(!el)return;
  const switches=[['Что показать',HOURLY_SERIES,'series'],['Единицы',HOURLY_METRICS,'metric'],['Сравнить с',HOURLY_COMPARE,'compare']];
  $('#ordersHourlyControls').innerHTML=switches.map(([label,options,field])=>`<div class="hourly-switch" role="group" aria-label="${label}">${options.map(([key,text])=>`<button type="button" class="funnel-metric ${ordersHourly[field]===key?'active':''}" data-hourly-${field}="${key}">${text}</button>`).join('')}</div>`).join('');
  const data=ordersHourly.data,compareLabel=HOURLY_COMPARE.find(([key])=>key===ordersHourly.compare)[1],seriesLabel=hourlySeriesLabel();
  if(!data){
    el.innerHTML=`<div class="chart-empty">${ordersHourly.error?`Не удалось загрузить заказы по часам: ${escapeHtml(ordersHourly.error)}`:'Загрузка заказов по часам…'}</div>`;
    $('#ordersHourlyInsights').innerHTML='';$('#ordersHourlyLegend').innerHTML='';$('#ordersHourlyTable').innerHTML='';return;
  }
  const series=hourlySeries(data),{todayValues,compareValues}=series,nowHour=data.now.hour;
  // WB отдаёт ленту раз в минуту; если обновить не удалось, показываем, на какое время данные.
  const fetched=data.fetchedAt?new Date(data.fetchedAt).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Moscow'}):'';
  $('#ordersHourlyNote').textContent=`По московскому времени · сегодня до ${hourLabel(nowHour).slice(0,3)}${String(data.now.minute).padStart(2,'0')}${fetched?` · данные WB на ${fetched}`:''}${data.demo?' · демо-данные':''}`;
  renderOrdersHourlyInsights(data,series);
  $('#ordersHourlyLegend').innerHTML=`<span><i class="legend-bar"></i>Сегодня</span><span><i class="legend-dashed"></i>${compareLabel}</span><span class="hourly-legend-note"><i class="legend-bar partial"></i>текущий час ещё идёт</span>`;
  // Ширина рисунка — по ширине панели, чтобы подписи осей не растягивались вместе с графиком.
  const w=Math.max(520,Math.round(el.clientWidth-40)),h=250,left=10,right=60,top=14,bottom=28,plotW=w-left-right,plotH=h-top-bottom,slot=plotW/24,barW=Math.min(22,slot*.62);
  const max=niceTrendMax(Math.max(0,...todayValues.filter(value=>value!=null),...compareValues));
  const y=value=>top+plotH-value/max*plotH,cx=hour=>left+slot*hour+slot/2;
  const axis=value=>ordersHourly.metric==='sum'?shortMoney(value):Number(value).toLocaleString('ru-RU',{maximumFractionDigits:1});
  const ticks=[0,.25,.5,.75,1].map(ratio=>`<line class="trend-grid" x1="${left}" x2="${w-right}" y1="${y(max*ratio)}" y2="${y(max*ratio)}"/><text class="trend-axis" x="${w-right+10}" y="${y(max*ratio)+4}">${axis(max*ratio)}</text>`).join('');
  const labels=Array.from({length:8},(_,i)=>i*3).map(hour=>`<text class="trend-axis" x="${cx(hour)}" y="${h-8}" text-anchor="middle">${hourLabel(hour)}</text>`).join('');
  // Столбик скруглён только сверху, основание — на нуле.
  const bar=(hour,value)=>{if(!value)return '';const x=cx(hour)-barW/2,top0=y(value),base=y(0),r=Math.min(4,barW/2,base-top0);
    return `<path class="hourly-bar ${hour===nowHour?'partial':''}" data-hour="${hour}" d="M${x} ${base}V${top0+r}Q${x} ${top0} ${x+r} ${top0}H${x+barW-r}Q${x+barW} ${top0} ${x+barW} ${top0+r}V${base}Z"/>`};
  const bars=todayValues.map((value,hour)=>bar(hour,value)).join('');
  const line=`<path class="trend-line previous" d="${compareValues.map((value,hour)=>`${hour?'L':'M'}${cx(hour)} ${y(value)}`).join('')}"/>`;
  el.innerHTML=`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${seriesLabel} по часам: сегодня и ${compareLabel.toLowerCase()}">${ticks}${labels}${bars}${line}`+
    `<g class="trend-hover hidden"><line class="hover-line" y1="${top}" y2="${top+plotH}"/><circle class="trend-hover-point previous" r="4.5"/></g><rect x="${left}" y="${top}" width="${plotW}" height="${plotH}" fill="transparent"/></svg><div class="chart-tooltip hidden"></div>`;
  const svg=el.querySelector('svg'),tip=el.querySelector('.chart-tooltip'),hover=svg.querySelector('.trend-hover');
  svg.onpointermove=event=>{
    const rect=svg.getBoundingClientRect(),vx=(event.clientX-rect.left)/rect.width*w,hour=Math.max(0,Math.min(23,Math.floor((vx-left)/slot)));
    hover.classList.remove('hidden');
    const guide=hover.querySelector('line');guide.setAttribute('x1',cx(hour));guide.setAttribute('x2',cx(hour));
    const dot=hover.querySelector('circle');dot.setAttribute('cx',cx(hour));dot.setAttribute('cy',y(compareValues[hour]));
    svg.querySelectorAll('.hourly-bar').forEach(item=>item.classList.toggle('active',Number(item.dataset.hour)===hour));
    const now=todayValues[hour],before=compareValues[hour];
    tip.innerHTML=`<strong>${seriesLabel} · ${hourRange(hour,hour+1)}${hour===nowHour?' · час идёт':''}</strong>`+
      `<span style="--dot:var(--purple)"><i></i>Сегодня<b>${hour>nowHour?'ещё не было':hourlyFormat(now)}</b></span>`+
      `<span style="--dot:#a78bfa"><i></i>${compareLabel}<b>${hourlyFormat(before)}</b></span>`+
      (hour<nowHour&&(now||before)?`<span>Изменение<b>${hourlyDelta(now,before).replace(/<[^>]+>/g,'')}</b></span>`:'');
    tip.classList.remove('hidden');
    const chartRect=el.getBoundingClientRect(),px=rect.left-chartRect.left+el.scrollLeft+cx(hour)/w*rect.width,half=tip.offsetWidth/2;
    tip.style.left=`${Math.min(Math.max(px,el.scrollLeft+half+6),el.scrollLeft+el.clientWidth-half-6)}px`;
  };
  svg.onpointerleave=()=>{hover.classList.add('hidden');tip.classList.add('hidden');svg.querySelectorAll('.hourly-bar.active').forEach(item=>item.classList.remove('active'))};
  // Таблица — те же числа без графика (и для тех, кому трудно различить цвета).
  const rows=Array.from({length:24},(_,hour)=>`<tr${hour===nowHour?' class="hourly-now"':''}><td>${hourRange(hour,hour+1)}</td><td>${hour>nowHour?'—':hourlyFormat(todayValues[hour])}</td><td>${hourlyFormat(series.yesterdayValues[hour])}</td><td>${hourlyFormat(series.weekValues[hour])}</td></tr>`).join('');
  const table=$('#ordersHourlyTable'),open=table.open;
  table.innerHTML=`<summary>Таблица по часам — ${seriesLabel.toLowerCase()}, ${ordersHourly.metric==='sum'?'₽':'шт'}</summary><div class="table-wrap"><table><thead><tr><th>Час</th><th>Сегодня</th><th>Вчера</th><th>Среднее за 7 дней</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  table.open=open;
}
// «К этому часу» — заказы и выкупы сегодня против вчера и среднего за 7 дней к тому же времени суток,
// изменение и по количеству, и по сумме.
function renderOrdersHourlyInsights(data,series){
  const {today,yesterday,week}=series;
  const at=`${hourLabel(data.now.hour).slice(0,3)}${String(data.now.minute).padStart(2,'0')}`;
  const num=value=>Number(value).toLocaleString('ru-RU',{maximumFractionDigits:1}),rub=value=>`${fmtNum(Math.round(value))} ₽`;
  const average=kind=>({count:week.reduce((sum,day)=>sum+hourlyPick(day.byNow,kind).count,0)/week.length,sum:week.reduce((sum,day)=>sum+hourlyPick(day.byNow,kind).sum,0)/week.length});
  const versus=(now,before,label)=>`${label} ${num(before.count)} шт ${hourlyDelta(now.count,before.count)} · ${rub(before.sum)} ${hourlyDelta(now.sum,before.sum)}`;
  const line=(kind,title)=>{const now=hourlyPick(today.byNow,kind);
    return `<p class="${ordersHourly.series===kind?'hourly-current':''}"><b>${title} к ${at}:</b> ${num(now.count)} шт · ${rub(now.sum)} — ${versus(now,hourlyPick(yesterday.byNow,kind),'вчера к этому времени')} — ${versus(now,average(kind),'в среднем за 7 дней')}</p>`};
  const peaks=hourlyPeaks(series.weekValues),buyouts=ordersHourly.series==='buyouts';
  const what=`${ordersHourly.metric==='sum'?'суммы ':''}${buyouts?'выкупов':'заказов'}`;
  // Расписание рекламы подсказываем по заказам; пики выкупов — когда покупатели забирают товар из пунктов выдачи.
  const advice=!peaks?`<p>За прошлую неделю ${buyouts?'выкупов':'заказов'} нет — пиковые часы определить не по чему.</p>`:buyouts?
    `<p><b>Пиковые часы выкупов</b> (среднее за 7 дней): ${peaks.ranges.map(range=>hourRange(range.from,range.to)).join(', ')} — ${Math.round(peaks.peakShare*100)}% ${what}. В эти часы покупатели чаще всего забирают заказы из пунктов выдачи.</p>`:
    `<p><b>Пиковые часы</b> (среднее за 7 дней): ${peaks.ranges.map(range=>hourRange(range.from,range.to)).join(', ')} — ${Math.round(peaks.peakShare*100)}% ${what}. Подсказка для расписания показов: в эти часы реклама должна быть включена.`+
    (peaks.quiet.share<.1?` Меньше всего — ${hourRange(peaks.quiet.from,peaks.quiet.from+6)}: всего ${Math.max(1,Math.round(peaks.quiet.share*100))}% ${what}, эти часы можно исключить из показов, чтобы не тратить бюджет.`:'')+'</p>';
  $('#ordersHourlyInsights').innerHTML=line('orders','Заказы сегодня')+line('buyouts','Выкупы сегодня')+advice;
}
let ordersHourlyResize=0;
window.addEventListener('resize',()=>{clearTimeout(ordersHourlyResize);ordersHourlyResize=setTimeout(()=>{if(ordersHourly.data&&state.activePage==='orders')renderOrdersHourly()},150)});
document.addEventListener('click',event=>{
  const metric=event.target.closest('[data-hourly-metric]'),compare=event.target.closest('[data-hourly-compare]'),series=event.target.closest('[data-hourly-series]');
  if(series){ordersHourly.series=series.dataset.hourlySeries;renderOrdersHourly()}
  if(metric){ordersHourly.metric=metric.dataset.hourlyMetric;renderOrdersHourly()}
  if(compare){ordersHourly.compare=compare.dataset.hourlyCompare;renderOrdersHourly()}
});
