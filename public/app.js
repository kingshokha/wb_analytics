const state={cabinets:[],cabinet:'demo',orders:[],funnel:{},funnelProducts:[],funnelHistory:[],funnelGroupedHistory:[],funnelFilters:{categories:new Set(),articles:new Set(),availability:new Set()},funnelSort:{key:'openCount',dir:'desc'},balance:null,ads:null,stocks:null,fbwStocks:null,prices:null,demo:true,activePage:'summary',dashboardKey:'',adsKey:'',stocksKey:'',fbwStocksKey:'',pricesKey:'',adSort:{key:'spend',dir:'desc'},adStatuses:new Set(['9','11']),adProductSort:{key:'spend',dir:'desc'},adProductOpen:new Set(),stockSelected:new Set(),stockFilters:{warehouses:new Set(),categories:new Set(),availability:new Set()},stockSort:{key:'amount',dir:'desc'},stockPage:1,stockPageSize:100,funnelPage:1,funnelTab:'products',funnelArticlesCabinet:'',dashboardAlerts:[],dashboardDemo:false,priceStocks:null,priceStocksKey:'',fbwFilters:{warehouses:new Set(),categories:new Set(),availability:new Set()},fbwSort:{key:'amount',dir:'desc'},fbwPage:1,fbwPageSize:100,pricePage:1,pricePageSize:100,priceSelected:new Set(),priceFilters:{categories:new Set(),brands:new Set(),discounts:new Set()},priceSort:{key:'name',dir:'desc'},fbsOrders:null,fbsOrdersKey:'',supplies:null,supplyDetail:null,fbsSelected:new Set(),fbsFilters:{warehouses:new Set(),categories:new Set(),assembly:new Set()},fbsSort:{key:'createdAt',dir:'desc'},fbsPage:1,fbsPageSize:100,supplyOrderSelected:new Set()};
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const fmtMoney=(n,c=643)=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:c===933?'BYN':c===398?'KZT':'RUB',maximumFractionDigits:0}).format(Number(n||0)/100);
const fmtNum=n=>new Intl.NumberFormat('ru-RU').format(Number(n||0));
const fmtRub=n=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',maximumFractionDigits:2}).format(Number(n||0));
const fmtPercent=n=>`${new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(Number(n||0))}%`;
const statusMap={new:['Новый','status-new'],confirm:['На сборке','status-confirm'],complete:['В доставке / продан','status-complete'],cancel:['Отменён','status-cancel'],return:['Возврат','status-return']};

async function api(url,options={}){const r=await fetch(url,{headers:{'Content-Type':'application/json'},...options});let data={};try{data=await r.json()}catch{}if(!r.ok)throw new Error(data.error||`Ошибка ${r.status}`);return data}
function toast(text){const el=$('#toast');el.textContent=text;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2600)}
// Даты сайта считаются по Москве (UTC+3), как в кабинете WB: «сегодня» не зависит от часового пояса компьютера.
function mskDate(offsetDays=0){const d=new Date(Date.now()+3*3_600_000);d.setUTCDate(d.getUTCDate()+offsetDays);return d.toISOString().slice(0,10)}
// Период по умолчанию — последние 7 дней включая сегодня: 25.09–01.10, если сегодня 1 октября.
function setDates(){$('#dateTo').value=mskDate(0);$('#dateFrom').value=mskDate(-6);const [year,month0]=mskDate(0).split('-').map(Number),month=$('#adMonth');month.innerHTML='<option value="">Выбрать период</option><option value="last31">Последние 31 день</option>'+Array.from({length:12},(_,i)=>{const d=new Date(Date.UTC(year,month0-1-i,1)),value=d.toISOString().slice(0,7);return `<option value="${value}">${d.toLocaleDateString('ru-RU',{month:'long',year:'numeric',timeZone:'UTC'})}</option>`}).join('')}

async function loadCabinets(){const data=await api('/api/cabinets');state.cabinets=data.cabinets;state.demo=data.demo;const stored=localStorage.getItem('wb-cabinet');state.cabinet=state.cabinets.some(c=>c.id===stored)?stored:state.cabinets[0].id;renderCabinets()}
function renderCabinets(){const selected=state.cabinets.find(c=>c.id===state.cabinet);$('#cabinetName').textContent=selected.name;$('#cabinetAvatar').textContent=selected.name[0].toUpperCase();$('#cabinetMode').textContent=selected.configured?'Единый токен активен':'Демо-данные';$('#cabinetList').innerHTML=state.cabinets.map(c=>`<button class="cab-option ${c.id===state.cabinet?'active':''}" data-id="${c.id}">${escapeHtml(c.name)} ${c.configured?'':'· демо'}</button>`).join('');$$('.cab-option').forEach(b=>b.onclick=()=>{state.cabinet=b.dataset.id;state.adsKey='';state.stocksKey='';state.fbwStocksKey='';state.pricesKey='';localStorage.setItem('wb-cabinet',state.cabinet);$('#cabinetMenu').classList.remove('open');renderCabinets();loadCurrentPage()})}

// silent — фоновая загрузка для счётчика в меню, без оверлея и без смены статуса синхронизации.
async function loadDashboard(silent=false){const btn=$('#refresh');if(!silent){btn.classList.add('loading');$('#syncText').textContent='Получаем данные…'}try{const q=new URLSearchParams({cabinet:state.cabinet,from:$('#dateFrom').value,to:$('#dateTo').value});const data=await api('/api/dashboard?'+q);state.dashboardKey=[...q.values()].join(':');state.orders=data.orders||[];state.fbsNew=data.fbsNew;state.funnel=data.funnel||{};state.balance=data.balance||null;state.demo=data.demo;renderAll();if(!silent)$('#syncText').textContent=`Обновлено ${new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}`;$('#cabinetMode').textContent=data.demo?'Демо-данные':'Единый токен активен';state.dashboardAlerts=[data.demo?'Сейчас показаны демо-данные. Добавьте <b>WB_TOKEN_1</b> в файл .env и перезапустите сервер.':'',...(data.warnings||[])].filter(Boolean);state.dashboardDemo=Boolean(data.demo);renderDashboardAlerts()}catch(e){if(silent)return;$('#syncText').textContent='Ошибка синхронизации';toast(e.message);addNotice('orders',`Ошибка загрузки ленты заказов: ${e.message}`)}finally{if(!silent)btn.classList.remove('loading')}}
function renderAll(){renderBalance();renderMetrics();renderOrders();renderFunnel();$('#newBadge').textContent=fbsNewCount()}
// Новые FBS-задания сервер считает отдельно (в строки ленты они не входят); в демо — по строкам.
function fbsNewCount(){return state.fbsNew??state.orders.filter(o=>o.source==='FBS'&&o.status==='new').length}
async function loadFunnelDetails(){if(!funnelFiltersActive())loadFunnelTrend();try{const q=new URLSearchParams({cabinet:state.cabinet,from:$('#dateFrom').value,to:$('#dateTo').value}),data=await api('/api/funnel?'+q);state.funnelProducts=data.products||[];state.funnelPeriods=data.periods||null;state.funnelPage=1;if(state.funnelArticlesCabinet!==state.cabinet){state.funnelFilters.articles.clear();state.funnelArticlesCabinet=state.cabinet}state.funnelHistory=data.history||[];state.funnelGroupedHistory=data.groupedHistory||[];const total=state.funnelProducts.reduce((sum,item)=>{const h=item.statistic?.selected||item.history?.[0]||item;return {views:sum.views+Number(h.openCount||0),cart:sum.cart+Number(h.cartCount||0),orders:sum.orders+Number(h.orderCount||0),sales:sum.sales+Number(h.buyoutCount||0),revenue:sum.revenue+Number(h.buyoutSum||0)}},{views:0,cart:0,orders:0,sales:0,revenue:0});if(state.funnelProducts.length)state.funnel=total;renderFunnel();renderFunnelDetails();renderFunnelArticleOptions();if(funnelFiltersActive())loadFunnelTrend();if(state.funnelTab==='sales')loadFunnelSales()}catch(e){toast(e.message)}}
function balanceMoney(value,currency='RUB'){return new Intl.NumberFormat('ru-RU',{style:'currency',currency,maximumFractionDigits:2}).format(Number(value||0))}
function renderBalance(){const el=$('#balanceStrip'),b=state.balance;if(!b){el.innerHTML='';el.classList.add('hidden');return}el.classList.remove('hidden');const latest=b.history?.[0],history=(b.history||[]).slice(0,5);const delta=latest?.delta||0;el.innerHTML=`<div class="balance-main"><p class="eyebrow">Баланс кабинета</p><strong>${balanceMoney(b.current,b.currency)}</strong><small class="balance-delta ${delta>0?'positive':delta<0?'negative':''}">${delta?`${delta>0?'+':''}${balanceMoney(delta,b.currency)} с прошлого снимка`:'Без изменений'}</small></div><div class="balance-withdraw"><span>Доступно к выводу</span><b>${balanceMoney(b.forWithdraw,b.currency)}</b></div><div class="balance-history"><span>Последние изменения</span><div>${history.length?history.map((x,i)=>`<button class="balance-event" data-balance-index="${i}"><i class="${x.delta>0?'up':x.delta<0?'down':''}">${i===history.length-1&&x.delta===0?'Первый снимок':`${x.delta>0?'+':''}${balanceMoney(x.delta,x.currency)}`}</i><small>${formatDate(x.timestamp)}</small></button>`).join(''):'<small>История начнёт заполняться после изменения баланса</small>'}</div></div>`}
function renderMetrics(){const f=state.funnel,items=[['Заказы',f.orders||state.orders.length,'за выбранный период','#7651e5'],['Выкупы',f.sales||state.orders.filter(o=>o.status==='complete').length,`${pct(f.sales,f.orders)}% от заказов`,'#318f68'],['Оборот',fmtMoney((f.revenue||0)*100),f.currency||'RUB','#f0a04b'],['Новые FBS',fbsNewCount(),'требуют внимания','#e76464']];$('#metrics').innerHTML=items.map(x=>`<article class="metric" style="--accent:${x[3]}"><div class="metric-label">${x[0]}</div><div class="metric-value">${typeof x[1]==='number'?fmtNum(x[1]):x[1]}</div><div class="metric-note">${x[2]}</div></article>`).join('')}
function feedStatus(o){if(o.source==='Лента WB'){if(o.rawStatus==='created')return['Оформлен','status-new'];if(o.rawStatus==='buyout')return['Выкуплен','status-complete'];if(o.rawStatus==='cancel')return[o.cancelType==='expire'?'Отменён · срок истёк':'Отменён','status-cancel'];if(o.rawStatus==='return')return['Возврат','status-return'];if(o.rawStatus==='returnDefective')return['Возврат · брак','status-return']}return statusMap[o.status]||[o.status||'Неизвестно','']}
function renderOrders(){const term=$('#search').value.toLowerCase(),status=$('#statusFilter').value;const rows=state.orders.filter(o=>(!status||o.status===status)&&(!term||[o.id,o.srid,o.nmId,o.chrtId,o.article,o.name,o.brand,o.warehouse,o.destinationCity].join(' ').toLowerCase().includes(term)));$('#orderCount').textContent=`${rows.length} из ${state.orders.length} событий за выбранный период`;$('#emptyOrders').classList.toggle('hidden',rows.length>0);$('#ordersBody').innerHTML=rows.map(o=>{const s=feedStatus(o);const picture=o.photo?`<img src="${escapeHtml(o.photo)}" alt="" loading="lazy">`:escapeHtml(String(o.name||'Т')[0]);const ordered=o.orderedAt||o.createdAt;return `<tr><td><strong>${formatDate(ordered)}</strong><small>Оформление</small></td><td><strong>${formatDate(o.createdAt)}</strong><small>Текущий статус</small></td><td><div class="product"><span class="product-icon ${o.photo?'has-photo':''}">${picture}</span><span><strong>${escapeHtml(o.name||'Товар')}</strong><small>${o.brand?`${escapeHtml(o.brand)} · `:''}${escapeHtml(o.article||'')} · nmID ${escapeHtml(o.nmId||'—')}</small></span></div></td><td><strong>${escapeHtml(o.warehouse||'—')}</strong><small>${escapeHtml(o.warehouseRegion||'')}</small></td><td><strong>${escapeHtml(o.destinationCity||'—')}</strong><small>${escapeHtml(o.destinationDistrict||'')}</small></td><td><strong>${fmtMoney(o.price,o.currencyCode)}</strong>${o.buyerPrice!=null&&o.buyerPrice!==o.price?`<small title="Сколько платит покупатель с учётом скидки WB (СПП)">покупатель ${fmtMoney(o.buyerPrice,o.currencyCode)}</small>`:''}</td><td><span class="status ${s[1]}">${s[0]}</span></td><td class="order-id"><small title="${escapeHtml(o.id)}">${escapeHtml(o.id)}</small></td></tr>`}).join('')}
function renderFunnel(){const f=state.funnel;const items=[['Переходы',f.views,'#9d77ff'],['Корзины',f.cart,'#7651e5'],['Заказы',f.orders,'#5635bc'],['Выкупы',f.sales,'#318f68']];const max=Math.max(1,...items.map(x=>Number(x[1]||0)));$('#funnelChart').innerHTML=items.map(x=>`<div class="funnel-row"><label>${x[0]}</label><div class="funnel-bar-wrap"><div class="funnel-bar" style="width:${Math.max(2,Number(x[1]||0)/max*100)}%;background:${x[2]}">${Number(x[1]||0)/max>.15?fmtNum(x[1]):''}</div></div><strong>${fmtNum(x[1])}</strong></div>`).join('');const conv=[['Карточка → корзина',pct(f.cart,f.views)],['Корзина → заказ',pct(f.orders,f.cart)],['Заказ → выкуп',pct(f.sales,f.orders)]];$('#conversionList').innerHTML=conv.map(x=>`<div class="conversion"><div><span>${x[0]}</span><strong>${x[1]}%</strong></div><div class="progress"><i style="width:${Math.min(100,x[1])}%"></i></div></div>`).join('')}

async function loadStocks(force=false){if(!force&&state.stocksKey===state.cabinet&&state.stocks){renderStocks();return}const btn=$('#refresh');btn.classList.add('loading');$('#syncText').textContent='Получаем остатки FBS…';try{const data=await api(`/api/fbs-stocks?cabinet=${encodeURIComponent(state.cabinet)}`);const sameCabinet=state.stocksKey===state.cabinet;state.stocks=data;state.stocksKey=state.cabinet;state.stockSelected=new Set();if(!sameCabinet){state.stockFilters={warehouses:new Set(),categories:new Set(),availability:new Set()};resetStockPage()}state.demo=data.demo;renderStocks();$('#syncText').textContent=`Остатки · ${new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}`;$('#cabinetMode').textContent=data.demo?'Демо-данные':'Единый токен активен';setNotices('stocks','load',data.warnings)}catch(e){$('#syncText').textContent='Ошибка остатков';toast(e.message);addNotice('stocks',`Ошибка загрузки остатков FBS: ${e.message}`)}finally{btn.classList.remove('loading')}}
async function loadFbwStocks(force=false){if(!force&&state.fbwStocksKey===state.cabinet&&state.fbwStocks){renderFbwStocks();return}const btn=$('#refresh');btn.classList.add('loading');$('#syncText').textContent='Получаем остатки FBW…';try{const data=await api(`/api/fbw-stocks?cabinet=${encodeURIComponent(state.cabinet)}`);state.fbwStocks=data;state.fbwStocksKey=state.cabinet;state.fbwFilters={warehouses:new Set(),categories:new Set(),availability:new Set()};state.fbwPage=1;state.demo=data.demo;renderFbwStocks();$('#syncText').textContent=`Остатки FBW · ${new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}`;$('#cabinetMode').textContent=data.demo?'Демо-данные':'Единый токен активен';setNotices('fbw-stocks','load',data.warnings)}catch(e){$('#syncText').textContent='Ошибка остатков FBW';toast(e.message);addNotice('fbw-stocks',`Ошибка загрузки остатков FBW: ${e.message}`)}finally{btn.classList.remove('loading')}}
function setFbwFilterOptions(data){const filters=[['fbwWarehouseOptions',data.warehouses||[],'warehouses','id','name'],['fbwCategoryOptions',(data.categories||[]).map(name=>({id:name,name})),'categories','id','name']];for(const [id,items,key,value,label] of filters){const options=items.map(item=>{const v=String(item[value]);return `<label><input type="checkbox" value="${escapeHtml(v)}" ${state.fbwFilters[key].has(v)?'checked':''}> ${escapeHtml(item[label])}</label>`}).join('');$(`#${id}`).innerHTML=options||'<span class="filter-empty">Нет вариантов</span>';$$(`#${id} input`).forEach(input=>input.onchange=()=>{input.checked?state.fbwFilters[key].add(input.value):state.fbwFilters[key].delete(input.value);state.fbwPage=1;renderFbwStocks()})}$$('#fbwAvailabilityOptions input').forEach(input=>{input.checked=state.fbwFilters.availability.has(input.value);input.onchange=()=>{input.checked?state.fbwFilters.availability.add(input.value):state.fbwFilters.availability.delete(input.value);state.fbwPage=1;renderFbwStocks()}});$('#fbwWarehouseLabel').textContent=state.fbwFilters.warehouses.size?`Склады (${state.fbwFilters.warehouses.size})`:'Склады';$('#fbwCategoryLabel').textContent=state.fbwFilters.categories.size?`Категории (${state.fbwFilters.categories.size})`:'Категории'}
function renderFbwPagination(pageCount){const el=$('#fbwStockPagination');if(!el)return;if(pageCount<=1){el.innerHTML='';el.classList.add('hidden');return}const pages=Array.from({length:pageCount},(_,index)=>index+1);el.classList.remove('hidden');el.innerHTML=`<button type="button" class="stock-page-button" data-fbw-page="prev" ${state.fbwPage===1?'disabled':''}>Назад</button><div class="stock-page-numbers">${pages.map(page=>`<button type="button" class="stock-page-button ${page===state.fbwPage?'active':''}" data-fbw-page="${page}" aria-current="${page===state.fbwPage?'page':'false'}">${page}</button>`).join('')}</div><button type="button" class="stock-page-button" data-fbw-page="next" ${state.fbwPage===pageCount?'disabled':''}>Вперёд</button>`;$$('[data-fbw-page]').forEach(button=>button.onclick=()=>{const target=button.dataset.fbwPage;const page=target==='prev'?state.fbwPage-1:target==='next'?state.fbwPage+1:Number(target);if(!Number.isInteger(page)||page<1||page>pageCount||page===state.fbwPage)return;state.fbwPage=page;renderFbwStocks();document.querySelector('#page-fbw-stocks')?.scrollIntoView({behavior:'smooth',block:'start'})})}
function renderFbwStocks(){const data=state.fbwStocks||{},rows=data.rows||[],t=data.totals||{};const metrics=[['Всего единиц',fmtNum(t.amount),'на складах WB','#7651e5'],['Позиций',fmtNum(t.rows),'товарных позиций','#9d77ff'],['Товаров',fmtNum(t.products),'уникальных товаров','#318f68'],['Складов',fmtNum(t.warehouses),'складов WB','#f0a04b'],['В наличии',fmtNum(t.positive),'позиций с количеством','#318f68'],['Нулевые',fmtNum(t.zero),'позиций без остатка','#e76464']];if(document.querySelector('#fbwStockMetrics'))document.querySelector('#fbwStockMetrics').innerHTML=metrics.map(x=>`<article class="metric" style="--accent:${x[3]}"><div class="metric-label">${x[0]}</div><div class="metric-value">${x[1]}</div><div class="metric-note">${x[2]}</div></article>`).join('');setFbwFilterOptions(data);const term=$('#fbwStockSearch').value.toLowerCase(),filtered=rows.filter(row=>(!state.fbwFilters.warehouses.size||state.fbwFilters.warehouses.has(String(row.warehouseId)))&&(!state.fbwFilters.categories.size||state.fbwFilters.categories.has(row.category))&&(!state.fbwFilters.availability.size||([...state.fbwFilters.availability].includes('positive')&&row.amount>0)||([...state.fbwFilters.availability].includes('zero')&&row.amount===0))&&(!term||[row.name,row.vendorCode,row.nmId,row.sku,row.category,row.warehouseName,row.regionName,row.size].join(' ').toLowerCase().includes(term))).sort((a,b)=>{const key=state.fbwSort.key,av=a[key]??'',bv=b[key]??'';const result=typeof av==='number'&&typeof bv==='number'?av-bv:String(av).localeCompare(String(bv),'ru',{numeric:true,sensitivity:'base'});return state.fbwSort.dir==='asc'?result:-result});const pageCount=Math.ceil(filtered.length/state.fbwPageSize);state.fbwPage=Math.min(Math.max(1,state.fbwPage),Math.max(1,pageCount));const start=(state.fbwPage-1)*state.fbwPageSize,pageRows=filtered.slice(start,start+state.fbwPageSize);$('#fbwStockCount').textContent=`${filtered.length} из ${rows.length} позиций`;$('#emptyFbwStocks').classList.toggle('hidden',filtered.length>0);$('#fbwStocksBody').innerHTML=pageRows.map(row=>`<tr><td class="fbw-product-cell">${row.photo?`<img class="stock-product-photo" src="${escapeHtml(row.photo)}" alt="" loading="lazy">`:''}<strong>${escapeHtml(row.name)}</strong></td><td><strong>${escapeHtml(row.vendorCode||'—')}</strong></td><td><strong>${escapeHtml(row.nmId||'—')}</strong></td><td>${escapeHtml(row.category||'—')}</td><td><strong>${escapeHtml(row.warehouseName||'—')}</strong><small>ID ${escapeHtml(row.warehouseId||'—')}</small></td><td><strong class="stock-amount ${row.amount>0?'in-stock':'out-stock'}">${fmtNum(row.amount)}</strong></td><td>${fmtNum(row.inWayToClient)}</td><td>${fmtNum(row.inWayFromClient)}</td></tr>`).join('');renderFbwPagination(pageCount);$$('#fbwStocksBody .stock-product-photo').forEach(image=>{if(!image.dataset.previewBound){image.dataset.previewBound='1';bindPhotoPreview(image)}});$$('[data-fbw-sort]').forEach(header=>header.onclick=()=>{const key=header.dataset.fbwSort;state.fbwSort=state.fbwSort.key===key?{key,dir:state.fbwSort.dir==='asc'?'desc':'asc'}:{key,dir:key==='amount'?'desc':'asc'};state.fbwPage=1;renderFbwStocks()})}
function stockRowKey(row){return `${row.warehouseId}:${row.chrtId}`}
function stockSelectedRows(){return (state.stocks?.rows||[]).filter(row=>state.stockSelected.has(stockRowKey(row)))}
function setStockFilterOptions(data){const filters=[['stockWarehouseOptions',data.warehouses||[],'warehouses','id','name'],['stockCategoryOptions',(data.categories||[]).map(name=>({id:name,name})),'categories','id','name']];for(const [id,items,key,value,label] of filters){const options=items.map(item=>{const v=String(item[value]);return `<label><input type="checkbox" data-stock-filter="${key}" value="${escapeHtml(v)}" ${state.stockFilters[key].has(v)?'checked':''}> ${escapeHtml(item[label])}</label>`}).join('');$(`#${id}`).innerHTML=options||'<span class="filter-empty">Нет вариантов</span>';$$(`#${id} input`).forEach(input=>input.onchange=()=>{input.checked?state.stockFilters[key].add(input.value):state.stockFilters[key].delete(input.value);resetStockPage();renderStocks()})}$$('#stockAvailabilityOptions input').forEach(input=>{input.checked=state.stockFilters.availability.has(input.value);input.onchange=()=>{input.checked?state.stockFilters.availability.add(input.value):state.stockFilters.availability.delete(input.value);resetStockPage();renderStocks()}});$('#stockWarehouseLabel').textContent=state.stockFilters.warehouses.size?`Склады (${state.stockFilters.warehouses.size})`:'Склады';$('#stockCategoryLabel').textContent=state.stockFilters.categories.size?`Категории (${state.stockFilters.categories.size})`:'Категории'}
function resetStockPage(){state.stockPage=1}
function scrollStocksToTop(){document.querySelector('#page-stocks')?.scrollIntoView({behavior:'smooth',block:'start'})}
function renderStockPagination(pageCount){const el=$('#stockPagination');if(!el)return; if(pageCount<=1){el.innerHTML='';el.classList.add('hidden');return}const pages=Array.from({length:pageCount},(_,index)=>index+1);el.classList.remove('hidden');el.innerHTML=`<button type="button" class="stock-page-button" data-stock-page="prev" ${state.stockPage===1?'disabled':''}>Назад</button><div class="stock-page-numbers">${pages.map(page=>`<button type="button" class="stock-page-button ${page===state.stockPage?'active':''}" data-stock-page="${page}" aria-current="${page===state.stockPage?'page':'false'}">${page}</button>`).join('')}</div><button type="button" class="stock-page-button" data-stock-page="next" ${state.stockPage===pageCount?'disabled':''}>Вперёд</button>`;$$('[data-stock-page]').forEach(button=>button.onclick=()=>{const target=button.dataset.stockPage;const page=target==='prev'?state.stockPage-1:target==='next'?state.stockPage+1:Number(target);if(!Number.isInteger(page)||page<1||page>pageCount||page===state.stockPage)return;state.stockPage=page;renderStocks();scrollStocksToTop()})}
function renderStocks(){const data=state.stocks||{},rows=data.rows||[],t=data.totals||{};const metrics=[['Всего единиц',fmtNum(t.amount),'по складам FBS','#7651e5'],['Позиций',fmtNum(t.rows),'товарных позиций','#9d77ff'],['Товаров',fmtNum(t.products),'уникальных товаров','#318f68'],['Складов',fmtNum(t.warehouses),'с остатками','#f0a04b'],['В наличии',fmtNum(t.positive),'позиций с количеством','#318f68'],['Нулевые',fmtNum(t.zero),'позиций без остатка','#e76464']];$('#stockMetrics').innerHTML=metrics.map(x=>`<article class="metric" style="--accent:${x[3]}"><div class="metric-label">${x[0]}</div><div class="metric-value">${x[1]}</div><div class="metric-note">${x[2]}</div></article>`).join('');setStockFilterOptions(data);const term=$('#stockSearch').value.toLowerCase(),filtered=rows.filter(row=>(!state.stockFilters.warehouses.size||state.stockFilters.warehouses.has(String(row.warehouseId)))&&(!state.stockFilters.categories.size||state.stockFilters.categories.has(row.category))&&(!state.stockFilters.availability.size||([...state.stockFilters.availability].includes('positive')&&row.amount>0)||([...state.stockFilters.availability].includes('zero')&&row.amount===0))&&(!term||[row.name,row.vendorCode,row.nmId,row.sku,row.category,row.warehouseName].join(' ').toLowerCase().includes(term))).sort((a,b)=>{const key=state.stockSort.key,av=a[key]??'',bv=b[key]??'';const result=typeof av==='number'&&typeof bv==='number'?av-bv:String(av).localeCompare(String(bv),'ru',{numeric:true,sensitivity:'base'});return state.stockSort.dir==='asc'?result:-result});const pageCount=Math.ceil(filtered.length/state.stockPageSize);state.stockPage=Math.min(Math.max(1,state.stockPage),Math.max(1,pageCount));const start=(state.stockPage-1)*state.stockPageSize,pageRows=filtered.slice(start,start+state.stockPageSize);$('#stockCount').textContent=`${filtered.length} из ${rows.length} позиций`;$('#emptyStocks').classList.toggle('hidden',filtered.length>0);$('#stockSelectAll').checked=pageRows.length>0&&pageRows.every(row=>state.stockSelected.has(stockRowKey(row)));$('#stocksBody').innerHTML=pageRows.map(row=>`<tr><td class="check-col"><input type="checkbox" data-stock-row="${escapeHtml(stockRowKey(row))}" ${state.stockSelected.has(stockRowKey(row))?'checked':''} aria-label="Выбрать ${escapeHtml(row.name)}"></td><td><strong>${escapeHtml(row.name)}</strong></td><td><strong>${escapeHtml(row.vendorCode||'—')}</strong></td><td><strong>${escapeHtml(row.nmId||'—')}</strong></td><td>${escapeHtml(row.category||'—')}</td><td><strong>${escapeHtml(row.warehouseName||'—')}</strong><small>ID ${escapeHtml(row.warehouseId||'—')}</small></td><td>${escapeHtml(row.sku||'—')}</td><td><strong class="stock-amount ${row.amount>0?'in-stock':'out-stock'}">${fmtNum(row.amount)}</strong></td></tr>`).join('');renderStockPagination(pageCount);$$('[data-stock-row]').forEach(input=>input.onchange=()=>{input.checked?state.stockSelected.add(input.dataset.stockRow):state.stockSelected.delete(input.dataset.stockRow);renderStockActions()});$$('[data-stock-sort]').forEach(header=>header.onclick=()=>{const key=header.dataset.stockSort;state.stockSort=state.stockSort.key===key?{key,dir:state.stockSort.dir==='asc'?'desc':'asc'}:{key,dir:key==='amount'?'desc':'asc'};resetStockPage();renderStocks()});$('#stockSelectAll').onchange=()=>{pageRows.forEach(row=>inputSelection(state.stockSelected,stockRowKey(row),$('#stockSelectAll').checked));renderStocks()};renderStockActions()}function inputSelection(set,key,checked){checked?set.add(key):set.delete(key)}
function renderStockActions(){const count=state.stockSelected.size;$('#stockActions').classList.toggle('hidden',!count);$('#stockSelectedCount').textContent=`Выбрано: ${fmtNum(count)}`}
async function setSelectedStock(){if(state.demo)return toast('В демо-режиме изменение остатков отключено');const amount=Number($('#stockAmountInput').value);if(!Number.isInteger(amount)||amount<0)return toast('Введите целое число не меньше нуля');const items=stockSelectedRows().map(row=>({warehouseId:row.warehouseId,chrtId:row.chrtId,amount}));try{await api('/api/fbs-stocks/update',{method:'POST',body:JSON.stringify({cabinet:state.cabinet,items,confirm:true})});closeModal();toast('Остатки обновлены');await loadStocks(true)}catch(e){toast(e.message)}}
function openSetStock(){openModal(`<p class="eyebrow">Массовое изменение</p><h2>Задать остаток</h2><p>Будет обновлено товаров: ${state.stockSelected.size}. Значение применится к каждой выбранной позиции на её складе.</p><label class="stock-modal-label">Количество<input id="stockAmountInput" type="number" min="0" step="1" value="0"></label><div class="stock-quick-amounts">${[10,20,30,40,50].map(amount=>`<button type="button" data-stock-quick="${amount}">${amount} шт</button>`).join('')}</div><button class="primary" id="confirmSetStock">Сохранить остаток</button>`);$('#confirmSetStock').onclick=setSelectedStock;const amountInput=$('#stockAmountInput'),markQuick=()=>$$('[data-stock-quick]').forEach(button=>button.classList.toggle('active',button.dataset.stockQuick===amountInput.value));$$('[data-stock-quick]').forEach(button=>button.onclick=()=>{amountInput.value=button.dataset.stockQuick;markQuick();amountInput.focus()});amountInput.oninput=markQuick}
function openCopyStock(){if(state.demo)return toast('В демо-режиме копирование отключено');const sourceIds=new Set(stockSelectedRows().map(row=>String(row.warehouseId))),warehouses=(state.stocks?.warehouses||[]).filter(item=>!sourceIds.has(String(item.id)));if(!warehouses.length)return toast('Выберите товары и оставьте доступный другой склад для копирования');openModal(`<div class="stock-target-options"><label class="stock-target-all"><input type="checkbox" id="copyTargetAll"> <span>Выбрать все склады</span></label>${warehouses.map(item=>`<label><input type="checkbox" name="copyTargetWarehouse" value="${escapeHtml(item.id)}"> <span>${escapeHtml(item.name)}</span></label>`).join('')}</div><button class="primary" id="confirmCopyStock">Скопировать остатки</button>`);const targetInputs=()=>$$('input[name="copyTargetWarehouse"]');$('#copyTargetAll').onchange=()=>{targetInputs().forEach(input=>input.checked=$('#copyTargetAll').checked)};targetInputs().forEach(input=>input.onchange=()=>{$('#copyTargetAll').checked=targetInputs().every(item=>item.checked)});$('#confirmCopyStock').onclick=async()=>{const targets=targetInputs().filter(input=>input.checked).map(input=>input.value);if(!targets.length)return toast('Выберите хотя бы один целевой склад');const items=[...new Map(stockSelectedRows().map(row=>[String(row.chrtId),{chrtId:row.chrtId,amount:row.amount}])).values()];try{await api('/api/fbs-stocks/copy',{method:'POST',body:JSON.stringify({cabinet:state.cabinet,targetWarehouseIds:targets,items,confirm:true})});closeModal();toast(`Товары скопированы на складов: ${targets.length}`);await loadStocks(true)}catch(e){toast(e.message)}}}

// Сначала приходят действующие и приостановленные кампании (part=active) — вкладка открывается без ожидания;
// завершённые кампании и остатки бюджета догружаются следом в фоне, и таблицы перерисовываются.
async function loadAds(force=false){const key=[state.cabinet,$('#dateFrom').value,$('#dateTo').value].join(':');if(!force&&state.adsKey===key&&state.ads){renderAds();return}const btn=$('#refresh'),request=state.adsRequest=(state.adsRequest||0)+1;btn.classList.add('loading');$('#syncText').textContent='Получаем рекламу…';try{const q=new URLSearchParams({cabinet:state.cabinet,from:$('#dateFrom').value,to:$('#dateTo').value});const first=await api('/api/advertising?'+q+'&part=active');if(request!==state.adsRequest)return;state.ads=first;state.adsKey=key;state.adsPrev={loading:true};state.demo=state.ads.demo;renderAds();$('#syncText').textContent=`Реклама · ${new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}`;$('#cabinetMode').textContent=state.ads.demo?'Демо-данные':'Единый токен активен';renderAdWarnings();loadAdFunnelOrders(q,key);if(state.ads.partial)loadAdsRest(q,request);else loadAdsPrevious(q,request)}catch(e){$('#syncText').textContent='Ошибка рекламы';toast(e.message);addNotice('ads',`Ошибка загрузки рекламы: ${e.message}`)}finally{btn.classList.remove('loading')}}
async function loadAdsRest(q,request){try{const full=await api('/api/advertising?'+q);if(request!==state.adsRequest)return;state.ads=full;renderAds();renderAdWarnings()}catch(e){if(request!==state.adsRequest)return;state.ads.partialError=e.message;renderAdPartialNote()}if(request===state.adsRequest)loadAdsPrevious(q,request)}
// Третий фоновый шаг: кампании за прошлый период той же длины — для изменений в процентах в «Рекламных кампаниях».
async function loadAdsPrevious(q,request){try{const data=await api('/api/advertising/previous?'+q);if(request!==state.adsRequest)return;state.adsPrev={period:data.period,totals:data.totals||null,byId:new Map((data.campaigns||[]).map(c=>[String(c.id),c]))}}catch(e){if(request!==state.adsRequest)return;state.adsPrev={error:e.message}}renderAds()}
// Изменение итога к прошлому периоду в карточках вкладки «Реклама»; цвет — по смыслу показателя (AD_DELTA_TONE).
function adMetricDelta(key,value){const prev=state.adsPrev,before=Number(prev?.totals?.[key]||0),now=Number(value||0),better=AD_DELTA_TONE[key];if(!prev?.totals||!better)return prev?.loading?'<small class="sales-delta flat metric-delta" title="Загружаем прошлый период">…</small>':'';
  const title=`к ${trendFullDate(prev.period.from)} – ${trendFullDate(prev.period.to)}`;
  if(!before)return now?`<small class="sales-delta flat metric-delta" title="${title}">новое</small>`:'';
  const change=Math.round((now-before)/before*100),tone=!change||better==='neutral'?'flat':(change>0)===(better==='up')?'up':'down';
  return `<small class="sales-delta ${tone} metric-delta" title="${title}">${change?`${change>0?'▲':'▼'} ${fmtNum(Math.abs(change))}%`:'0%'} <span>к прошлому периоду</span></small>`}
// Изменение метрики кампании к прошлому периоду, как в «Товарах в воронке». Для стоимостей (CPC, CPM, CPO, ДРР) рост — красный,
// расход — нейтральный серый: его рост сам по себе не плох и не хорош.
const AD_DELTA_TONE={spend:'neutral',views:'up',clicks:'up',ctr:'up',cpc:'down',cpm:'down',carts:'up',orders:'up',cr:'up',cpo:'down',revenue:'up',drr:'down',roas:'up'};
function adDelta(key,x){
  const better=AD_DELTA_TONE[key],byId=state.adsPrev?.byId;if(!better||!byId)return '';
  if((key==='cpo'&&!Number(x.orders))||(key==='drr'&&!Number(x.revenue)))return '';
  const before=byId.get(String(x.id)),value=Number(x[key]||0),old=before?Number(before[key]||0):0;
  if(!old)return value?'<small class="sales-delta flat">новое</small>':'';
  const change=Math.round((value-old)/old*100);
  if(!change)return '<small class="sales-delta flat">0%</small>';
  const tone=better==='neutral'?'flat':(change>0)===(better==='up')?'up':'down';
  return `<small class="sales-delta ${tone}">${change>0?'▲':'▼'} ${fmtNum(Math.abs(change))}%</small>`;
}
function adCompareNote(){const p=state.adsPrev;if(!p)return '';if(p.loading)return ' · сравнение с прошлым периодом загружается…';if(p.error)return ' · сравнение с прошлым периодом не загрузилось';return ` · изменения к ${trendFullDate(p.period.from)} – ${trendFullDate(p.period.to)}`}
function renderAdWarnings(){setNotices('ads','load',state.ads?.warnings||[])}
function renderAdPartialNote(){const note=$('#adPartialNote'),a=state.ads;if(!note)return;note.classList.toggle('hidden',!a?.partial);if(a?.partial)note.innerHTML=a.partialError?`<span>Не догрузилось</span><p>Завершённые кампании и остатки бюджета: ${escapeHtml(a.partialError)}. Нажмите «Обновить».</p>`:'<span>Догружаем</span><p>Статистика завершённых кампаний и остатки бюджета подгружаются в фоне — итоги и таблицы обновятся сами.</p>'}
const AD_BID_TYPES={unified:'единая',manual:'ручная'};
function adBidType(type){return AD_BID_TYPES[type]||type||''}
// WB отдаёт дату создания по Москве; берём её из строки, чтобы часовой пояс браузера не сдвигал день.
function adCreatedDate(value){const match=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})/);return match?`${match[3]}.${match[2]}.${match[1]}`:'—'}
function adStatus(status){return ({7:['Завершена','status-complete'],9:['Активна','status-new'],11:['На паузе','status-confirm']})[status]||[`Статус ${status??'—'}`,'']}
// --- «Заказы, воронка» в обеих таблицах рекламы: все заказы артикулов по воронке продаж за тот же период ---
// У кампании — сумма по всем её артикулам, у товара — заказы этого артикула. Догружается после рекламы (/api/funnel/orders).
function applyAdFunnelOrders(){const a=state.ads,f=state.adFunnel;if(!a)return;const ready=Boolean(f&&f.key===state.adsKey&&f.orders);
  (a.campaigns||[]).forEach(c=>{c.funnelOrders=ready?(c.nmIds||[]).reduce((sum,id)=>sum+Number(f.orders[id]||0),0):null});
  (a.products||[]).forEach(p=>{p.funnelOrders=ready?Number(f.orders[p.nmId]||0):null})}
// Под числом — доля рекламных заказов во всех заказах по воронке.
function adFunnelCell(x){if(x.funnelOrders==null){const f=state.adFunnel;return f?.key===state.adsKey&&f.error?`<span title="${escapeHtml(f.error)}">—</span>`:'<span title="Загружаем заказы из воронки продаж">…</span>'}
  const share=x.funnelOrders?Math.round(Number(x.orders||0)/x.funnelOrders*100):null;return `${fmtNum(x.funnelOrders)}${share!=null?`<small class="ad-funnel-share" title="Доля рекламных заказов во всех заказах">реклама ${fmtNum(share)}%</small>`:''}`}
async function loadAdFunnelOrders(q,key){state.adFunnel={key,orders:null,error:''};try{const data=await api('/api/funnel/orders?'+q);if(state.adsKey!==key)return;state.adFunnel={key,orders:data.orders||{},error:''}}catch(e){if(state.adsKey!==key)return;state.adFunnel={key,orders:null,error:e.message}}renderAds()}
function renderAds(){const a=state.ads;if(!a)return;applyAdFunnelOrders();renderAdPartialNote();const t=a.totals||{};const metrics=[['Расходы',fmtRub(t.spend),'за выбранный период','#7651e5','spend'],['Выручка с рекламы',fmtRub(t.revenue),`${fmtNum(t.orders)} рекламных заказов`,'#318f68','revenue'],['ДРР',fmtPercent(t.drr),'расходы / рекламная выручка','#e76464','drr'],['CTR',fmtPercent(t.ctr),`${fmtNum(t.clicks)} кликов из ${fmtNum(t.views)} показов`,'#f0a04b','ctr'],['CPC',fmtRub(t.cpc),'средняя цена клика','#9d77ff','cpc'],['ROAS',`${Number(t.roas||0).toLocaleString('ru-RU',{maximumFractionDigits:2})}×`,'выручка на 1 ₽ расходов','#318f68','roas']];$('#adMetrics').innerHTML=metrics.map(x=>`<article class="metric" style="--accent:${x[3]}"><div class="metric-label">${x[0]}</div><div class="metric-value">${x[1]}</div>${adMetricDelta(x[4],t[x[4]])}<div class="metric-note">${x[2]}</div></article>`).join('');renderAdMoneyChart(a.daily||[]);renderAdRateChart(a.daily||[]);renderAdPlatforms(a.platforms||[]);renderAdDetails(t);renderAdCampaigns();renderAdProducts(a.products||[])}
function chartEmpty(){return '<div class="chart-empty">Нет данных за выбранный период</div>'}
function chartLabels(data,width,height,left,bottom){const step=Math.max(1,Math.ceil(data.length/6));return data.map((d,i)=>i%step===0||i===data.length-1?`<text x="${left+i*(width-left-18)/Math.max(1,data.length-1)}" y="${height-bottom+19}" text-anchor="middle">${new Date(d.date+'T00:00:00').toLocaleDateString('ru-RU',{day:'2-digit',month:'short'})}</text>`:'').join('')}
function bindChartHover(el,data,{width,pointX,pointY,tooltipRows}){
  const svg=el.querySelector('svg'),hover=svg?.querySelector('.chart-hover');if(!svg||!hover)return;
  const tooltip=document.createElement('div');tooltip.className='chart-tooltip hidden';el.appendChild(tooltip);
  const move=event=>{const rect=svg.getBoundingClientRect(),viewX=(event.clientX-rect.left)/rect.width*width;let nearest=0,distance=Infinity;data.forEach((item,index)=>{const current=Math.abs(pointX(index)-viewX);if(current<distance){distance=current;nearest=index}});const item=data[nearest],x=pointX(nearest),ys=pointY(item);hover.classList.remove('hidden');hover.querySelector('.hover-line').setAttribute('x1',x);hover.querySelector('.hover-line').setAttribute('x2',x);hover.querySelectorAll('.hover-point').forEach((dot,index)=>{dot.setAttribute('cx',x);dot.setAttribute('cy',ys[index]??ys[0])});tooltip.innerHTML=`<strong>${new Date(item.date+'T00:00:00').toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'})}</strong>${tooltipRows(item).map(row=>`<span><i style="--dot:${row[2]}"></i>${row[0]}<b>${row[1]}</b></span>`).join('')}`;tooltip.classList.remove('hidden');const localX=rect.left-el.getBoundingClientRect().left+(x/width)*rect.width;tooltip.style.left=`${Math.max(105,Math.min(el.clientWidth-105,localX))}px`};
  svg.addEventListener('pointermove',move);svg.addEventListener('pointerleave',()=>{hover.classList.add('hidden');tooltip.classList.add('hidden')});
}
function renderAdMoneyChart(data){
  const el=$('#adMoneyChart');if(!data.length){el.innerHTML=chartEmpty();return}const w=760,h=270,l=56,b=38,top=18,plotH=h-b-top,step=(w-l-22)/Math.max(1,data.length),maxSpend=Math.max(1,...data.map(x=>x.spend)),maxRevenue=Math.max(1,...data.map(x=>x.revenue));const x=i=>l+i*step+step*.43,spendY=d=>top+plotH-d.spend/maxSpend*plotH,revenueY=d=>top+plotH-d.revenue/maxRevenue*plotH;const bars=data.map((d,i)=>{const bh=d.spend/maxSpend*plotH;return `<rect x="${l+i*step+step*.16}" y="${spendY(d)}" width="${Math.max(3,step*.55)}" height="${bh}" rx="3"/>`}).join('');el.innerHTML=`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Расходы и выручка по дням"><g class="grid"><line x1="${l}" y1="${top+plotH}" x2="${w-18}" y2="${top+plotH}"/><line x1="${l}" y1="${top+plotH/2}" x2="${w-18}" y2="${top+plotH/2}"/><line x1="${l}" y1="${top}" x2="${w-18}" y2="${top}"/></g><g class="money-bars">${bars}</g><polyline class="revenue-line" points="${data.map((d,i)=>`${x(i)},${revenueY(d)}`).join(' ')}"/>${data.map((d,i)=>`<circle class="revenue-dot" cx="${x(i)}" cy="${revenueY(d)}" r="3"/>`).join('')}<g class="chart-hover hidden"><line class="hover-line" y1="${top}" y2="${top+plotH}"/><circle class="hover-point spend-hover" r="5"/><circle class="hover-point revenue-hover" r="5"/></g><g class="axis-labels">${chartLabels(data,w,h,l,b)}<text x="5" y="${top+5}">${shortMoney(maxSpend)} расход</text><text x="${w-5}" y="${top+5}" text-anchor="end">${shortMoney(maxRevenue)} выручка</text></g></svg>`;bindChartHover(el,data,{width:w,pointX:x,pointY:d=>[spendY(d),revenueY(d)],tooltipRows:d=>[['Расходы',fmtRub(d.spend),'#8f6bea'],['Выручка',fmtRub(d.revenue),'#40a879'],['Клики',fmtNum(d.clicks),'#7651e5'],['Заказы',fmtNum(d.orders),'#f0a04b']]})}
function renderAdRateChart(data){
  const el=$('#adRateChart');if(!data.length){el.innerHTML=chartEmpty();return}const w=760,h=270,l=48,b=38,top=18,plotH=h-b-top,step=(w-l-22)/Math.max(1,data.length-1),max=Math.max(1,...data.flatMap(x=>[x.ctr,x.drr]))*1.1,x=i=>l+i*step,y=(d,key)=>top+plotH-d[key]/max*plotH,points=key=>data.map((d,i)=>`${x(i)},${y(d,key)}`).join(' ');el.innerHTML=`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="CTR и ДРР по дням"><g class="grid"><line x1="${l}" y1="${top+plotH}" x2="${w-18}" y2="${top+plotH}"/><line x1="${l}" y1="${top+plotH/2}" x2="${w-18}" y2="${top+plotH/2}"/><line x1="${l}" y1="${top}" x2="${w-18}" y2="${top}"/></g><polyline class="ctr-line" points="${points('ctr')}"/><polyline class="drr-line" points="${points('drr')}"/>${data.map((d,i)=>`<circle class="ctr-dot" cx="${x(i)}" cy="${y(d,'ctr')}" r="3"/><circle class="drr-dot" cx="${x(i)}" cy="${y(d,'drr')}" r="3"/>`).join('')}<g class="chart-hover hidden"><line class="hover-line" y1="${top}" y2="${top+plotH}"/><circle class="hover-point ctr-hover" r="5"/><circle class="hover-point drr-hover" r="5"/></g><g class="axis-labels">${chartLabels(data,w,h,l,b)}<text x="5" y="${top+5}">${fmtPercent(max)}</text></g><g class="rate-legend"><text x="${w-155}" y="14">● CTR</text><text x="${w-82}" y="14">● ДРР</text></g></svg>`;bindChartHover(el,data,{width:w,pointX:x,pointY:d=>[y(d,'ctr'),y(d,'drr')],tooltipRows:d=>[['CTR',fmtPercent(d.ctr),'#7651e5'],['ДРР',fmtPercent(d.drr),'#e76464'],['CPC',fmtRub(d.cpc),'#9d77ff'],['CR',fmtPercent(d.cr),'#f0a04b']]})}
function shortMoney(value){return new Intl.NumberFormat('ru-RU',{notation:'compact',maximumFractionDigits:1}).format(value)+' ₽'}
function renderAdPlatforms(items){const total=Math.max(1,...items.map(x=>x.spend));$('#adPlatforms').innerHTML=items.map(x=>`<div class="platform-row"><div><strong>${escapeHtml(x.name)}</strong><span>${fmtPercent(x.spend/(state.ads.totals.spend||1)*100)} расходов</span></div><div class="platform-bar"><i style="width:${x.spend/total*100}%"></i></div><b>${fmtRub(x.spend)}</b><small>${fmtNum(x.clicks)} кликов · ${fmtNum(x.orders)} заказов</small></div>`).join('')}
function renderAdDetails(t){const items=[['Показы',fmtNum(t.views)],['Клики',fmtNum(t.clicks)],['Добавления в корзину',fmtNum(t.carts)],['Рекламные заказы',fmtNum(t.orders)],['Продажи, шт.',fmtNum(t.sales)],['Технические отмены',fmtNum(t.canceled)],['Конверсия клика в заказ',fmtPercent(t.cr)],['CPM',fmtRub(t.cpm)]];$('#adDetails').innerHTML=items.map(x=>`<div class="ad-detail"><span>${x[0]}</span><strong>${x[1]}</strong></div>`).join('')}
// --- Таблица «Рекламные кампании»: набор и порядок столбцов выбираются в фильтре «Столбцы» и запоминаются в браузере ---
// Подсказки к метрикам рекламы — общие для «Рекламных кампаний» и «Товаров в рекламе».
const AD_TIPS={
  cpo:'Средняя стоимость одного заказа.\nРассчитываем по формуле: затраты ÷ количество заказов.',
  cr:'Доля кликов, после которых покупатели заказали товар.\nРассчитываем по формуле: заказы ÷ клики × 100%',
  cpm:'Стоимость тысячи показов.\nРассчитываем по формуле: затраты ÷ показы × 1000.'};
// Страница кампании в кабинете продвижения WB с текущим периодом сайта (формат ссылки взят из кабинета).
function adWbCampaignUrl(id){const from=$('#dateFrom').value,to=$('#dateTo').value,period=/^\d{4}-\d{2}-\d{2}$/.test(from)&&/^\d{4}-\d{2}-\d{2}$/.test(to)?`?from=${from}T00:00:00Z&to=${to}T00:00:00Z`:'';return `https://cmp.wildberries.ru/campaigns/edit/${encodeURIComponent(id)}${period}`}
// Без заказов стоимость заказа не определена — показываем прочерк, а не 0 ₽.
function adCpo(x){return Number(x.orders)?fmtRub(x.cpo):'—'}
function adDateTime(value){const match=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);return match?`<strong>${match[3]}.${match[2]}.${match[1]}</strong>${match[4]?`<small>${match[4]}:${match[5]}</small>`:''}`:'—'}
const AD_CAMPAIGN_COLUMNS=[
  // Детализация открывается иконкой слева, название ведёт в кампанию в кабинете WB, клик по ID копирует его (общий обработчик [data-copy]).
  {key:'name',label:'Кампания',fixed:true,width:295,cell:x=>{const photo=x.photo?`<img class="ad-product-photo" src="${escapeHtml(x.photo)}" alt="" loading="lazy">`:'',query=new URLSearchParams({cabinet:state.cabinet,id:x.id,from:$('#dateFrom').value,to:$('#dateTo').value});return `<div class="ad-product-name"><a class="campaign-open" href="/campaign.html?${query}" target="_blank" rel="noopener noreferrer" title="Открыть детализацию кампании" aria-label="Открыть детализацию кампании «${escapeHtml(x.name)}»"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.75" y="1.75" width="12.5" height="12.5" rx="3"/><path d="M6.25 9.75l3.5-3.5M6.75 6.25h3v3"/></svg></a>${photo}<span><strong><a class="campaign-wb-link" href="${escapeHtml(adWbCampaignUrl(x.id))}" target="_blank" rel="noopener noreferrer" title="Открыть кампанию в кабинете WB">${escapeHtml(x.name)}</a></strong><small><button type="button" class="copy-article" data-copy="${escapeHtml(x.id)}" title="Скопировать ID">ID ${escapeHtml(x.id)}</button> · ${escapeHtml((x.paymentType||'—').toUpperCase())} · ${escapeHtml(adBidType(x.bidType))}</small></span></div>`}},
  {key:'status',width:110,label:'Статус',cell:x=>{const s=adStatus(x.status);return `<span class="status ${s[1]}">${s[0]}</span>`}},
  {key:'createdAt',width:105,label:'Создана',hint:'дата создания',cell:x=>adCreatedDate(x.createdAt)},
  {key:'startedAt',width:105,label:'Запуск',hint:'последний запуск',cell:x=>adDateTime(x.startedAt)},
  {key:'updatedAt',width:105,label:'Изменена',hint:'последнее изменение',cell:x=>adDateTime(x.updatedAt)},
  {key:'budget',width:115,label:'Остаток',hint:'остаток бюджета',cell:x=>x.budget==null?(state.ads?.partial&&!state.ads.partialError&&[9,11].includes(Number(x.status))?'<span title="Остаток бюджета догружается">…</span>':'—'):`<strong class="${Number(x.budget)<=0?'bad-rate':''}">${fmtRub(x.budget)}</strong>`},
  {key:'spend',width:120,label:'Расход',cell:x=>`<strong>${fmtRub(x.spend)}</strong>`},
  {key:'views',width:100,label:'Показы',cell:x=>fmtNum(x.views)},
  {key:'clicks',width:90,label:'Клики',cell:x=>fmtNum(x.clicks)},
  {key:'ctr',width:80,label:'CTR',cell:x=>fmtPercent(x.ctr)},
  {key:'cpc',width:95,label:'CPC',cell:x=>fmtRub(x.cpc)},
  {key:'cpm',width:95,label:'CPM',tip:AD_TIPS.cpm,cell:x=>fmtRub(x.cpm)},
  {key:'carts',width:110,label:'Корзины',hint:'добавления в корзину',cell:x=>fmtNum(x.carts)},
  {key:'orders',width:90,label:'Заказы',cell:x=>fmtNum(x.orders)},
  {key:'funnelOrders',width:145,label:'Заказы, воронка',hint:'все заказы артикулов кампании по воронке продаж — не только с рекламы',cell:x=>adFunnelCell(x)},
  {key:'cr',width:80,label:'CR',tip:AD_TIPS.cr,cell:x=>fmtPercent(x.cr)},
  {key:'cpo',width:100,label:'CPO',tip:AD_TIPS.cpo,cell:x=>adCpo(x)},
  {key:'revenue',width:130,label:'Выручка',cell:x=>`<strong>${fmtRub(x.revenue)}</strong>`},
  {key:'drr',width:80,label:'ДРР',cell:x=>`<strong class="${x.drr>30?'bad-rate':''}">${fmtPercent(x.drr)}</strong>`},
  {key:'roas',width:80,label:'ROAS',cell:x=>`${Number(x.roas||0).toLocaleString('ru-RU',{maximumFractionDigits:2})}×`}];
const AD_COLUMNS_STORAGE='wb-ad-campaign-columns';
// «Кампания» всегда первая; остальные хранятся как [{key,visible}], новые столбцы дописываются в конец видимыми.
function adDefaultColumns(){return AD_CAMPAIGN_COLUMNS.filter(c=>!c.fixed).map(c=>({key:c.key,visible:true}))}
function adColumns(){
  if(state.adColumns)return state.adColumns;
  let saved=[];try{saved=JSON.parse(localStorage.getItem(AD_COLUMNS_STORAGE)||'[]')}catch{}
  const defaults=adDefaultColumns(),known=new Set(defaults.map(c=>c.key));
  const layout=(Array.isArray(saved)?saved:[]).filter(item=>known.has(item?.key)).map(item=>({key:item.key,visible:item.visible!==false}));
  // Столбцы, которых не было в сохранённом наборе, встают после своего соседа по умолчанию, а не в конец.
  defaults.forEach((item,index)=>{if(layout.some(c=>c.key===item.key))return;const before=defaults.slice(0,index).reverse().find(c=>layout.some(l=>l.key===c.key)),at=before?layout.findIndex(l=>l.key===before.key)+1:0;layout.splice(at,0,item)});
  return state.adColumns=layout;
}
function saveAdColumns(){try{localStorage.setItem(AD_COLUMNS_STORAGE,JSON.stringify(state.adColumns))}catch{}}
function adVisibleColumns(){return [AD_CAMPAIGN_COLUMNS[0],...adColumns().filter(c=>c.visible).map(c=>AD_CAMPAIGN_COLUMNS.find(x=>x.key===c.key))]}
function renderAdColumnOptions(){
  const box=$('#adColumnOptions');if(!box)return;
  box.innerHTML=adColumns().map(item=>{const c=AD_CAMPAIGN_COLUMNS.find(x=>x.key===item.key);return `<label class="column-option" draggable="true" data-ad-column="${c.key}"><span class="column-grip" aria-hidden="true" title="Перетащите, чтобы изменить порядок">⋮⋮</span><input type="checkbox" value="${c.key}" ${item.visible?'checked':''}><span class="column-name">${escapeHtml(c.label)}${c.hint?`<small>${escapeHtml(c.hint)}</small>`:''}</span><span class="column-move"><button type="button" data-ad-column-move="-1" aria-label="Выше">↑</button><button type="button" data-ad-column-move="1" aria-label="Ниже">↓</button></span></label>`}).join('')+
    '<button type="button" class="column-reset" data-ad-column-reset>Вернуть столбцы по умолчанию</button>';
  syncAdColumnOptions();
}
// Порядок пунктов меняется перестановкой узлов, а не перерисовкой: иначе клик «теряет» меню и оно закрывается.
function syncAdColumnOptions(){
  const box=$('#adColumnOptions');if(!box)return;const list=adColumns(),reset=box.querySelector('[data-ad-column-reset]');
  list.forEach((item,index)=>{const label=box.querySelector(`[data-ad-column="${item.key}"]`);if(!label)return;box.insertBefore(label,reset);label.querySelector('input').checked=item.visible;label.querySelector('[data-ad-column-move="-1"]').disabled=index===0;label.querySelector('[data-ad-column-move="1"]').disabled=index===list.length-1});
  $('#adColumnsLabel').textContent=`Столбцы (${list.filter(c=>c.visible).length+1}/${list.length+1})`;
}
function placeAdColumn(key,targetKey,after){
  if(key===targetKey)return;const item=adColumns().find(c=>c.key===key);if(!item)return;
  const list=state.adColumns.filter(c=>c.key!==key),index=list.findIndex(c=>c.key===targetKey);if(index<0)return;
  list.splice(index+(after?1:0),0,item);state.adColumns=list;saveAdColumns();syncAdColumnOptions();renderAdCampaigns();
}
function renderAdCampaignsHead(){
  const table=$('#adCampaignsTable'),columns=adVisibleColumns(),key=columns.map(c=>c.key).join(',');
  if(!table||table.dataset.columns===key)return;
  if(!$('#adColumnOptions').children.length)renderAdColumnOptions();
  table.dataset.columns=key;table.dataset.widthKey='adCampaigns';table.dataset.resizable='';table.removeAttribute('style');
  $('#adCampaignsHead').innerHTML=columns.map(c=>{const title=c.tip||(c.hint?c.hint[0].toUpperCase()+c.hint.slice(1):'');return `<th data-ad-sort="${c.key}" data-col-key="${c.key}" data-col-width="${c.width}"${title?` title="${escapeHtml(title)}"`:''}${c.tip?' class="has-tip"':''}>${escapeHtml(c.label)} ↕</th>`}).join('');
  initResizableTables(table.parentNode);
}
function renderAdCampaigns(){renderAdCampaignsHead();const columns=adVisibleColumns(),items=state.ads?.campaigns||[],term=$('#adSearch').value.toLowerCase();const rows=items.filter(x=>state.adStatuses.has(String(x.status))&&(!term||`${x.name} ${x.id}`.toLowerCase().includes(term))).sort((a,b)=>{const key=state.adSort.key,av=a[key]??'',bv=b[key]??'',result=typeof av==='number'&&typeof bv==='number'?av-bv:String(av).localeCompare(String(bv),'ru',{numeric:true});return state.adSort.dir==='asc'?result:-result});$('#adCampaignCount').textContent=`${rows.length} из ${items.length} кампаний${adCompareNote()}`;$('#emptyAds').classList.toggle('hidden',rows.length>0);$('#adCampaignsBody').innerHTML=rows.map(x=>`<tr data-campaign-id="${escapeHtml(x.id)}">${columns.map(c=>`<td>${c.cell(x)}${adDelta(c.key,x)}</td>`).join('')}</tr>`).join('');bindAdPhotoPreviews('#adCampaignsBody');$$('[data-ad-sort]').forEach(header=>header.onclick=()=>{const key=header.dataset.adSort;state.adSort=state.adSort.key===key?{key,dir:state.adSort.dir==='asc'?'desc':'asc'}:{key,dir:'desc'};renderAdCampaigns()}) }
document.addEventListener('change',event=>{
  const input=event.target.closest?.('#adColumnOptions input[type="checkbox"]');if(!input)return;
  const item=adColumns().find(c=>c.key===input.value);if(!item)return;
  item.visible=input.checked;saveAdColumns();syncAdColumnOptions();renderAdCampaigns();
});
document.addEventListener('click',event=>{
  const move=event.target.closest('[data-ad-column-move]');
  if(move){event.preventDefault();const list=adColumns(),key=move.closest('[data-ad-column]').dataset.adColumn,index=list.findIndex(c=>c.key===key),step=Number(move.dataset.adColumnMove),target=list[index+step];if(target)placeAdColumn(key,target.key,step>0);return}
  if(event.target.closest('[data-ad-column-reset]')){state.adColumns=adDefaultColumns();saveAdColumns();syncAdColumnOptions();renderAdCampaigns()}
});
// Перетаскивание пунктов в фильтре «Столбцы»: линия показывает, куда встанет столбец.
const adColumnDrag={key:''};
function clearAdColumnDrop(){$$('.column-option').forEach(item=>item.classList.remove('dragging','drop-before','drop-after'))}
document.addEventListener('dragstart',event=>{const item=event.target.closest?.('[data-ad-column]');if(!item)return;adColumnDrag.key=item.dataset.adColumn;event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',adColumnDrag.key);item.classList.add('dragging')});
document.addEventListener('dragover',event=>{const item=event.target.closest?.('[data-ad-column]');if(!item||!adColumnDrag.key)return;event.preventDefault();const rect=item.getBoundingClientRect(),after=event.clientY>rect.top+rect.height/2;$$('.column-option').forEach(option=>option.classList.remove('drop-before','drop-after'));if(item.dataset.adColumn!==adColumnDrag.key)item.classList.add(after?'drop-after':'drop-before')});
document.addEventListener('drop',event=>{const item=event.target.closest?.('[data-ad-column]');if(!item||!adColumnDrag.key)return;event.preventDefault();const rect=item.getBoundingClientRect();placeAdColumn(adColumnDrag.key,item.dataset.adColumn,event.clientY>rect.top+rect.height/2);clearAdColumnDrop();adColumnDrag.key=''});
document.addEventListener('dragend',()=>{clearAdColumnDrop();adColumnDrag.key=''});
// Кампании каждого товара: строки productDaily (кампания × артикул × день) складываются по паре «артикул + кампания».
// Показываем только кампании, где у артикула за период были показы или расход; внутри товара — по убыванию расхода.
const adProductCampaignCache=new WeakMap();
function adProductCampaigns(ads){if(!ads)return new Map();if(adProductCampaignCache.has(ads))return adProductCampaignCache.get(ads);const campaigns=new Map((ads.campaigns||[]).map(c=>[String(c.id),c])),pairs=new Map();
  for(const row of ads.productDaily||[]){if(row.advertId===undefined)continue;const key=`${row.nmId}:${row.advertId}`;let pair=pairs.get(key);if(!pair){pair={nmId:row.nmId,advertId:row.advertId,views:0,clicks:0,spend:0,carts:0,orders:0,revenue:0};pairs.set(key,pair)}['views','clicks','spend','carts','orders','revenue'].forEach(k=>pair[k]+=Number(row[k]||0))}
  const byProduct=new Map();for(const pair of pairs.values()){if(!pair.views&&!pair.spend)continue;const c=campaigns.get(String(pair.advertId))||{},ratio=(a,b,m=100)=>b?a/b*m:0;const row={...pair,name:c.name||`Кампания #${pair.advertId}`,status:c.status,paymentType:c.paymentType,bidType:c.bidType,ctr:ratio(pair.clicks,pair.views),cpm:ratio(pair.spend,pair.views,1000),cr:ratio(pair.orders,pair.clicks),cpo:ratio(pair.spend,pair.orders,1),drr:ratio(pair.spend,pair.revenue)};const key=String(pair.nmId);if(!byProduct.has(key))byProduct.set(key,[]);byProduct.get(key).push(row)}
  byProduct.forEach(list=>list.sort((a,b)=>b.spend-a.spend));adProductCampaignCache.set(ads,byProduct);return byProduct}
// nested — строка кампании внутри товара: заказы воронки относятся к товару целиком, у кампании их нет.
function adProductMetricCells(x,nested=false){return `<td>${fmtRub(x.spend)}</td><td>${fmtNum(x.views)}</td><td>${fmtNum(x.clicks)}</td><td>${fmtPercent(x.ctr)}</td><td>${fmtRub(x.cpm)}</td><td>${fmtNum(x.carts)}</td><td>${fmtNum(x.orders)}</td><td>${nested?'':adFunnelCell(x)}</td><td>${fmtPercent(x.cr)}</td><td>${adCpo(x)}</td><td>${fmtRub(x.revenue)}</td><td>${fmtPercent(x.drr)}</td>`}
function adProductCampaignRow(x){const s=adStatus(x.status),query=new URLSearchParams({cabinet:state.cabinet,id:x.advertId,from:$('#dateFrom').value,to:$('#dateTo').value});return `<tr class="ad-product-campaign"><td><div class="ad-product-campaign-name"><span><strong><a href="/campaign.html?${query}" target="_blank" rel="noopener noreferrer" title="Открыть детализацию кампании">${escapeHtml(x.name)}</a></strong><small><button type="button" class="copy-article" data-copy="${escapeHtml(x.advertId)}" title="Скопировать ID">ID ${escapeHtml(x.advertId)}</button> · <span class="status ${s[1]}">${s[0]}</span>${x.paymentType?` · ${escapeHtml(x.paymentType.toUpperCase())}`:''}</small></span></div></td>${adProductMetricCells(x,true)}</tr>`}
function renderAdProducts(items){const rows=[...items].sort((a,b)=>{const key=state.adProductSort.key,av=a[key]??'',bv=b[key]??'',result=typeof av==='number'&&typeof bv==='number'?av-bv:String(av).localeCompare(String(bv),'ru',{numeric:true});return state.adProductSort.dir==='asc'?result:-result});const byProduct=adProductCampaigns(state.ads);$('#adProductsBody').innerHTML=rows.length?rows.map(x=>{const photo=x.photo?`<img class="ad-product-photo" src="${escapeHtml(x.photo)}" alt="" loading="lazy">`:'',key=String(x.nmId),campaigns=byProduct.get(key)||[],open=campaigns.length&&state.adProductOpen.has(key);const toggle=campaigns.length?`<button type="button" class="ad-product-toggle" data-ad-product-toggle="${escapeHtml(key)}" aria-expanded="${open?'true':'false'}" title="Кампании с этим товаром: ${campaigns.length}" aria-label="Кампании с товаром ${escapeHtml(key)}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5l4.5 4.5L6 12.5"/></svg></button>`:'<i class="ad-product-toggle-stub"></i>';return `<tr${open?' class="ad-product-open"':''}><td><div class="ad-product-name">${toggle}${photo}<span><strong>${escapeHtml(x.name)}</strong><small><button class="copy-article" data-copy="${escapeHtml(x.nmId||'')}">Арт. WB ${escapeHtml(x.nmId||'—')}</button>${x.vendorCode?` · <button class="copy-article" data-copy="${escapeHtml(x.vendorCode)}">${escapeHtml(x.vendorCode)}</button>`:''}${x.barcode?` · <button class="copy-article" data-copy="${escapeHtml(x.barcode)}">${escapeHtml(x.barcode)}</button>`:''}</small></span></div></td>${adProductMetricCells(x)}</tr>${open?campaigns.map(adProductCampaignRow).join(''):''}`}).join(''):'<tr><td colspan="13" class="empty-row">WB не вернул детализацию по товарам за этот период</td></tr>';bindAdPhotoPreviews('#adProductsBody');$('#adProductsBody').onclick=event=>{const button=event.target.closest('[data-ad-product-toggle]');if(!button)return;const key=button.dataset.adProductToggle;if(state.adProductOpen.has(key))state.adProductOpen.delete(key);else state.adProductOpen.add(key);renderAdProducts(items)};$$('[data-ad-product-sort]').forEach(header=>{const tip=AD_TIPS[header.dataset.adProductSort];if(tip){header.title=tip;header.classList.add('has-tip')}});$$('[data-ad-product-sort]').forEach(header=>header.onclick=()=>{const key=header.dataset.adProductSort;state.adProductSort=state.adProductSort.key===key?{key,dir:state.adProductSort.dir==='asc'?'desc':'asc'}:{key,dir:'desc'};renderAdProducts(items)})}
function pct(a,b){return b?Math.round(Number(a||0)/Number(b)*100):0}
function formatDate(v){if(!v)return 'Дата неизвестна';const d=new Date(v);return Number.isNaN(d.getTime())?v:d.toLocaleString('ru-RU',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}
function escapeHtml(v){return String(v??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}

// wide — широкое окно (окно товара с графиком истории цены); остальные окна остаются обычной ширины.
function openModal(html,wide=false){$('#modalContent').innerHTML=html;$('#modal .modal-card').classList.toggle('modal-wide',wide);$('#modal').classList.add('open')}
function openCampaignModal(campaign){if(!campaign)return;const s=adStatus(campaign.status),photo=campaign.photo?`<img class="campaign-modal-photo" src="${escapeHtml(campaign.photo)}" alt="">`:'';openModal(`${photo}<p class="eyebrow">Рекламная кампания</p><h2>${escapeHtml(campaign.name||`Кампания #${campaign.id}`)}</h2><div class="campaign-details"><div><span>ID кампании</span><b>${escapeHtml(campaign.id)}</b></div><div><span>Статус</span><b>${s[0]}</b></div><div><span>Тип оплаты</span><b>${escapeHtml((campaign.paymentType||'—').toUpperCase())}</b></div><div><span>Тип ставки</span><b>${escapeHtml(adBidType(campaign.bidType)||'—')}</b></div><div><span>Расход</span><b>${fmtRub(campaign.spend)}</b></div><div><span>Показы</span><b>${fmtNum(campaign.views)}</b></div><div><span>Клики / CTR</span><b>${fmtNum(campaign.clicks)} · ${fmtPercent(campaign.ctr)}</b></div><div><span>Заказы / выручка</span><b>${fmtNum(campaign.orders)} · ${fmtRub(campaign.revenue)}</b></div><div><span>ДРР / ROAS</span><b>${fmtPercent(campaign.drr)} · ${Number(campaign.roas||0).toLocaleString('ru-RU',{maximumFractionDigits:2})}×</b></div></div>`)}
function closeModal(){$('#modal').classList.remove('open')}


function loadCurrentPage(force=false){if(state.activePage==='summary')return loadSummary(force);if(state.activePage==='ads')return loadAds(force);if(state.activePage==='stocks')return loadStocks(force);if(state.activePage==='fbw-stocks')return loadFbwStocks(force);if(state.activePage==='prices')return loadPrices(force);if(state.activePage==='fbs-orders')return loadFbsOrders(force);if(state.activePage==='funnel')return loadFunnelDetails();if(state.activePage==='ratings')return loadRatings(force);if(state.activePage==='orders')loadOrdersHourly();return loadDashboard()}
document.addEventListener('click', event => { if (!event.target.closest('.multi-filter')) $$('.multi-filter[open]').forEach(filter => { filter.removeAttribute('open'); }); });
document.addEventListener('click', event => { const option=event.target.closest('.cab-option'); if(option){const cabinet=$('#cabinetButton');cabinet.classList.remove('switching');void cabinet.offsetWidth;cabinet.classList.add('switching');setTimeout(()=>cabinet.classList.remove('switching'),650);} });
function bindPhotoPreview(image){image.addEventListener('mouseenter',()=>{const rect=image.getBoundingClientRect(),preview=document.createElement('img');preview.className='product-photo-preview';preview.src=image.currentSrc||image.src;preview.alt=image.alt||'';document.body.append(preview);const width=preview.offsetWidth,height=preview.offsetHeight;const left=Math.min(Math.max(8,rect.right+10),window.innerWidth-width-8);const top=Math.min(Math.max(8,rect.top+(rect.height-height)/2),window.innerHeight-height-8);preview.style.left=`${left}px`;preview.style.top=`${top}px`;image._photoPreview=preview}, {once:false});image.addEventListener('mouseleave',()=>{image._photoPreview?.remove();image._photoPreview=null})}
function bindAdPhotoPreviews(selector){$$(`${selector} .ad-product-photo`).forEach(image=>{if(image.dataset.previewBound)return;image.dataset.previewBound='1';bindPhotoPreview(image)})}
const stockObserver=new MutationObserver(()=>{const body=$('#stocksBody');if(!body)return;body.querySelectorAll('[data-stock-row]').forEach(input=>{const row=input.closest('tr'),data=(state.stocks?.rows||[]).find(item=>stockRowKey(item)===input.dataset.stockRow);if(!row||row.dataset.decorated==='1'||!data)return;row.dataset.decorated='1';const productCell=row.children[1];if(data.photo){const image=document.createElement('img');image.className='stock-product-photo';image.src=data.photo;image.alt='';image.loading='lazy';bindPhotoPreview(image);productCell.prepend(image)}[row.children[2],row.children[3],row.children[6]].forEach(cell=>{const value=cell.textContent.trim(),button=document.createElement('button');button.className='copy-article';button.textContent=value;button.title='Скопировать';button.dataset.copy=value;cell.textContent='';cell.append(button)})})});
setTimeout(()=>{const body=$('#stocksBody');if(body)stockObserver.observe(body,{childList:true});},0);
const articleObserver=new MutationObserver(()=>{$$('#pricesBody tr').forEach(row=>{if(row.dataset.copyReady)return;row.dataset.copyReady='1';[row.children[2],row.children[3]].forEach(cell=>{if(!cell)return;const value=cell.textContent.trim();cell.innerHTML=`<button class="copy-article" data-copy="${escapeHtml(value)}">${escapeHtml(value)}</button>`})});$$('#ordersBody tr').forEach(row=>{if(row.dataset.copyReady)return;const id=row.querySelector('.order-id small')?.textContent,data=state.orders.find(item=>String(item.id)===id),small=row.children[2]?.querySelector('.product small');if(!data||!small)return;row.dataset.copyReady='1';small.innerHTML=`${data.brand?`${escapeHtml(data.brand)} · `:''}<button class="copy-article" data-copy="${escapeHtml(data.article||'')}">${escapeHtml(data.article||'—')}</button> · <button class="copy-article" data-copy="${escapeHtml(data.nmId||'')}">Арт. WB ${escapeHtml(data.nmId||'—')}</button>${data.barcode?` · <button class="copy-article" data-copy="${escapeHtml(data.barcode)}">${escapeHtml(data.barcode)}</button>`:''}`})});
setTimeout(()=>{['pricesBody','ordersBody'].forEach(id=>{const body=$(`#${id}`);if(body)articleObserver.observe(body,{childList:true})})},0);
document.addEventListener('click',event=>{const button=event.target.closest('[data-copy]');if(button)navigator.clipboard.writeText(button.dataset.copy).then(()=>toast('Скопировано в буфер обмена'))});
// defaultPrevented — признак перехода внутри страницы: при открытии пункта в новой вкладке текущая вкладка ничего не грузит.
document.addEventListener('click',event=>{if(event.defaultPrevented&&event.target.closest('.nav-item[data-page="funnel"]'))setTimeout(loadFunnelDetails,50)});
const refreshObserver=new MutationObserver(()=>$('#loadingOverlay')?.classList.toggle('visible',$('#refresh')?.classList.contains('loading')));
setTimeout(()=>{const refresh=$('#refresh');if(refresh)refreshObserver.observe(refresh,{attributes:true,attributeFilter:['class']});},0);
setTimeout(()=>{const from=$('#dateFrom'),to=$('#dateTo'),month=$('#adMonth');from.onchange=to.onchange=()=>{state.adsKey=''};month.onchange=()=>{if(!month.value)return;if(month.value==='last31'){from.value=mskDate(-30);to.value=mskDate(0)}else{const [year,number]=month.value.split('-').map(Number),last=new Date(year,number,0);from.value=`${year}-${String(number).padStart(2,'0')}-01`;to.value=`${year}-${String(number).padStart(2,'0')}-${String(last.getDate()).padStart(2,'0')}`}state.adsKey='';loadAds(true)};$$('#adStatusOptions input').forEach(input=>input.onchange=()=>{input.checked?state.adStatuses.add(input.value):state.adStatuses.delete(input.value);$('#adStatusLabel').textContent=`Статусы (${state.adStatuses.size})`;renderAdCampaigns()});document.addEventListener('click',event=>{const nav=event.target.closest('.nav-item');if(nav&&event.defaultPrevented)month.classList.toggle('hidden',nav.dataset.page!=='ads')})},0);
// Обычный клик по пункту меню переключает вкладку без перезагрузки и записывает её в адрес (обновление страницы её сохранит).
// Ctrl/Shift/Cmd+клик браузер открывает сам в новой вкладке или окне; колесо мыши click вообще не вызывает.
function bind(){$$('.nav-item').forEach(b=>b.onclick=event=>{if(event&&(event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey))return;event?.preventDefault();history.replaceState(null,'',`?page=${b.dataset.page}`);state.activePage=b.dataset.page;toggleNotices(false);$$('.nav-item').forEach(x=>x.classList.toggle('active',x===b));$$('.page').forEach(x=>x.classList.toggle('active',x.id===`page-${b.dataset.page}`));$('#pageTitle').textContent={summary:'Общая сводка',orders:'Лента заказов','fbs-orders':'Новые заказы FBS',stocks:'Остатки FBS','fbw-stocks':'Остатки FBW',prices:'Цены и скидки',funnel:'Воронка продаж',ratings:'Оценки товаров',ads:'Аналитика рекламы'}[b.dataset.page];document.title=`${$('#pageTitle').textContent} — WB Pulse`;const noPeriod=['stocks','fbw-stocks','fbs-orders','prices'].includes(b.dataset.page);$('.date').classList.toggle('hidden',noPeriod);$('#funnelRefetch').classList.toggle('hidden',b.dataset.page!=='funnel');if(b.dataset.page==='summary')loadSummary();if(b.dataset.page==='orders'){loadOrdersHourly();if(state.dashboardKey!==[state.cabinet,$('#dateFrom').value,$('#dateTo').value].join(':'))loadDashboard()}if(b.dataset.page==='ads')loadAds();if(b.dataset.page==='ratings')loadRatings();if(b.dataset.page==='stocks')loadStocks();if(b.dataset.page==='fbw-stocks')loadFbwStocks();if(b.dataset.page==='prices')loadPrices();if(b.dataset.page==='fbs-orders')loadFbsOrders()});$('#refresh').onclick=()=>loadCurrentPage(true);$('#funnelRefetch').onclick=openFunnelRefetch;$('#dateFrom').onchange=()=>{state.adsKey='';loadCurrentPage()};$('#dateTo').onchange=()=>{state.adsKey='';loadCurrentPage()};$('#search').oninput=renderOrders;$('#statusFilter').onchange=renderOrders;$('#adSearch').oninput=renderAdCampaigns;$('#adStatus').onchange=renderAdCampaigns;$('#stockSearch').oninput=()=>{resetStockPage();renderStocks()};$('#fbwStockSearch').oninput=()=>{state.fbwPage=1;renderFbwStocks()};$('#setStockButton').onclick=openSetStock;$('#stockPresetsButton').onclick=openStockPresets;$('#copyStockButton').onclick=openCopyStock;$('#clearStockSelection').onclick=()=>{state.stockSelected.clear();renderStocks()};$('#priceSearch').oninput=()=>{resetPricePage();renderPrices()};$('#setPriceButton').onclick=openSetPrices;$('#pricePresetsButton').onclick=openPricePresets;$('#clearPriceSelection').onclick=()=>{state.priceSelected.clear();renderPrices()};$('#cabinetButton').onclick=()=>$('#cabinetMenu').classList.toggle('open');$('#renameCabinet').onclick=()=>{const c=state.cabinets.find(x=>x.id===state.cabinet);if(!c.configured)return toast('Демо-кабинет переименовать нельзя');openModal(`<p class="eyebrow">Настройки кабинета</p><h2>Новое название</h2><input id="renameInput" maxlength="60" value="${escapeHtml(c.name)}"><button class="primary" id="saveName">Сохранить</button>`);setTimeout(()=>$('#renameInput').focus(),0);$('#saveName').onclick=async()=>{try{const name=$('#renameInput').value.trim();await api(`/api/cabinets/${c.id}`,{method:'PATCH',body:JSON.stringify({name})});c.name=name;renderCabinets();closeModal();toast('Название сохранено')}catch(e){toast(e.message)}}};$('#modalClose').onclick=closeModal;$('#modal').onclick=e=>{if(e.target===$('#modal'))closeModal()};bindFbsOrders()}

function initResizableTables(root=document){root.querySelectorAll('table').forEach((table,tableIndex)=>{if(table.dataset.resizable==='1')return;const headers=[...table.querySelectorAll('thead th')];if(!headers.length)return;table.dataset.resizable='1';table.classList.add('resizable-table');const bodyId=table.querySelector('tbody[id]')?.id||`table-${tableIndex}`,storageKey=`wb-column-widths:${table.dataset.widthKey||bodyId}`;const keyed=headers.every(header=>header.dataset.colKey);let saved=[];try{saved=JSON.parse(localStorage.getItem(storageKey)||(keyed?'{}':'[]'))}catch{}// Таблицы с ключами у заголовков хранят ширину по ключу столбца: так она переживает скрытие и перестановку столбцов.
if(keyed){const map=saved&&!Array.isArray(saved)?saved:{};saved=headers.map(header=>Number(map[header.dataset.colKey])||Number(header.dataset.colWidth)||120)}if(saved.length===headers.length&&saved.every(Number.isFinite)){headers.forEach((header,index)=>header.style.width=`${saved[index]}px`);const total=saved.reduce((sum,width)=>sum+width,0);table.style.width=`${total}px`;table.style.minWidth=`${total}px`;table.style.tableLayout='fixed'}headers.forEach((header,index)=>{const handle=document.createElement('span');handle.className='column-resizer';handle.title='Потяните, чтобы изменить ширину';handle.setAttribute('aria-hidden','true');handle.onclick=event=>{event.preventDefault();event.stopPropagation()};handle.onpointerdown=event=>{if(event.button!==0)return;event.preventDefault();event.stopPropagation();const widths=headers.map(item=>Math.round(item.getBoundingClientRect().width));if(!widths[index])return;headers.forEach((item,column)=>item.style.width=`${widths[column]}px`);const startX=event.clientX,startWidth=widths[index],startTotal=widths.reduce((sum,width)=>sum+width,0);table.style.width=`${startTotal}px`;table.style.minWidth=`${startTotal}px`;table.style.tableLayout='fixed';document.body.classList.add('resizing-column');const move=moveEvent=>{const width=Math.max(48,Math.round(startWidth+moveEvent.clientX-startX)),delta=width-startWidth;header.style.width=`${width}px`;table.style.width=`${startTotal+delta}px`;table.style.minWidth=`${startTotal+delta}px`};const stop=()=>{document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',stop);document.removeEventListener('pointercancel',stop);document.body.classList.remove('resizing-column');const current=headers.map(item=>Math.round(item.getBoundingClientRect().width));if(keyed){let map={};try{map=JSON.parse(localStorage.getItem(storageKey)||'{}')}catch{}if(!map||Array.isArray(map))map={};headers.forEach((item,column)=>map[item.dataset.colKey]=current[column]);map[header.dataset.colKey]=current[index];localStorage.setItem(storageKey,JSON.stringify(map))}else localStorage.setItem(storageKey,JSON.stringify(current))};document.addEventListener('pointermove',move);document.addEventListener('pointerup',stop,{once:true});document.addEventListener('pointercancel',stop,{once:true})};header.append(handle)})})}
const tableObserver=new MutationObserver(()=>initResizableTables());
async function init(){setDates();bind();initResizableTables();tableObserver.observe(document.body,{childList:true,subtree:true});try{await loadCabinets();const page=new URLSearchParams(location.search).get('page');if(page!=='orders')loadDashboard(true);if(['orders','funnel','fbs-orders','stocks','fbw-stocks','prices','ratings','ads'].includes(page))$(`.nav-item[data-page="${page}"]`).click();else loadSummary()}catch(e){toast(e.message)}}init();

// Состояние снимков цен с GitHub Actions: сколько скачано на компьютер и когда последний (время в имени файла — московское).
async function loadPriceSnapshotNote(){const el=$('#priceSnapshotNote'),take=$('#priceSnapshotTake');if(!el)return;take.classList.toggle('hidden',Boolean(state.demo));try{const data=await api('/api/price-snapshots');const count=data.cabinets.reduce((sum,item)=>sum+item.count,0),last=data.cabinets.map(item=>item.last).filter(Boolean).sort().pop();const when=last?`${last.slice(8,10)}.${last.slice(5,7)} ${last.slice(11,13)}:${last.slice(14,16)} МСК`:'';el.textContent=(count?`Снимки цен: ${fmtNum(count)} · последний ${when}`:data.enabled?'Снимки цен: пока нет — GitHub делает их каждые 3 часа, сервер забирает раз в час':'Снимков цен пока нет')+(data.sync.lastError?' · ошибка синхронизации (см. уведомления)':'');el.classList.toggle('error',Boolean(data.sync.lastError));setNotices('prices','snapshots',data.sync.lastError?[`Снимки цен с GitHub: ${data.sync.lastError}`]:[],'error')}catch{el.textContent=''}}
// «Снять цены сейчас»: сервер берёт текущие цены выбранного кабинета и сразу сохраняет снимок на компьютере.
async function takePriceSnapshot(){const button=$('#priceSnapshotTake');button.disabled=true;button.textContent='Снимаем…';try{const data=await api('/api/price-snapshots/take',{method:'POST',body:JSON.stringify({cabinet:state.cabinet})});toast(`Снимок цен сохранён: ${fmtNum(data.goods)} ${pluralRu(data.goods,['товар','товара','товаров'])}`);loadPriceSnapshotNote()}catch(e){toast(e.message)}finally{button.disabled=false;button.textContent='Снять цены сейчас'}}
document.addEventListener('click',event=>{if(event.target.closest('#priceSnapshotTake'))takePriceSnapshot()});
async function loadPrices(force=false){if(!force&&state.pricesKey===state.cabinet&&state.prices){renderPrices();return}const btn=$('#refresh');btn.classList.add('loading');$('#syncText').textContent='Получаем цены и скидки…';try{const data=await api(`/api/prices?cabinet=${encodeURIComponent(state.cabinet)}`);state.prices=data;state.pricesKey=state.cabinet;state.priceSelected=new Set();state.priceFilters={categories:new Set(),brands:new Set(),discounts:new Set()};resetPricePage();state.demo=data.demo;renderPrices();loadPriceStocks(force);loadPriceSnapshotNote();$('#syncText').textContent=`Цены · ${new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}`;setNotices('prices','load',data.warnings)}catch(e){$('#syncText').textContent='Ошибка загрузки цен';toast(e.message);addNotice('prices',`Ошибка загрузки цен: ${e.message}`)}finally{btn.classList.remove('loading')}}
function priceFilterOptions(){const data=state.prices||{};for(const [id,items,key] of [['priceCategoryOptions',data.categories||[],'categories'],['priceBrandOptions',data.brands||[],'brands']]){$(`#${id}`).innerHTML=items.map(value=>`<label><input type="checkbox" value="${escapeHtml(value)}" ${state.priceFilters[key].has(String(value))?'checked':''}> ${escapeHtml(value)}</label>`).join('')||'<span class="filter-empty">Нет вариантов</span>';$$(`#${id} input`).forEach(input=>input.onchange=()=>{input.checked?state.priceFilters[key].add(input.value):state.priceFilters[key].delete(input.value);resetPricePage();renderPrices()})}$$('#priceDiscountOptions input').forEach(input=>{input.checked=state.priceFilters.discounts.has(input.value);input.onchange=()=>{input.checked?state.priceFilters.discounts.add(input.value):state.priceFilters.discounts.delete(input.value);resetPricePage();renderPrices()}});$('#priceCategoryLabel').textContent=state.priceFilters.categories.size?`Категории (${state.priceFilters.categories.size})`:'Категории';$('#priceBrandLabel').textContent=state.priceFilters.brands.size?`Бренды (${state.priceFilters.brands.size})`:'Бренды';$('#priceDiscountLabel').textContent=state.priceFilters.discounts.size?`Скидки (${state.priceFilters.discounts.size})`:'Скидки'}
function priceRows(){const term=$('#priceSearch').value.toLowerCase(),f=state.priceFilters;return (state.prices?.rows||[]).filter(row=>(!f.categories.size||f.categories.has(row.category))&&(!f.brands.size||f.brands.has(row.brand))&&(!f.discounts.size||(f.discounts.has('discounted')&&row.discount>0)||(f.discounts.has('none')&&row.discount===0)||(f.discounts.has('club')&&row.clubDiscount>0))&&(!term||[row.name,row.vendorCode,row.nmId,row.category,row.brand].join(' ').toLowerCase().includes(term))).sort((a,b)=>{const key=state.priceSort.key,av=a[key]??'',bv=b[key]??'',result=typeof av==='number'&&typeof bv==='number'?av-bv:String(av).localeCompare(String(bv),'ru',{numeric:true});return state.priceSort.dir==='asc'?result:-result})}
function resetPricePage(){state.pricePage=1}
function renderPricePagination(pageCount){const el=$('#pricePagination');if(!el)return;if(pageCount<=1){el.innerHTML='';el.classList.add('hidden');return}const pages=Array.from({length:pageCount},(_,index)=>index+1);el.classList.remove('hidden');el.innerHTML=`<button type="button" class="stock-page-button" data-price-page="prev" ${state.pricePage===1?'disabled':''}>Назад</button><div class="stock-page-numbers">${pages.map(page=>`<button type="button" class="stock-page-button ${page===state.pricePage?'active':''}" data-price-page="${page}" aria-current="${page===state.pricePage?'page':'false'}">${page}</button>`).join('')}</div><button type="button" class="stock-page-button" data-price-page="next" ${state.pricePage===pageCount?'disabled':''}>Вперёд</button>`;$$('[data-price-page]').forEach(button=>button.onclick=()=>{const target=button.dataset.pricePage;const page=target==='prev'?state.pricePage-1:target==='next'?state.pricePage+1:Number(target);if(!Number.isInteger(page)||page<1||page>pageCount||page===state.pricePage)return;state.pricePage=page;renderPrices();document.querySelector('#page-prices')?.scrollIntoView({behavior:'smooth',block:'start'})})}
function renderPrices(){const data=state.prices||{};priceFilterOptions();const rows=priceRows(),pageCount=Math.ceil(rows.length/state.pricePageSize);state.pricePage=Math.min(Math.max(1,state.pricePage),Math.max(1,pageCount));const start=(state.pricePage-1)*state.pricePageSize,pageRows=rows.slice(start,start+state.pricePageSize);$('#priceCount').textContent=`${rows.length} из ${(data.rows||[]).length} товаров`;$('#emptyPrices').classList.toggle('hidden',rows.length>0);$('#priceSelectAll').checked=pageRows.length>0&&pageRows.every(row=>state.priceSelected.has(String(row.nmId)));$('#pricesBody').innerHTML=pageRows.map(row=>`<tr><td class="check-col"><input type="checkbox" data-price-row="${row.nmId}" ${state.priceSelected.has(String(row.nmId))?'checked':''}></td><td class="price-product-cell" data-price-open="${row.nmId}" title="История цены и изменение">${row.photo?`<img class="stock-product-photo" src="${escapeHtml(row.photo)}" alt="" loading="lazy">`:''}<span><strong>${escapeHtml(row.name)}</strong><small>${row.editableSizePrice?`Цены размеров · ${row.sizes}`:'Единая цена'}</small></span></td><td><strong>${escapeHtml(row.vendorCode||'—')}</strong></td><td><strong>${row.nmId}</strong></td><td>${escapeHtml(row.category)}</td><td>${escapeHtml(row.brand)}</td><td><strong>${fmtRub(row.price)}</strong></td><td><strong>${fmtPercent(row.discount)}</strong></td><td><strong>${fmtRub(row.discountedPrice)}</strong></td><td>${fmtPercent(row.clubDiscount)}</td><td>${priceStockCell(row)}</td></tr>`).join('');renderPricePagination(pageCount);$$('#pricesBody .stock-product-photo').forEach(image=>{if(image.dataset.previewBound)return;image.dataset.previewBound='1';bindPhotoPreview(image)});$$('[data-price-row]').forEach(input=>input.onchange=()=>{inputSelection(state.priceSelected,input.dataset.priceRow,input.checked);renderPriceActions()});$$('[data-price-sort]').forEach(header=>header.onclick=()=>{const key=header.dataset.priceSort;state.priceSort=state.priceSort.key===key?{key,dir:state.priceSort.dir==='asc'?'desc':'asc'}:{key,dir:'desc'};resetPricePage();renderPrices()});$('#priceSelectAll').onchange=()=>{pageRows.forEach(row=>inputSelection(state.priceSelected,String(row.nmId),$('#priceSelectAll').checked));renderPrices()};renderPriceActions()}function renderPriceActions(){const count=state.priceSelected.size;$('#priceActions').classList.toggle('hidden',!count);$('#priceSelectedCount').textContent=`Выбрано: ${fmtNum(count)}`}
function openSetPrices(){if(state.demo)return toast('В демо-режиме изменение цен отключено');openModal(`<p class="eyebrow">Массовое изменение</p><h2>Задать цену и скидку</h2><p>Новые значения будут применены к товарам: ${state.priceSelected.size}. Для поразмерных карточек цена изменится у каждого размера.</p><label class="stock-modal-label">Цена, ₽<input id="newPriceInput" type="number" min="1" step="1"></label><label class="stock-modal-label">Скидка продавца, %<input id="newDiscountInput" type="number" min="0" max="99" step="1" value="0"></label><button class="primary" id="confirmSetPrices">Отправить в WB</button>`);$('#confirmSetPrices').onclick=async()=>{const price=Number($('#newPriceInput').value),discount=Number($('#newDiscountInput').value);if(!Number.isFinite(price)||price<=0||!Number.isInteger(discount)||discount<0||discount>99)return toast('Проверьте цену и скидку от 0 до 99%');const items=(state.prices?.rows||[]).filter(row=>state.priceSelected.has(String(row.nmId))).map(row=>({nmId:row.nmId,price,discount,editableSizePrice:row.editableSizePrice,sizeItems:row.sizeItems}));try{await api('/api/prices/update',{method:'POST',body:JSON.stringify({cabinet:state.cabinet,items,confirm:true})});closeModal();toast('Загрузка цен создана в WB');await loadPrices(true)}catch(e){toast(e.message)}}}
function pluralRu(count,forms){const value=Math.abs(Number(count)||0)%100,digit=value%10;if(value>10&&value<20)return forms[2];if(digit>1&&digit<5)return forms[1];if(digit===1)return forms[0];return forms[2]}
async function loadFbsOrders(force=false){if(!force&&state.fbsOrdersKey===state.cabinet&&state.fbsOrders){renderFbsOrders();renderSupplies();return}const btn=$('#refresh');btn.classList.add('loading');$('#syncText').textContent='Получаем новые задания…';try{const [orders,supplies]=await Promise.all([api(`/api/fbs-orders?cabinet=${encodeURIComponent(state.cabinet)}`),api(`/api/supplies?cabinet=${encodeURIComponent(state.cabinet)}`)]);state.fbsOrders=orders;state.supplies=supplies;state.fbsOrdersKey=state.cabinet;state.fbsSelected=new Set();state.fbsFilters={warehouses:new Set(),categories:new Set(),assembly:new Set()};state.fbsPage=1;state.demo=orders.demo;renderFbsOrders();renderSupplies();$('#syncText').textContent=`Новые задания · ${new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}`;$('#cabinetMode').textContent=orders.demo?'Демо-данные':'Единый токен активен';setNotices('fbs-orders','load',[...(orders.warnings||[]),...(supplies.warnings||[])])}catch(e){$('#syncText').textContent='Ошибка новых заданий';toast(e.message);addNotice('fbs-orders',`Ошибка загрузки новых заданий: ${e.message}`)}finally{btn.classList.remove('loading')}}
function setFbsFilterOptions(data){const filters=[['fbsWarehouseOptions',data.warehouses||[],'warehouses'],['fbsCategoryOptions',(data.categories||[]).map(name=>({id:name,name})),'categories']];for(const [id,items,key] of filters){$(`#${id}`).innerHTML=items.map(item=>{const value=String(item.id);return `<label><input type="checkbox" value="${escapeHtml(value)}" ${state.fbsFilters[key].has(value)?'checked':''}> ${escapeHtml(item.name)}</label>`}).join('')||'<span class="filter-empty">Нет вариантов</span>';$$(`#${id} input`).forEach(input=>input.onchange=()=>{inputSelection(state.fbsFilters[key],input.value,input.checked);state.fbsPage=1;renderFbsOrders()})}$$('#fbsAssemblyOptions input').forEach(input=>{input.checked=state.fbsFilters.assembly.has(input.value);input.onchange=()=>{inputSelection(state.fbsFilters.assembly,input.value,input.checked);state.fbsPage=1;renderFbsOrders()}});$('#fbsWarehouseLabel').textContent=state.fbsFilters.warehouses.size?`Склады (${state.fbsFilters.warehouses.size})`:'Склады';$('#fbsCategoryLabel').textContent=state.fbsFilters.categories.size?`Категории (${state.fbsFilters.categories.size})`:'Категории'}
function fbsFilteredRows(){const rows=state.fbsOrders?.rows||[],term=$('#fbsSearch').value.toLowerCase(),assembly=[...state.fbsFilters.assembly];return rows.filter(row=>(!state.fbsFilters.warehouses.size||state.fbsFilters.warehouses.has(String(row.warehouseId)))&&(!state.fbsFilters.categories.size||state.fbsFilters.categories.has(row.category))&&(!assembly.length||(assembly.includes('free')&&!row.supplyId)||(assembly.includes('assembled')&&Boolean(row.supplyId)))&&(!term||[row.id,row.nmId,row.chrtId,row.vendorCode,row.name,row.sku,row.category,row.supplyId].join(' ').toLowerCase().includes(term))).sort((a,b)=>{const key=state.fbsSort.key,av=a[key]??'',bv=b[key]??'';const result=typeof av==='number'&&typeof bv==='number'?av-bv:String(av).localeCompare(String(bv),'ru',{numeric:true,sensitivity:'base'});return state.fbsSort.dir==='asc'?result:-result})}
function renderFbsPagination(pageCount){const el=$('#fbsPagination');if(!el)return;if(pageCount<=1){el.innerHTML='';el.classList.add('hidden');return}el.classList.remove('hidden');el.innerHTML=`<button type="button" class="stock-page-button" data-fbs-page="prev" ${state.fbsPage===1?'disabled':''}>Назад</button><div class="stock-page-numbers">${Array.from({length:pageCount},(_,index)=>index+1).map(page=>`<button type="button" class="stock-page-button ${page===state.fbsPage?'active':''}" data-fbs-page="${page}" aria-current="${page===state.fbsPage?'page':'false'}">${page}</button>`).join('')}</div><button type="button" class="stock-page-button" data-fbs-page="next" ${state.fbsPage===pageCount?'disabled':''}>Вперёд</button>`;$$('[data-fbs-page]').forEach(button=>button.onclick=()=>{const target=button.dataset.fbsPage;const page=target==='prev'?state.fbsPage-1:target==='next'?state.fbsPage+1:Number(target);if(!Number.isInteger(page)||page<1||page>pageCount||page===state.fbsPage)return;state.fbsPage=page;renderFbsOrders();document.querySelector('#page-fbs-orders')?.scrollIntoView({behavior:'smooth',block:'start'})})}
function renderFbsOrders(){const data=state.fbsOrders||{},rows=data.rows||[],t=data.totals||{},supplyTotals=state.supplies?.totals||{};$('#fbsBadge').textContent=fmtNum(t.free||0);const metrics=[['Новых заданий',fmtNum(t.orders),'ожидают сборки','#7651e5'],['Без поставки',fmtNum(t.free),'можно собрать','#f0a04b'],['В поставке',fmtNum(t.assembled),'переданы на сборку','#318f68'],['Сумма',fmtMoney(t.amount),'по новым заданиям','#9d77ff'],['Товаров',fmtNum(t.products),'уникальных позиций','#318f68'],['Открытых поставок',fmtNum(supplyTotals.open),`всего ${fmtNum(supplyTotals.supplies)}`,'#e76464']];$('#fbsMetrics').innerHTML=metrics.map(x=>`<article class="metric" style="--accent:${x[3]}"><div class="metric-label">${x[0]}</div><div class="metric-value">${x[1]}</div><div class="metric-note">${x[2]}</div></article>`).join('');setFbsFilterOptions(data);const filtered=fbsFilteredRows(),pageCount=Math.ceil(filtered.length/state.fbsPageSize);state.fbsPage=Math.min(Math.max(1,state.fbsPage),Math.max(1,pageCount));const start=(state.fbsPage-1)*state.fbsPageSize,pageRows=filtered.slice(start,start+state.fbsPageSize);$('#fbsCount').textContent=`${filtered.length} из ${rows.length} ${pluralRu(rows.length,['задания','заданий','заданий'])}`;$('#emptyFbsOrders').classList.toggle('hidden',filtered.length>0);$('#fbsSelectAll').checked=pageRows.length>0&&pageRows.every(row=>state.fbsSelected.has(String(row.id)));$('#fbsOrdersBody').innerHTML=pageRows.map(row=>{const picture=row.photo?`<img src="${escapeHtml(row.photo)}" alt="" loading="lazy">`:escapeHtml(String(row.name||'Т')[0]);return `<tr><td class="check-col"><input type="checkbox" data-fbs-row="${escapeHtml(row.id)}" ${state.fbsSelected.has(String(row.id))?'checked':''} aria-label="Выбрать задание ${escapeHtml(row.id)}"></td><td><strong>${formatDate(row.createdAt)}</strong><small>${escapeHtml(row.cargoTypeName)}</small></td><td><div class="product"><span class="product-icon ${row.photo?'has-photo':''}">${picture}</span><span><strong>${escapeHtml(row.name)}</strong><small>${escapeHtml(row.category)} · ${escapeHtml(row.size)}</small></span></div></td><td><button class="copy-article" data-copy="${escapeHtml(row.vendorCode||'')}">${escapeHtml(row.vendorCode||'—')}</button></td><td><button class="copy-article" data-copy="${escapeHtml(row.nmId||'')}">${escapeHtml(row.nmId||'—')}</button></td><td><button class="copy-article" data-copy="${escapeHtml(row.sku||'')}">${escapeHtml(row.sku||'—')}</button></td><td><strong>${fmtMoney(row.price,row.currencyCode)}</strong></td><td>${row.supplyId?`<button class="copy-article supply-link" data-supply-open="${escapeHtml(row.supplyId)}">${escapeHtml(row.supplyId)}</button>`:'<span class="status status-new">Без поставки</span>'}</td><td><small title="${escapeHtml(row.id)}">${escapeHtml(row.id)}</small></td></tr>`}).join('');renderFbsPagination(pageCount);$$('#fbsOrdersBody img').forEach(bindPhotoPreview);$$('[data-fbs-row]').forEach(input=>input.onchange=()=>{inputSelection(state.fbsSelected,input.dataset.fbsRow,input.checked);renderFbsActions()});$$('[data-fbs-sort]').forEach(header=>header.onclick=()=>{const key=header.dataset.fbsSort;state.fbsSort=state.fbsSort.key===key?{key,dir:state.fbsSort.dir==='asc'?'desc':'asc'}:{key,dir:'desc'};state.fbsPage=1;renderFbsOrders()});$('#fbsSelectAll').onchange=()=>{pageRows.forEach(row=>inputSelection(state.fbsSelected,String(row.id),$('#fbsSelectAll').checked));renderFbsOrders()};$$('#fbsOrdersBody [data-supply-open]').forEach(button=>button.onclick=()=>openSupplyDetail(button.dataset.supplyOpen));renderFbsActions()}
function renderFbsActions(){const count=state.fbsSelected.size;$('#fbsActions').classList.toggle('hidden',!count);$('#fbsSelectedCount').textContent=`Выбрано: ${fmtNum(count)}`}
function renderSupplies(){const rows=state.supplies?.rows||[],totals=state.supplies?.totals||{};$('#supplyCount').textContent=rows.length?`${fmtNum(totals.open)} ${pluralRu(totals.open,['открытая','открытые','открытых'])} из ${fmtNum(totals.supplies)}`:'Поставок нет';$('#emptySupplies').classList.toggle('hidden',rows.length>0);$('#suppliesBody').innerHTML=rows.map(row=>`<tr><td><button class="copy-article" data-copy="${escapeHtml(row.id)}">${escapeHtml(row.id)}</button></td><td><strong>${escapeHtml(row.name)}</strong></td><td><strong>${formatDate(row.createdAt)}</strong>${row.closedAt?`<small>закрыта ${formatDate(row.closedAt)}</small>`:''}</td><td><span class="status ${row.done?'status-complete':'status-new'}">${row.done?'Передана в доставку':'Открыта'}</span></td><td>${escapeHtml(row.cargoTypeName)}</td><td class="supply-row-actions"><button class="secondary" data-supply-detail="${escapeHtml(row.id)}">Состав</button><button class="secondary" data-supply-qr="${escapeHtml(row.id)}">QR</button><button class="danger" data-supply-remove="${escapeHtml(row.id)}" ${row.done?'disabled':''}>Удалить</button></td></tr>`).join('');$$('[data-supply-detail]').forEach(button=>button.onclick=()=>openSupplyDetail(button.dataset.supplyDetail));$$('[data-supply-qr]').forEach(button=>button.onclick=()=>downloadSupplyBarcode(button.dataset.supplyQr));$$('[data-supply-remove]').forEach(button=>button.onclick=()=>removeSupply(button.dataset.supplyRemove))}
async function openSupplyDetail(supplyId){if(!supplyId)return;const btn=$('#refresh');btn.classList.add('loading');try{const q=new URLSearchParams({cabinet:state.cabinet,id:supplyId});state.supplyDetail=await api('/api/supplies/detail?'+q);state.supplyOrderSelected=new Set();renderSupplyDetail();(state.supplyDetail.warnings||[]).forEach(warning=>toast(warning));$('#supplyDetailPanel').scrollIntoView({behavior:'smooth',block:'start'})}catch(e){toast(e.message)}finally{btn.classList.remove('loading')}}
function trbxOfOrder(orderId){return (state.supplyDetail?.trbxes||[]).find(trbx=>trbx.orderIds.includes(Number(orderId)))?.id||''}
function renderSupplyDetail(){const detail=state.supplyDetail;const panel=$('#supplyDetailPanel');if(!detail?.supply){panel.classList.add('hidden');return}panel.classList.remove('hidden');const supply=detail.supply,orders=detail.orders||[],trbxes=detail.trbxes||[];$('#supplyDetailTitle').textContent=`Поставка ${supply.id}`;$('#supplyDetailMeta').innerHTML=`${escapeHtml(supply.name)} · создана ${formatDate(supply.createdAt)} · <span class="status ${supply.done?'status-complete':'status-new'}">${supply.done?'передана в доставку':'открыта'}</span>`;$('#deliverSupplyButton').disabled=supply.done||!orders.length;$('#addTrbxButton').disabled=supply.done;$('#supplyStickersButton').disabled=!orders.length;$('#supplyOrderCount').textContent=`${fmtNum(orders.length)} шт.`;$('#trbxCount').textContent=`${fmtNum(trbxes.length)} шт.`;$('#supplyOrdersBody').innerHTML=orders.map(row=>{const trbxId=trbxOfOrder(row.id);return `<tr><td class="check-col"><input type="checkbox" data-supply-order="${escapeHtml(row.id)}" ${state.supplyOrderSelected.has(String(row.id))?'checked':''} aria-label="Выбрать задание ${escapeHtml(row.id)}"></td><td><strong>${escapeHtml(row.name)}</strong><small>${row.detailsMissing?'данные задания WB уже не отдаёт':`${escapeHtml(row.size)} · ${fmtMoney(row.price,row.currencyCode)}`}</small></td><td><button class="copy-article" data-copy="${escapeHtml(row.vendorCode||'')}">${escapeHtml(row.vendorCode||'—')}</button></td><td>${trbxId?`<strong>${escapeHtml(trbxId)}</strong>`:'<small>не разложено</small>'}</td><td><small>${escapeHtml(row.id)}</small></td></tr>`}).join('')||'<tr><td colspan="5"><small>В поставке пока нет заданий.</small></td></tr>';$('#supplyOrderSelectAll').checked=orders.length>0&&orders.every(row=>state.supplyOrderSelected.has(String(row.id)));$('#trbxList').innerHTML=trbxes.map(trbx=>`<article class="trbx-card"><header><strong>${escapeHtml(trbx.id)}</strong><span>${fmtNum(trbx.orderIds.length)} ${pluralRu(trbx.orderIds.length,['задание','задания','заданий'])}</span></header><div class="trbx-actions"><button class="secondary" data-trbx-fill="${escapeHtml(trbx.id)}" ${supply.done?'disabled':''}>Положить выбранные</button><button class="secondary" data-trbx-qr="${escapeHtml(trbx.id)}">QR</button><button class="danger" data-trbx-remove="${escapeHtml(trbx.id)}" ${supply.done?'disabled':''}>Удалить</button></div></article>`).join('')||'<p class="trbx-empty">Грузомест нет. Добавьте их, чтобы получить QR-коды коробов.</p>';$$('[data-supply-order]').forEach(input=>input.onchange=()=>inputSelection(state.supplyOrderSelected,input.dataset.supplyOrder,input.checked));$('#supplyOrderSelectAll').onchange=()=>{orders.forEach(row=>inputSelection(state.supplyOrderSelected,String(row.id),$('#supplyOrderSelectAll').checked));renderSupplyDetail()};$$('[data-trbx-fill]').forEach(button=>button.onclick=()=>fillTrbx(button.dataset.trbxFill));$$('[data-trbx-qr]').forEach(button=>button.onclick=()=>downloadTrbxStickers([button.dataset.trbxQr]));$$('[data-trbx-remove]').forEach(button=>button.onclick=()=>removeTrbx(button.dataset.trbxRemove))}
function stickerMime(type){return type==='svg'?'image/svg+xml':type==='png'?'image/png':'text/plain'}
function stickerExt(type){return type==='svg'?'svg':type==='png'?'png':'zpl'}
function downloadBase64(file,name,mime){const a=document.createElement('a');a.href=`data:${mime};base64,${file}`;a.download=name;document.body.append(a);a.click();a.remove()}
function openStickerPrint(title,items,type){const win=window.open('','_blank');if(!win)return toast('Браузер заблокировал окно печати — разрешите всплывающие окна');const cards=items.map(item=>`<figure><img src="data:${stickerMime(type)};base64,${item.file}" alt="${escapeHtml(item.name)}"><figcaption>${escapeHtml(item.name)}</figcaption></figure>`).join('');win.document.write(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>*{box-sizing:border-box}body{margin:0;padding:14px;font:12px/1.45 system-ui,Arial,sans-serif;background:#f5f6f3;color:#1b1b1f}header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}h1{font-size:15px;margin:0}button{font:inherit;padding:8px 16px;border:0;border-radius:9px;background:#7651e5;color:#fff;cursor:pointer}.sheet{display:flex;flex-wrap:wrap;gap:8px}figure{margin:0;width:58mm;background:#fff;border:1px solid #d9d9e3;border-radius:5px;padding:2mm;break-inside:avoid}figure img{display:block;width:100%;height:40mm;object-fit:contain}figcaption{margin-top:1mm;font-size:9px;text-align:center;color:#5b5b6b}@page{size:58mm 40mm;margin:0}@media print{body{padding:0;background:#fff}header{display:none}.sheet{display:block;gap:0}figure{width:58mm;height:40mm;padding:0;border:0;border-radius:0;break-after:page}figcaption{display:none}}</style></head><body><header><h1>${escapeHtml(title)} · ${items.length} шт.</h1><button onclick="window.print()">Печать</button></header><div class="sheet">${cards}</div></body></html>`);win.document.close()}
function offerStickers(title,items,type){if(!items.length)return toast('WB не вернул файлы для печати');const printable=type==='png'||type==='svg';openModal(`<p class="eyebrow">${escapeHtml(title)}</p><h2>Готово: ${items.length} шт.</h2><p>${printable?'Страница печати рассчитана на 58×40 мм — по одному стикеру на лист. Либо сохраните файлы по отдельности.':'Формат ZPL открывается только на термопринтере — сохраните файлы.'}</p><div class="modal-actions">${printable?'<button class="primary" id="printStickers">Открыть для печати</button>':''}<button id="saveStickers">Скачать файлами</button></div>`);if(printable)$('#printStickers').onclick=()=>{openStickerPrint(title,items,type);closeModal()};$('#saveStickers').onclick=()=>{items.forEach(item=>downloadBase64(item.file,`${item.name}.${stickerExt(type)}`,stickerMime(type)));closeModal();toast(`Файлов скачано: ${items.length}`)}}
async function downloadOrderStickers(){if(!state.fbsSelected.size)return toast('Выберите сборочные задания');try{const data=await api('/api/orders/stickers',{method:'POST',body:JSON.stringify({cabinet:state.cabinet,orders:[...state.fbsSelected].map(Number),type:'png'})});offerStickers('Стикеры товаров',(data.stickers||[]).filter(item=>item.file).map(item=>({file:item.file,name:`sticker-${item.orderId}`})),data.type||'png')}catch(e){toast(e.message)}}
async function downloadSupplyBarcode(supplyId){const id=supplyId||state.supplyDetail?.supply?.id;if(!id)return toast('Выберите поставку');try{const q=new URLSearchParams({cabinet:state.cabinet,id,type:'png'});const data=await api('/api/supplies/barcode?'+q);if(!data.file)return toast('WB не вернул QR-код поставки');offerStickers(`QR-код поставки ${id}`,[{file:data.file,name:`supply-${data.barcode||id}`}],data.type||'png')}catch(e){toast(e.message)}}
async function downloadTrbxStickers(trbxIds){const detail=state.supplyDetail;if(!detail?.supply)return toast('Откройте состав поставки');const ids=(trbxIds&&trbxIds.length?trbxIds:(detail.trbxes||[]).map(trbx=>trbx.id)).filter(Boolean);if(!ids.length)return toast('В поставке нет грузомест');try{const data=await api('/api/supplies/trbx/stickers',{method:'POST',body:JSON.stringify({cabinet:state.cabinet,supplyId:detail.supply.id,trbxIds:ids,type:'png'})});offerStickers('QR-коды грузомест',(data.stickers||[]).filter(item=>item.file).map(item=>({file:item.file,name:`trbx-${item.trbxId}`})),data.type||'png')}catch(e){toast(e.message)}}
function openAssembleModal(){if(state.demo)return toast('В демо-режиме сборка заданий отключена');if(!state.fbsSelected.size)return toast('Выберите сборочные задания');const open=(state.supplies?.rows||[]).filter(row=>!row.done);openModal(`<p class="eyebrow">Сборка заданий</p><h2>Собрать в поставку</h2><p>Будет добавлено заданий: ${state.fbsSelected.size}. В WB они перейдут в статус «на сборке».</p><label class="stock-modal-label">Поставка<select id="assembleSupply"><option value="">➕ Создать новую поставку</option>${open.map(row=>`<option value="${escapeHtml(row.id)}">${escapeHtml(row.id)} · ${escapeHtml(row.name)}</option>`).join('')}</select></label><label class="stock-modal-label" id="assembleNameLabel">Название новой поставки<input id="assembleName" maxlength="128" value="Поставка ${new Date().toLocaleDateString('ru-RU')}"></label><button class="primary" id="confirmAssemble">Собрать</button>`);const sync=()=>$('#assembleNameLabel').classList.toggle('hidden',Boolean($('#assembleSupply').value));$('#assembleSupply').onchange=sync;sync();$('#confirmAssemble').onclick=runAssemble}
async function runAssemble(){const supplyId=$('#assembleSupply').value,name=$('#assembleName')?.value.trim()||'';if(!supplyId&&!name)return toast('Введите название новой поставки');try{const data=await api('/api/supplies/orders',{method:'POST',body:JSON.stringify({cabinet:state.cabinet,supplyId,name,orders:[...state.fbsSelected].map(Number),confirm:true})});closeModal();toast(`Собрано заданий: ${data.added}${data.failed?.length?` · с ошибкой: ${data.failed.length}`:''}`);(data.failed||[]).slice(0,3).forEach(item=>toast(`Задание ${item.orderId}: ${item.message}`));state.fbsSelected.clear();await loadFbsOrders(true);await openSupplyDetail(data.supplyId)}catch(e){toast(e.message)}}
function openCreateSupply(){if(state.demo)return toast('В демо-режиме создание поставок отключено');openModal(`<p class="eyebrow">Поставки FBS</p><h2>Новая поставка</h2><p>Пустая поставка появится в списке — в неё можно собирать задания.</p><label class="stock-modal-label">Название<input id="supplyNameInput" maxlength="128" value="Поставка ${new Date().toLocaleDateString('ru-RU')}"></label><button class="primary" id="confirmCreateSupply">Создать</button>`);$('#confirmCreateSupply').onclick=async()=>{try{const data=await api('/api/supplies',{method:'POST',body:JSON.stringify({cabinet:state.cabinet,name:$('#supplyNameInput').value.trim(),confirm:true})});closeModal();toast(`Поставка создана: ${data.id}`);await loadFbsOrders(true)}catch(e){toast(e.message)}}}
async function removeSupply(supplyId){if(state.demo)return toast('В демо-режиме удаление поставок отключено');if(!confirm(`Удалить поставку ${supplyId}? Удалить можно только пустую и незакрытую поставку.`))return;try{await api('/api/supplies/delete',{method:'POST',body:JSON.stringify({cabinet:state.cabinet,supplyId,confirm:true})});if(state.supplyDetail?.supply?.id===supplyId){state.supplyDetail=null;renderSupplyDetail()}toast('Поставка удалена');await loadFbsOrders(true)}catch(e){toast(e.message)}}
async function deliverSupply(){const supply=state.supplyDetail?.supply;if(!supply)return;if(state.demo)return toast('В демо-режиме передача поставки отключена');if(!confirm(`Передать поставку ${supply.id} в доставку? После этого её состав изменить нельзя.`))return;try{await api('/api/supplies/deliver',{method:'POST',body:JSON.stringify({cabinet:state.cabinet,supplyId:supply.id,confirm:true})});toast('Поставка передана в доставку');await loadFbsOrders(true);await openSupplyDetail(supply.id)}catch(e){toast(e.message)}}
function openAddTrbx(){const detail=state.supplyDetail;if(!detail?.supply)return toast('Откройте состав поставки');if(state.demo)return toast('В демо-режиме грузоместа не создаются');openModal(`<p class="eyebrow">Поставка ${escapeHtml(detail.supply.id)}</p><h2>Добавить грузоместа</h2><p>WB создаст указанное количество коробов и выдаст для каждого QR-код.</p><label class="stock-modal-label">Количество<input id="trbxAmount" type="number" min="1" max="1000" step="1" value="1"></label><button class="primary" id="confirmTrbx">Добавить</button>`);$('#confirmTrbx').onclick=async()=>{try{const data=await api('/api/supplies/trbx',{method:'POST',body:JSON.stringify({cabinet:state.cabinet,supplyId:detail.supply.id,amount:Number($('#trbxAmount').value),confirm:true})});closeModal();toast(`Добавлено грузомест: ${data.trbxIds.length}`);await openSupplyDetail(detail.supply.id)}catch(e){toast(e.message)}}}
async function fillTrbx(trbxId){const detail=state.supplyDetail;if(!detail?.supply)return;if(state.demo)return toast('В демо-режиме раскладка по грузоместам отключена');if(!state.supplyOrderSelected.size)return toast('Отметьте задания в составе поставки');try{const data=await api('/api/supplies/trbx/orders',{method:'POST',body:JSON.stringify({cabinet:state.cabinet,supplyId:detail.supply.id,trbxId,orders:[...state.supplyOrderSelected].map(Number),confirm:true})});toast(`В ${trbxId} добавлено заданий: ${data.added}`);state.supplyOrderSelected=new Set();await openSupplyDetail(detail.supply.id)}catch(e){toast(e.message)}}
async function removeTrbx(trbxId){const detail=state.supplyDetail;if(!detail?.supply)return;if(state.demo)return toast('В демо-режиме удаление грузомест отключено');if(!confirm(`Удалить грузоместо ${trbxId}?`))return;try{await api('/api/supplies/trbx/delete',{method:'POST',body:JSON.stringify({cabinet:state.cabinet,supplyId:detail.supply.id,trbxIds:[trbxId],confirm:true})});toast('Грузоместо удалено');await openSupplyDetail(detail.supply.id)}catch(e){toast(e.message)}}
function bindFbsOrders(){$('#fbsSearch').oninput=()=>{state.fbsPage=1;renderFbsOrders()};$('#assembleButton').onclick=openAssembleModal;$('#fbsStickerButton').onclick=downloadOrderStickers;$('#clearFbsSelection').onclick=()=>{state.fbsSelected.clear();renderFbsOrders()};$('#createSupplyButton').onclick=openCreateSupply;$('#addTrbxButton').onclick=openAddTrbx;$('#supplyStickersButton').onclick=downloadSupplyOrderStickers;$('#supplyBarcodeButton').onclick=()=>downloadSupplyBarcode();$('#trbxStickersButton').onclick=()=>downloadTrbxStickers();$('#deliverSupplyButton').onclick=deliverSupply;$('#closeSupplyDetail').onclick=()=>{state.supplyDetail=null;renderSupplyDetail()}}

// --- Шаблоны остатков FBS ---
const presetState={presets:[],draft:null};
function presetCatalog(){
  const unique=new Map();
  for(const row of state.stocks?.rows||[]){const key=String(row.chrtId);if(!key||unique.has(key))continue;
    unique.set(key,{chrtId:row.chrtId,nmId:row.nmId,name:row.name,vendorCode:row.vendorCode,size:row.size,sku:row.sku,photo:row.photo});}
  return [...unique.values()];
}
function presetWarehouses(){return (state.stocks?.warehouses||[]).map(item=>({id:String(item.id),name:item.name}))}
function presetWarehouseNames(preset){const known=new Map(presetWarehouses().map(item=>[item.id,item.name]));
  return (preset.warehouseIds||[]).map(id=>known.get(String(id))||`Склад ${id}`).join(', ')||'склады не выбраны'}
function presetPhoto(item){return item.photo?`<img src="${escapeHtml(item.photo)}" alt="" loading="lazy">`:'<img alt="">'}
async function openStockPresets(){
  if(!state.stocks)await loadStocks();
  try{const data=await api(`/api/stock-presets?cabinet=${encodeURIComponent(state.cabinet)}`);presetState.presets=data.presets||[]}
  catch(e){presetState.presets=[];toast(e.message)}
  renderPresetList();
}
function renderPresetList(){
  const cards=presetState.presets.map(preset=>{
    const amount=preset.items.reduce((sum,item)=>sum+Number(item.amount||0),0);
    return `<div class="preset-card"><div><strong>${escapeHtml(preset.name)}</strong><small>Артикулов: ${fmtNum(preset.items.length)} · всего ${fmtNum(amount)} шт · складов: ${fmtNum((preset.warehouseIds||[]).length)}</small></div>`+
      `<div class="preset-card-actions"><button class="primary" data-preset-run="${escapeHtml(preset.id)}">Выполнить</button>`+
      `<button data-preset-edit="${escapeHtml(preset.id)}">Изменить</button>`+
      `<button class="danger" data-preset-delete="${escapeHtml(preset.id)}">Удалить</button></div></div>`;
  }).join('');
  openModal(`<p class="eyebrow">Остатки FBS</p><h2>Шаблоны остатков</h2>`+
    `<p>Шаблон хранит артикулы с нужным количеством. При выполнении эти остатки выставляются на выбранных складах.</p>`+
    `<div class="preset-list">${cards||'<div class="preset-empty">Шаблонов пока нет. Создайте первый и добавьте в него артикулы с количеством.</div>'}</div>`+
    `<div class="preset-actions"><button class="primary" id="presetCreate">Новый шаблон</button></div>`);
  $('#presetCreate').onclick=()=>openPresetEditor(null);
  $$('[data-preset-run]').forEach(button=>button.onclick=()=>openPresetApply(button.dataset.presetRun));
  $$('[data-preset-edit]').forEach(button=>button.onclick=()=>openPresetEditor(button.dataset.presetEdit));
  $$('[data-preset-delete]').forEach(button=>button.onclick=()=>deletePreset(button.dataset.presetDelete));
}
function openPresetEditor(id){
  const existing=presetState.presets.find(item=>item.id===id);
  presetState.draft=existing?{...existing,items:existing.items.map(item=>({...item}))}
    :{id:'',name:'',warehouseIds:presetWarehouses().map(item=>item.id),items:[]};
  const draft=presetState.draft;
  const warehouses=presetWarehouses().map(item=>`<label><input type="checkbox" data-preset-warehouse="${escapeHtml(item.id)}" ${draft.warehouseIds.includes(item.id)?'checked':''}> ${escapeHtml(item.name)}</label>`).join('');
  openModal(`<p class="eyebrow">Остатки FBS</p><h2>${existing?'Изменить шаблон':'Новый шаблон'}</h2>`+
    `<label class="stock-modal-label">Название<input id="presetName" maxlength="60" placeholder="Например: утренние остатки" value="${escapeHtml(draft.name)}"></label>`+
    `<p class="eyebrow">Склады</p><div class="preset-warehouses">${warehouses||'<small>Склады FBS не найдены</small>'}</div>`+
    `<label class="stock-modal-label preset-search">Добавить артикул<input id="presetSearch" placeholder="Название, артикул WB, артикул продавца или баркод" autocomplete="off"><div id="presetSuggest"></div></label>`+
    `<div class="preset-items" id="presetItems"></div>`+
    `<div class="preset-actions"><button class="primary" id="presetSave">Сохранить шаблон</button>`+
    `${state.stockSelected.size?`<button id="presetAddSelected">Добавить выбранные (${fmtNum(state.stockSelected.size)})</button>`:''}`+
    `<button id="presetBack">К списку</button></div>`);
  $$('[data-preset-warehouse]').forEach(input=>input.onchange=()=>{
    const id=input.dataset.presetWarehouse;
    draft.warehouseIds=input.checked?[...new Set([...draft.warehouseIds,id])]:draft.warehouseIds.filter(item=>item!==id);
  });
  $('#presetName').oninput=event=>{draft.name=event.target.value};
  $('#presetSearch').oninput=event=>renderPresetSuggest(event.target.value);
  $('#presetSearch').onblur=()=>setTimeout(()=>{const box=$('#presetSuggest');if(box)box.innerHTML=''},180);
  $('#presetSave').onclick=savePreset;
  $('#presetBack').onclick=renderPresetList;
  if($('#presetAddSelected'))$('#presetAddSelected').onclick=()=>{
    stockSelectedRows().forEach(row=>addPresetItem({chrtId:row.chrtId,nmId:row.nmId,name:row.name,vendorCode:row.vendorCode,size:row.size,sku:row.sku,photo:row.photo},row.amount));
    renderPresetItems();
  };
  renderPresetItems();
}
function renderPresetSuggest(term){
  const box=$('#presetSuggest');if(!box)return;
  const query=String(term||'').trim().toLowerCase();
  if(query.length<2){box.innerHTML='';return}
  const chosen=new Set(presetState.draft.items.map(item=>String(item.chrtId)));
  const found=presetCatalog().filter(item=>!chosen.has(String(item.chrtId))&&
    `${item.name} ${item.nmId} ${item.vendorCode} ${item.sku} ${item.size}`.toLowerCase().includes(query)).slice(0,8);
  box.className='preset-suggest';
  box.innerHTML=found.length?found.map(item=>`<button type="button" data-preset-add="${escapeHtml(item.chrtId)}">${presetPhoto(item)}<span><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.vendorCode||'—')} · nmId ${escapeHtml(item.nmId||'—')} · размер ${escapeHtml(item.size||'—')}</small></span></button>`).join(''):'<button type="button" disabled><span><b>Ничего не найдено</b></span></button>';
  box.querySelectorAll('[data-preset-add]').forEach(button=>button.onclick=()=>{
    const item=presetCatalog().find(row=>String(row.chrtId)===button.dataset.presetAdd);
    if(item)addPresetItem(item,0);
    $('#presetSearch').value='';box.innerHTML='';renderPresetItems();
  });
}
function addPresetItem(item,amount){
  const draft=presetState.draft;
  if(draft.items.some(row=>String(row.chrtId)===String(item.chrtId)))return;
  draft.items.push({chrtId:item.chrtId,nmId:item.nmId,name:item.name,vendorCode:item.vendorCode,size:item.size,sku:item.sku,photo:item.photo,amount:Number(amount)||0});
}
function renderPresetItems(){
  const box=$('#presetItems');if(!box)return;
  const items=presetState.draft.items;
  box.innerHTML=items.length?items.map((item,index)=>`<div class="preset-item">${presetPhoto(item)}<div><b>${escapeHtml(item.name||'Товар')}</b><small>${escapeHtml(item.vendorCode||'—')} · nmId ${escapeHtml(item.nmId||'—')} · размер ${escapeHtml(item.size||'—')}</small></div>`+
    `<input type="number" min="0" step="1" value="${Number(item.amount)||0}" data-preset-amount="${index}" aria-label="Количество"><button type="button" data-preset-remove="${index}" aria-label="Убрать">×</button></div>`).join('')
    :'<div class="preset-empty">Добавьте артикулы через поиск выше</div>';
  box.querySelectorAll('[data-preset-amount]').forEach(input=>input.oninput=()=>{
    presetState.draft.items[Number(input.dataset.presetAmount)].amount=Math.max(0,Math.floor(Number(input.value)||0));
  });
  box.querySelectorAll('[data-preset-remove]').forEach(button=>button.onclick=()=>{
    presetState.draft.items.splice(Number(button.dataset.presetRemove),1);renderPresetItems();
  });
}
async function savePreset(){
  const draft=presetState.draft;
  if(!String(draft.name||'').trim())return toast('Укажите название шаблона');
  if(!draft.warehouseIds.length)return toast('Выберите хотя бы один склад FBS');
  if(!draft.items.length)return toast('Добавьте хотя бы один артикул');
  if(draft.items.some(item=>!Number.isInteger(Number(item.amount))||Number(item.amount)<0))return toast('Количество должно быть целым числом не меньше нуля');
  try{
    const data=await api('/api/stock-presets',{method:'POST',body:JSON.stringify({cabinet:state.cabinet,preset:draft})});
    presetState.presets=data.presets||[];toast('Шаблон сохранён');renderPresetList();
  }catch(e){toast(e.message)}
}
async function deletePreset(id){
  const preset=presetState.presets.find(item=>item.id===id);
  if(!preset||!confirm(`Удалить шаблон «${preset.name}»?`))return;
  try{
    const data=await api(`/api/stock-presets?cabinet=${encodeURIComponent(state.cabinet)}&id=${encodeURIComponent(id)}`,{method:'DELETE'});
    presetState.presets=data.presets||[];toast('Шаблон удалён');renderPresetList();
  }catch(e){toast(e.message)}
}
function openPresetApply(id){
  const preset=presetState.presets.find(item=>item.id===id);if(!preset)return;
  const known=new Set(presetWarehouses().map(item=>item.id));
  const warehouses=(preset.warehouseIds||[]).filter(item=>known.has(String(item)));
  const missing=(preset.warehouseIds||[]).length-warehouses.length;
  const rows=preset.items.map(item=>`<div class="preset-item">${presetPhoto(item)}<div><b>${escapeHtml(item.name||'Товар')}</b><small>${escapeHtml(item.vendorCode||'—')} · размер ${escapeHtml(item.size||'—')}</small></div><input type="number" value="${Number(item.amount)||0}" disabled></div>`).join('');
  openModal(`<p class="eyebrow">Выполнение шаблона</p><h2>${escapeHtml(preset.name)}</h2>`+
    `<p>Остатки будут заменены на указанные значения. Складов: ${fmtNum(warehouses.length)} · позиций к обновлению: ${fmtNum(warehouses.length*preset.items.length)}.`+
    `${missing?` <b>Складов из шаблона больше нет: ${fmtNum(missing)}.</b>`:''}</p>`+
    `<p><b>Склады:</b> ${escapeHtml(presetWarehouseNames({warehouseIds:warehouses}))}</p>`+
    `<div class="preset-items">${rows}</div>`+
    `<div class="preset-actions"><button class="primary" id="presetRun">Выполнить</button><button id="presetCancel">Отмена</button></div>`);
  $('#presetCancel').onclick=renderPresetList;
  $('#presetRun').onclick=()=>runPreset(preset,warehouses);
}
async function runPreset(preset,warehouses){
  if(state.demo)return toast('В демо-режиме изменение остатков отключено');
  if(!warehouses.length)return toast('У шаблона нет действующих складов FBS');
  const items=warehouses.flatMap(warehouseId=>preset.items.map(item=>({warehouseId,chrtId:item.chrtId,amount:Number(item.amount)||0})));
  const button=$('#presetRun');if(button){button.disabled=true;button.textContent='Выполняем…'}
  try{
    await api('/api/fbs-stocks/update',{method:'POST',body:JSON.stringify({cabinet:state.cabinet,items,confirm:true})});
    closeModal();toast(`Шаблон «${preset.name}» выполнен: позиций ${fmtNum(items.length)}`);await loadStocks(true);
  }catch(e){toast(e.message);if(button){button.disabled=false;button.textContent='Выполнить'}}
}

// --- Шаблоны цен и скидок ---
const pricePresetState={presets:[],draft:null};
function pricePresetCatalog(){return (state.prices?.rows||[]).map(row=>({nmId:row.nmId,name:row.name,vendorCode:row.vendorCode,photo:row.photo,price:row.price,discount:row.discount}))}
async function openPricePresets(){
  if(!state.prices)await loadPrices();
  try{const data=await api(`/api/price-presets?cabinet=${encodeURIComponent(state.cabinet)}`);pricePresetState.presets=data.presets||[]}
  catch(e){pricePresetState.presets=[];toast(e.message)}
  renderPricePresetList();
}
function renderPricePresetList(){
  const cards=pricePresetState.presets.map(preset=>{
    const prices=preset.items.map(item=>Number(item.price)||0);
    const min=prices.length?Math.min(...prices):0,max=prices.length?Math.max(...prices):0;
    const range=min===max?fmtRub(min):`${fmtRub(min)} — ${fmtRub(max)}`;
    return `<div class="preset-card"><div><strong>${escapeHtml(preset.name)}</strong><small>Товаров: ${fmtNum(preset.items.length)} · цены ${escapeHtml(range)}</small></div>`+
      `<div class="preset-card-actions"><button class="primary" data-price-preset-run="${escapeHtml(preset.id)}">Выполнить</button>`+
      `<button data-price-preset-edit="${escapeHtml(preset.id)}">Изменить</button>`+
      `<button class="danger" data-price-preset-delete="${escapeHtml(preset.id)}">Удалить</button></div></div>`;
  }).join('');
  openModal(`<p class="eyebrow">Цены и скидки</p><h2>Шаблоны цен</h2>`+
    `<p>Шаблон хранит товары с ценой и скидкой продавца. При выполнении эти значения отправляются в Wildberries.</p>`+
    `<div class="preset-list">${cards||'<div class="preset-empty">Шаблонов пока нет. Создайте первый и добавьте в него товары с ценой и скидкой.</div>'}</div>`+
    `<div class="preset-actions"><button class="primary" id="pricePresetCreate">Новый шаблон</button></div>`);
  $('#pricePresetCreate').onclick=()=>openPricePresetEditor(null);
  $$('[data-price-preset-run]').forEach(button=>button.onclick=()=>openPricePresetApply(button.dataset.pricePresetRun));
  $$('[data-price-preset-edit]').forEach(button=>button.onclick=()=>openPricePresetEditor(button.dataset.pricePresetEdit));
  $$('[data-price-preset-delete]').forEach(button=>button.onclick=()=>deletePricePreset(button.dataset.pricePresetDelete));
}
function openPricePresetEditor(id){
  const existing=pricePresetState.presets.find(item=>item.id===id);
  pricePresetState.draft=existing?{...existing,items:existing.items.map(item=>({...item}))}:{id:'',name:'',items:[]};
  const draft=pricePresetState.draft;
  openModal(`<p class="eyebrow">Цены и скидки</p><h2>${existing?'Изменить шаблон':'Новый шаблон'}</h2>`+
    `<label class="stock-modal-label">Название<input id="pricePresetName" maxlength="60" placeholder="Например: цены на распродажу" value="${escapeHtml(draft.name)}"></label>`+
    `<label class="stock-modal-label preset-search">Добавить товар<input id="pricePresetSearch" placeholder="Название, артикул WB или артикул продавца" autocomplete="off"><div id="pricePresetSuggest"></div></label>`+
    `<div class="preset-items" id="pricePresetItems"></div>`+
    `<div class="preset-actions"><button class="primary" id="pricePresetSave">Сохранить шаблон</button>`+
    `${state.priceSelected.size?`<button id="pricePresetAddSelected">Добавить выбранные (${fmtNum(state.priceSelected.size)})</button>`:''}`+
    `<button id="pricePresetBack">К списку</button></div>`);
  $('#pricePresetName').oninput=event=>{draft.name=event.target.value};
  $('#pricePresetSearch').oninput=event=>renderPricePresetSuggest(event.target.value);
  $('#pricePresetSearch').onblur=()=>setTimeout(()=>{const box=$('#pricePresetSuggest');if(box)box.innerHTML=''},180);
  $('#pricePresetSave').onclick=savePricePreset;
  $('#pricePresetBack').onclick=renderPricePresetList;
  if($('#pricePresetAddSelected'))$('#pricePresetAddSelected').onclick=()=>{
    (state.prices?.rows||[]).filter(row=>state.priceSelected.has(String(row.nmId))).forEach(row=>addPricePresetItem(row));
    renderPricePresetItems();
  };
  renderPricePresetItems();
}
function renderPricePresetSuggest(term){
  const box=$('#pricePresetSuggest');if(!box)return;
  const query=String(term||'').trim().toLowerCase();
  if(query.length<2){box.innerHTML='';return}
  const chosen=new Set(pricePresetState.draft.items.map(item=>String(item.nmId)));
  const found=pricePresetCatalog().filter(item=>!chosen.has(String(item.nmId))&&
    `${item.name} ${item.nmId} ${item.vendorCode}`.toLowerCase().includes(query)).slice(0,8);
  box.className='preset-suggest';
  box.innerHTML=found.length?found.map(item=>`<button type="button" data-price-preset-add="${escapeHtml(item.nmId)}">${presetPhoto(item)}<span><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.vendorCode||'—')} · nmId ${escapeHtml(item.nmId)} · сейчас ${escapeHtml(fmtRub(item.price))} · скидка ${escapeHtml(item.discount)}%</small></span></button>`).join(''):'<button type="button" disabled><span><b>Ничего не найдено</b></span></button>';
  box.querySelectorAll('[data-price-preset-add]').forEach(button=>button.onclick=()=>{
    const item=pricePresetCatalog().find(row=>String(row.nmId)===button.dataset.pricePresetAdd);
    if(item)addPricePresetItem(item);
    $('#pricePresetSearch').value='';box.innerHTML='';renderPricePresetItems();
  });
}
function addPricePresetItem(row){
  const draft=pricePresetState.draft;
  if(draft.items.some(item=>String(item.nmId)===String(row.nmId)))return;
  draft.items.push({nmId:row.nmId,name:row.name,vendorCode:row.vendorCode,photo:row.photo,price:Math.round(Number(row.price)||0)||1,discount:Math.round(Number(row.discount)||0)});
}
function renderPricePresetItems(){
  const box=$('#pricePresetItems');if(!box)return;
  const items=pricePresetState.draft.items;
  box.innerHTML=items.length?items.map((item,index)=>`<div class="preset-item">${presetPhoto(item)}<div><b>${escapeHtml(item.name||'Товар')}</b><small>${escapeHtml(item.vendorCode||'—')} · nmId ${escapeHtml(item.nmId)} · со скидкой ${escapeHtml(fmtRub(Math.round(Number(item.price)*(100-Number(item.discount))/100)))}</small></div>`+
    `<input type="number" min="1" step="1" value="${Number(item.price)||0}" data-price-preset-price="${index}" aria-label="Цена, ₽">`+
    `<input type="number" min="0" max="99" step="1" value="${Number(item.discount)||0}" data-price-preset-discount="${index}" aria-label="Скидка, %">`+
    `<button type="button" data-price-preset-remove="${index}" aria-label="Убрать">×</button></div>`).join('')
    :'<div class="preset-empty">Добавьте товары через поиск выше</div>';
  box.querySelectorAll('[data-price-preset-price]').forEach(input=>input.onchange=()=>{
    pricePresetState.draft.items[Number(input.dataset.pricePresetPrice)].price=Math.max(1,Math.round(Number(input.value)||0));
    renderPricePresetItems();
  });
  box.querySelectorAll('[data-price-preset-discount]').forEach(input=>input.onchange=()=>{
    pricePresetState.draft.items[Number(input.dataset.pricePresetDiscount)].discount=Math.min(99,Math.max(0,Math.round(Number(input.value)||0)));
    renderPricePresetItems();
  });
  box.querySelectorAll('[data-price-preset-remove]').forEach(button=>button.onclick=()=>{
    pricePresetState.draft.items.splice(Number(button.dataset.pricePresetRemove),1);renderPricePresetItems();
  });
}
async function savePricePreset(){
  const draft=pricePresetState.draft;
  if(!String(draft.name||'').trim())return toast('Укажите название шаблона');
  if(!draft.items.length)return toast('Добавьте хотя бы один товар');
  if(draft.items.some(item=>!(Number(item.price)>0)))return toast('Цена должна быть больше нуля');
  if(draft.items.some(item=>!Number.isInteger(Number(item.discount))||Number(item.discount)<0||Number(item.discount)>99))return toast('Скидка должна быть целым числом от 0 до 99');
  try{
    const data=await api('/api/price-presets',{method:'POST',body:JSON.stringify({cabinet:state.cabinet,preset:draft})});
    pricePresetState.presets=data.presets||[];toast('Шаблон сохранён');renderPricePresetList();
  }catch(e){toast(e.message)}
}
async function deletePricePreset(id){
  const preset=pricePresetState.presets.find(item=>item.id===id);
  if(!preset||!confirm(`Удалить шаблон «${preset.name}»?`))return;
  try{
    const data=await api(`/api/price-presets?cabinet=${encodeURIComponent(state.cabinet)}&id=${encodeURIComponent(id)}`,{method:'DELETE'});
    pricePresetState.presets=data.presets||[];toast('Шаблон удалён');renderPricePresetList();
  }catch(e){toast(e.message)}
}
function openPricePresetApply(id){
  const preset=pricePresetState.presets.find(item=>item.id===id);if(!preset)return;
  const byNmId=new Map((state.prices?.rows||[]).map(row=>[String(row.nmId),row]));
  const ready=preset.items.filter(item=>byNmId.has(String(item.nmId)));
  const missing=preset.items.length-ready.length;
  const rows=preset.items.map(item=>{
    const known=byNmId.get(String(item.nmId));
    return `<div class="preset-item">${presetPhoto(item)}<div><b>${escapeHtml(item.name||'Товар')}</b><small>${known?`сейчас ${escapeHtml(fmtRub(known.price))} · скидка ${escapeHtml(known.discount)}%`:'нет в текущем списке цен'}</small></div>`+
      `<input type="number" value="${Number(item.price)||0}" disabled><input type="number" value="${Number(item.discount)||0}" disabled></div>`;
  }).join('');
  openModal(`<p class="eyebrow">Выполнение шаблона</p><h2>${escapeHtml(preset.name)}</h2>`+
    `<p>Будет отправлено товаров: ${fmtNum(ready.length)}. Для поразмерных карточек цена изменится у каждого размера.`+
    `${missing?` <b>Пропущено товаров, которых нет в списке цен: ${fmtNum(missing)}.</b>`:''}</p>`+
    `<div class="preset-items">${rows}</div>`+
    `<div class="preset-actions"><button class="primary" id="pricePresetRun">Выполнить</button><button id="pricePresetCancel">Отмена</button></div>`);
  $('#pricePresetCancel').onclick=renderPricePresetList;
  $('#pricePresetRun').onclick=()=>runPricePreset(preset,ready);
}
async function runPricePreset(preset,ready){
  if(state.demo)return toast('В демо-режиме изменение цен отключено');
  if(!ready.length)return toast('Ни один товар шаблона не найден в текущем списке цен');
  const byNmId=new Map((state.prices?.rows||[]).map(row=>[String(row.nmId),row]));
  const items=ready.map(item=>{const row=byNmId.get(String(item.nmId));
    return {nmId:item.nmId,price:Number(item.price),discount:Number(item.discount),editableSizePrice:row.editableSizePrice,sizeItems:row.sizeItems}});
  const button=$('#pricePresetRun');if(button){button.disabled=true;button.textContent='Выполняем…'}
  try{
    await api('/api/prices/update',{method:'POST',body:JSON.stringify({cabinet:state.cabinet,items,confirm:true})});
    closeModal();toast(`Шаблон «${preset.name}» отправлен в WB: товаров ${fmtNum(items.length)}`);await loadPrices(true);
  }catch(e){toast(e.message);if(button){button.disabled=false;button.textContent='Выполнить'}}
}
// --- Общие остатки в ценах и скидках ---
function mergePriceStocks(){
  const byNmId=state.priceStocks?.byNmId||{},failed=!state.priceStocks||state.priceStocks.failed;
  for(const row of state.prices?.rows||[]){
    const totals=byNmId[String(row.nmId)];
    row.stock=failed?undefined:Number(totals?.total||0);row.stockFbs=Number(totals?.fbs||0);row.stockFbw=Number(totals?.fbw||0);
  }
}
async function loadPriceStocks(force=false){
  const cabinet=state.cabinet;
  if(!force&&state.priceStocksKey===cabinet&&state.priceStocks){mergePriceStocks();if(state.activePage==='prices')renderPrices();return}
  state.priceStocks=null;
  try{
    const data=await api(`/api/prices/stocks?cabinet=${encodeURIComponent(cabinet)}`);
    if(cabinet!==state.cabinet)return;
    state.priceStocks=data;state.priceStocksKey=cabinet;
    setNotices('prices','stocks',data.warnings||[]);
  }catch(e){
    if(cabinet!==state.cabinet)return;
    state.priceStocks={byNmId:{},failed:true};
    setNotices('prices','stocks',[`Остатки: ${e.message}`],'error');
  }
  mergePriceStocks();
  if(state.activePage==='prices')renderPrices();
}
function priceStockCell(row){
  if(!state.priceStocks)return '<span class="stock-muted">Загрузка…</span>';
  if(row.stock==null)return '<span class="stock-muted">—</span>';
  return `<strong class="${row.stock>0?'in-stock':'out-stock'}">${fmtNum(row.stock)} шт</strong><small>FBS ${fmtNum(row.stockFbs)} · FBW ${fmtNum(row.stockFbw)}</small>`;
}

// --- График этапов воронки продаж ---
const FUNNEL_TREND_METRICS=[
  {key:'openCount',label:'Переходы',unit:'шт'},
  {key:'cartCount',label:'Корзины',unit:'шт'},
  {key:'cartConversion',label:'Конв. в корзину',unit:'%'},
  {key:'addToWishlistCount',label:'Отложено',unit:'шт'},
  {key:'orderCount',label:'Заказы, шт',unit:'шт'},
  {key:'orderConversion',label:'Конв. в заказ',unit:'%'},
  {key:'orderSum',label:'Заказы, ₽',unit:'₽'},
  {key:'buyoutCount',label:'Выкупы, шт',unit:'шт'},
  {key:'buyoutSum',label:'Выкупы, ₽',unit:'₽'}];
const TREND_MONTHS=['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
const funnelTrend={data:null,metric:'orderCount',compare:true,grouping:'day',loading:false,error:'',pollTimer:0,filterTimer:0,requestId:0,nmIds:null};
const trendShift=(date,days)=>{const d=new Date(`${date}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10)};
const trendWeekStart=date=>{const d=new Date(`${date}T00:00:00Z`);d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);return d.toISOString().slice(0,10)};
const trendShortDate=date=>`${date.slice(8,10)}.${date.slice(5,7)}`;
const trendFullDate=date=>`${date.slice(8,10)}.${date.slice(5,7)}.${date.slice(2,4)}`;
// Пока сервер догружает дни из WB, график переспрашивает его каждые 5 секунд и дорисовывается.
// Фильтры таблицы товаров сужают и график: на сервер уходят артикулы, которые прошли фильтры.
function funnelFiltersActive(){const f=state.funnelFilters;return Boolean(f.categories.size||f.articles.size||f.availability.size)}
function funnelTrendNmIds(){return funnelFiltersActive()?funnelProductRows().map(row=>String(row.nmId)):null}
function scheduleFunnelTrendReload(){clearTimeout(funnelTrend.filterTimer);funnelTrend.filterTimer=setTimeout(()=>{loadFunnelTrend();if(state.funnelTab==='sales'){funnelSales.page=1;loadFunnelSales()}},400)}
async function loadFunnelTrend(silent=false){
  const cabinet=state.cabinet,from=$('#dateFrom').value,to=$('#dateTo').value,request=++funnelTrend.requestId;
  clearTimeout(funnelTrend.pollTimer);
  if(!silent){funnelTrend.loading=true;funnelTrend.error='';renderFunnelTrend()}
  try{
    const grouping=funnelTrend.grouping,nmIds=funnelTrendNmIds();
    const data=await api('/api/funnel/history',{method:'POST',body:JSON.stringify({cabinet,from,to,grouping,nmIds})});
    if(request!==funnelTrend.requestId||grouping!==funnelTrend.grouping||cabinet!==state.cabinet)return;
    funnelTrend.data=data;funnelTrend.error='';funnelTrend.nmIds=nmIds;
    if(data.sync?.pending)funnelTrend.pollTimer=setTimeout(()=>{if(request===funnelTrend.requestId&&state.activePage==='funnel'&&state.cabinet===cabinet&&$('#dateFrom').value===from&&$('#dateTo').value===to)loadFunnelTrend(true)},5000);
    setNotices('funnel','trend',data.warnings||[]);
  }catch(e){funnelTrend.error=e.message;setNotices('funnel','trend',[`График воронки: ${e.message}`],'error')}
  finally{if(request===funnelTrend.requestId){funnelTrend.loading=false;renderFunnelTrend()}}
}
// Кнопка «Перекачать» в воронке: заново загружает выбранный период из WB и перезаписывает сохранённые данные,
// даже окончательные. Перед запуском показывает, сколько запросов и времени это займёт (WB даёт 3 запроса в минуту).
function openFunnelRefetch(){
  const from=$('#dateFrom').value,today=mskDate(0),to=$('#dateTo').value>today?today:$('#dateTo').value,grouping=funnelTrend.grouping;
  if(!from||!to||from>to)return toast('Выберите период');
  const days=datesBetweenTrend(from,to),buckets=new Set();
  for(let date=from;date<=to;date=trendShift(date,1))buckets.add(grouping==='week'?trendWeekStart(date):date.slice(0,7));
  // Дни запрашиваются парами (выбранный + «прошлый» в одном запросе), недели и месяцы — по одному отрезку за запрос.
  const requests=grouping==='day'?Math.ceil(days/2):buckets.size,seconds=Math.max(0,requests-3)*20.5+requests*2;
  const eta=seconds>=60?`примерно ${Math.ceil(seconds/60)} мин`:'меньше минуты';
  const unit=grouping==='week'?` · ${buckets.size} нед.`:grouping==='month'?` · ${buckets.size} мес.`:'';
  openModal(`<p class="eyebrow">Воронка продаж</p><h2>Перекачать данные из WB?</h2><p>Данные за ${trendFullDate(from)} – ${trendFullDate(to)} (${fmtNum(days)} дн.${unit}) будут заново загружены через API WB и перезапишут сохранённые, в том числе дни, которые уже считались окончательными.</p><p>Запросов к WB: ${fmtNum(requests)}, ${eta}. Прогресс виден под графиком; загрузка идёт на сервере, страницу можно закрыть.</p><button class="primary" id="funnelRefetchRun">Перекачать</button>`);
  $('#funnelRefetchRun').onclick=async()=>{
    const button=$('#funnelRefetchRun');button.disabled=true;
    try{const result=await api('/api/funnel/refetch',{method:'POST',body:JSON.stringify({cabinet:state.cabinet,from,to,grouping})});closeModal();toast(`Перекачка запущена: ${fmtNum(result.scheduled)} ${grouping==='day'?'дн.':grouping==='week'?'нед.':'мес.'}`);loadFunnelDetails()}
    catch(e){button.disabled=false;toast(e.message)}
  };
}
function funnelTrendPoints(days=[],period,grouping){
  const byDate=new Map(days.map(day=>[day.date,day])),buckets=[],index=new Map();
  for(let date=period.from;date<=period.to;date=trendShift(date,1)){
    const key=grouping==='week'?trendWeekStart(date):grouping==='month'?date.slice(0,7):date;
    if(!index.has(key)){const bucket={key,from:date,to:date,total:0,rows:[]};index.set(key,bucket);buckets.push(bucket)}
    const bucket=index.get(key);bucket.to=date;bucket.total++;if(byDate.has(date))bucket.rows.push(byDate.get(date));
  }
  return buckets.map(bucket=>{
    if(!bucket.rows.length)return {...bucket,values:null};
    const sum=key=>bucket.rows.reduce((total,row)=>total+Number(row[key]||0),0);
    const values={openCount:sum('openCount'),cartCount:sum('cartCount'),orderCount:sum('orderCount'),orderSum:sum('orderSum'),buyoutCount:sum('buyoutCount'),buyoutSum:sum('buyoutSum'),addToWishlistCount:sum('addToWishlistCount')};
    values.cartConversion=values.openCount?values.cartCount/values.openCount*100:0;
    values.orderConversion=values.cartCount?values.orderCount/values.cartCount*100:0;
    return {...bucket,values};
  });
}
function funnelBucketPoint(range){
  const total=datesBetweenTrend(range.from,range.to);
  if(!range.values)return {key:range.key||range.from,from:range.from,to:range.to,total,rows:[],values:null};
  const values={...range.values};
  values.cartConversion=values.openCount?values.cartCount/values.openCount*100:0;
  values.orderConversion=values.cartCount?values.orderCount/values.cartCount*100:0;
  return {key:range.key||range.from,from:range.from,to:range.to,total,rows:Array(total).fill(null),values};
}
function datesBetweenTrend(from,to){let count=0;for(let date=from;date<=to;date=trendShift(date,1))count++;return count}
function trendBucketLabel(bucket,grouping){
  if(!bucket)return '';
  if(bucket.shifted)return bucket.from===bucket.to?trendShortDate(bucket.from):`${trendShortDate(bucket.from)}–${trendShortDate(bucket.to)}`;
  if(grouping==='month'){const [year,month]=bucket.key.split('-');return `${TREND_MONTHS[Number(month)-1]} ${year}`}
  if(grouping==='week')return bucket.from===bucket.to?trendShortDate(bucket.from):`${trendShortDate(bucket.from)}–${trendShortDate(bucket.to)}`;
  return trendShortDate(bucket.from);
}
function trendValue(metric,value){
  if(value==null)return 'нет данных';
  if(metric.unit==='%')return `${(Math.round(value*10)/10).toLocaleString('ru-RU')}%`;
  if(metric.unit==='₽')return `${fmtNum(Math.round(value))} ₽`;
  return fmtNum(Math.round(value));
}
function trendAxisValue(metric,value){return metric.unit==='₽'?shortMoney(value):metric.unit==='%'?`${fmtNum(Math.round(value))}%`:fmtNum(Math.round(value))}
function niceTrendMax(value){if(!(value>0))return 4;const raw=value/4,power=10**Math.floor(Math.log10(raw)),step=[1,1.2,1.5,2,2.5,3,4,5,6,8,10].map(k=>k*power).find(k=>k>=raw);return step*4}
// Плавная линия без выбросов за пределы соседних значений (монотонный кубический сплайн).
function trendSmoothPath(points){
  const n=points.length,dx=[],slopes=[],tangents=[];
  for(let i=0;i<n-1;i++){dx[i]=points[i+1].x-points[i].x;slopes[i]=(points[i+1].y-points[i].y)/dx[i]}
  tangents[0]=slopes[0];tangents[n-1]=slopes[n-2];
  for(let i=1;i<n-1;i++)tangents[i]=slopes[i-1]*slopes[i]<=0?0:(slopes[i-1]+slopes[i])/2;
  for(let i=0;i<n-1;i++){
    if(slopes[i]===0){tangents[i]=0;tangents[i+1]=0;continue}
    const a=tangents[i]/slopes[i],b=tangents[i+1]/slopes[i],s=a*a+b*b;
    if(s>9){const k=3/Math.sqrt(s);tangents[i]=k*a*slopes[i];tangents[i+1]=k*b*slopes[i]}
  }
  let d=`M${points[0].x},${points[0].y}`;
  for(let i=0;i<n-1;i++){const c=dx[i]/3;d+=` C${points[i].x+c},${points[i].y+tangents[i]*c} ${points[i+1].x-c},${points[i+1].y-tangents[i+1]*c} ${points[i+1].x},${points[i+1].y}`}
  return d;
}
function renderFunnelTrend(){
  const metricList=$('#funnelMetricList');if(!metricList)return;
  const metric=FUNNEL_TREND_METRICS.find(item=>item.key===funnelTrend.metric)||FUNNEL_TREND_METRICS[0];
  metricList.innerHTML=FUNNEL_TREND_METRICS.map(item=>`<button type="button" class="funnel-metric ${item.key===metric.key?'active':''}" data-trend-metric="${item.key}">${item.label}</button>`).join('');
  metricList.querySelectorAll('[data-trend-metric]').forEach(button=>button.onclick=()=>{funnelTrend.metric=button.dataset.trendMetric;renderFunnelTrend()});
  $('#funnelCompare').checked=funnelTrend.compare;$('#funnelGrouping').value=funnelTrend.grouping;
  const chart=$('#funnelTrendChart'),legend=$('#funnelTrendLegend'),note=$('#funnelTrendNote'),data=funnelTrend.data;
  if(!data){legend.innerHTML='';note.textContent='';chart.innerHTML=`<div class="chart-empty">${funnelTrend.error?escapeHtml(funnelTrend.error):'Загрузка истории воронки…'}</div>`;return}
  const currentPeriod=data.periods.current,previousPeriod=data.periods.previous,grouping=funnelTrend.grouping;
  legend.innerHTML=`<span><i class="legend-solid"></i>${trendFullDate(currentPeriod.from)} - ${trendFullDate(currentPeriod.to)}</span>`+
    (funnelTrend.compare?`<span><i class="legend-dashed"></i>${trendFullDate(previousPeriod.from)} - ${trendFullDate(previousPeriod.to)}</span>`:'');
  const ranged=grouping!=='day'&&data.grouping===grouping;
  const current=ranged?(data.buckets||[]).map(funnelBucketPoint):funnelTrendPoints(data.current,currentPeriod,grouping);
  const previous=!funnelTrend.compare?[]:ranged?(data.buckets||[]).map(bucket=>({...funnelBucketPoint(bucket.previous),shifted:true})):funnelTrendPoints(data.previous,previousPeriod,grouping);
  const notes=[];
  if(!data.demo){
    const earliest=funnelTrend.compare?previousPeriod.from:currentPeriod.from;
    const eta=seconds=>seconds>=60?`${Math.ceil(seconds/60)} мин`:`${Math.max(1,seconds)} сек`;
    if(data.sync?.pending)notes.push(`Загружаем из WB: осталось ${fmtNum(data.sync.pending)} ${grouping==='week'?'нед.':grouping==='month'?'мес.':'дн.'}, примерно ${eta(data.sync.etaSeconds)}. WB разрешает 3 запроса в минуту, график дорисуется сам.`);
    if(data.sync?.lastError)notes.push(`Часть дней не загрузилась: ${data.sync.lastError}. Повторим позже.`);
    if(data.earliestAvailable&&earliest<data.earliestAvailable)notes.push(`WB отдаёт воронку не раньше ${trendFullDate(data.earliestAvailable)}.`);
  }
  if(data.filtered){const ids=funnelTrend.nmIds||[];const one=ids.length===1?(state.funnelProducts||[]).map(item=>item.product||item).find(p=>String(p.nmId)===ids[0]):null;notes.unshift(ids.length?(one?`График по артикулу ${one.vendorCode||one.nmId} (${one.nmId}).`:`График по ${fmtNum(ids.length)} ${pluralRu(ids.length,['товару','товарам','товарам'])} из фильтров.`):'Под фильтры не попал ни один товар.')}
  if(funnelTrend.error)notes.push(`Не удалось обновить: ${funnelTrend.error}`);
  if(funnelTrend.loading)notes.push('Обновляем…');
  note.textContent=notes.join(' ');
  if(!current.some(point=>point.values)&&!previous.some(point=>point.values)){chart.innerHTML='<div class="chart-empty">Нет сохранённых данных за выбранный период</div>';return}
  const w=900,h=300,left=14,right=62,top=24,bottom=34,plotW=w-left-right,plotH=h-top-bottom,count=current.length;
  const x=i=>left+(count<=1?plotW/2:i*plotW/(count-1));
  const valuesOf=list=>list.map(point=>point.values?Number(point.values[metric.key]||0):null);
  const currentValues=valuesOf(current),previousValues=valuesOf(previous).slice(0,count);
  const max=niceTrendMax(Math.max(0,...currentValues.filter(value=>value!=null),...previousValues.filter(value=>value!=null)));
  const y=value=>top+plotH-(value/max)*plotH;
  const segments=values=>{const parts=[];let part=[];values.forEach((value,i)=>{if(value==null){if(part.length)parts.push(part);part=[];return}part.push({x:x(i),y:y(value)})});if(part.length)parts.push(part);return parts};
  const lines=(values,kind)=>segments(values).map(points=>points.length===1?`<circle class="trend-dot ${kind}" cx="${points[0].x}" cy="${points[0].y}" r="3.5"/>`:`<path class="trend-line ${kind}" d="${trendSmoothPath(points)}"/>`).join('');
  const ticks=[0,.25,.5,.75,1].map(ratio=>`<line class="trend-grid" x1="${left}" x2="${w-right}" y1="${y(max*ratio)}" y2="${y(max*ratio)}"/><text class="trend-axis" x="${w-right+10}" y="${y(max*ratio)+4}">${trendAxisValue(metric,max*ratio)}</text>`).join('');
  const verticals=current.map((point,i)=>`<line class="trend-grid" x1="${x(i)}" x2="${x(i)}" y1="${top}" y2="${top+plotH}"/>`).join('');
  const labelStep=Math.max(1,Math.ceil(count/(grouping==='week'?5:8)));
  const labels=current.map((point,i)=>i%labelStep===0||i===count-1?`<text class="trend-axis" x="${x(i)}" y="${h-10}" text-anchor="${count>1&&i===0?'start':count>1&&i===count-1?'end':'middle'}">${trendBucketLabel(point,grouping)}</text>`:'').join('');
  chart.innerHTML=`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${escapeHtml(metric.label)}">${verticals}${ticks}<text class="trend-axis" x="${w-right+10}" y="${top-10}">${metric.unit}</text>${labels}${lines(previousValues,'previous')}${lines(currentValues,'current')}`+
    `<g class="trend-hover hidden"><line class="hover-line" y1="${top}" y2="${top+plotH}"/><circle class="trend-hover-point previous" r="4.5"/><circle class="trend-hover-point current" r="5"/></g><rect x="${left}" y="${top}" width="${plotW}" height="${plotH}" fill="transparent"/></svg><div class="chart-tooltip hidden"></div>`;
  const svg=chart.querySelector('svg'),tip=chart.querySelector('.chart-tooltip'),hover=svg.querySelector('.trend-hover');
  const partial=bucket=>bucket?.values&&bucket.rows.length<bucket.total?` (есть ${bucket.rows.length} из ${bucket.total} дн.)`:'';
  svg.onpointermove=event=>{
    const rect=svg.getBoundingClientRect(),vx=(event.clientX-rect.left)/rect.width*w;
    let index=0,best=Infinity;current.forEach((point,i)=>{const distance=Math.abs(x(i)-vx);if(distance<best){best=distance;index=i}});
    const cv=currentValues[index],pv=previousValues[index];
    hover.classList.remove('hidden');
    const line=hover.querySelector('line');line.setAttribute('x1',x(index));line.setAttribute('x2',x(index));
    [['current',cv],['previous',funnelTrend.compare?pv:null]].forEach(([kind,value])=>{const dot=hover.querySelector(`.trend-hover-point.${kind}`);dot.style.display=value==null?'none':'';if(value!=null){dot.setAttribute('cx',x(index));dot.setAttribute('cy',y(value))}});
    tip.innerHTML=`<strong>${escapeHtml(metric.label)}</strong><span style="--dot:var(--purple)"><i></i>${trendBucketLabel(current[index],grouping)}${partial(current[index])}<b>${trendValue(metric,cv)}</b></span>`+
      (funnelTrend.compare&&previous[index]?`<span style="--dot:#a78bfa"><i></i>${trendBucketLabel(previous[index],grouping)}${partial(previous[index])}<b>${trendValue(metric,pv)}</b></span>`:'');
    tip.classList.remove('hidden');
    // Подсказка лежит внутри прокручиваемого блока графика, поэтому координата считается от его левого края с учётом прокрутки.
    const chartRect=chart.getBoundingClientRect(),px=rect.left-chartRect.left+chart.scrollLeft+x(index)/w*rect.width,half=tip.offsetWidth/2;
    tip.style.left=`${Math.min(Math.max(px,chart.scrollLeft+half+6),chart.scrollLeft+chart.clientWidth-half-6)}px`;
    const highest=Math.min(...[cv,funnelTrend.compare?pv:null].filter(value=>value!=null).map(value=>y(value)),top+plotH);
    const pointTop=rect.top-chartRect.top+highest/h*rect.height;
    tip.style.top=`${pointTop<tip.offsetHeight+34?Math.min(pointTop+16,chart.clientHeight-tip.offsetHeight-4):24}px`;
  };
  svg.onpointerleave=()=>{hover.classList.add('hidden');tip.classList.add('hidden')};
}
document.addEventListener('change',event=>{
  if(event.target.id==='funnelCompare'){funnelTrend.compare=event.target.checked;renderFunnelTrend()}
  if(event.target.id==='funnelGrouping'){funnelTrend.grouping=event.target.value;funnelTrend.data=null;loadFunnelTrend()}
});
// Стикеры товаров для заданий поставки: отмеченные задания или все, если ничего не отмечено.
async function downloadSupplyOrderStickers(){
  const orders=state.supplyDetail?.orders||[];
  const selected=orders.filter(row=>state.supplyOrderSelected.has(String(row.id)));
  const ids=(selected.length?selected:orders).map(row=>Number(row.id)).filter(Number.isInteger);
  if(!ids.length)return toast('В поставке нет заданий');
  try{
    const data=await api('/api/orders/stickers',{method:'POST',body:JSON.stringify({cabinet:state.cabinet,orders:ids,type:'png'})});
    offerStickers(selected.length?'Стикеры отмеченных товаров':'Стикеры товаров поставки',(data.stickers||[]).filter(item=>item.file).map(item=>({file:item.file,name:`sticker-${item.orderId}`})),data.type||'png');
  }catch(e){toast(e.message)}
}

// --- Таблица «Товары в воронке»: фильтры, столбцы этапов и пагинация ---
// Показатели воронки одного периода (выбранного или прошлого) в едином виде.
// «% выкупа» у WB — выкупы ÷ (выкупы + отмены), а не выкупы ÷ заказы; так же считается и итог.
function funnelStatValues(s={}){
  const c=s.conversions||{},n=key=>Number(s[key]||0);
  return {openCount:n('openCount'),cartCount:n('cartCount'),orderCount:n('orderCount'),orderSum:n('orderSum'),buyoutCount:n('buyoutCount'),buyoutSum:n('buyoutSum'),cancelCount:n('cancelCount'),
    addToWishlist:Number(s.addToWishlist??s.addToWishlistCount??0),addToCartPercent:Number(c.addToCartPercent??s.addToCartConversion??0),
    cartToOrderPercent:Number(c.cartToOrderPercent??s.cartToOrderConversion??0),buyoutPercent:Number(c.buyoutPercent??s.buyoutPercent??0)};
}
const FUNNEL_SUM_KEYS=['openCount','cartCount','orderCount','orderSum','buyoutCount','buyoutSum','cancelCount','addToWishlist'];
function funnelTotalValues(list){
  const t=Object.fromEntries(FUNNEL_SUM_KEYS.map(key=>[key,list.reduce((sum,item)=>sum+Number(item[key]||0),0)]));
  return {...t,addToCartPercent:t.openCount?t.cartCount/t.openCount*100:0,cartToOrderPercent:t.cartCount?t.orderCount/t.cartCount*100:0,
    buyoutPercent:t.buyoutCount+t.cancelCount?t.buyoutCount/(t.buyoutCount+t.cancelCount)*100:0};
}
// Изменение к прошлому периоду той же длины — в процентах от прошлого значения, как в кабинете WB (и для конверсий тоже).
function funnelDelta(value,previous){
  if(previous==null)return '';
  if(!previous)return value?'<small class="sales-delta up">новое</small>':'';
  const change=Math.round((value-previous)/previous*100);
  if(!change)return '<small class="sales-delta flat">0%</small>';
  return `<small class="sales-delta ${change>0?'up':'down'}">${change>0?'▲':'▼'} ${fmtNum(Math.abs(change))}%</small>`;
}
function funnelProductRows(){
  const f=state.funnelFilters;
  return (state.funnelProducts||[]).map(item=>{
    const p=item.product||item,s=item.statistic?.selected||item.history?.[0]||item,past=item.statistic?.past,stocks=p.stocks||{};
    return {...p,...s,...funnelStatValues(s),past:past?funnelStatValues(past):null,title:p.title||p.name||`Товар ${p.nmId}`,vendorCode:p.vendorCode||'',subjectName:p.subjectName||'Без категории',nmId:p.nmId,
      stock:Number(stocks.wb||0)+Number(stocks.mp||0)};
  }).filter(row=>(!f.categories.size||f.categories.has(row.subjectName))&&(!f.articles.size||f.articles.has(String(row.nmId)))&&
    (!f.availability.size||(f.availability.has('positive')&&row.stock>0)||(f.availability.has('zero')&&row.stock===0)))
  .sort((a,b)=>{const key=state.funnelSort.key,av=a[key]??0,bv=b[key]??0,result=typeof av==='number'&&typeof bv==='number'?av-bv:String(av).localeCompare(String(bv),'ru',{numeric:true});return state.funnelSort.dir==='asc'?result:-result});
}
function renderFunnelDetails(){
  const all=state.funnelProducts||[],rows=funnelProductRows(),f=state.funnelFilters;
  const categories=[...new Set(all.map(item=>(item.product||item).subjectName||'Без категории'))].sort((a,b)=>a.localeCompare(b,'ru'));
  $('#funnelCategoryOptions').innerHTML=categories.map(category=>`<label><input type="checkbox" value="${escapeHtml(category)}"> ${escapeHtml(category)}</label>`).join('')||'<span class="filter-empty">Нет вариантов</span>';
  $$('#funnelCategoryOptions input').forEach(input=>{input.checked=f.categories.has(input.value);input.onchange=()=>{input.checked?f.categories.add(input.value):f.categories.delete(input.value);state.funnelPage=1;renderFunnelDetails();scheduleFunnelTrendReload()}});
  $('#funnelCategoryLabel').textContent=f.categories.size?`Категории (${f.categories.size})`:'Категории';
  $$('#funnelAvailabilityOptions input').forEach(input=>{input.checked=f.availability.has(input.value);input.onchange=()=>{input.checked?f.availability.add(input.value):f.availability.delete(input.value);state.funnelPage=1;renderFunnelDetails();scheduleFunnelTrendReload()}});
  $('#funnelAvailabilityLabel').textContent=f.availability.size?`Наличие (${f.availability.size})`:'Наличие';
  $('#funnelArticleLabel').textContent=f.articles.size?`Артикулы (${f.articles.size})`:'Артикулы';
  $('#funnelProductCount').textContent=`${fmtNum(rows.length)} из ${fmtNum(all.length)} товаров`;
  if(all.length){state.funnel=rows.reduce((sum,row)=>({views:sum.views+Number(row.openCount||0),cart:sum.cart+Number(row.cartCount||0),orders:sum.orders+Number(row.orderCount||0),sales:sum.sales+Number(row.buyoutCount||0),revenue:sum.revenue+Number(row.buyoutSum||0)}),{views:0,cart:0,orders:0,sales:0,revenue:0});renderFunnel()}
  const pageCount=Math.max(1,Math.ceil(rows.length/state.stockPageSize));
  state.funnelPage=Math.min(Math.max(1,state.funnelPage),pageCount);
  const pageRows=rows.slice((state.funnelPage-1)*state.stockPageSize,state.funnelPage*state.stockPageSize);
  // Столбцы показателей: значение и под ним изменение к прошлому периоду.
  const metrics=[['openCount',fmtNum],['cartCount',fmtNum],['addToCartPercent',fmtPercent],['addToWishlist',fmtNum],['orderCount',fmtNum],['cartToOrderPercent',fmtPercent],
    ['orderSum',fmtRub],['buyoutCount',fmtNum],['buyoutSum',fmtRub],['buyoutPercent',fmtPercent]];
  const cells=(values,past)=>metrics.map(([key,format])=>`<td>${format(values[key])}${funnelDelta(values[key],past?past[key]:null)}</td>`).join('');
  const total=funnelTotalValues(rows),totalPast=rows.some(row=>row.past)?funnelTotalValues(rows.map(row=>row.past||{})):null;
  const previous=state.funnelPeriods?.previous;
  const totalRow=rows.length?`<tr class="funnel-total-row"><td><strong>Итого по товарам</strong>${previous?`<small>к ${trendFullDate(previous.from)} – ${trendFullDate(previous.to)}</small>`:''}</td><td></td><td></td><td></td>${cells(total,totalPast)}</tr>`:'';
  $('#funnelProductsBody').innerHTML=totalRow+(pageRows.map(row=>`<tr><td class="funnel-product-cell">${row.photo?`<img class="stock-product-photo" src="${escapeHtml(row.photo)}" alt="" loading="lazy">`:''}<strong>${escapeHtml(row.title)}</strong></td>`+
    `<td>${escapeHtml(row.vendorCode||'—')}</td><td>${escapeHtml(row.nmId||'—')}</td><td>${escapeHtml(row.subjectName)}</td>${cells(row,row.past)}</tr>`).join('')||
    `<tr><td colspan="14" class="empty-row">${all.length?'Нет товаров по выбранным фильтрам':'Нет данных по товарам за период'}</td></tr>`);
  renderFunnelPagination(pageCount);
  $$('#funnelProductsBody .stock-product-photo').forEach(image=>{if(image.dataset.previewBound)return;image.dataset.previewBound='1';bindPhotoPreview(image)});
  $$('[data-funnel-sort]').forEach(header=>header.onclick=()=>{const key=header.dataset.funnelSort;state.funnelSort=state.funnelSort.key===key?{key,dir:state.funnelSort.dir==='asc'?'desc':'asc'}:{key,dir:'desc'};state.funnelPage=1;renderFunnelDetails()});
}
function renderFunnelPagination(pageCount){
  const el=$('#funnelPagination');if(!el)return;
  if(pageCount<=1){el.innerHTML='';el.classList.add('hidden');return}
  const pages=Array.from({length:pageCount},(_,index)=>index+1);el.classList.remove('hidden');
  el.innerHTML=`<button type="button" class="stock-page-button" data-funnel-page="prev" ${state.funnelPage===1?'disabled':''}>Назад</button><div class="stock-page-numbers">${pages.map(page=>`<button type="button" class="stock-page-button ${page===state.funnelPage?'active':''}" data-funnel-page="${page}" aria-current="${page===state.funnelPage?'page':'false'}">${page}</button>`).join('')}</div><button type="button" class="stock-page-button" data-funnel-page="next" ${state.funnelPage===pageCount?'disabled':''}>Вперёд</button>`;
  $$('[data-funnel-page]').forEach(button=>button.onclick=()=>{const target=button.dataset.funnelPage;const page=target==='prev'?state.funnelPage-1:target==='next'?state.funnelPage+1:Number(target);if(!Number.isInteger(page)||page<1||page>pageCount||page===state.funnelPage)return;state.funnelPage=page;renderFunnelDetails();document.querySelector('.funnel-products-panel')?.scrollIntoView({behavior:'smooth',block:'start'})});
}
let funnelArticleTip=null;
function hideFunnelArticleTip(){funnelArticleTip?.remove();funnelArticleTip=null}
function renderFunnelArticleOptions(){
  const box=$('#funnelArticleOptions');if(!box)return;
  const term=($('#funnelArticleSearch')?.value||'').trim().toLowerCase(),selected=state.funnelFilters.articles;
  const items=[...new Map((state.funnelProducts||[]).map(item=>{const p=item.product||item;return [String(p.nmId),{nmId:String(p.nmId),vendorCode:p.vendorCode||'',title:p.title||''}]})).values()]
    .sort((a,b)=>String(a.vendorCode||a.title).localeCompare(String(b.vendorCode||b.title),'ru',{numeric:true}));
  const found=term?items.filter(item=>`${item.vendorCode} ${item.nmId} ${item.title}`.toLowerCase().includes(term)):items;
  box.innerHTML=found.map(item=>`<label class="article-option" data-tip="${escapeHtml(`${item.vendorCode||item.title} · ${item.nmId}`)}"><input type="checkbox" value="${escapeHtml(item.nmId)}" ${selected.has(item.nmId)?'checked':''}><span><b>${escapeHtml(item.vendorCode||item.title||'Без артикула')}</b><small>${escapeHtml(item.nmId)}</small></span></label>`).join('')||
    `<span class="filter-empty">${items.length?'Ничего не найдено':'Товары ещё не загружены'}</span>`;
  box.querySelectorAll('.article-option').forEach(label=>{
    label.onmouseenter=()=>{hideFunnelArticleTip();const tip=document.createElement('div');tip.className='article-tip';tip.textContent=label.dataset.tip;document.body.append(tip);const rect=label.getBoundingClientRect();tip.style.left=`${Math.max(8,Math.min(rect.left,window.innerWidth-tip.offsetWidth-8))}px`;tip.style.top=`${Math.max(8,rect.top-tip.offsetHeight-2)}px`;funnelArticleTip=tip};
    label.onmouseleave=hideFunnelArticleTip;
  });
  box.querySelectorAll('input').forEach(input=>input.onchange=()=>{input.checked?selected.add(input.value):selected.delete(input.value);state.funnelPage=1;updateFunnelArticleSummary();renderFunnelDetails();scheduleFunnelTrendReload()});
  box.onscroll=hideFunnelArticleTip;
  updateFunnelArticleSummary();
}
function updateFunnelArticleSummary(){const size=state.funnelFilters.articles.size;const el=$('#funnelArticleSelected');if(el)el.textContent=size?`Выбрано: ${fmtNum(size)}`:'Все артикулы';$('#funnelArticleReset').disabled=!size}
document.addEventListener('input',event=>{if(event.target.id==='funnelArticleSearch')renderFunnelArticleOptions()});
document.addEventListener('click',event=>{
  if(event.target.id==='funnelArticleReset'){state.funnelFilters.articles.clear();state.funnelPage=1;renderFunnelArticleOptions();renderFunnelDetails();scheduleFunnelTrendReload()}
  if(!event.target.closest('.article-filter'))hideFunnelArticleTip();
});
// Предупреждения общей загрузки (лента заказов, баланс, новые задания) — в уведомлениях ленты заказов;
// подсказка демо-режима (первая строка) — во всех разделах.
function renderDashboardAlerts(){
  const alerts=state.dashboardAlerts||[];
  setNotices('*','demo',state.dashboardDemo?alerts.slice(0,1):[],'info');
  setNotices('orders','dashboard',state.dashboardDemo?alerts.slice(1):alerts);
}

// --- Вкладка «Продажи по дням» ---
const FUNNEL_SALES_METRICS=[
  {key:'orderCount',label:'Заказы, шт',unit:'шт'},
  {key:'orderSum',label:'Заказы, ₽',unit:'₽'},
  {key:'buyoutCount',label:'Выкупы, шт',unit:'шт'},
  {key:'buyoutSum',label:'Выкупы, ₽',unit:'₽'},
  {key:'cartCount',label:'Корзины',unit:'шт'},
  {key:'openCount',label:'Переходы',unit:'шт'}];
const funnelSales={data:null,metric:'orderCount',page:1,loading:false,error:'',pollTimer:0,requestId:0};
function funnelSalesMetric(){return FUNNEL_SALES_METRICS.find(item=>item.key===funnelSales.metric)||FUNNEL_SALES_METRICS[0]}
function funnelSalesValue(value){if(value==null)return '—';return funnelSalesMetric().unit==='₽'?fmtRub(value):fmtNum(value)}
function funnelSalesDelta(value,previous){
  if(value==null||previous==null)return '';
  if(!previous)return value?'<small class="sales-delta up">новое</small>':'';
  const change=Math.round((value-previous)/previous*1000)/10;
  if(!change)return '<small class="sales-delta flat">0%</small>';
  return `<small class="sales-delta ${change>0?'up':'down'}">${change>0?'+':'−'}${fmtNum(Math.abs(change))}%</small>`;
}
function switchFunnelTab(tab){
  state.funnelTab=tab;
  $$('[data-funnel-tab]').forEach(button=>button.classList.toggle('active',button.dataset.funnelTab===tab));
  $('.funnel-products-panel').classList.toggle('hidden',tab!=='products');
  $('#funnelSalesPanel').classList.toggle('hidden',tab!=='sales');
  if(tab==='sales'&&!funnelSales.data&&!funnelSales.loading)loadFunnelSales();
}
async function loadFunnelSales(){
  const cabinet=state.cabinet,from=$('#dateFrom').value,to=$('#dateTo').value,request=++funnelSales.requestId;
  clearTimeout(funnelSales.pollTimer);
  funnelSales.loading=true;funnelSales.error='';renderFunnelSales();
  try{
    const nmIds=funnelProductRows().map(row=>String(row.nmId));
    const data=await api('/api/funnel/sales',{method:'POST',body:JSON.stringify({cabinet,from,to,metric:funnelSales.metric,nmIds})});
    if(request!==funnelSales.requestId||cabinet!==state.cabinet)return;
    funnelSales.data=data;
    if(data.sync?.pending)funnelSales.pollTimer=setTimeout(()=>{if(request===funnelSales.requestId&&state.activePage==='funnel'&&state.funnelTab==='sales')loadFunnelSales()},5000);
  }catch(e){funnelSales.error=e.message}
  finally{if(request===funnelSales.requestId){funnelSales.loading=false;renderFunnelSales()}}
}
function renderFunnelSales(){
  const head=$('#funnelSalesHead'),body=$('#funnelSalesBody'),count=$('#funnelSalesCount');
  if(!head)return;
  $('#funnelSalesMetric').innerHTML=FUNNEL_SALES_METRICS.map(item=>`<option value="${item.key}" ${item.key===funnelSales.metric?'selected':''}>${escapeHtml(item.label)}</option>`).join('');
  const data=funnelSales.data;
  if(!data){head.innerHTML='';body.innerHTML='';count.textContent=funnelSales.error?`Ошибка: ${funnelSales.error}`:'Загрузка продаж по дням…';return}
  // Дни идут от свежих к старым, проценты сравнивают день с предыдущим.
  const order=data.dates.map((date,index)=>index).reverse();
  const byNmId=new Map((state.funnelProducts||[]).map(item=>{const p=item.product||item;return [String(p.nmId),p]}));
  const rows=data.products.map(product=>({...product,meta:byNmId.get(String(product.nmId))||{}}));
  const pageCount=Math.max(1,Math.ceil(rows.length/state.stockPageSize));
  funnelSales.page=Math.min(Math.max(1,funnelSales.page),pageCount);
  const pageRows=rows.slice((funnelSales.page-1)*state.stockPageSize,funnelSales.page*state.stockPageSize);
  const notes=[`${fmtNum(rows.length)} товаров`,`дней: ${fmtNum(data.dates.length)}`];
  if(data.sync?.pending)notes.push(`догружаем дни: осталось ${fmtNum(data.sync.pending)}`);
  if(funnelSales.loading)notes.push('обновляем…');
  if(funnelSales.error)notes.push(`ошибка: ${funnelSales.error}`);
  (data.warnings||[]).forEach(text=>notes.push(text));
  count.textContent=notes.join(' · ');
  // У столбцов фиксированная ширина: при длинном периоде таблица листается вбок, а не сжимает дни до нечитаемых.
  // Все дни делят одну ширину (ключ day): тянете один столбец дня — после перерисовки такими станут все.
  const dayWidth=funnelSalesMetric().unit==='₽'?108:84;
  head.innerHTML=`<th data-col-key="product" data-col-width="260">Товар</th><th data-col-key="vendorCode" data-col-width="140" title="Артикул продавца">Арт. продавца</th><th data-col-key="nmId" data-col-width="110" title="Артикул WB">Арт. WB</th><th data-col-key="total" data-col-width="${dayWidth+16}">Итого</th>`+
    order.map(index=>`<th data-col-key="day" data-col-width="${dayWidth}">${escapeHtml(formatShortDate(data.dates[index]))}</th>`).join('');
  const table=head.closest('table');table.dataset.widthKey='funnelSales';table.dataset.resizable='';table.removeAttribute('style');initResizableTables(table.parentNode);
  const cell=(values,index)=>`<td>${funnelSalesValue(values[index])}${funnelSalesDelta(values[index],index>0?values[index-1]:null)}</td>`;
  const totalsRow=`<tr class="sales-total-row"><td><strong>Итого</strong></td><td>—</td><td>—</td><td><strong>${funnelSalesValue(data.total)}</strong></td>`+
    order.map(index=>cell(data.totals,index)).join('')+'</tr>';
  body.innerHTML=rows.length?totalsRow+pageRows.map(row=>`<tr><td class="funnel-product-cell">${row.meta.photo?`<img class="stock-product-photo" src="${escapeHtml(row.meta.photo)}" alt="" loading="lazy">`:''}<strong>${escapeHtml(row.meta.title||`Товар ${row.nmId}`)}</strong></td>`+
    `<td>${escapeHtml(row.meta.vendorCode||'—')}</td><td>${escapeHtml(row.nmId)}</td><td><strong>${funnelSalesValue(row.total)}</strong></td>`+
    order.map(index=>cell(row.values,index)).join('')+'</tr>').join(''):
    `<tr><td colspan="${4+data.dates.length}" class="empty-row">Нет данных за выбранный период</td></tr>`;
  renderFunnelSalesPagination(pageCount);
  $$('#funnelSalesBody .stock-product-photo').forEach(image=>{if(image.dataset.previewBound)return;image.dataset.previewBound='1';bindPhotoPreview(image)});
}
function renderFunnelSalesPagination(pageCount){
  const el=$('#funnelSalesPagination');if(!el)return;
  if(pageCount<=1){el.innerHTML='';el.classList.add('hidden');return}
  const pages=Array.from({length:pageCount},(_,index)=>index+1);el.classList.remove('hidden');
  el.innerHTML=`<button type="button" class="stock-page-button" data-sales-page="prev" ${funnelSales.page===1?'disabled':''}>Назад</button><div class="stock-page-numbers">${pages.map(page=>`<button type="button" class="stock-page-button ${page===funnelSales.page?'active':''}" data-sales-page="${page}">${page}</button>`).join('')}</div><button type="button" class="stock-page-button" data-sales-page="next" ${funnelSales.page===pageCount?'disabled':''}>Вперёд</button>`;
  $$('[data-sales-page]').forEach(button=>button.onclick=()=>{const target=button.dataset.salesPage;const page=target==='prev'?funnelSales.page-1:target==='next'?funnelSales.page+1:Number(target);if(!Number.isInteger(page)||page<1||page>pageCount||page===funnelSales.page)return;funnelSales.page=page;renderFunnelSales()});
}
function formatShortDate(date){return `${date.slice(8,10)}.${date.slice(5,7)}`}
document.addEventListener('click',event=>{const button=event.target.closest('[data-funnel-tab]');if(button)switchFunnelTab(button.dataset.funnelTab)});
document.addEventListener('change',event=>{if(event.target.id==='funnelSalesMetric'){funnelSales.metric=event.target.value;funnelSales.page=1;loadFunnelSales()}});
