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
  function renderMeta(c){const tags=[c.paymentType?String(c.paymentType).toUpperCase():'',AD_BIDS[String(c.bidType)]||c.bidType||'',AD_STATUSES[Number(c.status)]||''];$('#campaignMeta').innerHTML=tags.filter(Boolean).map(x=>`<b>${esc(x)}</b>`).join('')}
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
  function renderChart(){const svg=$('#dailyChart'), rows=[...state.rows].sort((a,b)=>String(a.date).localeCompare(String(b.date))), left=54,right=22,top=20,bottom=42,w=1200,h=290,pw=w-left-right,ph=h-top-bottom;const cards=[...new Map(state.productDaily.map(r=>[String(r.nmId),r])).values()];const selected=chartMetrics.filter(m=>state.visibleMetrics.has(m.key));const series=[...selected,...cards.filter(c=>state.visibleCards.has(String(c.nmId))).map((c,i)=>({key:`card:${c.nmId}`,label:`Артикул ${c.nmId}`,color:['#b35b45','#5a7d9a','#8b6b3f','#277a70','#d77b28'][i%5],card:c.nmId}))];if(!rows.length||!series.length){svg.innerHTML='<text x="600" y="145" text-anchor="middle" class="chart-axis">Выберите данные для отображения</text>';return}const byDay=new Map(state.productDaily.map(r=>[`${r.nmId}:${r.date}`,r]));const max=Math.max(1,...series.flatMap(s=>rows.map(r=>Number(s.card?byDay.get(`${s.card}:${r.date}`)?.spend||0:r[s.key]||0))));const x=i=>left+(rows.length===1?pw/2:i*pw/(rows.length-1)),y=v=>top+ph-Number(v||0)/max*ph;const grid=[0,.25,.5,.75,1].map(r=>`<line class="chart-grid" x1="${left}" x2="${w-right}" y1="${y(max*r)}" y2="${y(max*r)}"/><text class="chart-axis" x="${left-8}" y="${y(max*r)+4}" text-anchor="end">${number(max*r)}</text>`).join('');const labels=rows.map((r,i)=>i%Math.max(1,Math.ceil(rows.length/8))===0?`<text class="chart-axis" x="${x(i)}" y="${h-14}" text-anchor="middle">${esc(date(r.date))}</text>`:'').join('');const lines=series.map(s=>{const pts=rows.map((r,i)=>{const v=s.card?(byDay.get(`${s.card}:${r.date}`)?.spend||0):r[s.key];return `${x(i)},${y(v)}`}).join(' ');return `<polyline class="chart-line" points="${pts}" stroke="${s.color}"/>`}).join('');svg.innerHTML=`${grid}${labels}${lines}<rect class="chart-hit-area" x="${left}" y="${top}" width="${pw}" height="${ph}" fill="transparent"/>`;bindHover(rows,x,series,byDay,w,top,top+ph)}
  function bindHover(rows,x,series,byDay,w,top,bottom){const svg=$('#dailyChart'),tip=$('#chartTooltip'),wrap=$('.chart-wrap');svg.onpointermove=e=>{const point=svg.createSVGPoint();point.x=e.clientX;point.y=e.clientY;const matrix=svg.getScreenCTM();if(!matrix)return;const local=point.matrixTransform(matrix.inverse()),vx=Math.max(0,Math.min(w,local.x));let idx=0,best=Infinity;rows.forEach((_,i)=>{const d=Math.abs(x(i)-vx);if(d<best){best=d;idx=i}});const row=rows[idx];tip.innerHTML=`<strong>${esc(date(row.date))}</strong>`+series.map(s=>{const v=s.card?(byDay.get(`${s.card}:${row.date}`)?.spend||0):row[s.key];return `<span><i style="background:${s.color}"></i>${s.label}: <b>${esc(fmt(s.card?'spend':s.key,v))}</b></span>`}).join('');tip.hidden=false;const wrapRect=wrap.getBoundingClientRect(),svgRect=svg.getBoundingClientRect(),px=svgRect.left-wrapRect.left+(x(idx)/w)*svgRect.width;tip.style.left=`${Math.max(12,Math.min(wrap.clientWidth-tip.offsetWidth-12,px))}px`;let line=svg.querySelector('.chart-hover-line');if(!line){svg.insertAdjacentHTML('beforeend','<line class="chart-hover-line" y1="20" y2="248"/>');line=svg.querySelector('.chart-hover-line')}line.setAttribute('x1',x(idx));line.setAttribute('x2',x(idx))};svg.onpointerleave=()=>tip.hidden=true}
  const MONTH_NAMES=['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  const isoDate=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const exportState={presets:[],started:0,timer:0,chunks:0,index:0,phase:'',reason:'',waitUntil:0,failed:0};
  function buildExportPresets(){
    const today=new Date();today.setHours(0,0,0,0);
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
  function formatSeconds(total){return total>=60?`${Math.floor(total/60)} мин ${total%60} сек`:`${total} сек`}
  function exportRequestsSent(s,now){
    if(s.phase==='start')return 0;
    if(s.phase==='wait'&&now<s.waitUntil)return s.index;
    if(s.phase==='finalize')return s.chunks;
    return s.index+1;
  }
  function renderExportProgress(){
    const s=exportState,now=Date.now();
    const saved=s.storedDays?` · из сохранённого: ${s.storedDays} дн.`:'';
    if(s.phase==='start'&&!s.known){$('#exportProgress').textContent='Проверяем сохранённую статистику…';return}
    if(s.chunks===0){$('#exportProgress').textContent=`Все дни уже сохранены, запросы к WB не нужны${s.phase==='finalize'?' · подставляем названия и фото товаров…':''}`;return}
    let text=`Запросы: ${exportRequestsSent(s,now)} из ${s.chunks}${saved}`;
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
    if(event.type==='start'){s.chunks=event.chunks;s.storedDays=Number(event.storedDays||0);s.known=true;s.phase='start'}
    if(event.type==='request'){s.index=event.index;s.phase='request'}
    if(event.type==='wait'){s.index=event.index;s.phase='wait';s.reason=event.reason;s.waitUntil=Date.now()+Number(event.ms||0)}
    if(event.type==='chunk'){s.index=event.index;s.phase='received';if(!event.ok)s.failed++}if(event.type==='finalize')s.phase='finalize';
    if(event.type==='error')throw new Error(event.error||'Не удалось выгрузить статистику');
    renderExportProgress();
    return event.type==='result'?event:null;
  }
  async function exportHistory(){
    const button=$('#exportHistory'),controls=[button,$('#exportPreset'),$('#exportFrom'),$('#exportTo')];
    const from=$('#exportFrom').value,to=$('#exportTo').value;
    if(!from||!to)return alert('Выберите даты начала и конца выгрузки');
    if(from>to)return alert('Дата начала должна быть не позже даты конца');
    Object.assign(exportState,{started:Date.now(),chunks:0,index:0,phase:'start',reason:'',waitUntil:0,failed:0,storedDays:0,known:false});
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
      $('#periodLabel').textContent=`Кампания #${result.campaign.id} · ${date(result.period.from)} — ${date(result.period.to)}${result.folder?` · ${result.folder}`:''}`;
      clearInterval(exportState.timer);
      const took=formatSeconds(Math.max(1,Math.round((Date.now()-exportState.started)/1000)));
      const saved=result.storedDays?` · из сохранённого: ${result.storedDays} дн.`:'';
      $('#exportProgress').textContent=exportState.failed?`Готово за ${took} · запросов без данных: ${exportState.failed} из ${exportState.chunks}${saved}`:`Готово за ${took} · запросов к WB: ${exportState.chunks}${saved}`;
    }catch(e){
      clearInterval(exportState.timer);$('#exportProgress').textContent=`Ошибка: ${e.message}`;
    }finally{
      clearInterval(exportState.timer);controls.forEach(control=>control.disabled=false);button.textContent='Выгрузить';
    }
  }
  function load(){const from=params.get('from')||'',to=params.get('to')||'',fromInput=$('#exportFrom'),toInput=$('#exportTo');if(/^\d{4}-\d{2}-\d{2}$/.test(from)&&/^\d{4}-\d{2}-\d{2}$/.test(to)&&from<=to&&from>=fromInput.min&&to<=toInput.max){fromInput.value=from;toInput.value=to;fromInput.onchange()}exportHistory()}
  document.querySelectorAll('th[data-key]').forEach(h=>h.onclick=()=>{const k=h.dataset.key;state.sort=state.sort.key===k?{key:k,direction:state.sort.direction==='asc'?'desc':'asc'}:{key:k,direction:'desc'};renderTable()});document.querySelectorAll('th[data-product-key]').forEach(h=>h.onclick=()=>{const k=h.dataset.productKey;state.productSort=state.productSort.key===k?{key:k,direction:state.productSort.direction==='asc'?'desc':'asc'}:{key:k,direction:'desc'};renderProductTable()});buildExportPresets();$('#exportHistory').onclick=exportHistory;document.querySelectorAll('[data-modal-close]').forEach(el=>el.onclick=closeProductModal);document.addEventListener('keydown',event=>{if(event.key==='Escape')closeProductModal()});load();
})();









