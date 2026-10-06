(() => {
  'use strict';
  const params = new URLSearchParams(location.search);
  const state = { rows: [], productDaily: [], sort: { key: 'date', direction: 'desc' }, productSort: { key: 'spend', direction: 'desc' }, visibleMetrics: new Set(['views', 'clicks', 'orders', 'spend', 'drr']), visibleCards: new Set() };
  const columns = ['date','views','clicks','ctr','cpc','carts','orders','canceled','revenue','spend','drr'];
  const chartMetrics = [{key:'views',label:'Показы',color:'#277a70'},{key:'clicks',label:'Клики',color:'#d77b28'},{key:'carts',label:'Корзины',color:'#4d8f63'},{key:'orders',label:'Заказы',color:'#b35b45'},{key:'spend',label:'Затраты',color:'#5a7d9a'},{key:'revenue',label:'Сумма заказов',color:'#8b6b3f'},{key:'drr',label:'ДРР',color:'#7651e5'}];
  // Значение линии графика за день. ДРР без рекламной выручки не определён (расход есть, заказов нет) — на графике разрыв, а не 0.
  function chartValue(s,row,byDay){if(s.card)return Number(byDay.get(`${s.card}:${row.date}`)?.spend||0);if(s.key==='drr'&&!Number(row.revenue))return null;return Number(row[s.key]||0)}
  const $=s=>document.querySelector(s), number=v=>Number(v||0).toLocaleString('ru-RU',{maximumFractionDigits:2}), money=v=>`${number(v)} ₽`, percent=v=>`${number(v)}%`, date=v=>{const d=new Date(`${v}T00:00:00Z`);return Number.isNaN(d.getTime())?v:d.toLocaleDateString('ru-RU')}, esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])), total=k=>state.rows.reduce((s,r)=>s+Number(r[k]||0),0), average=k=>state.rows.length?total(k)/state.rows.length:0;
  const fmt=(k,v)=>k==='date'?date(v):['spend','revenue','cpc'].includes(k)?money(v):['ctr','drr'].includes(k)?percent(v):number(v);
  function sorted(rows, sort){return [...rows].sort((a,b)=>{const av=a[sort.key]??'',bv=b[sort.key]??'',r=typeof av==='number'&&typeof bv==='number'?av-bv:String(av).localeCompare(String(bv),'ru',{numeric:true});return sort.direction==='asc'?r:-r})}
  const AD_STATUSES={4:'Готова к запуску',7:'Завершена',8:'Отказался',9:'Идут показы',11:'На паузе'};
  const AD_BIDS={manual:'Ручные ставки',unified:'Единая ставка',auto:'Автоставка'};
  const SUM_KEYS=['views','clicks','carts','orders','canceled','revenue','spend'];
  function totals(rows){const t={};SUM_KEYS.forEach(k=>t[k]=rows.reduce((sum,row)=>sum+Number(row[k]||0),0));t.ctr=t.views?t.clicks/t.views*100:0;t.cpc=t.clicks?t.spend/t.clicks:0;t.drr=t.revenue?t.spend/t.revenue*100:0;return t}
  function photoCell(row){const photo=row.photo?`<img class="product-photo" src="${esc(row.photo)}" alt="" loading="lazy">`:'<i class="product-photo-stub"></i>';return `<div class="product-cell" title="${esc(row.name||`Товар ${row.nmId}`)}">${photo}<span><b>${esc(row.name||`Товар ${row.nmId}`)}</b>${row.vendorCode?`<small>${esc(row.vendorCode)}</small>`:''}</span></div>`}
  function bindPhotoPreview(image){image.addEventListener('mouseenter',()=>{const rect=image.getBoundingClientRect(),preview=document.createElement('img');preview.className='product-photo-preview';preview.src=image.currentSrc||image.src;preview.alt='';document.body.append(preview);const width=preview.offsetWidth,height=preview.offsetHeight;preview.style.left=`${Math.min(Math.max(8,rect.right+10),window.innerWidth-width-8)}px`;preview.style.top=`${Math.min(Math.max(8,rect.top+(rect.height-height)/2),window.innerHeight-height-8)}px`;image._preview=preview});image.addEventListener('mouseleave',()=>{image._preview?.remove();image._preview=null})}
  function bindPhotoPreviews(selector){document.querySelectorAll(`${selector} .product-photo`).forEach(image=>{if(image.dataset.previewBound)return;image.dataset.previewBound='1';bindPhotoPreview(image)})}
  // Дата создания берётся из строки WB (время московское), чтобы часовой пояс браузера не сдвигал день.
  const createdDate=value=>{const match=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})/);return match?`${match[3]}.${match[2]}.${match[1]}`:''};
  function renderMeta(c){const tags=[c.paymentType?String(c.paymentType).toUpperCase():'',AD_BIDS[String(c.bidType)]||c.bidType||'',AD_STATUSES[Number(c.status)]||''],created=createdDate(c.createdAt);$('#campaignMeta').innerHTML=tags.filter(Boolean).map(x=>`<b>${esc(x)}</b>`).join('')+(created?`<span class="campaign-created">Создана ${created}</span>`:'')}
  function renderSummary(c){const cards=[['Показы',number(c.views)],['Клики',number(c.clicks)],['Рекламные заказы',number(c.orders)],['Сумма заказов',money(c.revenue)],['Затраты',money(c.spend)],['ДРР за период',percent(Number(c.revenue)?Number(c.spend||0)/Number(c.revenue)*100:0)],['Средний CTR',percent(average('ctr'))],['Средний CPC',money(average('cpc'))],['Добавления в корзину',number(total('carts'))],['Отмены',number(total('canceled'))]];$('#summary').innerHTML=cards.map(x=>`<div class="metric"><span>${x[0]}</span><strong>${x[1]}</strong></div>`).join('')}
  function renderTable(){const rows=sorted(state.rows,state.sort);const sum=totals(state.rows);const head=`<tr class="total-row"><td>Итого · ${number(state.rows.length)} дн.</td>${columns.slice(1).map(k=>`<td>${esc(fmt(k,sum[k]))}</td>`).join('')}</tr>`;$('#dailyBody').innerHTML=rows.length?head+rows.map(r=>`<tr>${columns.map(k=>`<td>${k==='drr'&&!Number(r.revenue)&&Number(r.spend)?'<span title="Нет рекламной выручки — ДРР не определён">—</span>':esc(fmt(k,r[k]))}</td>`).join('')}</tr>`).join(''):'<tr><td colspan="11" class="empty">Нет дневных данных за выбранный период</td></tr>'}
  function aggregateProducts(){
    const totals=new Map(), sumKeys=['views','clicks','carts','orders','canceled','revenue','spend'];
    for(const row of state.productDaily){const key=String(row.nmId||'');if(!key)continue;let total=totals.get(key);if(!total){total={nmId:row.nmId,name:'',photo:'',vendorCode:''};sumKeys.forEach(k=>total[k]=0);totals.set(key,total)}if(!total.name&&row.name)total.name=row.name;if(!total.photo&&row.photo)total.photo=row.photo;if(!total.vendorCode&&row.vendorCode)total.vendorCode=row.vendorCode;sumKeys.forEach(k=>total[k]+=Number(row[k]||0));}
    return [...totals.values()].map(row=>({...row,name:row.name||`Товар ${row.nmId}`,ctr:row.views?row.clicks/row.views*100:0,cpc:row.clicks?row.spend/row.clicks:0,drr:row.revenue?row.spend/row.revenue*100:0}));
  }
  function renderProductTable(){const rows=sorted(aggregateProducts(),state.productSort);const sum=totals(rows);const head=`<tr class="total-row"><td>Итого</td><td>${number(rows.length)} артикулов</td>${['views','clicks','ctr','cpc','carts','orders','canceled','revenue','spend','drr'].map(k=>`<td>${esc(fmt(k,sum[k]))}</td>`).join('')}</tr>`;$('#productDailyBody').innerHTML=rows.length?head+rows.map(r=>`<tr><td><button class="product-link" type="button" data-product-id="${esc(r.nmId)}">${esc(r.nmId||'—')}</button></td><td>${photoCell(r)}</td>${['views','clicks','ctr','cpc','carts','orders','canceled','revenue','spend','drr'].map(k=>`<td>${esc(fmt(k,r[k]))}</td>`).join('')}</tr>`).join(''):'<tr><td colspan="12" class="empty">Нет данных по артикулам за выбранный период</td></tr>';$('#productDailyBody').querySelectorAll('[data-product-id]').forEach(button=>button.onclick=()=>openProductModal(button.dataset.productId));bindPhotoPreviews('#productDailyBody')}
  function openProductModal(nmId){const rows=state.productDaily.filter(row=>String(row.nmId)===String(nmId)).sort((a,b)=>String(a.date).localeCompare(String(b.date)));const first=rows.find(row=>row.name)||rows[0]||{};$('#productModalTitle').textContent=`Артикул ${nmId} · ${first.name||'Статистика по дням'}`;$('#productModalBody').innerHTML=rows.length?`<tr class="total-row"><td>Итого · ${number(rows.length)} дн.</td>${['views','clicks','ctr','cpc','carts','orders','canceled','revenue','spend','drr'].map(k=>`<td>${esc(fmt(k,totals(rows)[k]))}</td>`).join('')}</tr>`+rows.map(r=>`<tr>${['date','views','clicks','ctr','cpc','carts','orders','canceled','revenue','spend','drr'].map(k=>`<td>${esc(fmt(k,r[k]))}</td>`).join('')}</tr>`).join(''):'<tr><td colspan="11" class="empty">Нет дневных данных по этому артикулу</td></tr>';$('#productModal').hidden=false}
  function closeProductModal(){$('#productModal').hidden=true}
  function renderOptions(){const cards=[...new Map(state.productDaily.map(r=>[String(r.nmId),r])).values()];$('#chartOptions').innerHTML=chartMetrics.map(m=>`<label><input type="checkbox" data-chart-key="${m.key}" ${state.visibleMetrics.has(m.key)?'checked':''}> ${m.label}</label>`).join('')+cards.map((c,i)=>`<label><input type="checkbox" data-card-key="${esc(c.nmId)}" ${state.visibleCards.has(String(c.nmId))?'checked':''}> Артикул ${esc(c.nmId)}</label>`).join('');$('#chartOptions').querySelectorAll('[data-chart-key]').forEach(i=>i.onchange=()=>{i.checked?state.visibleMetrics.add(i.dataset.chartKey):state.visibleMetrics.delete(i.dataset.chartKey);renderChart()});$('#chartOptions').querySelectorAll('[data-card-key]').forEach(i=>i.onchange=()=>{i.checked?state.visibleCards.add(i.dataset.cardKey):state.visibleCards.delete(i.dataset.cardKey);renderChart()})}
  // Линии разных порядков (показы — тысячи, заказы — единицы) делятся на группы по величине: внутри группы максимумы
  // отличаются меньше чем в 10 раз, и у группы общая шкала. Первая группа — левая ось, вторая — правая; остальные
  // рисуются каждая со своей шкалой без оси, их значения видны в подсказке и в пометке под графиком.
  const CHART_GROUP_RATIO=10;
  function chartNiceMax(value){if(!(value>0))return 1;const power=10**Math.floor(Math.log10(value)),step=[1,1.2,1.5,2,2.5,3,4,5,6,8,10].find(k=>k*power>=value);return step*power}
  function chartAxisNumber(value){return Math.abs(value)>=10000?new Intl.NumberFormat('ru-RU',{notation:'compact',maximumFractionDigits:1}).format(value):number(value)}
  function chartGroups(series,maxOf){
    const groups=[];
    for(const s of [...series].sort((a,b)=>maxOf(b)-maxOf(a))){const group=groups[groups.length-1];if(group&&maxOf(s)*CHART_GROUP_RATIO>=group.top)group.series.push(s);else groups.push({top:maxOf(s),series:[s]})}
    return groups.map(group=>({...group,max:chartNiceMax(group.top)}));
  }
  function renderChart(){
    const svg=$('#dailyChart'),note=$('#chartScaleNote'),rows=[...state.rows].sort((a,b)=>String(a.date).localeCompare(String(b.date))),left=64,right=64,top=20,bottom=42,w=1200,h=290,pw=w-left-right,ph=h-top-bottom;
    const cards=[...new Map(state.productDaily.map(r=>[String(r.nmId),r])).values()];const selected=chartMetrics.filter(m=>state.visibleMetrics.has(m.key));
    const series=[...selected,...cards.filter(c=>state.visibleCards.has(String(c.nmId))).map((c,i)=>({key:`card:${c.nmId}`,label:`Артикул ${c.nmId}`,color:['#b35b45','#5a7d9a','#8b6b3f','#277a70','#d77b28'][i%5],card:c.nmId}))];
    if(!rows.length||!series.length){svg.innerHTML='<text x="600" y="145" text-anchor="middle" class="chart-axis">Выберите данные для отображения</text>';note.innerHTML='';return}
    const byDay=new Map(state.productDaily.map(r=>[`${r.nmId}:${r.date}`,r]));
    const value=(s,r)=>chartValue(s,r,byDay),maxOf=s=>Math.max(0,...rows.map(r=>value(s,r)).filter(v=>v!=null));
    const groups=chartGroups(series,maxOf),scale=new Map(groups.flatMap(group=>group.series.map(s=>[s.key,group.max]))),[leftAxis,rightAxis]=groups;
    const x=i=>left+(rows.length===1?pw/2:i*pw/(rows.length-1)),y=(s,v)=>top+ph-Number(v||0)/scale.get(s.key)*ph;
    // Подписи оси — цветом её линии; если на оси несколько линий, цвет нейтральный, а линии перечислены над осью своими цветами.
    const axisColor=group=>group.series.length===1?group.series[0].color:'#58716e';
    const caption=(group,side)=>`<text class="chart-axis-caption" x="${side==='left'?left:w-right}" y="${top-8}" text-anchor="${side==='left'?'start':'end'}">${group.series.map(s=>`<tspan style="fill:${s.color}">${esc(s.label)}</tspan>`).join('<tspan style="fill:#9aaba8"> · </tspan>')}</text>`;
    const grid=[0,.25,.5,.75,1].map(r=>{const gy=top+ph-r*ph;return `<line class="chart-grid" x1="${left}" x2="${w-right}" y1="${gy}" y2="${gy}"/><text class="chart-axis" x="${left-8}" y="${gy+4}" text-anchor="end" style="fill:${axisColor(leftAxis)}">${esc(chartAxisNumber(leftAxis.max*r))}</text>`+(rightAxis?`<text class="chart-axis" x="${w-right+8}" y="${gy+4}" style="fill:${axisColor(rightAxis)}">${esc(chartAxisNumber(rightAxis.max*r))}</text>`:'')}).join('');
    const labels=rows.map((r,i)=>i%Math.max(1,Math.ceil(rows.length/8))===0?`<text class="chart-axis" x="${x(i)}" y="${h-14}" text-anchor="middle">${esc(date(r.date))}</text>`:'').join('');
    // Дни без значения (null) рвут линию: отрезки рисуются отдельно, одиночная точка — кружком.
    const lines=series.map(s=>{const parts=[];let part=[];rows.forEach((r,i)=>{const v=value(s,r);if(v==null){if(part.length)parts.push(part);part=[];return}part.push([x(i),y(s,v)])});if(part.length)parts.push(part);
      return parts.map(points=>points.length===1?`<circle class="chart-dot" cx="${points[0][0]}" cy="${points[0][1]}" r="3.5" fill="${s.color}"/>`:`<polyline class="chart-line" points="${points.map(p=>p.join(',')).join(' ')}" stroke="${s.color}"/>`).join('')}).join('');
    svg.innerHTML=`${grid}${rightAxis?caption(leftAxis,'left')+caption(rightAxis,'right'):''}${labels}${lines}<rect class="chart-hit-area" x="${left}" y="${top}" width="${pw}" height="${ph}" fill="transparent"/>`;
    const own=groups.slice(2).flatMap(group=>group.series.map(s=>`<span><i style="background:${s.color}"></i>${esc(s.label)} — до ${esc(chartAxisNumber(group.max))}${s.key==='drr'?'%':''}</span>`));
    note.innerHTML=own.length?`Со своей шкалой, без оси: ${own.join(' ')}`:'';
    bindHover(rows,x,series,byDay,w,top,top+ph);
  }
  function bindHover(rows,x,series,byDay,w,top,bottom){const svg=$('#dailyChart'),tip=$('#chartTooltip'),wrap=$('.chart-wrap');svg.onpointermove=e=>{const point=svg.createSVGPoint();point.x=e.clientX;point.y=e.clientY;const matrix=svg.getScreenCTM();if(!matrix)return;const local=point.matrixTransform(matrix.inverse()),vx=Math.max(0,Math.min(w,local.x));let idx=0,best=Infinity;rows.forEach((_,i)=>{const d=Math.abs(x(i)-vx);if(d<best){best=d;idx=i}});const row=rows[idx];tip.innerHTML=`<strong>${esc(date(row.date))}</strong>`+series.map(s=>{const v=chartValue(s,row,byDay);return `<span><i style="background:${s.color}"></i>${s.label}: <b>${v==null?'— (нет рекламной выручки)':esc(fmt(s.card?'spend':s.key,v))}</b></span>`}).join('');tip.hidden=false;const wrapRect=wrap.getBoundingClientRect(),svgRect=svg.getBoundingClientRect(),px=svgRect.left-wrapRect.left+(x(idx)/w)*svgRect.width;tip.style.left=`${Math.max(12,Math.min(wrap.clientWidth-tip.offsetWidth-12,px))}px`;let line=svg.querySelector('.chart-hover-line');if(!line){svg.insertAdjacentHTML('beforeend','<line class="chart-hover-line" y1="20" y2="248"/>');line=svg.querySelector('.chart-hover-line')}line.setAttribute('x1',x(idx));line.setAttribute('x2',x(idx))};svg.onpointerleave=()=>tip.hidden=true}
  const MONTH_NAMES=['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  const isoDate=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const exportState={presets:[],started:0,timer:0,chunks:0,index:0,phase:'',reason:'',waitUntil:0,failed:0};
  function buildExportPresets(){
    // «Сегодня» — по Москве (UTC+3), как в кабинете WB; дальше календарная арифметика идёт по этой дате.
    const msk=new Date(Date.now()+3*3_600_000),today=new Date(msk.getUTCFullYear(),msk.getUTCMonth(),msk.getUTCDate());
    const start31=new Date(today);start31.setDate(start31.getDate()-30);
    const list=[{value:'last31',label:'Последние 31 день',from:isoDate(start31),to:isoDate(today)},
      {value:'this-month',label:'Этот месяц',from:isoDate(new Date(today.getFullYear(),today.getMonth(),1)),to:isoDate(today)}];
    for(let i=1;i<=12;i++){const first=new Date(today.getFullYear(),today.getMonth()-i,1),last=new Date(today.getFullYear(),today.getMonth()-i+1,0);
      list.push({value:`month-${i}`,label:`${MONTH_NAMES[first.getMonth()]} ${first.getFullYear()}`,from:isoDate(first),to:isoDate(last)})}
    exportState.presets=list;
    const select=$('#exportPreset'),from=$('#exportFrom'),to=$('#exportTo');
    select.innerHTML=list.map(item=>`<option value="${item.value}">${esc(item.label)}</option>`).join('')+'<option value="custom">Свой период</option>';
    from.min=to.min=list[list.length-1].from;from.max=to.max=isoDate(today);
    const applyPreset=()=>{const item=list.find(entry=>entry.value===select.value);if(item){from.value=item.from;to.value=item.to}};
    select.onchange=applyPreset;
    from.onchange=to.onchange=()=>{const match=list.find(entry=>entry.from===from.value&&entry.to===to.value);select.value=match?match.value:'custom'};
    select.value='last31';applyPreset();
  }
  // Пояснение, если период выгрузки обрезан по жизни кампании.
  function exportLifeNote(event){
    const period=event.period,active=event.activePeriod,created=createdDate(event.createdAt);
    if(!period)return '';
    if(!active)return created?`Кампания создана ${created}, за выбранный период статистики у неё нет`:'За выбранный период статистики у кампании нет';
    const parts=[];
    if(active.from>period.from)parts.push(`с ${date(active.from)} — даты создания`);
    if(active.to<period.to)parts.push(`по ${date(active.to)} — дату завершения`);
    return parts.length?`Запрошено ${parts.join(', ')}`:'';
  }
  function formatSeconds(total){return total>=60?`${Math.floor(total/60)} мин ${total%60} сек`:`${total} сек`}
  function exportRequestsSent(s,now){
    if(s.phase==='start')return 0;
    if(s.phase==='wait'&&now<s.waitUntil)return s.index;
    if(s.phase==='finalize')return s.chunks;
    return s.index+1;
  }
  function renderExportProgress(){
    const s=exportState,now=Date.now();
    const saved=s.storedDays?` · из сохранённого: ${s.storedDays} дн.`:'',life=s.lifeNote?` · ${s.lifeNote}`:'';
    if(s.phase==='start'&&!s.known){$('#exportProgress').textContent='Проверяем сохранённую статистику…';return}
    if(s.chunks===0){$('#exportProgress').textContent=`${s.storedDays?'Все дни уже сохранены, запросы к WB не нужны':'Запросы к WB не нужны'}${life}${s.phase==='finalize'?' · подставляем названия и фото товаров…':''}`;return}
    let text=`Запросы: ${exportRequestsSent(s,now)} из ${s.chunks}${saved}${life}`;
    if(s.phase==='finalize'){text+=' · подставляем названия и фото товаров…'}
    else if(s.phase!=='start'){
      const waiting=s.phase==='wait'?Math.max(0,s.waitUntil-now):0;
      const current=s.phase==='received'?0:1000;
      const next=Math.max(0,s.chunks-s.index-1)*21000;
      const eta=Math.ceil((waiting+current+next)/1000);
      text+=eta<=3?' · осталось несколько секунд':` · осталось примерно ${formatSeconds(eta)}`;
    }
    $('#exportProgress').textContent=text;
  }
  function handleExportEvent(event){
    const s=exportState;
    if(event.type==='start'){s.chunks=event.chunks;s.storedDays=Number(event.storedDays||0);s.known=true;s.phase='start';s.lifeNote=exportLifeNote(event)}
    if(event.type==='request'){s.index=event.index;s.phase='request'}
    if(event.type==='wait'){s.index=event.index;s.phase='wait';s.reason=event.reason;s.waitUntil=Date.now()+Number(event.ms||0)}
    if(event.type==='chunk'){s.index=event.index;s.phase='received';if(!event.ok)s.failed++}if(event.type==='finalize')s.phase='finalize';
    if(event.type==='error')throw new Error(event.error||'Не удалось выгрузить статистику');
    renderExportProgress();
    return event.type==='result'?event:null;
  }
  const keywords={data:null,loading:false,error:'',product:'',search:'',onlyInactive:false,grade:'',sort:{key:'views',direction:'desc'},limit:200,selected:new Set(),busy:false,shown:[],ranges:{}};
  // Первые три столбца (запрос, статус, оценка) рисуются отдельно, остальные — через keywordValue.
  const KEYWORD_COLUMNS=['query','status','gradeScore','views','clicks','ctr','cpm','cpc','spend','spendShare','carts','cartCost','orders','cr','cpo','avgPosition'];
  // --- Оценка ключевых запросов по правилам: каждый запрос сравнивается со средним по кампании за период ---
  // Основа — стоимость заказа (CPO). Если заказов в кампании меньше десяти, по ним мало что видно (почти всё уйдёт
  // в «Мало данных»), поэтому сравнение идёт по стоимости корзины: корзин обычно в разы больше.
  // Запрос без заказов считается плохим, только когда кликов у него вдвое больше, чем в среднем нужно на один заказ,
  // и потрачено не меньше средней стоимости заказа; иначе это «Мало данных», а не провал.
  const KEYWORD_GRADES={good:{label:'Хороший',plural:'Хорошие',rank:4},watch:{label:'Наблюдать',plural:'Наблюдать',rank:3},little:{label:'Мало данных',plural:'Мало данных',rank:2},bad:{label:'Плохой',plural:'Плохие',rank:1}};
  const KEYWORD_MIN_ORDERS=10,KEYWORD_WATCH_RATIO=1.5;
  const ratioText=value=>Number(value).toLocaleString('ru-RU',{maximumFractionDigits:1});
  const plural=(count,forms)=>{const n=Math.abs(Number(count)||0)%100,d=n%10;return forms[n>10&&n<20?2:d===1?0:d>1&&d<5?1:2]};
  const clicksText=count=>`${number(count)} ${plural(count,['клик','клика','кликов'])}`;
  function keywordBenchmark(rows){
    const sum=key=>rows.reduce((total,row)=>total+Number(row[key]||0),0),spend=sum('spend'),clicks=sum('clicks'),orders=sum('orders'),carts=sum('carts');
    const byOrders=orders>=KEYWORD_MIN_ORDERS,count=byOrders?orders:carts;
    return {spend,clicks,byOrders,count,key:byOrders?'orders':'carts',cost:byOrders?'CPO':'Цена корзины',unit:byOrders?'заказ':'корзина',none:byOrders?'заказов':'корзин',
      unitCost:count?spend/count:null,clicksPerUnit:count?clicks/count:null};
  }
  function gradeKeyword(row,b){
    const spend=Number(row.spend||0),clicks=Number(row.clicks||0),count=Number(row[b.key]||0);
    if(!spend&&!clicks)return null;
    if(!b.unitCost)return {grade:'little',reason:`В кампании пока нет ${b.none} — сравнивать не с чем`};
    const average=money(b.unitCost);
    if(count){
      const cost=spend/count,ratio=cost/b.unitCost,diff=Math.round(Math.abs(1-ratio)*100);
      const versus=diff<5?`на уровне среднего (${average})`:ratio<1?`на ${diff}% ниже среднего (${average})`:ratio<=2?`на ${diff}% выше среднего (${average})`:`в ${ratioText(ratio)} раза выше среднего (${average})`;
      return {grade:ratio<=1?'good':ratio<=KEYWORD_WATCH_RATIO?'watch':'bad',reason:`${b.cost} ${money(cost)} — ${versus}`};
    }
    const need=Math.round(b.clicksPerUnit);
    if(clicks>=2*b.clicksPerUnit&&spend>=b.unitCost)return {grade:'bad',reason:`0 ${b.none} за ${clicksText(clicks)} (в среднем ${b.unit} на ${clicksText(need)}), потрачено ${money(spend)}`};
    return {grade:'little',reason:`${clicksText(clicks)} без ${b.none} — мало для вывода (в среднем ${b.unit} на ${clicksText(need)})`};
  }
  // Строки текущего артикула (или всех) с долей расходов, ценой корзины, CPO и оценкой; среднее — по всем строкам вида.
  function keywordView(){
    const data=keywords.data;if(!data)return {rows:[],benchmark:null};
    const base=keywords.product?(data.byNmId?.[keywords.product]||[]):(data.total||[]),benchmark=keywordBenchmark(base);
    const rows=base.map(row=>{
      const spend=Number(row.spend||0),graded=gradeKeyword(row,benchmark);
      return {...row,spendShare:benchmark.spend?spend/benchmark.spend*100:0,cartCost:row.carts?spend/row.carts:null,cpo:row.orders?spend/row.orders:null,
        grade:graded?.grade||'',gradeReason:graded?.reason||'',gradeScore:graded?KEYWORD_GRADES[graded.grade].rank:null};
    });
    return {rows,benchmark};
  }
  const KEYWORD_STATUSES={active:'Активен',excluded:'Неактивен',archived:'В архиве'};
  const keywordStatusCell=row=>row.status?`<span class="keyword-status ${row.status}">${KEYWORD_STATUSES[row.status]}</span>`:'<span class="keyword-status archived">Нет данных</span>';
  // null — WB этот показатель не прислал (показы, CTR и CPM по CPC-кампаниям), поэтому прочерк, а не 0.
  const keywordValue=(key,value)=>key==='query'?String(value??''):value==null?'—':['spend','cpc','cpm','cartCost','cpo'].includes(key)?money(value):['ctr','cr','spendShare'].includes(key)?percent(value):number(value);
  function keywordRows(view){
    const data=keywords.data;if(!data)return [];
    const term=keywords.search.trim().toLowerCase();
    // Фильтры «от — до» над столбцами: строка без значения (прочерк) при заданной границе не проходит.
    const ranges=Object.entries(keywords.ranges).filter(([,range])=>range.min!=null||range.max!=null);
    const inRanges=row=>ranges.every(([key,range])=>{const value=row[key];if(value==null)return false;return (range.min==null||value>=range.min)&&(range.max==null||value<=range.max)});
    const filtered=view.rows.filter(row=>(!term||row.query.toLowerCase().includes(term))&&(!keywords.onlyInactive||row.status==='excluded'||row.status==='archived')&&(!keywords.grade||row.grade===keywords.grade)&&inRanges(row));
    // Без показов (CPC-кампании) сортировка по показам, CTR или CPM ничего не упорядочит — тогда сортируем по кликам.
    const unknown=data.viewsAvailable===false&&['views','ctr','cpm'].includes(keywords.sort.key),sort=unknown?{key:'clicks',direction:keywords.sort.direction}:keywords.sort;
    // Строки без значения (нет заказов для CPO, нет корзин для их цены, нет оценки) всегда в конце, в любом направлении.
    return [...sorted(filtered.filter(row=>row[sort.key]!=null),sort),...filtered.filter(row=>row[sort.key]==null)];
  }
  // Блок над таблицей: сколько запросов в каждой оценке, сколько денег на них ушло, кандидаты на отключение.
  function renderKeywordInsights(view){
    const box=$('#keywordInsights');if(!box)return;
    const b=view.benchmark,graded=view.rows.filter(row=>row.grade);
    if(!b||!graded.length){box.innerHTML='';return}
    const cards=['good','watch','bad','little'].map(grade=>{
      const list=graded.filter(row=>row.grade===grade),spend=list.reduce((total,row)=>total+Number(row.spend||0),0);
      return `<button type="button" class="keyword-grade-card ${grade} ${keywords.grade===grade?'active':''}" data-keyword-grade="${grade}"><b>${number(list.length)}</b><span>${KEYWORD_GRADES[grade].plural}</span><small>${money(spend)} · ${percent(b.spend?spend/b.spend*100:0)} расходов</small></button>`;
    }).join('');
    const cost=b.byOrders?b.cost:b.cost.toLowerCase();
    const basis=b.unitCost?`Сравнение со средним по кампании: ${cost} ${money(b.unitCost)}, ${b.unit} в среднем на ${clicksText(Math.round(b.clicksPerUnit))}${b.byOrders?'':` (заказов меньше ${KEYWORD_MIN_ORDERS} — по ним выводы ненадёжны, поэтому оценка по корзинам)`}. Хороший — ${cost} не выше среднего; наблюдать — до ${ratioText(KEYWORD_WATCH_RATIO)}× среднего; плохой — выше или 0 ${b.none} при вдвое большем числе кликов, чем обычно нужно.`:`В кампании пока нет ${b.none} — оценивать запросы не с чем.`;
    const bad=graded.filter(row=>row.grade==='bad').sort((x,y)=>Number(y.spend||0)-Number(x.spend||0)).slice(0,5);
    box.innerHTML=`<div class="keyword-grade-cards">${cards}</div><p class="keyword-basis">${esc(basis)}</p>`+
      (bad.length?`<div class="keyword-candidates"><strong>Кандидаты на отключение</strong>${bad.map(row=>`<span><b>${esc(row.query)}</b> — ${esc(money(row.spend))} · ${esc(row.gradeReason)}</span>`).join('')}</div>`:'');
    box.querySelectorAll('[data-keyword-grade]').forEach(button=>button.onclick=()=>{const grade=button.dataset.keywordGrade;keywords.grade=keywords.grade===grade?'':grade;$('#keywordGrade').value=keywords.grade;renderKeywords()});
  }
  function keywordStatusNote(rows){
    const off=rows.filter(row=>row.status==='excluded').length,archived=rows.filter(row=>row.status==='archived').length;
    return [off?`неактивных: ${number(off)}`:'',archived?`в архиве: ${number(archived)}`:''].filter(Boolean);
  }
  function keywordTotals(rows){
    const sum=key=>rows.reduce((total,row)=>total+Number(row[key]||0),0);
    const viewsKnown=rows.some(row=>row.views!=null),views=viewsKnown?sum('views'):null,clicks=sum('clicks'),spend=sum('spend'),orders=sum('orders');
    const positions=rows.reduce((total,row)=>total+Number(row.avgPosition||0)*Number(row.views||1),0);
    const base=rows.reduce((total,row)=>total+Number(row.views||1),0);
    const carts=sum('carts');
    return {views,clicks,spend,orders,carts,ctr:viewsKnown?(views?clicks/views*100:0):null,cpc:clicks?spend/clicks:0,
      cpm:viewsKnown?(views?spend/views*1000:0):null,cr:clicks?orders/clicks*100:0,avgPosition:base?positions/base:0,
      spendShare:sum('spendShare'),cartCost:carts?spend/carts:null,cpo:orders?spend/orders:null};
  }
  async function loadKeywords(period,refresh=false){
    if(!period)return;
    keywords.loading=true;keywords.error='';renderKeywords();
    try{
      const q=new URLSearchParams({cabinet:params.get('cabinet')||'demo',id:params.get('id')||'',from:period.from,to:period.to,...(refresh?{refresh:'1'}:{})});
      const response=await fetch(`/api/advertising/campaign/keywords?${q}`);
      if(!response.ok)throw new Error((await response.json()).error||'Не удалось получить ключевые запросы');
      keywords.data=await response.json();keywords.selected.clear();
      if(!keywords.data.byNmId?.[keywords.product])keywords.product='';
    }catch(e){keywords.error=e.message}
    finally{keywords.loading=false;renderKeywords()}
  }
  function renderKeywords(){
    const note=$('#keywordsNote'),body=$('#keywordsBody'),select=$('#keywordProduct');
    if(!note)return;
    const data=keywords.data;
    select.innerHTML='<option value="">Все артикулы</option>'+(data?.products||[]).map(product=>`<option value="${esc(product.nmId)}" ${String(product.nmId)===keywords.product?'selected':''}>${esc(product.vendorCode||product.name)} · ${esc(product.nmId)}</option>`).join('');
    if(keywords.loading&&!data){note.textContent='Загрузка ключевых запросов…';body.innerHTML='';renderKeywordInsights({rows:[],benchmark:null});return}
    if(keywords.error&&!data){note.textContent=`Ошибка: ${keywords.error}`;body.innerHTML='';renderKeywordInsights({rows:[],benchmark:null});return}
    if(!data){note.textContent='';body.innerHTML='';renderKeywordInsights({rows:[],benchmark:null});return}
    const view=keywordView(),rows=keywordRows(view),shown=rows.slice(0,keywords.limit),totals=keywordTotals(rows);
    renderKeywordInsights(view);
    const notes=[`${date(data.period.from)} — ${date(data.period.to)}`,`запросов: ${number(rows.length)}`,...keywordStatusNote(rows)];
    if(keywords.product)notes.push('по одному артикулу');
    const rangeCount=Object.values(keywords.ranges).filter(range=>range.min!=null||range.max!=null).length;
    if(rangeCount)notes.push(`фильтров по столбцам: ${number(rangeCount)}`);
    $('#keywordRangeReset').hidden=!rangeCount;
    if(rows.length>shown.length)notes.push(`показаны первые ${number(shown.length)}`);
    if(data.viewsAvailable===false)notes.push('показы, CTR и CPM по запросам WB не отдаёт для кампаний с оплатой за клики');
    if(data.fromFile)notes.push('из сохранённого файла');
    if(keywords.loading)notes.push('обновляем…');
    if(keywords.error)notes.push(`ошибка обновления: ${keywords.error}`);
    (data.warnings||[]).forEach(text=>notes.push(text));
    note.textContent=notes.join(' · ');
    const gradeCell=row=>row.grade?`<span class="keyword-grade ${row.grade}" title="${esc(row.gradeReason)}">${KEYWORD_GRADES[row.grade].label}</span>`:'<span class="keyword-grade none" title="Нет кликов и затрат за период">—</span>';
    const empty=keywords.grade?`Запросов с оценкой «${KEYWORD_GRADES[keywords.grade].label}» нет`:keywords.onlyInactive?'Неактивных запросов нет':'WB не вернул поисковые запросы за этот период';
    keywords.shown=shown;
    const rowClass=row=>[row.status==='excluded'||row.status==='archived'?'keyword-off':'',keywords.selected.has(row.query)?'keyword-selected':''].filter(Boolean).join(' ');
    body.innerHTML=rows.length?`<tr class="total-row"><td></td><td>Итого · ${number(rows.length)} запросов</td><td></td><td></td>${KEYWORD_COLUMNS.slice(3).map(key=>`<td>${esc(keywordValue(key,totals[key]))}</td>`).join('')}</tr>`+
      shown.map(row=>`<tr class="${rowClass(row)}"><td><input type="checkbox" data-keyword-select="${esc(row.query)}" ${keywords.selected.has(row.query)?'checked':''} aria-label="Выбрать запрос «${esc(row.query)}»"></td><td>${esc(row.query)}</td><td>${keywordStatusCell(row)}</td><td>${gradeCell(row)}</td>${KEYWORD_COLUMNS.slice(3).map(key=>`<td>${esc(keywordValue(key,row[key]))}</td>`).join('')}</tr>`).join(''):
      `<tr><td colspan="${KEYWORD_COLUMNS.length+1}" class="empty">${empty}</td></tr>`;
    renderKeywordActions();
  }
  document.querySelectorAll('th[data-keyword-key]').forEach(header=>header.onclick=()=>{const key=header.dataset.keywordKey;keywords.sort=keywords.sort.key===key?{key,direction:keywords.sort.direction==='asc'?'desc':'asc'}:{key,direction:key==='query'?'asc':'desc'};renderKeywords()});
  $('#keywordProduct').onchange=event=>{keywords.product=event.target.value;keywords.selected.clear();renderKeywords()};
  // Поля «От» и «До» в заголовках числовых столбцов. Клик по ним не сортирует таблицу; ввод применяется с короткой задержкой.
  // Проценты и рубли вводятся как в ячейках: «5» в CTR — это 5%, «150» в CPO — 150 ₽; запятая и точка равноценны.
  let keywordRangeTimer=0;
  document.querySelectorAll('th[data-keyword-key]').forEach(header=>{
    const key=header.dataset.keywordKey;if(!KEYWORD_COLUMNS.slice(3).includes(key))return;
    const box=document.createElement('span');box.className='keyword-range';
    const name=header.textContent.replace('↕','').trim();
    box.innerHTML=`<input type="text" inputmode="decimal" placeholder="От" data-range-key="${key}" data-range-side="min" aria-label="${esc(name)}: от"><input type="text" inputmode="decimal" placeholder="До" data-range-key="${key}" data-range-side="max" aria-label="${esc(name)}: до">`;
    box.addEventListener('click',event=>event.stopPropagation());
    header.prepend(box);
  });
  document.querySelector('.keywords-table thead').addEventListener('input',event=>{
    const input=event.target.closest('[data-range-key]');if(!input)return;
    const raw=input.value.replace(/\s/g,'').replace(',','.'),value=raw===''?null:Number(raw);
    input.classList.toggle('invalid',raw!==''&&!Number.isFinite(value));
    const range=keywords.ranges[input.dataset.rangeKey]||(keywords.ranges[input.dataset.rangeKey]={min:null,max:null});
    range[input.dataset.rangeSide]=Number.isFinite(value)?value:null;
    input.classList.toggle('filled',range[input.dataset.rangeSide]!=null);
    clearTimeout(keywordRangeTimer);keywordRangeTimer=setTimeout(renderKeywords,250);
  });
  $('#keywordRangeReset').onclick=()=>{keywords.ranges={};document.querySelectorAll('[data-range-key]').forEach(input=>{input.value='';input.classList.remove('filled','invalid')});renderKeywords()};
  // --- Исключение и включение выбранных запросов: галочки слева, нижняя панель действий, подтверждение ---
  // Сервер читает текущие минус-фразы каждого товара, добавляет или убирает выбранные запросы и перепроверяет результат.
  function selectedKeywordRows(){const rows=keywordView().rows;return rows.filter(row=>keywords.selected.has(row.query))}
  function renderKeywordActions(){
    const bar=$('#keywordActions'),all=$('#keywordSelectAll'),selected=selectedKeywordRows();
    bar.hidden=!selected.length;
    $('#keywordSelectedCount').textContent=`Выбрано: ${number(selected.length)}`;
    $('#keywordExclude').disabled=keywords.busy||!selected.some(row=>row.status!=='excluded');
    $('#keywordInclude').disabled=keywords.busy||!selected.some(row=>row.status==='excluded');
    const shownSelected=keywords.shown.filter(row=>keywords.selected.has(row.query)).length;
    all.checked=keywords.shown.length>0&&shownSelected===keywords.shown.length;
    all.indeterminate=shownSelected>0&&shownSelected<keywords.shown.length;
  }
  function keywordMessage(text,kind='ok'){const box=$('#keywordMessage');box.className=`keyword-message ${kind}`;box.textContent=text}
  function closeConfirm(){$('#confirmModal').hidden=true}
  function openKeywordConfirm(action){
    const exclude=action==='exclude',rows=selectedKeywordRows().filter(row=>exclude?row.status!=='excluded':row.status==='excluded');
    if(!rows.length)return;
    const product=(keywords.data?.products||[]).find(item=>String(item.nmId)===keywords.product);
    const scope=product?`только для артикула ${esc(product.vendorCode||product.name)} · ${esc(product.nmId)}`:'для всех артикулов кампании, у которых есть эти запросы';
    const list=rows.slice(0,15).map(row=>`<li>${esc(row.query)}${row.spend?` — ${esc(money(row.spend))}`:''}</li>`).join('')+(rows.length>15?`<li>и ещё ${number(rows.length-15)}</li>`:'');
    $('#confirmTitle').textContent=exclude?`Исключить ${number(rows.length)} ${plural(rows.length,['запрос','запроса','запросов'])}?`:`Включить ${number(rows.length)} ${plural(rows.length,['запрос','запроса','запросов'])}?`;
    $('#confirmBody').innerHTML=`<p>${exclude?'Запросы будут добавлены в минус-фразы кампании в WB: товар перестанет показываться по ним':'Запросы будут убраны из минус-фраз кампании в WB: товар снова начнёт показываться по ним'} ${scope}.</p><ul>${list}</ul>`+
      `<small>Остальные минус-фразы не изменятся. Изменение сразу применяется в кабинете WB; отменить его можно здесь же${exclude?' кнопкой «Включить»':' кнопкой «Исключить»'}.</small>`+
      `<div class="confirm-buttons"><button type="button" class="secondary" data-confirm-close>Отмена</button><button type="button" class="${exclude?'danger':'include'}" id="confirmRun">${exclude?'Исключить':'Включить'}</button></div>`;
    $('#confirmModal').hidden=false;
    $('#confirmRun').onclick=()=>runKeywordMinus(action,rows.map(row=>row.query));
  }
  async function runKeywordMinus(action,queries){
    const button=$('#confirmRun');button.disabled=true;button.textContent='Отправляем в WB…';keywords.busy=true;renderKeywordActions();
    try{
      const response=await fetch('/api/advertising/campaign/minus',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({cabinet:params.get('cabinet')||'demo',id:params.get('id')||'',action,queries,nmIds:keywords.product?[keywords.product]:[]})});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error||'WB не принял изменение');
      const failed=result.results.filter(item=>!item.ok),changed=result.results.filter(item=>item.ok&&item.changed);
      const verb=action==='exclude'?'Исключено':'Включено';
      keywordMessage(failed.length?`${verb} для ${number(changed.length)} из ${number(result.results.length)} артикулов. Не получилось: ${failed.map(item=>`${item.nmId} — ${item.error}`).join('; ')}`:
        changed.length?`${verb} ${number(queries.length)} ${plural(queries.length,['запрос','запроса','запросов'])} для ${number(changed.length)} ${plural(changed.length,['артикула','артикулов','артикулов'])}. Статусы обновляются…`:'Изменений не потребовалось: запросы уже в нужном состоянии',failed.length?'error':'ok');
      closeConfirm();keywords.selected.clear();
      loadKeywords(keywords.data?.period||state.period,true);
    }catch(e){keywordMessage(`Не удалось: ${e.message}`,'error');closeConfirm()}
    finally{keywords.busy=false;renderKeywordActions()}
  }
  $('#keywordsBody').addEventListener('change',event=>{const box=event.target.closest('[data-keyword-select]');if(!box)return;box.checked?keywords.selected.add(box.dataset.keywordSelect):keywords.selected.delete(box.dataset.keywordSelect);box.closest('tr').classList.toggle('keyword-selected',box.checked);renderKeywordActions()});
  $('#keywordSelectAll').onchange=event=>{keywords.shown.forEach(row=>event.target.checked?keywords.selected.add(row.query):keywords.selected.delete(row.query));renderKeywords()};
  $('#keywordExclude').onclick=()=>openKeywordConfirm('exclude');
  $('#keywordInclude').onclick=()=>openKeywordConfirm('include');
  $('#keywordClearSelection').onclick=()=>{keywords.selected.clear();renderKeywords()};
  document.addEventListener('click',event=>{if(event.target.closest('[data-confirm-close]'))closeConfirm()});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('#confirmModal').hidden)closeConfirm()});
  $('#keywordSearch').oninput=event=>{keywords.search=event.target.value;renderKeywords()};
  $('#keywordOnlyInactive').onchange=event=>{keywords.onlyInactive=event.target.checked;renderKeywords()};
  $('#keywordGrade').onchange=event=>{keywords.grade=event.target.value;renderKeywords()};
  $('#keywordRefresh').onclick=()=>loadKeywords(keywords.data?.period||state.period,true);
  async function exportHistory(){
    const button=$('#exportHistory'),controls=[button,$('#exportPreset'),$('#exportFrom'),$('#exportTo')];
    const from=$('#exportFrom').value,to=$('#exportTo').value;
    if(!from||!to)return alert('Выберите даты начала и конца выгрузки');
    if(from>to)return alert('Дата начала должна быть не позже даты конца');
    Object.assign(exportState,{started:Date.now(),chunks:0,index:0,phase:'start',reason:'',waitUntil:0,failed:0,storedDays:0,known:false,lifeNote:''});
    controls.forEach(control=>control.disabled=true);button.textContent='Выгрузка…';
    renderExportProgress();clearInterval(exportState.timer);exportState.timer=setInterval(renderExportProgress,250);
    try{
      const q=new URLSearchParams({cabinet:params.get('cabinet')||'demo',id:params.get('id')||'',from,to});
      const response=await fetch(`/api/advertising/campaign/history?${q}`);
      if(!response.ok||!response.body)throw new Error('Не удалось начать выгрузку');
      const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',result=null;
      for(;;){
        const {value,done}=await reader.read();
        buffer+=decoder.decode(value||new Uint8Array(),{stream:!done});
        let newline;
        while((newline=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,newline).trim();buffer=buffer.slice(newline+1);if(line)result=handleExportEvent(JSON.parse(line))||result}
        if(done)break;
      }
      if(!result)throw new Error('Выгрузка прервалась без результата');
      state.rows=result.campaign.daily||[];state.productDaily=result.productDaily||[];
      renderMeta(result.campaign);renderSummary(result.campaign);renderOptions();renderChart();renderTable();renderProductTable();
      $('#campaignTitle').textContent=result.campaign.name||`Кампания #${result.campaign.id}`;
      state.period=result.activePeriod||result.period;loadKeywords(state.period);
      $('#periodLabel').textContent=`Кампания #${result.campaign.id} · ${date(result.period.from)} — ${date(result.period.to)}${result.folder?` · ${result.folder}`:''}`;
      clearInterval(exportState.timer);
      const took=formatSeconds(Math.max(1,Math.round((Date.now()-exportState.started)/1000)));
      const saved=result.storedDays?` · из сохранённого: ${result.storedDays} дн.`:'';
      const life=exportState.lifeNote?` · ${exportState.lifeNote}`:'';
      $('#exportProgress').textContent=exportState.failed?`Готово за ${took} · запросов без данных: ${exportState.failed} из ${exportState.chunks}${saved}${life}`:`Готово за ${took} · запросов к WB: ${exportState.chunks}${saved}${life}`;
    }catch(e){
      clearInterval(exportState.timer);$('#exportProgress').textContent=`Ошибка: ${e.message}`;
    }finally{
      clearInterval(exportState.timer);controls.forEach(control=>control.disabled=false);button.textContent='Выгрузить';
    }
  }
  // Ширину колонок можно тянуть мышью, как в «Ценах и скидках»; значения хранятся в браузере.
  function initResizableTables(scope=document){
    scope.querySelectorAll('table').forEach((table,tableIndex)=>{
      if(table.dataset.resizable==='1')return;
      const headers=[...table.querySelectorAll('thead th')];
      if(!headers.length)return;
      table.dataset.resizable='1';table.classList.add('resizable-table');
      const bodyId=table.querySelector('tbody[id]')?.id||`campaign-table-${tableIndex}`,storageKey=`wb-campaign-column-widths:${bodyId}`;
      let saved=[];try{saved=JSON.parse(localStorage.getItem(storageKey)||'[]')}catch{}
      if(saved.length===headers.length&&saved.every(Number.isFinite)){
        headers.forEach((header,index)=>header.style.width=`${saved[index]}px`);
        const total=saved.reduce((sum,width)=>sum+width,0);
        table.style.width=`${total}px`;table.style.minWidth=`${total}px`;table.style.tableLayout='fixed';
      }
      headers.forEach((header,index)=>{
        const handle=document.createElement('span');
        handle.className='column-resizer';handle.title='Потяните, чтобы изменить ширину';handle.setAttribute('aria-hidden','true');
        handle.onclick=event=>{event.preventDefault();event.stopPropagation()};
        handle.onpointerdown=event=>{
          if(event.button!==0)return;
          event.preventDefault();event.stopPropagation();
          const widths=headers.map(item=>Math.round(item.getBoundingClientRect().width));
          if(!widths[index])return;
          headers.forEach((item,column)=>item.style.width=`${widths[column]}px`);
          const startX=event.clientX,startWidth=widths[index],startTotal=widths.reduce((sum,width)=>sum+width,0);
          table.style.width=`${startTotal}px`;table.style.minWidth=`${startTotal}px`;table.style.tableLayout='fixed';
          document.body.classList.add('resizing-column');
          const move=moveEvent=>{
            const width=Math.max(48,Math.round(startWidth+moveEvent.clientX-startX)),delta=width-startWidth;
            header.style.width=`${width}px`;table.style.width=`${startTotal+delta}px`;table.style.minWidth=`${startTotal+delta}px`;
          };
          const stop=()=>{
            document.removeEventListener('pointermove',move);
            document.body.classList.remove('resizing-column');
            localStorage.setItem(storageKey,JSON.stringify(headers.map(item=>Math.round(item.getBoundingClientRect().width))));
          };
          document.addEventListener('pointermove',move);
          document.addEventListener('pointerup',stop,{once:true});
          document.addEventListener('pointercancel',stop,{once:true});
        };
        header.append(handle);
      });
    });
  }
  new MutationObserver(()=>initResizableTables()).observe(document.body,{childList:true,subtree:true});
  initResizableTables();
  function load(){const from=params.get('from')||'',to=params.get('to')||'',fromInput=$('#exportFrom'),toInput=$('#exportTo');if(/^\d{4}-\d{2}-\d{2}$/.test(from)&&/^\d{4}-\d{2}-\d{2}$/.test(to)&&from<=to&&from>=fromInput.min&&to<=toInput.max){fromInput.value=from;toInput.value=to;fromInput.onchange()}exportHistory()}
  document.querySelectorAll('th[data-key]').forEach(h=>h.onclick=()=>{const k=h.dataset.key;state.sort=state.sort.key===k?{key:k,direction:state.sort.direction==='asc'?'desc':'asc'}:{key:k,direction:'desc'};renderTable()});document.querySelectorAll('th[data-product-key]').forEach(h=>h.onclick=()=>{const k=h.dataset.productKey;state.productSort=state.productSort.key===k?{key:k,direction:state.productSort.direction==='asc'?'desc':'asc'}:{key:k,direction:'desc'};renderProductTable()});buildExportPresets();$('#exportHistory').onclick=exportHistory;document.querySelectorAll('[data-modal-close]').forEach(el=>el.onclick=closeProductModal);document.addEventListener('keydown',event=>{if(event.key==='Escape')closeProductModal()});load();
})();









