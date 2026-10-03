(() => {
  'use strict';
  const params = new URLSearchParams(location.search);
  const state = { rows: [], productDaily: [], sort: { key: 'date', direction: 'desc' }, productSort: { key: 'spend', direction: 'desc' }, visibleMetrics: new Set(['views', 'clicks', 'orders', 'spend']), visibleCards: new Set() };
  const columns = ['date','views','clicks','ctr','cpc','carts','orders','canceled','revenue','spend','drr'];
  const chartMetrics = [{key:'views',label:'Показы',color:'#277a70'},{key:'clicks',label:'Клики',color:'#d77b28'},{key:'carts',label:'Корзины',color:'#4d8f63'},{key:'orders',label:'Заказы',color:'#b35b45'},{key:'spend',label:'Затраты',color:'#5a7d9a'},{key:'revenue',label:'Сумма заказов',color:'#8b6b3f'}];
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
  function renderTable(){const rows=sorted(state.rows,state.sort);const sum=totals(state.rows);const head=`<tr class="total-row"><td>Итого · ${number(state.rows.length)} дн.</td>${columns.slice(1).map(k=>`<td>${esc(fmt(k,sum[k]))}</td>`).join('')}</tr>`;$('#dailyBody').innerHTML=rows.length?head+rows.map(r=>`<tr>${columns.map(k=>`<td>${esc(fmt(k,r[k]))}</td>`).join('')}</tr>`).join(''):'<tr><td colspan="11" class="empty">Нет дневных данных за выбранный период</td></tr>'}
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
    const value=(s,r)=>Number(s.card?byDay.get(`${s.card}:${r.date}`)?.spend||0:r[s.key]||0),maxOf=s=>Math.max(0,...rows.map(r=>value(s,r)));
    const groups=chartGroups(series,maxOf),scale=new Map(groups.flatMap(group=>group.series.map(s=>[s.key,group.max]))),[leftAxis,rightAxis]=groups;
    const x=i=>left+(rows.length===1?pw/2:i*pw/(rows.length-1)),y=(s,v)=>top+ph-Number(v||0)/scale.get(s.key)*ph;
    // Подписи оси — цветом её линии; если на оси несколько линий, цвет нейтральный, а линии перечислены над осью своими цветами.
    const axisColor=group=>group.series.length===1?group.series[0].color:'#58716e';
    const caption=(group,side)=>`<text class="chart-axis-caption" x="${side==='left'?left:w-right}" y="${top-8}" text-anchor="${side==='left'?'start':'end'}">${group.series.map(s=>`<tspan style="fill:${s.color}">${esc(s.label)}</tspan>`).join('<tspan style="fill:#9aaba8"> · </tspan>')}</text>`;
    const grid=[0,.25,.5,.75,1].map(r=>{const gy=top+ph-r*ph;return `<line class="chart-grid" x1="${left}" x2="${w-right}" y1="${gy}" y2="${gy}"/><text class="chart-axis" x="${left-8}" y="${gy+4}" text-anchor="end" style="fill:${axisColor(leftAxis)}">${esc(chartAxisNumber(leftAxis.max*r))}</text>`+(rightAxis?`<text class="chart-axis" x="${w-right+8}" y="${gy+4}" style="fill:${axisColor(rightAxis)}">${esc(chartAxisNumber(rightAxis.max*r))}</text>`:'')}).join('');
    const labels=rows.map((r,i)=>i%Math.max(1,Math.ceil(rows.length/8))===0?`<text class="chart-axis" x="${x(i)}" y="${h-14}" text-anchor="middle">${esc(date(r.date))}</text>`:'').join('');
    const lines=series.map(s=>`<polyline class="chart-line" points="${rows.map((r,i)=>`${x(i)},${y(s,value(s,r))}`).join(' ')}" stroke="${s.color}"/>`).join('');
    svg.innerHTML=`${grid}${rightAxis?caption(leftAxis,'left')+caption(rightAxis,'right'):''}${labels}${lines}<rect class="chart-hit-area" x="${left}" y="${top}" width="${pw}" height="${ph}" fill="transparent"/>`;
    const own=groups.slice(2).flatMap(group=>group.series.map(s=>`<span><i style="background:${s.color}"></i>${esc(s.label)} — до ${esc(chartAxisNumber(group.max))}</span>`));
    note.innerHTML=own.length?`Со своей шкалой, без оси: ${own.join(' ')}`:'';
    bindHover(rows,x,series,byDay,w,top,top+ph);
  }
  function bindHover(rows,x,series,byDay,w,top,bottom){const svg=$('#dailyChart'),tip=$('#chartTooltip'),wrap=$('.chart-wrap');svg.onpointermove=e=>{const point=svg.createSVGPoint();point.x=e.clientX;point.y=e.clientY;const matrix=svg.getScreenCTM();if(!matrix)return;const local=point.matrixTransform(matrix.inverse()),vx=Math.max(0,Math.min(w,local.x));let idx=0,best=Infinity;rows.forEach((_,i)=>{const d=Math.abs(x(i)-vx);if(d<best){best=d;idx=i}});const row=rows[idx];tip.innerHTML=`<strong>${esc(date(row.date))}</strong>`+series.map(s=>{const v=s.card?(byDay.get(`${s.card}:${row.date}`)?.spend||0):row[s.key];return `<span><i style="background:${s.color}"></i>${s.label}: <b>${esc(fmt(s.card?'spend':s.key,v))}</b></span>`}).join('');tip.hidden=false;const wrapRect=wrap.getBoundingClientRect(),svgRect=svg.getBoundingClientRect(),px=svgRect.left-wrapRect.left+(x(idx)/w)*svgRect.width;tip.style.left=`${Math.max(12,Math.min(wrap.clientWidth-tip.offsetWidth-12,px))}px`;let line=svg.querySelector('.chart-hover-line');if(!line){svg.insertAdjacentHTML('beforeend','<line class="chart-hover-line" y1="20" y2="248"/>');line=svg.querySelector('.chart-hover-line')}line.setAttribute('x1',x(idx));line.setAttribute('x2',x(idx))};svg.onpointerleave=()=>tip.hidden=true}
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
  const keywords={data:null,loading:false,error:'',product:'',search:'',onlyInactive:false,sort:{key:'views',direction:'desc'},limit:200};
  const KEYWORD_COLUMNS=['query','status','views','clicks','ctr','cpm','cpc','spend','carts','orders','cr','avgPosition'];
  const KEYWORD_STATUSES={active:'Активен',excluded:'Неактивен',archived:'В архиве'};
  const keywordStatusCell=row=>row.status?`<span class="keyword-status ${row.status}">${KEYWORD_STATUSES[row.status]}</span>`:'<span class="keyword-status archived">Нет данных</span>';
  const keywordValue=(key,value)=>key==='query'?String(value??''):['spend','cpc','cpm'].includes(key)?money(value):['ctr','cr'].includes(key)?percent(value):number(value);
  function keywordRows(){
    const data=keywords.data;if(!data)return [];
    const rows=keywords.product?(data.byNmId?.[keywords.product]||[]):(data.total||[]);
    const term=keywords.search.trim().toLowerCase();
    const filtered=rows.filter(row=>(!term||row.query.toLowerCase().includes(term))&&(!keywords.onlyInactive||row.status==='excluded'||row.status==='archived'));
    return sorted(filtered,keywords.sort);
  }
  function keywordStatusNote(rows){
    const off=rows.filter(row=>row.status==='excluded').length,archived=rows.filter(row=>row.status==='archived').length;
    return [off?`неактивных: ${number(off)}`:'',archived?`в архиве: ${number(archived)}`:''].filter(Boolean);
  }
  function keywordTotals(rows){
    const sum=key=>rows.reduce((total,row)=>total+Number(row[key]||0),0);
    const views=sum('views'),clicks=sum('clicks'),spend=sum('spend'),orders=sum('orders');
    const positions=rows.reduce((total,row)=>total+Number(row.avgPosition||0)*Number(row.views||1),0);
    const base=rows.reduce((total,row)=>total+Number(row.views||1),0);
    return {views,clicks,spend,orders,carts:sum('carts'),ctr:views?clicks/views*100:0,cpc:clicks?spend/clicks:0,
      cpm:views?spend/views*1000:0,cr:clicks?orders/clicks*100:0,avgPosition:base?positions/base:0};
  }
  async function loadKeywords(period,refresh=false){
    if(!period)return;
    keywords.loading=true;keywords.error='';renderKeywords();
    try{
      const q=new URLSearchParams({cabinet:params.get('cabinet')||'demo',id:params.get('id')||'',from:period.from,to:period.to,...(refresh?{refresh:'1'}:{})});
      const response=await fetch(`/api/advertising/campaign/keywords?${q}`);
      if(!response.ok)throw new Error((await response.json()).error||'Не удалось получить ключевые запросы');
      keywords.data=await response.json();
      if(!keywords.data.byNmId?.[keywords.product])keywords.product='';
    }catch(e){keywords.error=e.message}
    finally{keywords.loading=false;renderKeywords()}
  }
  function renderKeywords(){
    const note=$('#keywordsNote'),body=$('#keywordsBody'),select=$('#keywordProduct');
    if(!note)return;
    const data=keywords.data;
    select.innerHTML='<option value="">Все артикулы</option>'+(data?.products||[]).map(product=>`<option value="${esc(product.nmId)}" ${String(product.nmId)===keywords.product?'selected':''}>${esc(product.vendorCode||product.name)} · ${esc(product.nmId)}</option>`).join('');
    if(keywords.loading&&!data){note.textContent='Загрузка ключевых запросов…';body.innerHTML='';return}
    if(keywords.error&&!data){note.textContent=`Ошибка: ${keywords.error}`;body.innerHTML='';return}
    if(!data){note.textContent='';body.innerHTML='';return}
    const rows=keywordRows(),shown=rows.slice(0,keywords.limit),totals=keywordTotals(rows);
    const notes=[`${date(data.period.from)} — ${date(data.period.to)}`,`запросов: ${number(rows.length)}`,...keywordStatusNote(rows)];
    if(keywords.product)notes.push('по одному артикулу');
    if(rows.length>shown.length)notes.push(`показаны первые ${number(shown.length)}`);
    if(data.fromFile)notes.push('из сохранённого файла');
    if(keywords.loading)notes.push('обновляем…');
    if(keywords.error)notes.push(`ошибка обновления: ${keywords.error}`);
    (data.warnings||[]).forEach(text=>notes.push(text));
    note.textContent=notes.join(' · ');
    body.innerHTML=rows.length?`<tr class="total-row"><td>Итого · ${number(rows.length)} запросов</td><td></td>${KEYWORD_COLUMNS.slice(2).map(key=>`<td>${esc(keywordValue(key,totals[key]))}</td>`).join('')}</tr>`+
      shown.map(row=>`<tr class="${row.status==='excluded'||row.status==='archived'?'keyword-off':''}"><td>${esc(row.query)}</td><td>${keywordStatusCell(row)}</td>${KEYWORD_COLUMNS.slice(2).map(key=>`<td>${esc(keywordValue(key,row[key]))}</td>`).join('')}</tr>`).join(''):
      `<tr><td colspan="12" class="empty">${keywords.onlyInactive?'Неактивных запросов нет':'WB не вернул поисковые запросы за этот период'}</td></tr>`;
  }
  document.querySelectorAll('th[data-keyword-key]').forEach(header=>header.onclick=()=>{const key=header.dataset.keywordKey;keywords.sort=keywords.sort.key===key?{key,direction:keywords.sort.direction==='asc'?'desc':'asc'}:{key,direction:key==='query'?'asc':'desc'};renderKeywords()});
  $('#keywordProduct').onchange=event=>{keywords.product=event.target.value;renderKeywords()};
  $('#keywordSearch').oninput=event=>{keywords.search=event.target.value;renderKeywords()};
  $('#keywordOnlyInactive').onchange=event=>{keywords.onlyInactive=event.target.checked;renderKeywords()};
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









