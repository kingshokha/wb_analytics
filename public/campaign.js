(() => {
  'use strict';
  const params = new URLSearchParams(location.search);
  const state = { rows: [], productDaily: [], sort: { key: 'date', direction: 'desc' }, productSort: { key: 'spend', direction: 'desc' }, visibleMetrics: new Set(['views', 'clicks', 'orders', 'spend', 'drr', 'avgPosition']), visibleCards: new Set(), positions: new Map() };
  const columns = ['date','views','clicks','ctr','cpc','carts','orders','canceled','revenue','spend','drr'];
  const chartMetrics = [{key:'views',label:'Показы',color:'#277a70'},{key:'clicks',label:'Клики',color:'#d77b28'},{key:'carts',label:'Корзины',color:'#4d8f63'},{key:'orders',label:'Заказы',color:'#b35b45'},{key:'spend',label:'Затраты',color:'#5a7d9a'},{key:'revenue',label:'Сумма заказов',color:'#8b6b3f'},{key:'drr',label:'ДРР',color:'#7651e5'},{key:'avgPosition',label:'Ср. позиция',color:'#c35fb8'}];
  // Значение линии графика за день. ДРР без рекламной выручки не определён (расход есть, заказов нет) — на графике разрыв, а не 0.
  // Средняя позиция приходит отдельно (статистика поисковых кластеров по дням); дни без неё — тоже разрыв.
  function chartValue(s,row,byDay){if(s.card)return Number(byDay.get(`${s.card}:${row.date}`)?.spend||0);if(s.key==='drr'&&!Number(row.revenue))return null;if(s.key==='avgPosition')return state.positions.get(row.date)??null;return Number(row[s.key]||0)}
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
  // Идут показы — зеленоватая плашка, на паузе — красноватая.
  const AD_STATUS_CLASSES={9:'status-running',11:'status-paused'};
  function renderMeta(c){state.paymentType=String(c.paymentType||'').toLowerCase();const status=AD_STATUSES[Number(c.status)]||'',tags=[c.paymentType?String(c.paymentType).toUpperCase():'',AD_BIDS[String(c.bidType)]||c.bidType||''],created=createdDate(c.createdAt);$('#campaignMeta').innerHTML=tags.filter(Boolean).map(x=>`<b>${esc(x)}</b>`).join('')+(status?`<b class="${AD_STATUS_CLASSES[Number(c.status)]||''}">${esc(status)}</b>`:'')+(created?`<span class="campaign-created">Создана ${created}</span>`:'')}
  // Карточки с изменением к прошлому периоду той же длины (state.previous — /api/advertising/campaign/previous).
  // CTR и CPC — за весь период (клики ÷ показы, затраты ÷ клики), а не среднее по дням: так они сравнимы с прошлым периодом.
  // up — рост хорош (зелёный), down — рост плох (красный), neutral — затраты: рост сам по себе ни хорош, ни плох.
  const SUMMARY_TONES={views:'up',clicks:'up',orders:'up',revenue:'up',spend:'neutral',drr:'down',ctr:'up',cpc:'down',carts:'up',canceled:'down'};
  function summaryDelta(key,now){
    const p=state.previous;if(!p)return '';
    if(p.loading)return '<small class="metric-delta flat" title="Загружаем прошлый период">…</small>';
    if(!p.available||!p.campaign)return '';
    const before=Number(p.campaign[key]||0),value=Number(now||0),title=`к ${date(p.period.from)} – ${date(p.period.to)}: ${['spend','revenue','cpc'].includes(key)?money(before):['drr','ctr'].includes(key)?percent(before):number(before)}`;
    if(['drr','ctr','cpc'].includes(key)&&(!value||!before))return '';
    if(!before)return value?`<small class="metric-delta flat" title="${esc(title)}">новое</small>`:'';
    const change=Math.round((value-before)/before*100),tone=!change||SUMMARY_TONES[key]==='neutral'?'flat':(change>0)===(SUMMARY_TONES[key]==='up')?'up':'down';
    return `<small class="metric-delta ${tone}" title="${esc(title)}">${change?`${change>0?'▲':'▼'} ${number(Math.abs(change))}%`:'0%'}</small>`;
  }
  function renderSummary(c){
    const ctr=c.ctr??average('ctr'),cpc=c.cpc??average('cpc'),drr=Number(c.revenue)?Number(c.spend||0)/Number(c.revenue)*100:0,carts=c.carts??total('carts'),canceled=c.canceled??total('canceled');
    const cards=[['Показы',number(c.views),'views',c.views],['Клики',number(c.clicks),'clicks',c.clicks],['Рекламные заказы',number(c.orders),'orders',c.orders],['Сумма заказов',money(c.revenue),'revenue',c.revenue],['Затраты',money(c.spend),'spend',c.spend],
      ['ДРР за период',percent(drr),'drr',drr],['Средний CTR',percent(ctr),'ctr',ctr],['Средний CPC',money(cpc),'cpc',cpc],['Добавления в корзину',number(carts),'carts',carts],['Отмены',number(canceled),'canceled',canceled]];
    $('#summary').innerHTML=cards.map(x=>`<div class="metric"><span>${x[0]}</span><strong>${x[1]}</strong>${summaryDelta(x[2],x[3])}</div>`).join('');
  }
  async function loadPrevious(period,campaign){
    const request=state.previousRequest=(state.previousRequest||0)+1;
    state.previous={loading:true};renderSummary(campaign);
    try{const q=new URLSearchParams({cabinet:params.get('cabinet')||'demo',id:params.get('id')||'',from:period.from,to:period.to});
      const response=await fetch(`/api/advertising/campaign/previous?${q}`),data=await response.json();if(!response.ok)throw new Error(data.error||'не загрузилось');
      if(request!==state.previousRequest)return;state.previous=data}
    catch(e){if(request!==state.previousRequest)return;state.previous=null}
    renderSummary(campaign);
  }
  function renderTable(){const rows=sorted(state.rows,state.sort);const sum=totals(state.rows);const head=`<tr class="total-row"><td>Итого · ${number(state.rows.length)} дн.</td>${columns.slice(1).map(k=>`<td>${esc(fmt(k,sum[k]))}</td>`).join('')}</tr>`;$('#dailyBody').innerHTML=rows.length?head+rows.map(r=>`<tr>${columns.map(k=>`<td>${k==='drr'&&!Number(r.revenue)&&Number(r.spend)?'<span title="Нет рекламной выручки — ДРР не определён">—</span>':esc(fmt(k,r[k]))}</td>`).join('')}</tr>`).join(''):'<tr><td colspan="11" class="empty">Нет дневных данных за выбранный период</td></tr>'}
  function aggregateProducts(){
    const totals=new Map(), sumKeys=['views','clicks','carts','orders','canceled','revenue','spend'];
    for(const row of state.productDaily){const key=String(row.nmId||'');if(!key)continue;let total=totals.get(key);if(!total){total={nmId:row.nmId,name:'',photo:'',vendorCode:''};sumKeys.forEach(k=>total[k]=0);totals.set(key,total)}if(!total.name&&row.name)total.name=row.name;if(!total.photo&&row.photo)total.photo=row.photo;if(!total.vendorCode&&row.vendorCode)total.vendorCode=row.vendorCode;sumKeys.forEach(k=>total[k]+=Number(row[k]||0));}
    return [...totals.values()].map(row=>({...row,name:row.name||`Товар ${row.nmId}`,ctr:row.views?row.clicks/row.views*100:0,cpc:row.clicks?row.spend/row.clicks:0,drr:row.revenue?row.spend/row.revenue*100:0}));
  }
  // Детализация артикула по дням открывается кнопкой со стрелкой слева от названия.
  const productOpenButton=row=>`<button class="product-open" type="button" data-product-id="${esc(row.nmId)}" title="Статистика артикула по дням" aria-label="Статистика артикула ${esc(row.nmId)} по дням"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 10.5l5-5M6.5 5.5h4v4"/></svg></button>`;
  function renderProductTable(){const rows=sorted(aggregateProducts(),state.productSort);const sum=totals(rows);const head=`<tr class="total-row"><td>Итого · ${number(rows.length)} ${plural(rows.length,['артикул','артикула','артикулов'])}</td><td></td>${['views','clicks','ctr','cpc','carts','orders','canceled','revenue','spend','drr'].map(k=>`<td>${esc(fmt(k,sum[k]))}</td>`).join('')}</tr>`;$('#productDailyBody').innerHTML=rows.length?head+rows.map(r=>`<tr><td><div class="product-name-cell">${productOpenButton(r)}${photoCell(r)}</div></td><td>${esc(r.nmId||'—')}</td>${['views','clicks','ctr','cpc','carts','orders','canceled','revenue','spend','drr'].map(k=>`<td>${esc(fmt(k,r[k]))}</td>`).join('')}</tr>`).join(''):'<tr><td colspan="12" class="empty">Нет данных по артикулам за выбранный период</td></tr>';$('#productDailyBody').querySelectorAll('[data-product-id]').forEach(button=>button.onclick=()=>openProductModal(button.dataset.productId));bindPhotoPreviews('#productDailyBody')}
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
  const KEYWORD_PAGE_SIZE=100;
  const keywords={data:null,loading:false,error:'',product:'',search:'',onlyInactive:false,sort:{key:'views',direction:'desc'},page:1,selected:new Set(),busy:false,shown:[],ranges:{}};
  // Первые два столбца (запрос, статус) рисуются отдельно, остальные — через keywordValue.
  const KEYWORD_COLUMNS=['query','status','views','clicks','ctr','cpm','cpc','spend','spendShare','carts','cartCost','orders','cr','cpo','avgPosition'];
  const plural=(count,forms)=>{const n=Math.abs(Number(count)||0)%100,d=n%10;return forms[n>10&&n<20?2:d===1?0:d>1&&d<5?1:2]};
  // Исключать запросы (минус-фразы) WB позволяет только в кампаниях с оплатой за показы.
  const keywordsCpc=()=>state.paymentType==='cpc'||keywords.data?.viewsAvailable===false;
  // Строки текущего артикула (или всех) с долей расходов, ценой корзины и CPO.
  function keywordView(){
    const data=keywords.data;if(!data)return {rows:[]};
    const base=keywords.product?(data.byNmId?.[keywords.product]||[]):(data.total||[]),spend=base.reduce((total,row)=>total+Number(row.spend||0),0);
    const rows=base.map(row=>({...row,spendShare:spend?Number(row.spend||0)/spend*100:0,cartCost:row.carts?Number(row.spend||0)/row.carts:null,cpo:row.orders?Number(row.spend||0)/row.orders:null}));
    return {rows};
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
    const filtered=view.rows.filter(row=>(!term||row.query.toLowerCase().includes(term))&&(!keywords.onlyInactive||row.status==='excluded'||row.status==='archived')&&inRanges(row));
    // Без показов (CPC-кампании) сортировка по показам, CTR или CPM ничего не упорядочит — тогда сортируем по кликам.
    const unknown=data.viewsAvailable===false&&['views','ctr','cpm'].includes(keywords.sort.key),sort=unknown?{key:'clicks',direction:keywords.sort.direction}:keywords.sort;
    // Строки без значения (нет заказов для CPO, нет корзин для их цены) всегда в конце, в любом направлении.
    return [...sorted(filtered.filter(row=>row[sort.key]!=null),sort),...filtered.filter(row=>row[sort.key]==null)];
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
    if(keywords.loading&&!data){note.textContent='Загрузка ключевых запросов…';body.innerHTML='';renderKeywordPagination(0);return}
    if(keywords.error&&!data){note.textContent=`Ошибка: ${keywords.error}`;body.innerHTML='';renderKeywordPagination(0);return}
    if(!data){note.textContent='';body.innerHTML='';renderKeywordPagination(0);return}
    const view=keywordView(),rows=keywordRows(view),totals=keywordTotals(rows);
    const pageCount=Math.ceil(rows.length/KEYWORD_PAGE_SIZE);keywords.page=Math.min(Math.max(1,keywords.page),Math.max(1,pageCount));
    const shown=rows.slice((keywords.page-1)*KEYWORD_PAGE_SIZE,keywords.page*KEYWORD_PAGE_SIZE);
    // В CPC-кампаниях галочек и панели «Исключить/Включить» нет.
    const cpc=keywordsCpc();if(cpc)keywords.selected.clear();
    document.querySelector('.keywords-table').classList.toggle('no-select',cpc);
    const notes=[`${date(data.period.from)} — ${date(data.period.to)}`,`запросов: ${number(rows.length)}`,...keywordStatusNote(rows)];
    if(keywords.product)notes.push('по одному артикулу');
    const rangeCount=Object.values(keywords.ranges).filter(range=>range.min!=null||range.max!=null).length;
    if(rangeCount)notes.push(`фильтров по столбцам: ${number(rangeCount)}`);
    $('#keywordRangeReset').hidden=!rangeCount;
    // У кампаний с оплатой за клики WB не отдаёт показы по запросам — столбцы «Показы», «CTR» и «CPM» скрываются.
    document.querySelector('.keywords-table').classList.toggle('no-views',data.viewsAvailable===false);
    if(data.viewsAvailable===false)notes.push('кампания с оплатой за клики (CPC): показы, CTR и CPM по запросам WB не отдаёт, поэтому эти столбцы скрыты');
    if(cpc)notes.push('исключать запросы в CPC-кампаниях WB не позволяет');
    if(data.fromFile)notes.push('из сохранённого файла');
    if(keywords.loading)notes.push('обновляем…');
    if(keywords.error)notes.push(`ошибка обновления: ${keywords.error}`);
    (data.warnings||[]).forEach(text=>notes.push(text));
    note.textContent=notes.join(' · ');
    const empty=keywords.search.trim()||rangeCount?'Нет запросов по заданным фильтрам':keywords.onlyInactive?'Неактивных запросов нет':'WB не вернул поисковые запросы за этот период';
    keywords.shown=shown;
    const rowClass=row=>[row.status==='excluded'||row.status==='archived'?'keyword-off':'',keywords.selected.has(row.query)?'keyword-selected':''].filter(Boolean).join(' ');
    body.innerHTML=rows.length?`<tr class="total-row"><td></td><td>Итого · ${number(rows.length)} ${plural(rows.length,['запрос','запроса','запросов'])}</td><td></td>${KEYWORD_COLUMNS.slice(2).map(key=>`<td>${esc(keywordValue(key,totals[key]))}</td>`).join('')}</tr>`+
      shown.map(row=>`<tr class="${rowClass(row)}"><td><input type="checkbox" data-keyword-select="${esc(row.query)}" ${keywords.selected.has(row.query)?'checked':''} aria-label="Выбрать запрос «${esc(row.query)}»"></td><td><span class="keyword-query"><button type="button" class="keyword-chart-button" data-keyword-daily="${esc(row.query)}" title="Статистика по дням" aria-label="Статистика запроса «${esc(row.query)}» по дням"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.75" y="1.75" width="12.5" height="12.5" rx="3"/><path d="M4.5 10.5l2.5-3 2 2 2.5-4"/></svg></button>${keywordTagButton(row.query)}<span>${esc(row.query)}</span>${keywordNoteButton(row.query)}</span></td><td>${keywordStatusCell(row)}</td>${KEYWORD_COLUMNS.slice(2).map(key=>`<td>${esc(keywordValue(key,row[key]))}</td>`).join('')}</tr>`).join(''):
      `<tr><td colspan="${KEYWORD_COLUMNS.length+1}" class="empty">${empty}</td></tr>`;
    renderKeywordPagination(pageCount);
    renderKeywordActions();
  }
  // Страницы по 100 запросов — как пагинация на остальных страницах сайта.
  function renderKeywordPagination(pageCount){
    const el=$('#keywordPagination');
    if(pageCount<=1){el.innerHTML='';el.hidden=true;return}
    el.hidden=false;
    el.innerHTML=`<button type="button" class="page-button" data-keyword-page="prev" ${keywords.page===1?'disabled':''}>Назад</button><div class="page-numbers">${Array.from({length:pageCount},(_,index)=>index+1).map(page=>`<button type="button" class="page-button ${page===keywords.page?'active':''}" data-keyword-page="${page}" aria-current="${page===keywords.page?'page':'false'}">${page}</button>`).join('')}</div><button type="button" class="page-button" data-keyword-page="next" ${keywords.page===pageCount?'disabled':''}>Вперёд</button>`;
  }
  $('#keywordPagination').addEventListener('click',event=>{
    const button=event.target.closest('[data-keyword-page]');if(!button||button.disabled)return;
    const target=button.dataset.keywordPage,page=target==='prev'?keywords.page-1:target==='next'?keywords.page+1:Number(target);
    if(!Number.isInteger(page)||page===keywords.page)return;
    keywords.page=page;renderKeywords();
    $('#keywordsNote').closest('.panel').scrollIntoView({behavior:'smooth',block:'start'});
  });
  document.querySelectorAll('th[data-keyword-key]').forEach(header=>header.onclick=()=>{const key=header.dataset.keywordKey;keywords.sort=keywords.sort.key===key?{key,direction:keywords.sort.direction==='asc'?'desc':'asc'}:{key,direction:key==='query'?'asc':'desc'};keywords.page=1;renderKeywords()});
  $('#keywordProduct').onchange=event=>{keywords.product=event.target.value;keywords.selected.clear();keywords.page=1;renderKeywords()};
  // Поля «От» и «До» в заголовках числовых столбцов. Клик по ним не сортирует таблицу; ввод применяется с короткой задержкой.
  // Проценты и рубли вводятся как в ячейках: «5» в CTR — это 5%, «150» в CPO — 150 ₽; запятая и точка равноценны.
  let keywordRangeTimer=0;
  document.querySelectorAll('th[data-keyword-key]').forEach(header=>{
    const key=header.dataset.keywordKey;if(!KEYWORD_COLUMNS.slice(2).includes(key))return;
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
    clearTimeout(keywordRangeTimer);keywordRangeTimer=setTimeout(()=>{keywords.page=1;renderKeywords()},250);
  });
  $('#keywordRangeReset').onclick=()=>{keywords.ranges={};document.querySelectorAll('[data-range-key]').forEach(input=>{input.value='';input.classList.remove('filled','invalid')});keywords.page=1;renderKeywords()};
  // Поиск стоит в заголовке столбца «Запрос»: клик по полю не сортирует таблицу.
  $('#keywordSearch').addEventListener('click',event=>event.stopPropagation());
  // Средняя позиция по дням для графика — догружается после выгрузки, график перерисовывается.
  let positionsRequest=0;
  async function loadPositions(period){
    if(!period)return;const request=++positionsRequest;state.positions=new Map();
    try{
      const response=await fetch(`/api/advertising/campaign/positions?${new URLSearchParams({cabinet:params.get('cabinet')||'demo',id:params.get('id')||'',from:period.from,to:period.to})}`);
      const result=await response.json();if(!response.ok)throw new Error(result.error||'');
      if(request!==positionsRequest)return;
      state.positions=new Map((result.days||[]).filter(day=>day.avgPosition!=null).map(day=>[day.date,day.avgPosition]));
      renderChart();
    }catch{/* без позиции график остаётся как есть */}
  }
  // --- Шапка: название ведёт в кампанию в кабинете продвижения WB, номер рядом копируется по клику ---
  function renderCampaignHeader(result){
    const id=result.campaign.id,period=result.period,link=$('#campaignWbLink'),idButton=$('#campaignId');
    if(result.folder&&/^\d+$/.test(String(id)))link.href=`https://cmp.wildberries.ru/campaigns/edit/${encodeURIComponent(id)}?from=${period.from}T00:00:00Z&to=${period.to}T00:00:00Z`;
    else link.removeAttribute('href');
    idButton.textContent=id;idButton.dataset.copy=id;idButton.hidden=false;
  }
  $('#campaignId').onclick=event=>{const button=event.currentTarget,text=button.dataset.copy;navigator.clipboard?.writeText(text).then(()=>{button.textContent='Скопировано';setTimeout(()=>{button.textContent=text},1200)})};
  // Кнопка «i»: подробности выгрузки видны при наведении, а на телефоне — по нажатию.
  $('#campaignInfoButton').onclick=event=>{event.stopPropagation();event.currentTarget.closest('.info-wrap').classList.toggle('open')};
  document.addEventListener('click',event=>{if(!event.target.closest('.info-wrap'))document.querySelector('.info-wrap')?.classList.remove('open')});
  // --- Блок «Размещение и ставки»: места размещения кампании и ставки товаров из настроек WB ---
  function renderSetup(setup){
    const panel=$('#setupPanel');if(!setup){panel.hidden=true;return}
    panel.hidden=false;
    const cpc=String(setup.paymentType).toLowerCase()==='cpc',unit=cpc?'за клик':'за 1000 показов',p=setup.placements||{};
    // Единая ставка одинакова в поиске и рекомендациях — показываем её одним столбцом.
    const unified=setup.bidType==='unified';
    $('#setupNote').textContent=`Оплата ${cpc?'за клики (CPC)':'за показы (CPM)'} · ${unified?`единая ставка ${unit} для поиска и рекомендаций`:`ставки ${unit}`}`;
    $('#setupHead').innerHTML=`<th>Товар</th><th>Предмет</th>${unified?'<th>Ставка</th>':'<th>Ставка в поиске</th><th>Ставка в рекомендациях</th>'}`;
    $('#setupPlacements').innerHTML=[['search','Поиск'],['recommendations','Рекомендации']].map(([key,label])=>
      `<span class="placement ${p[key]?'on':'off'}" title="Размещение ${p[key]?'включено':'отключено'}"><i></i>${label}${p[key]?'':' · выкл.'}</span>`).join('');
    // Ставка за отключённое место размещения приглушена и подписана: она есть в настройках, но не работает.
    const bid=(value,enabled)=>value==null?'—':`<span class="bid-cell ${enabled?'':'bid-off'}">${money(value)}${enabled?'':'<small>выкл.</small>'}</span>`;
    $('#setupBids').innerHTML=(setup.bids||[]).map(item=>`<tr><td><div class="product-cell">${item.photo?`<img class="product-photo" src="${esc(item.photo)}" alt="" loading="lazy">`:'<i class="product-photo-stub"></i>'}<span><b>${esc(item.name)}</b><small>${esc(item.vendorCode||'')}${item.vendorCode?' · ':''}${esc(item.nmId)}</small></span></div></td><td>${esc(item.subject||'—')}</td>${unified?`<td>${bid(item.search??item.recommendations,p.search||p.recommendations)}</td>`:`<td>${bid(item.search,p.search)}</td><td>${bid(item.recommendations,p.recommendations)}</td>`}</tr>`).join('')||
      `<tr><td colspan="${unified?3:4}" class="empty">WB не вернул ставки товаров</td></tr>`;
    bindPhotoPreviews('#setupBids');
  }
  // --- Статистика ключевого запроса по дням (кнопка с графиком у запроса) ---
  const KEYWORD_DAILY_METRICS=[{key:'clicks',label:'Клики'},{key:'spend',label:'Затраты',money:true},{key:'carts',label:'Корзины'},{key:'orders',label:'Заказы'},{key:'views',label:'Показы',views:true},{key:'ctr',label:'CTR',percent:true,views:true},{key:'cpc',label:'CPC',money:true},{key:'avgPosition',label:'Ср. позиция'}];
  const keywordDaily={data:null,metric:'clicks',query:'',request:0};
  function closeKeywordDaily(){$('#keywordDailyModal').hidden=true}
  async function openKeywordDaily(query){
    const data=keywords.data;if(!data)return;
    const request=++keywordDaily.request;keywordDaily.query=query;keywordDaily.data=null;
    $('#keywordDailyTitle').textContent=`«${query}» по дням`;
    $('#keywordDailyNote').textContent=`${date(data.period.from)} — ${date(data.period.to)} · загружаем из WB, первый запрос может занять до минуты…`;
    $('#keywordDailyMetrics').innerHTML='';$('#keywordDailyChart').innerHTML='';$('#keywordDailyBody').innerHTML='';
    $('#keywordDailyModal').hidden=false;
    try{
      const response=await fetch('/api/advertising/campaign/keyword-daily',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({cabinet:params.get('cabinet')||'demo',id:params.get('id')||'',from:data.period.from,to:data.period.to,query,nmIds:keywords.product?[keywords.product]:Object.keys(data.byNmId||{})})});
      const result=await response.json();if(!response.ok)throw new Error(result.error||'WB не вернул статистику');
      if(request!==keywordDaily.request)return;
      keywordDaily.data=result;
      if(!result.viewsAvailable&&KEYWORD_DAILY_METRICS.find(m=>m.key===keywordDaily.metric)?.views)keywordDaily.metric='clicks';
      renderKeywordDaily();
    }catch(e){if(request===keywordDaily.request)$('#keywordDailyNote').textContent=`Не удалось загрузить: ${e.message}`}
  }
  function renderKeywordDaily(){
    const result=keywordDaily.data;if(!result)return;
    const metrics=KEYWORD_DAILY_METRICS.filter(m=>result.viewsAvailable||!m.views),metric=metrics.find(m=>m.key===keywordDaily.metric)||metrics[0];
    const days=result.days,active=days.filter(day=>day.clicks||day.spend||day.views).length;
    $('#keywordDailyNote').textContent=`${date(result.period.from)} — ${date(result.period.to)} · дней с активностью: ${number(active)} из ${number(days.length)}${keywords.product?' · по одному артикулу':''}${result.viewsAvailable?'':' · кампания CPC: показы, CTR и CPM WB не отдаёт'}`;
    $('#keywordDailyMetrics').innerHTML=metrics.map(m=>`<button type="button" class="${m.key===metric.key?'active':''}" data-kwday-metric="${m.key}">${m.label}</button>`).join('');
    const format=(m,v)=>v==null?'—':m.money?money(v):m.percent?percent(v):number(v);
    // Линейный график выбранного показателя; дни без значения (нет позиции) — разрыв линии.
    const w=900,h=230,left=56,right=16,top=14,bottom=30,pw=w-left-right,ph=h-top-bottom,values=days.map(day=>day[metric.key]);
    const max=chartNiceMax(Math.max(0,...values.filter(v=>v!=null))),x=i=>left+(days.length===1?pw/2:i*pw/(days.length-1)),y=v=>top+ph-v/max*ph;
    const grid=[0,.5,1].map(r=>`<line class="chart-grid" x1="${left}" x2="${w-right}" y1="${y(max*r)}" y2="${y(max*r)}"/><text class="chart-axis" x="${left-8}" y="${y(max*r)+4}" text-anchor="end">${esc(chartAxisNumber(max*r))}</text>`).join('');
    const step=Math.max(1,Math.ceil(days.length/8)),labels=days.map((day,i)=>i%step===0||i===days.length-1?`<text class="chart-axis" x="${x(i)}" y="${h-8}" text-anchor="${i===0?'start':i===days.length-1?'end':'middle'}">${esc(date(day.date).slice(0,5))}</text>`:'').join('');
    const parts=[];let part=[];values.forEach((v,i)=>{if(v==null){if(part.length)parts.push(part);part=[];return}part.push([x(i),y(v),i])});if(part.length)parts.push(part);
    const lines=parts.map(points=>points.length>1?`<polyline class="chart-line" stroke="#7651e5" points="${points.map(p=>`${p[0]},${p[1]}`).join(' ')}"/>`:'').join('');
    const dots=parts.flat().map(([px,py,i])=>`<circle class="chart-dot" cx="${px}" cy="${py}" r="3.5" fill="#7651e5"><title>${esc(date(days[i].date))}: ${esc(format(metric,values[i]))}</title></circle>`).join('');
    $('#keywordDailyChart').innerHTML=values.some(v=>v!=null)?`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(metric.label)} по дням">${grid}${labels}${lines}${dots}</svg>`:'<div class="chart-empty">Нет данных по этому показателю</div>';
    const table=document.querySelector('.kwday-table');table.classList.toggle('no-views',!result.viewsAvailable);
    $('#keywordDailyBody').innerHTML=[...days].reverse().map(day=>`<tr><td>${esc(date(day.date))}</td><td class="views-col">${esc(format({},day.views))}</td><td>${number(day.clicks)}</td><td class="views-col">${esc(format({percent:true},day.ctr))}</td><td class="views-col">${esc(format({money:true},day.cpm))}</td><td>${money(day.cpc)}</td><td>${money(day.spend)}</td><td>${number(day.carts)}</td><td>${number(day.orders)}</td><td>${percent(day.cr)}</td><td>${esc(format({},day.avgPosition))}</td></tr>`).join('');
  }
  $('#keywordsBody').addEventListener('click',event=>{const button=event.target.closest('[data-keyword-daily]');if(button)openKeywordDaily(button.dataset.keywordDaily)});
  document.addEventListener('click',event=>{const metric=event.target.closest('[data-kwday-metric]');if(metric){keywordDaily.metric=metric.dataset.kwdayMetric;renderKeywordDaily()}if(event.target.closest('[data-kwday-close]'))closeKeywordDaily()});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('#keywordDailyModal').hidden)closeKeywordDaily()});
  // --- Отметки ключевых запросов: «Важный» сочетается с любой, остальные — одна на запрос. Хранятся на сервере по кампании ---
  const KEYWORD_TAGS={
    important:{label:'Важный',desc:'Можно сочетать с любой отметкой',icon:'★',color:'#f0a04b'},
    target:{label:'Целевой',desc:'Запрос точно подходит товару',icon:'◎',color:'#2f8f62'},
    nearTarget:{label:'Околоцелевой',desc:'Смежный запрос: проверяем интерес к товару',icon:'✣',color:'#3f6fd6'},
    nonTarget:{label:'Нецелевой',desc:'Покупатель ищет другой товар',icon:'✕',color:'#d4553f'},
    promote:{label:'Продвигаем',desc:'Усиливаем показы по запросу',icon:'➚',color:'#2e7d32'},
    test:{label:'Тестируем',desc:'Проверяем рекламную гипотезу',icon:'⚗',color:'#7b2fbf'},
    traffic:{label:'Трафик',desc:'Запрос для привлечения трафика',icon:'≋',color:'#4a63d6'},
    watch:{label:'Наблюдаем',desc:'Следим за результатом без изменений',icon:'◉',color:'#2b7bbf'},
    unprofitable:{label:'Не окупается',desc:'Затраты не оправдывают результат',icon:'⊘',color:'#c0392b'},
    profitable:{label:'Выгодно',desc:'Результат устраивает по затратам',icon:'₽',color:'#43a047'},
    investigate:{label:'Разобраться',desc:'Есть вопрос: добавьте пояснение',icon:'?',color:'#e67e22'}};
  const KEYWORD_TAG_ORDER=Object.keys(KEYWORD_TAGS).filter(key=>key!=='important');
  keywords.tags={};keywords.tagColors={};keywords.tagsLoaded=false;
  const tagColor=key=>keywords.tagColors[key]||KEYWORD_TAGS[key].color;
  async function loadKeywordTags(){
    try{const response=await fetch(`/api/keyword-tags?${new URLSearchParams({cabinet:params.get('cabinet')||'demo',id:params.get('id')||''})}`);const result=await response.json();if(!response.ok)throw new Error(result.error);
      keywords.tags=result.tags||{};keywords.tagColors=result.colors||{};keywords.tagsLoaded=true;renderKeywords()}catch{/* без отметок таблица работает как раньше */}
  }
  function keywordTagButton(query){
    const tag=keywords.tags[query]||{};
    if(!tag.tag&&!tag.important)return `<button type="button" class="keyword-tag-add" data-keyword-tag="${esc(query)}" title="Добавить отметку" aria-label="Добавить отметку запросу «${esc(query)}»">+</button>`;
    const title=[tag.important?KEYWORD_TAGS.important.label:'',tag.tag?KEYWORD_TAGS[tag.tag].label:''].filter(Boolean).join(' · ');
    // В строке — только иконки отметок, названия видны при наведении.
    const main=tag.tag?`<i style="color:${tagColor(tag.tag)}">${KEYWORD_TAGS[tag.tag].icon}</i>`:'';
    return `<button type="button" class="keyword-tag-set" data-keyword-tag="${esc(query)}" style="--tag:${tag.tag?tagColor(tag.tag):tagColor('important')}" title="${esc(title)} — изменить отметку" aria-label="Отметка «${esc(title)}», изменить">${tag.important?`<i style="color:${tagColor('important')}">★</i>`:''}${main}</button>`;
  }
  // --- Пояснения и история: у запроса хранится история смены отметок (с пояснениями), комментарии и смена статуса фразы ---
  const NOTE_ICON='<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 1.75h5.25l3 3v9.5H4z"/><path d="M9.25 1.75v3h3M6.25 8h4M6.25 10.75h4"/></svg>';
  const COMMENT_ICON='<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 3h11v7.5H7.25L4.5 13v-2.5h-2z"/></svg>';
  const EDIT_ICON='<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10.5 2.75l2.75 2.75-7.5 7.5H3v-2.75z"/></svg>';
  const DELETE_ICON='<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"/></svg>';
  const keywordHistory=query=>keywords.tags[query]?.history||[];
  // Значок справа от запроса появляется, когда есть хотя бы одно пояснение или комментарий.
  const keywordHasNotes=query=>keywordHistory(query).some(event=>event.note||event.type==='comment');
  // Последняя смена основной отметки на текущую — к ней относится пояснение из меню отметок.
  const lastTagEvent=query=>{const tag=keywords.tags[query]?.tag;return tag?[...keywordHistory(query)].reverse().find(event=>event.type==='tag'&&event.to===tag)||null:null};
  const keywordNoteButton=query=>keywordHasNotes(query)?`<button type="button" class="keyword-note-button" data-keyword-notes="${esc(query)}" aria-label="История отметок и комментариев запроса «${esc(query)}»">${NOTE_ICON}</button>`:'';
  const noteForm=(attr,text,placeholder)=>`<form class="note-form" ${attr}><textarea rows="2" maxlength="1000" placeholder="${placeholder}" aria-label="${placeholder}">${esc(text||'')}</textarea><div><button type="button" class="note-cancel" data-note-cancel>Отмена</button><button type="submit" class="note-save">Сохранить</button></div></form>`;
  // Enter сохраняет, Shift+Enter — перенос строки.
  document.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&event.target.matches('.note-form textarea')){event.preventDefault();event.target.form.requestSubmit()}});
  async function saveKeywordNote(query,body){
    try{const response=await fetch('/api/keyword-tags/note',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cabinet:params.get('cabinet')||'demo',id:params.get('id')||'',query,...body})});
      const result=await response.json();if(!response.ok)throw new Error(result.error||'не сохранилось');
      if(result.tag)keywords.tags[query]=result.tag;else delete keywords.tags[query];
      renderKeywords();return true}
    catch(e){keywordMessage(`Комментарий не сохранился: ${e.message}`,'error');return false}
  }
  function closeTagMenu(){$('#keywordTagMenu').hidden=true;tagMenu.editing=false}
  const tagMenu={editing:false};
  // Под выбранной отметкой — пояснение к ней: ссылка «Добавить пояснение», поле ввода или уже написанный текст.
  function tagNoteBlock(query){
    const event=lastTagEvent(query);
    if(tagMenu.editing)return noteForm('data-tag-note-form',event?.note,'Пояснение к отметке');
    if(event?.note)return `<div class="tag-note">${NOTE_ICON}<span>${esc(event.note)}</span><button type="button" class="tag-note-link" data-tag-note-add>Изменить</button></div>`;
    return `<button type="button" class="tag-note-link tag-note-add" data-tag-note-add>${NOTE_ICON}Добавить пояснение</button>`;
  }
  function renderTagMenu(query){
    const menu=$('#keywordTagMenu'),tag=keywords.tags[query]||{};
    menu.dataset.query=query;
    menu.innerHTML=`<button type="button" class="tag-menu-close" data-tag-close aria-label="Закрыть">×</button><small class="tag-menu-caption">Отметка кластера</small><strong class="tag-menu-query">${esc(query)}</strong>`+
      `<button type="button" class="tag-item ${tag.important?'active':''}" data-tag-important><i style="color:${tagColor('important')}">${tag.important?'★':'☆'}</i><span>${KEYWORD_TAGS.important.label}<small>${KEYWORD_TAGS.important.desc}</small></span></button><hr>`+
      KEYWORD_TAG_ORDER.map(key=>`<button type="button" class="tag-item ${tag.tag===key?'active':''}" data-tag-set="${key}"><i style="color:${tagColor(key)}">${KEYWORD_TAGS[key].icon}</i><span>${KEYWORD_TAGS[key].label}<small>${KEYWORD_TAGS[key].desc}</small></span></button>${tag.tag===key?tagNoteBlock(query):''}`).join('')+
      `<hr><button type="button" class="tag-item" data-tag-clear ${tag.tag||tag.important?'':'disabled'}><i>⌫</i><span>Убрать отметку</span></button><button type="button" class="tag-colors-link" data-tag-colors>⚙ Настроить цвета отметок</button>`;
    if(tagMenu.editing){const field=menu.querySelector('.note-form textarea');field?.focus();field?.setSelectionRange(field.value.length,field.value.length)}
  }
  function openTagMenu(query,anchor){
    const menu=$('#keywordTagMenu');
    tagMenu.editing=false;hideHistory();
    renderTagMenu(query);
    menu.hidden=false;
    placeTagMenu(anchor);
  }
  // Меню у кнопки: вниз, если помещается, иначе в сторону, где больше места, с прокруткой внутри.
  function placeTagMenu(anchor){
    const menu=$('#keywordTagMenu'),rect=anchor.getBoundingClientRect(),below=window.innerHeight-rect.bottom-14,above=rect.top-14,scroll=menu.scrollTop;
    menu.style.maxHeight='none';
    const full=menu.offsetHeight,down=full<=below||below>=above,height=Math.min(full,down?below:above);
    menu.style.maxHeight=`${height}px`;
    menu.style.left=`${Math.max(8,Math.min(rect.left,window.innerWidth-menu.offsetWidth-8))}px`;
    menu.style.top=`${down?rect.bottom+6:rect.top-6-height}px`;
    menu.scrollTop=scroll;
  }
  // При прокрутке страницы меню едет за своей кнопкой; закрывается, только когда кнопка ушла с экрана.
  function followTagMenu(){
    const menu=$('#keywordTagMenu');if(menu.hidden)return;
    const anchor=document.querySelector(`[data-keyword-tag="${CSS.escape(menu.dataset.query||'')}"]`),rect=anchor?.getBoundingClientRect();
    if(!rect||rect.bottom<0||rect.top>window.innerHeight)return closeTagMenu();
    placeTagMenu(anchor);
  }
  // Меню открыто для этого запроса и не редактируется — перерисовать (например, когда сервер вернул событие для пояснения).
  const refreshTagMenu=query=>{const menu=$('#keywordTagMenu');if(!menu.hidden&&menu.dataset.query===query&&!tagMenu.editing)renderTagMenu(query)};
  async function saveKeywordTag(query,change){
    const before=keywords.tags[query]?{...keywords.tags[query]}:null;
    const next={...(before||{})};
    if(change.clear){delete next.tag;delete next.important}
    if('tag' in change){if(change.tag)next.tag=change.tag;else delete next.tag}
    if('important' in change){if(change.important)next.important=true;else delete next.important}
    if(next.tag||next.important||next.history?.length)keywords.tags[query]=next;else delete keywords.tags[query];
    renderKeywords();
    try{const response=await fetch('/api/keyword-tags',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cabinet:params.get('cabinet')||'demo',id:params.get('id')||'',query,...change})});
      const result=await response.json();if(!response.ok)throw new Error(result.error||'не сохранилось');
      if(result.tag)keywords.tags[query]=result.tag;else delete keywords.tags[query];}
    catch(e){if(before)keywords.tags[query]=before;else delete keywords.tags[query];keywordMessage(`Отметка не сохранилась: ${e.message}`,'error')}
    renderKeywords();refreshTagMenu(query);
  }
  function openTagColors(){
    closeTagMenu();
    $('#tagColorsBody').innerHTML=Object.keys(KEYWORD_TAGS).map(key=>`<label class="tag-color-row"><i style="color:${tagColor(key)}">${KEYWORD_TAGS[key].icon}</i><span>${KEYWORD_TAGS[key].label}</span><input type="color" value="${tagColor(key)}" data-tag-color="${key}" aria-label="Цвет отметки «${KEYWORD_TAGS[key].label}»"></label>`).join('')+
      `<div class="confirm-buttons"><button type="button" class="secondary" data-tag-colors-reset>По умолчанию</button><button type="button" data-tag-colors-save>Сохранить</button></div>`;
    $('#tagColorsModal').hidden=false;
  }
  async function saveTagColors(colors){
    try{const response=await fetch('/api/keyword-tags/colors',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({colors})});const result=await response.json();if(!response.ok)throw new Error(result.error);
      keywords.tagColors=result.colors||{};$('#tagColorsModal').hidden=true;renderKeywords()}catch(e){keywordMessage(`Цвета не сохранились: ${e.message}`,'error')}
  }
  $('#keywordsBody').addEventListener('click',event=>{const button=event.target.closest('[data-keyword-tag]');if(!button)return;event.stopPropagation();const menu=$('#keywordTagMenu');if(!menu.hidden&&menu.dataset.query===button.dataset.keywordTag){closeTagMenu();return}openTagMenu(button.dataset.keywordTag,button)});
  $('#keywordTagMenu').addEventListener('click',event=>{
    // Меню перерисовывается при клике — без этого document увидит «внешний» клик и закроет его.
    event.stopPropagation();
    const query=$('#keywordTagMenu').dataset.query,tag=keywords.tags[query]||{};
    if(event.target.closest('[data-tag-close]'))return closeTagMenu();
    if(event.target.closest('[data-tag-colors]'))return openTagColors();
    if(event.target.closest('[data-tag-important]')){saveKeywordTag(query,{important:!tag.important});tagMenu.editing=false;renderTagMenu(query);return}
    // После выбора отметки меню остаётся открытым: под ней появляется «Добавить пояснение».
    const set=event.target.closest('[data-tag-set]');if(set){saveKeywordTag(query,{tag:tag.tag===set.dataset.tagSet?'':set.dataset.tagSet});tagMenu.editing=false;renderTagMenu(query);return}
    if(event.target.closest('[data-tag-note-add]')){tagMenu.editing=true;renderTagMenu(query);return}
    if(event.target.closest('[data-note-cancel]')){tagMenu.editing=false;renderTagMenu(query);return}
    if(event.target.closest('[data-tag-clear]')){saveKeywordTag(query,{clear:true});closeTagMenu()}
  });
  $('#keywordTagMenu').addEventListener('submit',async event=>{
    event.preventDefault();
    const query=$('#keywordTagMenu').dataset.query,text=event.target.querySelector('textarea').value.trim(),target=lastTagEvent(query);
    // Пустое поле у уже написанного пояснения — удалить его; без события отметки пояснение сохраняется комментарием.
    const ok=!text?(target?.note?await saveKeywordNote(query,{eventId:target.id,remove:true}):true):await saveKeywordNote(query,target?{eventId:target.id,text}:{text});
    if(ok){tagMenu.editing=false;if(!$('#keywordTagMenu').hidden)renderTagMenu(query)}
  });
  // --- Всплывающая история запроса: при наведении на значок справа от запроса; клик закрепляет окно ---
  const historyPop={query:'',tab:'all',editing:null,pinned:false,timer:0,anchor:null};
  const HISTORY_TABS=[['all','Все'],['notes','Комментарии и отметки'],['status','Статус фразы']];
  const historyDay=iso=>{const at=new Date(iso);return `${at.toLocaleDateString('ru-RU',{day:'numeric',month:'long',timeZone:'Europe/Moscow'})} · ${at.toLocaleDateString('ru-RU',{weekday:'short',timeZone:'Europe/Moscow'})}`};
  const historyTime=iso=>new Date(iso).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Moscow'});
  const tagBadge=key=>`<span class="history-tag"><i style="color:${KEYWORD_TAGS[key]?tagColor(key):'inherit'}">${KEYWORD_TAGS[key]?.icon||''}</i><b>${esc(KEYWORD_TAGS[key]?.label||key)}</b></span>`;
  function historyTitle(event){
    if(event.type==='tag')return event.to?`Отмечен как ${event.from?`<span class="history-from">${esc(KEYWORD_TAGS[event.from]?.label||event.from)}</span> → `:''}${tagBadge(event.to)}`:`Снята отметка ${tagBadge(event.from)}`;
    if(event.type==='important')return `${event.on?'Отмечен как':'Снята отметка'} ${tagBadge('important')}`;
    if(event.type==='status')return event.action==='exclude'?'Фраза <b>исключена</b> из показов (минус-фраза)':'Фраза снова <b>включена</b> в показы';
    return 'Комментарий';
  }
  function historyComment(event,text){
    if(historyPop.editing===event.id)return noteForm(`data-history-form="${esc(event.id)}"`,text,event.type==='comment'?'Комментарий':'Пояснение');
    return `<div class="history-comment">${COMMENT_ICON}<p>${esc(text)}</p><span class="history-actions"><button type="button" data-history-edit="${esc(event.id)}" title="Изменить" aria-label="Изменить">${EDIT_ICON}</button><button type="button" data-history-delete="${esc(event.id)}" title="Удалить" aria-label="Удалить">${DELETE_ICON}</button></span></div>`;
  }
  function historyCard(event){
    const text=event.type==='comment'?event.text:event.note;
    const body=text?historyComment(event,text):historyPop.editing===event.id?noteForm(`data-history-form="${esc(event.id)}"`,'','Пояснение'):`<button type="button" class="history-explain" data-history-edit="${esc(event.id)}">Пояснить</button>`;
    return `<article class="history-card ${event.type}"><div class="history-card-head"><div class="history-title">${historyTitle(event)}</div><div class="history-who"><b>Вы</b><small>${historyTime(event.at)}</small></div></div>${body}</article>`;
  }
  function renderHistory(){
    const pop=$('#keywordHistoryPop'),query=historyPop.query;
    const events=keywordHistory(query).filter(event=>historyPop.tab==='all'||(historyPop.tab==='status'?event.type==='status':event.type!=='status')).slice().reverse();
    let day='',list='';
    for(const event of events){const label=historyDay(event.at);if(label!==day){day=label;list+=`<div class="history-day"><span>${esc(label)}</span></div>`}list+=historyCard(event)}
    pop.innerHTML=`<div class="history-head"><strong>${esc(query)}</strong><button type="button" class="history-close" data-history-close aria-label="Закрыть">×</button></div>`+
      `<div class="history-tabs" role="tablist">${HISTORY_TABS.map(([key,label])=>`<button type="button" role="tab" aria-selected="${historyPop.tab===key}" class="${historyPop.tab===key?'active':''}" data-history-tab="${key}">${label}</button>`).join('')}</div>`+
      `<div class="history-list">${list||'<p class="history-empty">Записей нет</p>'}</div>`+
      `<div class="history-foot">${historyPop.editing==='new'?noteForm('data-history-form="new"','','Комментарий'):`<button type="button" class="history-add" data-history-add>${COMMENT_ICON}Добавить комментарий</button>`}</div>`;
    const field=pop.querySelector('.note-form textarea');if(field){field.focus();field.setSelectionRange(field.value.length,field.value.length)}
  }
  function placeHistory(){
    const pop=$('#keywordHistoryPop'),anchor=historyPop.anchor;if(!anchor?.isConnected)return;
    const rect=anchor.getBoundingClientRect(),below=window.innerHeight-rect.bottom-14,above=rect.top-14;
    pop.style.maxHeight='none';
    const full=pop.offsetHeight,down=full<=below||below>=above,height=Math.min(full,down?below:above);
    pop.style.maxHeight=`${height}px`;
    pop.style.left=`${Math.max(8,Math.min(rect.right-pop.offsetWidth+14,window.innerWidth-pop.offsetWidth-8))}px`;
    pop.style.top=`${down?rect.bottom+6:rect.top-6-height}px`;
  }
  function showHistory(query,anchor,pinned=false){
    clearTimeout(historyPop.timer);
    if(historyPop.query!==query){historyPop.tab='all';historyPop.editing=null}
    Object.assign(historyPop,{query,anchor,pinned:pinned||historyPop.pinned&&historyPop.query===query});
    $('#keywordHistoryPop').hidden=false;renderHistory();placeHistory();
  }
  function hideHistory(){clearTimeout(historyPop.timer);$('#keywordHistoryPop').hidden=true;Object.assign(historyPop,{query:'',editing:null,pinned:false,anchor:null})}
  // Окно не закрывается, пока оно закреплено кликом или в нём пишут комментарий.
  const historyBusy=()=>historyPop.pinned||historyPop.editing!=null;
  const scheduleHideHistory=()=>{clearTimeout(historyPop.timer);historyPop.timer=setTimeout(()=>{if(!historyBusy())hideHistory()},250)};
  // После перерисовки таблицы (сохранение) окно привязывается к новому значку того же запроса.
  function refreshHistory(){
    if($('#keywordHistoryPop').hidden)return;
    if(!keywordHistory(historyPop.query).length){hideHistory();return}
    historyPop.anchor=document.querySelector(`[data-keyword-notes="${CSS.escape(historyPop.query)}"]`)||historyPop.anchor;
    renderHistory();placeHistory();
  }
  $('#keywordsBody').addEventListener('mouseover',event=>{const button=event.target.closest('[data-keyword-notes]');if(!button)return;clearTimeout(historyPop.timer);if($('#keywordHistoryPop').hidden||historyPop.query!==button.dataset.keywordNotes)showHistory(button.dataset.keywordNotes,button)});
  $('#keywordsBody').addEventListener('mouseout',event=>{const button=event.target.closest('[data-keyword-notes]');if(button&&!button.contains(event.relatedTarget))scheduleHideHistory()});
  $('#keywordsBody').addEventListener('click',event=>{const button=event.target.closest('[data-keyword-notes]');if(!button)return;event.stopPropagation();
    if(!$('#keywordHistoryPop').hidden&&historyPop.query===button.dataset.keywordNotes&&historyPop.pinned)hideHistory();else{closeTagMenu();showHistory(button.dataset.keywordNotes,button,true)}});
  $('#keywordHistoryPop').addEventListener('mouseenter',()=>clearTimeout(historyPop.timer));
  $('#keywordHistoryPop').addEventListener('mouseleave',scheduleHideHistory);
  $('#keywordHistoryPop').addEventListener('click',async event=>{
    // Окно перерисовывается при клике — без этого document увидит «внешний» клик и закроет его.
    // Клик внутри закрепляет окно: после смены вкладки оно может стать ниже и уйти из-под курсора.
    event.stopPropagation();
    historyPop.pinned=true;
    const query=historyPop.query;
    if(event.target.closest('[data-history-close]'))return hideHistory();
    const tab=event.target.closest('[data-history-tab]');if(tab){historyPop.tab=tab.dataset.historyTab;historyPop.editing=null;renderHistory();placeHistory();return}
    if(event.target.closest('[data-history-add]')){historyPop.editing='new';renderHistory();placeHistory();return}
    if(event.target.closest('[data-note-cancel]')){historyPop.editing=null;renderHistory();placeHistory();return}
    const edit=event.target.closest('[data-history-edit]');if(edit){historyPop.editing=edit.dataset.historyEdit;renderHistory();placeHistory();return}
    const remove=event.target.closest('[data-history-delete]');if(remove){if(await saveKeywordNote(query,{eventId:remove.dataset.historyDelete,remove:true}))refreshHistory();refreshTagMenu(query)}
  });
  $('#keywordHistoryPop').addEventListener('submit',async event=>{
    event.preventDefault();
    const query=historyPop.query,id=event.target.dataset.historyForm,text=event.target.querySelector('textarea').value.trim();
    const target=keywordHistory(query).find(item=>item.id===id);
    // Пустой текст у существующей записи — удалить её текст (комментарий удаляется целиком).
    const ok=id==='new'?(text?await saveKeywordNote(query,{text}):true):!text?((target?.note||target?.type==='comment')?await saveKeywordNote(query,{eventId:id,remove:true}):true):await saveKeywordNote(query,{eventId:id,text});
    if(ok){historyPop.editing=null;refreshHistory();refreshTagMenu(query)}
  });
  document.addEventListener('click',event=>{if(!$('#keywordHistoryPop').hidden&&!event.target.closest('#keywordHistoryPop'))hideHistory()});
  $('#tagColorsModal').addEventListener('click',event=>{
    if(event.target.closest('[data-tag-colors-close]'))$('#tagColorsModal').hidden=true;
    if(event.target.closest('[data-tag-colors-reset]'))saveTagColors({});
    if(event.target.closest('[data-tag-colors-save]'))saveTagColors(Object.fromEntries([...document.querySelectorAll('[data-tag-color]')].filter(input=>input.value.toLowerCase()!==KEYWORD_TAGS[input.dataset.tagColor].color.toLowerCase()).map(input=>[input.dataset.tagColor,input.value])));
  });
  document.addEventListener('click',event=>{if(!$('#keywordTagMenu').hidden&&!event.target.closest('#keywordTagMenu'))closeTagMenu()});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'){closeTagMenu();hideHistory();$('#tagColorsModal').hidden=true}});
  window.addEventListener('scroll',event=>{
    if(!$('#keywordTagMenu').contains(event.target))followTagMenu();
    // История закрывается при прокрутке страницы, а если в ней пишут или она закреплена — едет за значком.
    if(!$('#keywordHistoryPop').hidden&&!$('#keywordHistoryPop').contains(event.target)){if(historyBusy())placeHistory();else hideHistory()}
  },true);
  loadKeywordTags();
  // --- Заметки по кампании: плавающая кнопка справа внизу, окно с заметками по дням (новые сверху) и полем для новой ---
  // Хранятся на компьютере (data/campaign-notes.json), отдельно для каждой кампании.
  const campaignNotes={list:[],open:false,editing:null};
  const notesQuery=()=>({cabinet:params.get('cabinet')||'demo',id:params.get('id')||''});
  async function loadCampaignNotes(){
    try{const response=await fetch(`/api/campaign-notes?${new URLSearchParams(notesQuery())}`),data=await response.json();if(!response.ok)throw new Error(data.error);campaignNotes.list=data.notes||[]}
    catch{campaignNotes.list=[]}
    renderCampaignNotesButton();if(campaignNotes.open)renderCampaignNotes();
  }
  function renderCampaignNotesButton(){const count=$('#campaignNotesCount');count.textContent=campaignNotes.list.length;count.hidden=!campaignNotes.list.length}
  function renderCampaignNotes(){
    const panel=$('#campaignNotesPanel'),draft=panel.querySelector('[data-campaign-note-form="new"] textarea')?.value||'';
    let day='',html='';
    for(const note of [...campaignNotes.list].reverse()){
      const label=historyDay(note.at);if(label!==day){day=label;html+=`<div class="history-day"><span>${esc(label)}</span></div>`}
      html+=`<article class="history-card comment"><div class="history-card-head"><div class="history-title">Заметка${note.editedAt?` · изменена ${esc(historyTime(note.editedAt))}`:''}</div><div class="history-who"><b>Вы</b><small>${historyTime(note.at)}</small></div></div>`+
        (campaignNotes.editing===note.id?noteForm(`data-campaign-note-form="${esc(note.id)}"`,note.text,'Заметка'):
        `<div class="history-comment">${COMMENT_ICON}<p>${esc(note.text)}</p><span class="history-actions"><button type="button" data-campaign-note-edit="${esc(note.id)}" title="Изменить" aria-label="Изменить">${EDIT_ICON}</button><button type="button" data-campaign-note-delete="${esc(note.id)}" title="Удалить" aria-label="Удалить">${DELETE_ICON}</button></span></div>`)+'</article>';
    }
    panel.innerHTML=`<div class="history-head"><strong>Заметки по кампании</strong><button type="button" class="history-close" data-campaign-notes-close aria-label="Закрыть">×</button></div>`+
      `<div class="notes-list">${html||'<p class="history-empty">Заметок пока нет. Запишите, что меняли в кампании и зачем, — потом будет видно, что сработало.</p>'}</div>`+
      `<div class="notes-new">${noteForm('data-campaign-note-form="new"',draft,'Новая заметка — Enter сохранить, Shift+Enter перенос')}</div>`;
    const field=panel.querySelector(campaignNotes.editing?`[data-campaign-note-form="${CSS.escape(campaignNotes.editing)}"] textarea`:'[data-campaign-note-form="new"] textarea');
    if(field){field.focus();field.setSelectionRange(field.value.length,field.value.length)}
  }
  function toggleCampaignNotes(open=!campaignNotes.open){
    campaignNotes.open=open;campaignNotes.editing=null;
    $('#campaignNotesPanel').hidden=!open;$('#campaignNotesButton').setAttribute('aria-expanded',String(open));
    if(open)renderCampaignNotes();
  }
  async function saveCampaignNote(body){
    try{const response=await fetch('/api/campaign-notes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...notesQuery(),...body})});
      const data=await response.json();if(!response.ok)throw new Error(data.error||'не сохранилось');campaignNotes.list=data.notes||[];return true}
    catch(e){alertNote(`Заметка не сохранилась: ${e.message}`);return false}
  }
  const alertNote=text=>{const panel=$('#campaignNotesPanel');panel.querySelector('.notes-error')?.remove();panel.insertAdjacentHTML('beforeend',`<p class="price-product-note notes-error" style="color:#b84949">${esc(text)}</p>`)};
  $('#campaignNotesButton').addEventListener('click',event=>{event.stopPropagation();toggleCampaignNotes()});
  $('#campaignNotesPanel').addEventListener('click',async event=>{
    event.stopPropagation();
    if(event.target.closest('[data-campaign-notes-close]'))return toggleCampaignNotes(false);
    const edit=event.target.closest('[data-campaign-note-edit]');if(edit){campaignNotes.editing=edit.dataset.campaignNoteEdit;return renderCampaignNotes()}
    const remove=event.target.closest('[data-campaign-note-delete]');if(remove){if(await saveCampaignNote({noteId:remove.dataset.campaignNoteDelete,remove:true})){renderCampaignNotesButton();renderCampaignNotes()}return}
    if(event.target.closest('[data-note-cancel]')){const form=event.target.closest('form');if(form?.dataset.campaignNoteForm==='new')form.querySelector('textarea').value='';campaignNotes.editing=null;renderCampaignNotes()}
  });
  $('#campaignNotesPanel').addEventListener('submit',async event=>{
    event.preventDefault();
    const id=event.target.dataset.campaignNoteForm,text=event.target.querySelector('textarea').value.trim();
    // Пустой текст у существующей заметки — удалить её; пустая новая — ничего не делать.
    if(id==='new'&&!text)return;
    if(await saveCampaignNote(id==='new'?{text}:text?{noteId:id,text}:{noteId:id,remove:true})){
      if(id==='new')event.target.querySelector('textarea').value='';
      campaignNotes.editing=null;renderCampaignNotesButton();renderCampaignNotes();
    }
  });
  // Клик мимо окна закрывает его, если ничего не пишется (иначе можно потерять набранный текст).
  document.addEventListener('click',event=>{
    if(!campaignNotes.open||event.target.closest('#campaignNotesPanel,#campaignNotesButton'))return;
    const draft=$('#campaignNotesPanel [data-campaign-note-form="new"] textarea')?.value.trim();
    if(!draft&&!campaignNotes.editing)toggleCampaignNotes(false);
  });
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&campaignNotes.open)toggleCampaignNotes(false)});
  loadCampaignNotes();
  // --- Исключение и включение выбранных запросов: галочки слева, нижняя панель действий, подтверждение ---
  // Сервер читает текущие минус-фразы каждого товара, добавляет или убирает выбранные запросы и перепроверяет результат.
  function selectedKeywordRows(){const rows=keywordView().rows;return rows.filter(row=>keywords.selected.has(row.query))}
  function renderKeywordActions(){
    const bar=$('#keywordActions'),all=$('#keywordSelectAll'),selected=keywordsCpc()?[]:selectedKeywordRows();
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
    if(keywordsCpc())return;
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
  $('#keywordSearch').oninput=event=>{keywords.search=event.target.value;keywords.page=1;renderKeywords()};
  $('#keywordOnlyInactive').onchange=event=>{keywords.onlyInactive=event.target.checked;keywords.page=1;renderKeywords()};
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
      renderMeta(result.campaign);renderSummary(result.campaign);renderSetup(result.setup);renderOptions();renderChart();renderTable();renderProductTable();loadPositions(result.activePeriod||result.period);
      $('#campaignTitle').textContent=result.campaign.name||`Кампания #${result.campaign.id}`;document.title=`${$('#campaignTitle').textContent} — WB Pulse`;renderCampaignHeader(result);
      state.period=result.activePeriod||result.period;loadKeywords(state.period);loadPrevious(result.period,result.campaign);
      $('#periodLabel').textContent=`${date(result.period.from)} — ${date(result.period.to)}${result.folder?` · ${result.folder}`:''}`;
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
      const bodyId=table.querySelector('tbody[id]')?.id||`campaign-table-${tableIndex}`,storageKey=`wb-campaign-column-widths:${bodyId}${table.dataset.widthsVersion?`:v${table.dataset.widthsVersion}`:''}`;
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









