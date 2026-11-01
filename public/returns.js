// --- Возвраты и перемещения: что ждёт в ПВЗ, что едет, что получено и что не забрано ---
// Данные — /api/returns (метод WB item-returns). Активные возвраты (ещё не выданы) — за последние 3 месяца
// независимо от периода сайта: их нужно забрать. Полученные и не забранные — за выбранный период.
// Статус показывается текстом WB как есть, цвет — по группе: в пути, готов к выдаче, получен, не забран.
const returnsView={data:null,key:'',error:'',search:'',status:'',type:'',sort:{key:'orderDt',dir:'desc'},page:1,pageSize:pageSizeFor('returns'),request:0};
const RETURN_STATUS_CLASS={transit:'status-confirm',ready:'status-new',done:'status-complete',expired:'status-cancel',cancel:'status-cancel',other:''};
const RETURN_STATUS_ORDER={ready:0,transit:1,expired:2,cancel:3,done:4,other:5};
const RETURN_COLUMNS=[
  {key:'title',label:'Товар',width:300},
  {key:'returnType',label:'Тип возврата',width:220},
  {key:'returnStatus',label:'Статус',width:200},
  {key:'officeAddress',label:'ПВЗ выдачи',width:260},
  {key:'orderDt',label:'Оформлен',hint:'Дата заказа на возврат: когда WB оформил возврат товара продавцу',width:110},
  {key:'readyAt',label:'Готов к выдаче',width:130},
  {key:'expiresAt',label:'Хранится до',hint:'Когда истекает срок хранения возврата в ПВЗ',width:140},
  {key:'completedAt',label:'Получен',hint:'Когда возврат выдали продавцу',width:130},
  {key:'sku',label:'Баркод',width:140},
  {key:'stickerId',label:'Стикер · ШК',hint:'Стикер заказа на возврат и штрихкод товара — по ним возврат выдают в ПВЗ. Клик копирует',width:150},
  {key:'kiz',label:'Честный знак',hint:'Код маркировки, если товар маркированный. Клик копирует',width:120}];
const RETURN_MONTHS=['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'];
// Даты WB — московские, без часового пояса: показываем как есть, год — только если не текущий.
function returnDate(value,withTime=false){
  const m=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  if(!m)return '—';
  const day=`${Number(m[3])} ${RETURN_MONTHS[Number(m[2])-1]}${m[1]!==String(new Date().getFullYear())?` ${m[1]}`:''}`;
  return withTime&&m[4]?`${day}, ${m[4]}:${m[5]}`:day;
}
function returnDaysLeft(value){const at=Date.parse(`${value}+03:00`);return value&&!Number.isNaN(at)?(at-Date.now())/864e5:null}
// Остаток срока хранения: меньше 2 суток — красный, меньше 5 — оранжевый.
function returnLeftLabel(value){
  const days=returnDaysLeft(value);if(days==null)return '';
  if(days<0)return '<small class="returns-left bad">срок истёк</small>';
  const whole=Math.floor(days),text=whole<1?'меньше суток':`${whole} ${pluralRu(whole,['день','дня','дней'])}`;
  return `<small class="returns-left ${days<2?'bad':days<5?'warn':''}">осталось ${text}</small>`;
}
const returnAll=()=>[...(returnsView.data?.active||[]),...(returnsView.data?.archive||[])];
const returnPeriodText=data=>`${trendFullDate(data.period.from)} – ${trendFullDate(data.period.to)}`;
function returnRows(){
  const term=returnsView.search.trim().toLowerCase(),{status,type}=returnsView;
  const filtered=returnAll().filter(item=>(!term||[item.title,item.vendorCode,item.nmId,item.sku,item.stickerId,item.shkId,item.srid,item.officeAddress,item.subjectName,item.returnType,item.returnStatus].join(' ').toLowerCase().includes(term))&&
    (!status||(status==='active'?item.active:status==='lost'?['expired','cancel'].includes(item.status):item.status===status))&&(!type||item.returnType===type));
  // Пустые значения (ещё не готов, ещё не получен) — всегда в конце.
  const {key,dir}=returnsView.sort,factor=dir==='asc'?1:-1;
  const value=item=>key==='returnStatus'?RETURN_STATUS_ORDER[item.status]:item[key]||null;
  const compare=(a,b)=>{const av=value(a),bv=value(b);return (typeof av==='number'?av-bv:String(av).localeCompare(String(bv),'ru',{numeric:true}))*factor};
  return [...filtered.filter(item=>value(item)!=null).sort(compare),...filtered.filter(item=>value(item)==null)];
}
async function loadReturns(force=false){
  const key=[state.cabinet,$('#dateFrom').value,$('#dateTo').value].join(':');
  if(!force&&returnsView.key===key&&returnsView.data){renderReturns();return}
  const request=++returnsView.request,btn=$('#refresh');
  if(returnsView.key.split(':')[0]!==state.cabinet){returnsView.data=null;returnsView.error='';renderReturns()}
  btn.classList.add('loading');
  try{
    const data=await api('/api/returns?'+new URLSearchParams({cabinet:state.cabinet,from:$('#dateFrom').value,to:$('#dateTo').value}));
    if(request!==returnsView.request)return;
    Object.assign(returnsView,{data,key,error:'',page:1});state.demo=data.demo;renderReturns();
  }catch(e){if(request!==returnsView.request)return;returnsView.error=e.message;renderReturns();toast(e.message);addNotice('returns',`Ошибка загрузки возвратов: ${e.message}`)}
  finally{if(request===returnsView.request)btn.classList.remove('loading')}
}
function renderReturns(){
  const data=returnsView.data;
  if(!data){
    const text=returnsView.error?`Не удалось загрузить возвраты: ${escapeHtml(returnsView.error)}`:'Загрузка возвратов…';
    $('#returnMetrics').innerHTML='';$('#returnPickup').innerHTML=`<p class="rating-empty">${text}</p>`;$('#returnTypes').innerHTML='';$('#returnTop').innerHTML='';
    $('#returnPickupNote').textContent='';$('#returnTypesNote').textContent='';$('#returnCount').textContent=returnsView.error?'Ошибка загрузки':'Загрузка возвратов…';$('#returnBody').innerHTML='';return;
  }
  renderReturnSummary(data);
  renderReturnTypeFilter();
  renderReturnTable();
}
function renderReturnSummary(data){
  const active=data.active||[],archive=data.archive||[],all=returnAll(),period=returnPeriodText(data);
  const ready=active.filter(item=>item.status==='ready'),transit=active.filter(item=>item.status!=='ready');
  const done=archive.filter(item=>item.status==='done'),lost=archive.filter(item=>['expired','cancel'].includes(item.status));
  const offices=new Set(ready.map(item=>item.officeAddress)).size,soonest=ready.map(item=>item.expiresAt).filter(Boolean).sort()[0];
  const metrics=[
    ['Ждут в ПВЗ',ready.length,ready.length?`в ${offices} ${pluralRu(offices,['ПВЗ','ПВЗ','ПВЗ'])}${soonest?` · ближайший срок ${returnDate(soonest)}`:''}`:'забирать нечего','#7651e5'],
    ['В пути',transit.length,transit.length?'едут в ПВЗ выдачи':'нет возвратов в пути','#f0a04b'],
    ['Получено',done.length,`за ${period}`,'#318f68'],
    ['Не забрано',lost.length,lost.length?'истёк срок хранения или отменено по задержке':`за ${period} — ни одного`,'#e76464']];
  $('#returnMetrics').innerHTML=metrics.map(x=>`<article class="metric" style="--accent:${x[3]}"><div class="metric-label">${x[0]}</div><div class="metric-value">${fmtNum(x[1])}</div><div class="metric-note">${escapeHtml(x[2])}</div></article>`).join('');
  // Забрать в ПВЗ: активные возвраты по адресам. Сверху — где уже есть готовые к выдаче, с ближайшим сроком хранения.
  const groups=new Map();
  for(const item of active){
    const address=item.officeAddress||'ПВЗ не указан';let group=groups.get(address);
    if(!group){group={address,ready:0,transit:0,expires:null,readySince:null};groups.set(address,group)}
    if(item.status==='ready'){group.ready++;if(item.expiresAt&&(!group.expires||item.expiresAt<group.expires))group.expires=item.expiresAt;if(item.readyAt&&(!group.readySince||item.readyAt<group.readySince))group.readySince=item.readyAt}
    else group.transit++;
  }
  const list=[...groups.values()].sort((a,b)=>(b.ready>0)-(a.ready>0)||String(a.expires||'9').localeCompare(String(b.expires||'9'))||b.ready-a.ready||b.transit-a.transit);
  $('#returnPickupNote').textContent=`${fmtNum(ready.length)} готово к выдаче · ${fmtNum(transit.length)} в пути · активные за последние 3 месяца${data.demo?' · демо-данные':''}`;
  $('#returnPickup').innerHTML=list.length?list.map(group=>{
    const when=group.expires?`до ${returnDate(group.expires)}${returnLeftLabel(group.expires)}`:group.readySince?`готово с ${returnDate(group.readySince)}<small>срок хранения WB не указал</small>`:'<small>ещё в пути</small>';
    return `<button type="button" class="returns-pickup-row" data-return-office="${escapeHtml(group.address)}" title="Показать возвраты этого ПВЗ в таблице"><span><strong>${escapeHtml(group.address)}</strong><span class="rating-issues">${group.ready?`<em class="ready">${fmtNum(group.ready)} готово к выдаче</em>`:''}${group.transit?`<em class="transit">${fmtNum(group.transit)} в пути</em>`:''}</span></span><span class="returns-pickup-when">${when}</span></button>`}).join(''):
    '<p class="rating-empty">Активных возвратов нет — забирать ничего не нужно.</p>';
  // Типы возвратов и товары, которые возвращают чаще, — по всем возвратам таблицы.
  const types=new Map();all.forEach(item=>types.set(item.returnType,(types.get(item.returnType)||0)+1));
  const typeList=[...types].sort((a,b)=>b[1]-a[1]),max=Math.max(1,...typeList.map(x=>x[1]));
  $('#returnTypesNote').textContent=`${fmtNum(all.length)} ${pluralRu(all.length,['возврат','возврата','возвратов'])}: активные и за ${period}`;
  $('#returnTypes').innerHTML=typeList.length?typeList.map(([name,count])=>`<button type="button" class="returns-type-row" data-return-type="${escapeHtml(name)}" title="Показать в таблице"><span>${escapeHtml(name)}</span><span class="rating-star-track"><span style="width:${count/max*100}%"></span></span><b>${fmtNum(count)}</b><small>${Math.round(count/all.length*100)}%</small></button>`).join(''):'<p class="rating-empty">За период возвратов не было.</p>';
  const products=new Map();all.forEach(item=>{const p=products.get(item.nmId)||{item,count:0};p.count++;products.set(item.nmId,p)});
  const top=[...products.values()].filter(p=>p.count>1).sort((a,b)=>b.count-a.count).slice(0,5);
  $('#returnTop').innerHTML=top.length?`<h3>Чаще возвращают</h3>${top.map(({item,count})=>`<button type="button" class="rating-attention-row" data-return-focus="${item.nmId}" title="Показать товар в таблице">${item.photo?`<img class="stock-product-photo" src="${escapeHtml(item.photo)}" alt="" loading="lazy">`:'<i class="rating-photo-stub"></i>'}<span><strong>${escapeHtml(item.title)}</strong><small class="muted">${escapeHtml(item.vendorCode||'—')} · ${item.nmId}</small></span><b class="rating-attention-value">${fmtNum(count)}</b></button>`).join('')}`:'';
}
function renderReturnTypeFilter(){
  const select=$('#returnTypeFilter'),types=[...new Set(returnAll().map(item=>item.returnType))].sort((a,b)=>a.localeCompare(b,'ru'));
  if(returnsView.type&&!types.includes(returnsView.type))returnsView.type='';
  select.innerHTML=`<option value="">Все типы</option>${types.map(type=>`<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`).join('')}`;
  select.value=returnsView.type;
}
const returnCopy=(value,title)=>value?`<button type="button" class="copy-article" data-copy="${escapeHtml(value)}" title="${title}">${escapeHtml(value)}</button>`:'—';
function returnCell(item,key){
  if(key==='title')return `<td class="price-product-cell">${item.photo?`<img class="stock-product-photo" src="${escapeHtml(item.photo)}" alt="" loading="lazy">`:''}<span><strong title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</strong><small>${escapeHtml(item.vendorCode||'—')} · ${item.nmId}${item.techSize?` · размер ${escapeHtml(item.techSize)}`:''}</small></span></td>`;
  if(key==='returnType')return `<td class="returns-wrap">${escapeHtml(item.returnType)}${item.returnReason?`<small>Причина: ${escapeHtml(item.returnReason)}</small>`:''}</td>`;
  if(key==='returnStatus')return `<td><span class="status ${RETURN_STATUS_CLASS[item.status]||''}">${escapeHtml(item.returnStatus)}</span></td>`;
  if(key==='officeAddress')return `<td class="returns-wrap" title="${escapeHtml(item.officeAddress)}">${escapeHtml(item.officeAddress||'—')}</td>`;
  if(key==='orderDt')return `<td>${returnDate(item.orderDt)}</td>`;
  if(key==='readyAt'||key==='completedAt')return `<td>${returnDate(item[key],true)}</td>`;
  if(key==='expiresAt')return `<td>${returnDate(item.expiresAt,true)}${item.status==='ready'?returnLeftLabel(item.expiresAt):''}</td>`;
  if(key==='sku')return `<td>${returnCopy(item.sku,'Скопировать баркод')}</td>`;
  if(key==='stickerId')return `<td>${returnCopy(item.stickerId,'Скопировать стикер')}${item.shkId?`<small>ШК ${returnCopy(item.shkId,'Скопировать штрихкод')}</small>`:''}</td>`;
  return `<td>${item.kiz?`<button type="button" class="copy-article" data-copy="${escapeHtml(item.kiz)}" title="Скопировать код маркировки">Есть · копировать</button>`:'<span class="muted">—</span>'}</td>`;
}
function renderReturnTable(){
  const all=returnAll(),rows=returnRows(),pageCount=Math.ceil(rows.length/returnsView.pageSize);
  returnsView.page=Math.min(Math.max(1,returnsView.page),Math.max(1,pageCount));
  const pageRows=rows.slice((returnsView.page-1)*returnsView.pageSize,returnsView.page*returnsView.pageSize);
  $('#returnCount').textContent=`${fmtNum(rows.length)} из ${fmtNum(all.length)} · активные за 3 месяца и завершённые за ${returnPeriodText(returnsView.data)}`;
  // Заголовки создаются один раз — так сохраняются ширины столбцов (column-widths.js); при сортировке меняется только стрелка.
  const head=$('#returnHead');
  if(!head.children.length)head.innerHTML=RETURN_COLUMNS.map(c=>`<th data-return-sort="${c.key}" data-col-key="${c.key}" data-col-width="${c.width}"${c.hint?` title="${escapeHtml(c.hint)}"`:''}>${escapeHtml(c.label)} <span class="rating-sort-arrow"></span></th>`).join('');
  head.querySelectorAll('[data-return-sort]').forEach(th=>{th.querySelector('.rating-sort-arrow').textContent=returnsView.sort.key===th.dataset.returnSort?(returnsView.sort.dir==='asc'?'↑':'↓'):'↕'});
  $('#returnBody').innerHTML=pageRows.map(item=>`<tr>${RETURN_COLUMNS.map(c=>returnCell(item,c.key)).join('')}</tr>`).join('');
  $('#emptyReturns').classList.toggle('hidden',rows.length>0);
  $$('#returnBody .stock-product-photo,#returnTop .stock-product-photo').forEach(image=>{if(image.dataset.previewBound)return;image.dataset.previewBound='1';bindPhotoPreview(image)});
  renderPager($('#returnPagination'),{page:returnsView.page,pageCount,total:rows.length,sizeKey:'returns',onPage:page=>{returnsView.page=page;renderReturnTable();$('#page-returns .stock-panel').scrollIntoView({behavior:'smooth',block:'start'})},onSize:size=>{returnsView.pageSize=size;returnsView.page=1;renderReturnTable()}});
}
// Клик по ПВЗ, типу или товару в верхних блоках — показывает эти возвраты в таблице.
function focusReturns({search='',status='',type=''}){
  Object.assign(returnsView,{search,status,type,page:1});$('#returnSearch').value=search;$('#returnStatusFilter').value=status;$('#returnTypeFilter').value=type;
  renderReturnTable();$('#page-returns .stock-panel').scrollIntoView({behavior:'smooth',block:'start'});
}
document.addEventListener('click',event=>{
  const sort=event.target.closest('[data-return-sort]');
  if(sort&&!event.target.closest('.column-resizer')){const key=sort.dataset.returnSort;returnsView.sort=returnsView.sort.key===key?{key,dir:returnsView.sort.dir==='asc'?'desc':'asc'}:{key,dir:['title','returnType','returnStatus','officeAddress'].includes(key)?'asc':'desc'};returnsView.page=1;renderReturnTable();return}
  const office=event.target.closest('[data-return-office]');
  if(office){focusReturns({search:office.dataset.returnOffice,status:'active'});return}
  const type=event.target.closest('[data-return-type]');
  if(type){focusReturns({type:type.dataset.returnType});return}
  const product=event.target.closest('[data-return-focus]');
  if(product)focusReturns({search:product.dataset.returnFocus});
});
// Через document: скрипт подключается раньше app.js, где объявлен $.
document.addEventListener('input',event=>{if(event.target.id!=='returnSearch')return;returnsView.search=event.target.value;returnsView.page=1;if(returnsView.data)renderReturnTable()});
document.addEventListener('change',event=>{
  if(event.target.id==='returnStatusFilter'){returnsView.status=event.target.value;returnsView.page=1;if(returnsView.data)renderReturnTable()}
  if(event.target.id==='returnTypeFilter'){returnsView.type=event.target.value;returnsView.page=1;if(returnsView.data)renderReturnTable()}
});
