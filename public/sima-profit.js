// --- «Прибыль Сималенда»: оптовые цены Сималенда и Lenardi против цен товаров на WB выбранного кабинета ---
// Как таблица «Артикулы … с логистикой.xlsx». Данные — /api/sima-profit?cabinet= (модуль sima-profit.js): товары, у
// которых артикул продавца начинается с артикула Сималенда или это артикул Lenardi (305-043/L), их цена на WB,
// комиссия FBS предмета, объём, тариф логистики и опт поставщика: Сималенда — последней загрузки, Lenardi — из
// отчёта xlsx, загруженного кнопкой «Загрузить опт Lenardi» (POST /api/lenardi/upload). Расчёт — здесь, как формулы таблицы:
//   налог = цена × налог %; комиссия = цена × комиссия %;
//   логистика: объём > 1 л — первый литр + следующие литры по тарифу склада, до литра — ступень × коэффициент склада;
//   чистая прибыль = цена − налог − комиссия − сборка − логистика − закупка;
//   цена для нужной прибыли = (закупка + сборка + логистика) / (1 − налог − комиссия − желаемая прибыль), всё в долях
//   цены; если знаменатель ≤ 0 — «недостижимо»; отличие = цена для нужной прибыли / текущая цена − 1.
// Желаемая прибыль, налог, сборка и чем считать закупку (оптовой или обычной ценой; обычной есть только у Сималенда)
// запоминаются в браузере.
// «Применить цены» — выбранным галочками товарам ставит цену со скидкой, равную цене для нужной прибыли
// (POST /api/sima-profit/apply; скидка не меняется, большое снижение — ступенями по 30%), окно показывает ход и итог.
// Файл подключается до app.js: $, escapeHtml и прочее из app.js используются только внутри функций.
const SIMA_PROFIT_FILTERS=[['','Все товары'],['loss','Убыток'],['below','Прибыль ниже желаемой'],['above','Прибыль не ниже желаемой'],['noCost','Нет оптовой цены'],['notListed','Нет в списке поставщика'],['noStock','Нет в наличии на Сималенде']];
const SIMA_PROFIT_SUPPLIERS=[['','Все поставщики'],['sima','Сималенд'],['lenardi','Lenardi']];
const SIMA_PROFIT_STATUS={
  sima:{noPrice:'Нет цены на Сималенде',missing:'Нет на Сималенде',failed:'Цена не загрузилась',notListed:'Нет на листе «Артикулы» таблицы',notLoaded:'Цены Сималенда ещё не загружались'},
  lenardi:{noPrice:'Нет опта в файле Lenardi',notListed:'Нет в файле опт Lenardi',notLoaded:'Файл опт Lenardi не загружен'}};
const simaSupplierStatus=supplier=>supplier.status==='ok'?(supplier.inStock===false?'Нет в наличии':''):SIMA_PROFIT_STATUS[supplier.source]?.[supplier.status]||'';
const simaProfit={data:null,error:'',request:0,key:'',search:'',filter:'',supplier:'',sort:{key:'margin',dir:'asc'},page:1,pageSize:pageSizeFor('sima-profit'),searchTimer:0,settingsTimer:0,selected:new Set(),applyTimer:0,
  settings:{target:20,tax:6,assembly:50,cost:'wholesale'}};
try{
  const saved=JSON.parse(localStorage.getItem('wb-sima-profit')||'{}');
  for(const key of ['target','tax','assembly'])if(Number.isFinite(saved[key]))simaProfit.settings[key]=saved[key];
  if(['wholesale','retail'].includes(saved.cost))simaProfit.settings.cost=saved.cost;
}catch{/* настройки по умолчанию */}
const simaRub=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0});
const simaKopecks=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2});
const simaPercent=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1});
// Прибыль ниже желаемой — по тому же значению, что на экране (до десятой процента): иначе 14,96% показывается
// как «15%», но красится и отбирается как ниже 15%.
function simaBelow(margin,target){return Math.round(margin*10)/10<target}

function simaLogistics(volume,tariff){
  if(!volume||!tariff)return null;
  if(volume>1)return tariff.base+tariff.liter*(volume-1);
  return (tariff.small.find(([liters])=>volume<=liters)||tariff.small[tariff.small.length-1])[1]*tariff.coef/100;
}
// Расчёт одной строки; null — посчитать нельзя (нет цены, комиссии, объёма или цены поставщика).
function simaProfitCalc(row,settings,tariff){
  const cost=settings.cost==='retail'?row.supplier.retail:row.supplier.wholesale,logistics=simaLogistics(row.volume,tariff);
  const out={cost,logistics,tax:null,fee:null,profit:null,margin:null,need:null,diff:null};
  if(row.price){out.tax=row.price*settings.tax/100;if(row.commission!=null)out.fee=row.price*row.commission/100}
  if(cost==null||logistics==null||row.commission==null)return out;
  if(row.price){out.profit=row.price-out.tax-out.fee-settings.assembly-logistics-cost;out.margin=out.profit/row.price*100}
  const share=1-settings.tax/100-row.commission/100-settings.target/100;
  // До копеек, как ОКРУГЛ в Excel: сначала 15 значащих цифр, иначе 2885,375 из-за двоичной дроби округлится вниз.
  out.need=share<=0?'unreachable':Math.round(Number(((cost+settings.assembly+logistics)/share*100).toPrecision(15)))/100;
  if(typeof out.need==='number'&&row.price)out.diff=(out.need/row.price-1)*100;
  return out;
}

function loadSimaProfit(force=false){
  const v=simaProfit,key=state.cabinet;
  if(!force&&v.key===key&&v.data){renderSimaProfit();return}
  const request=++v.request;
  if(v.key!==key){v.data=null;v.page=1;v.selected.clear()}
  v.key=key;v.error='';renderSimaProfit();
  // Как в других разделах: пока идёт загрузка (цены WB всех товаров — до 15 секунд), «Обновить» крутится.
  const button=$('#refresh');button?.classList.add('loading');
  api(`/api/sima-profit?cabinet=${encodeURIComponent(key)}${force?'&force=1':''}`).then(data=>{
    if(request!==v.request||state.cabinet!==key)return;
    v.data=data;renderSimaProfit();
  }).catch(error=>{if(request!==v.request||state.cabinet!==key)return;v.error=error.message;renderSimaProfit()})
    .finally(()=>{if(request===v.request)button?.classList.remove('loading')});
}
function saveSimaProfitSettings(){try{localStorage.setItem('wb-sima-profit',JSON.stringify(simaProfit.settings))}catch{/* без сохранения */}}

// Все строки с расчётом, отобранные и отсортированные; пустые значения — всегда в конце.
function simaProfitRows(){
  const v=simaProfit,s=v.settings,data=v.data,term=v.search.trim().toLowerCase();
  const all=(data?.rows||[]).map(row=>({row,calc:simaProfitCalc(row,s,data.tariff)}));
  const test={loss:({calc})=>calc.profit!=null&&calc.profit<0,below:({calc})=>calc.margin!=null&&simaBelow(calc.margin,s.target),above:({calc})=>calc.margin!=null&&!simaBelow(calc.margin,s.target),
    noCost:({calc})=>calc.cost==null,notListed:({row})=>row.supplier.status==='notListed',noStock:({row})=>row.supplier.inStock===false}[v.filter];
  const value={name:({row})=>row.name,nmId:({row})=>row.nmId,article:({row})=>`${row.supplier.source} ${row.article}`,price:({row})=>row.price,cost:({calc})=>calc.cost,commission:({row})=>row.commission,
    tax:({calc})=>calc.tax,logistics:({calc})=>calc.logistics,profit:({calc})=>calc.profit,margin:({calc})=>calc.margin,need:({calc})=>calc.need==='unreachable'?Infinity:calc.need,diff:({calc})=>calc.diff==null&&calc.need==='unreachable'?Infinity:calc.diff}[v.sort.key]||(()=>null);
  const rows=all.filter(item=>(!v.supplier||item.row.supplier.source===v.supplier)&&(!test||test(item))&&(!term||[item.row.name,item.row.nmId,item.row.vendorCode,item.row.article,item.row.subject].join(' ').toLowerCase().includes(term)));
  rows.sort((a,b)=>{const x=value(a),y=value(b);if(x==null||y==null)return x==null&&y==null?0:x==null?1:-1;const result=typeof x==='number'?x-y:String(x).localeCompare(String(y),'ru',{numeric:true});return v.sort.dir==='asc'?result:-result});
  return {all,rows};
}
const simaMoney=(value,format=simaRub)=>value==null?'<span class="change-muted">—</span>':`${format.format(value)} ₽`;
function simaProfitCells({row,calc}){
  const s=simaProfit.settings,supplier=row.supplier,status=simaSupplierStatus(supplier);
  // Сималенд — ссылкой на товар; у Lenardi своей страницы товара нет. Название поставщика — только когда в таблице оба.
  const name=simaProfit.supplier?'':`<small class="sima-profit-sub">${supplier.source==='sima'?'Сималенд':'Lenardi'}</small>`;
  const article=supplier.source==='sima'
    ?`<a class="change-link" href="https://www.sima-land.ru/${encodeURIComponent(row.article)}/" target="_blank" rel="noopener noreferrer" title="${escapeHtml(supplier.name||'Открыть на Сималенде')}">${escapeHtml(row.article)}</a>${name}`
    :`<strong>${escapeHtml(row.article)}</strong>${name}`;
  const margin=calc.margin==null?'':`<small class="sima-profit-mark ${calc.margin<0?'down':simaBelow(calc.margin,s.target)?'warn':'up'}" title="Чистая прибыль в процентах от цены на WB">${simaPercent.format(calc.margin)}%</small>`;
  const need=calc.need==='unreachable'?'<span class="sima-profit-mark down" title="Налог, комиссия и желаемая прибыль вместе — 100% цены или больше">недостижимо</span>':simaMoney(calc.need);
  const diff=calc.diff==null?'<span class="change-muted">—</span>':`<strong class="sima-profit-mark ${calc.diff>0?'down':'up'}">${calc.diff>0?'+':calc.diff<0?'−':''}${simaPercent.format(Math.abs(calc.diff))}%</strong>`;
  return `<td><div class="sima-profit-product">${row.photo?`<img class="stock-product-photo" src="${escapeHtml(row.photo)}" alt="" loading="lazy">`:''}<span><strong title="${escapeHtml(row.name)}">${escapeHtml(row.name)}</strong><small>${escapeHtml(row.subject||'')}</small></span></div></td>`+
    `<td><a class="change-link" href="https://www.wildberries.ru/catalog/${row.nmId}/detail.aspx" target="_blank" rel="noopener noreferrer" title="Открыть на WB">${row.nmId}</a><small class="sima-profit-sub">${escapeHtml(row.vendorCode)}</small></td>`+
    `<td>${article}${status?`<small class="sima-profit-sub sima-profit-mark ${supplier.status==='ok'?'warn':'down'}" title="${escapeHtml(status)}">${escapeHtml(status)}</small>`:''}</td>`+
    `<td><strong>${simaMoney(row.price)}</strong></td>`+
    `<td><strong>${simaMoney(calc.cost,simaKopecks)}</strong></td>`+
    `<td>${row.commission==null?'<span class="change-muted">—</span>':`${simaPercent.format(row.commission)}%`}${calc.fee!=null?`<small class="sima-profit-sub">${simaRub.format(calc.fee)} ₽</small>`:''}</td>`+
    `<td>${simaMoney(calc.tax)}</td>`+
    `<td>${simaMoney(calc.logistics)}${row.volume?`<small class="sima-profit-sub">${simaKopecks.format(row.volume)} л</small>`:''}</td>`+
    `<td><strong>${simaMoney(calc.profit)}</strong>${margin}</td><td><strong>${need}</strong></td><td>${diff}</td>`;
}
// Сообщения — только о выбранном поставщике (или об обоих, если выбраны все).
function simaProfitNotes(data,rows){
  const l=data.lenardi,notes=[],show=source=>!simaProfit.supplier||simaProfit.supplier===source;
  if(show('sima'))notes.push(data.simaAt?`Цены Сималенда загружены ${changeTime(data.simaAt)}${data.simaRefreshing?' · сейчас загружаются новые':''}`:'Цены Сималенда ещё не загружались — нажмите «Загрузить цены сейчас» в разделе «Цены Сималенда» или подождите плановой загрузки');
  // Дата отчёта без времени («11.11.2026 10:42» → «11.11.2026»); нет даты в отчёте — когда загружен файл.
  if(show('lenardi'))notes.push(l?`Опт Lenardi от ${String(l.reportDate||'').split(' ')[0]||changeTime(l.uploadedAt)}`:'Опт Lenardi не загружен — нажмите «Загрузить опт Lenardi» и выберите отчёт xlsx с колонками «Артикул» и «Опт.»');
  const notListed=source=>rows.filter(item=>item.row.supplier.source===source&&item.row.supplier.status==='notListed').length;
  const word=count=>pluralRu(count,['артикула','артикулов','артикулов']);
  if(show('sima')&&notListed('sima'))notes.push(`${fmtNum(notListed('sima'))} ${word(notListed('sima'))} нет на листе «Артикулы» таблицы Сималенда — допишите их туда, чтобы загружались цены`);
  if(show('lenardi')&&l&&notListed('lenardi'))notes.push(`${fmtNum(notListed('lenardi'))} ${word(notListed('lenardi'))} Lenardi нет в файле опт`);
  return [...notes,...(data.warnings||[])].join(' · ');
}
// Тариф логистики — в подсказке к заголовку «Логистика», а не в строке над таблицей.
function simaLogisticsTitle(t){
  return `Логистика по объёму упаковки из карточки, тариф WB «${t.warehouse}»: ${simaKopecks.format(t.base)} ₽ первый литр, ${simaKopecks.format(t.liter)} ₽ каждый следующий; до литра — ${t.small.map(([liters,rub])=>`до ${simaKopecks.format(liters)} л ${simaKopecks.format(rub*t.coef/100)} ₽`).join(', ')}`;
}

function renderSimaProfit(){
  const v=simaProfit,data=v.data,body=$('#simaProfitBody');
  if(!body)return;
  for(const [id,key] of [['#simaProfitTarget','target'],['#simaProfitTax','tax'],['#simaProfitAssembly','assembly']]){const input=$(id);if(document.activeElement!==input)input.value=String(v.settings[key])}
  $('#simaProfitCost').value=v.settings.cost;
  $('#simaProfitFilter').innerHTML=SIMA_PROFIT_FILTERS.map(([value,label])=>`<option value="${value}"${value===v.filter?' selected':''}>${label}</option>`).join('');
  $('#simaProfitSupplier').innerHTML=SIMA_PROFIT_SUPPLIERS.map(([value,label])=>`<option value="${value}"${value===v.supplier?' selected':''}>${label}</option>`).join('');
  $$('#page-sima-profit [data-sima-sort]').forEach(th=>{const active=th.dataset.simaSort===v.sort.key;th.classList.toggle('sorted',active);th.dataset.label??=th.textContent;th.textContent=`${th.dataset.label} ${active?(v.sort.dir==='asc'?'↑':'↓'):'↕'}`});
  const empty=(count,text)=>{body.innerHTML='';$('#simaProfitCount').textContent=count;$('#simaProfitHint').textContent='';$('#emptySimaProfitText').textContent=text;$('#emptySimaProfit').classList.toggle('hidden',!text);$('#simaProfitPagination').classList.add('hidden');$('#simaProfitActions').classList.add('hidden')};
  if(!data)return empty(v.error?`Не удалось загрузить: ${v.error}`:'Загрузка товаров и цен…','');
  if(data.demo)return empty('Демо-кабинет','Выберите кабинет с токеном WB: раздел сравнивает цены его товаров с оптом Сималенда и Lenardi.');
  if(!data.configured)return empty('Таблица Сималенда не подключена','Впишите в .env сайта SIMA_SHEET_URL и SIMA_SHEET_KEY и перезапустите сервер. Инструкция — google-sheets/sima-land/README.md.');
  const {all,rows}=simaProfitRows(),pageCount=Math.ceil(rows.length/v.pageSize);
  v.page=Math.min(Math.max(1,v.page),Math.max(1,pageCount));
  // Счётчики — по выбранному поставщику (поиск и отбор их не меняют); нули не показываются.
  const scope=v.supplier?all.filter(item=>item.row.supplier.source===v.supplier):all,count=test=>scope.filter(test).length;
  const counts=[['убыток',count(({calc})=>calc.profit!=null&&calc.profit<0)],['ниже желаемой прибыли',count(({calc})=>calc.margin!=null&&simaBelow(calc.margin,v.settings.target))],['без оптовой цены',count(({calc})=>calc.cost==null)]];
  $('#simaProfitCount').textContent=[`${rows.length===scope.length?'':`${fmtNum(rows.length)} из `}${fmtNum(scope.length)} ${pluralRu(scope.length,['товар','товара','товаров'])}`,...counts.filter(([,value])=>value).map(([label,value])=>`${label}: ${fmtNum(value)}`)].join(' · ');
  $('#simaProfitHint').textContent=simaProfitNotes(data,all);
  if(data.tariff)$('#page-sima-profit [data-sima-sort="logistics"]').title=simaLogisticsTitle(data.tariff);
  const pageRows=rows.slice((v.page-1)*v.pageSize,v.page*v.pageSize);
  body.innerHTML=pageRows.map(item=>`<tr><td class="check-col"><input type="checkbox" data-sima-select="${item.row.nmId}" aria-label="Выбрать товар"${v.selected.has(String(item.row.nmId))?' checked':''}></td>${simaProfitCells(item)}</tr>`).join('');
  $('#simaProfitSelectAll').checked=pageRows.length>0&&pageRows.every(item=>v.selected.has(String(item.row.nmId)));
  v.filtered=rows.map(item=>String(item.row.nmId));
  renderSimaProfitActions();
  $$('#simaProfitBody .stock-product-photo').forEach(image=>{if(image.dataset.previewBound)return;image.dataset.previewBound='1';bindPhotoPreview(image)});
  $('#emptySimaProfitText').textContent=all.length?'Измените поиск или отбор.':'В кабинете нет товаров, у которых артикул продавца начинается с артикула Сималенда (например, 6938164/125/ШДФ) или это артикул Lenardi (например, 305-043/L).';
  $('#emptySimaProfit').classList.toggle('hidden',rows.length>0);
  renderPager($('#simaProfitPagination'),{page:v.page,pageCount,total:rows.length,sizeKey:'sima-profit',onPage:page=>{v.page=page;renderSimaProfit();document.querySelector('#page-sima-profit .stock-panel')?.scrollIntoView({behavior:'smooth',block:'start'})},onSize:size=>{v.pageSize=size;v.page=1;renderSimaProfit()}});
}

function renderSimaProfitActions(){
  const v=simaProfit,count=v.selected.size,filtered=v.filtered||[];
  $('#simaProfitActions').classList.toggle('hidden',!count||state.activePage!=='sima-profit');
  $('#simaProfitSelected').textContent=`Выбрано: ${fmtNum(count)}`;
  const button=$('#simaProfitSelectFiltered'),all=filtered.length>0&&filtered.every(id=>v.selected.has(id));
  button.classList.toggle('hidden',all);button.textContent=`Выбрать все отобранные: ${fmtNum(filtered.length)}`;
}

// --- «Применить цены» ---
// Выбранные товары с расчётом: нужная цена со скидкой против текущей. Без расчёта (нет оптовой цены, «недостижимо») —
// пропускаются. Снижение больше 30% сервер делает ступенями.
function simaApplyPlan(){
  const v=simaProfit,data=v.data,plan={items:[],up:0,down:0,steps:0,same:0,skipped:0,changes:[]};
  for(const row of data?.rows||[]){
    if(!v.selected.has(String(row.nmId)))continue;
    const calc=simaProfitCalc(row,v.settings,data.tariff);
    if(typeof calc.need!=='number'||!row.price){plan.skipped++;continue}
    plan.items.push({nmId:row.nmId,target:calc.need});
    if(Math.abs(calc.need-row.price)<1){plan.same++;continue}
    if(calc.need>row.price)plan.up++;else{plan.down++;if(calc.need<row.price*0.7)plan.steps++}
    plan.changes.push({row,need:calc.need,diff:calc.diff});
  }
  plan.changes.sort((a,b)=>Math.abs(b.diff)-Math.abs(a.diff));
  return plan;
}
function openSimaApply(){
  const v=simaProfit,s=v.settings;
  if(!v.data||v.data.demo)return toast('В демо-кабинете цены не меняются');
  if(!v.selected.size)return toast('Отметьте товары галочками');
  const plan=simaApplyPlan(),cost=s.cost==='retail'?'обычной':'оптовой';
  const tile=(value,label)=>`<div><b>${fmtNum(value)}</b><span>${label}</span></div>`;
  const list=plan.changes.slice(0,50).map(({row,need,diff})=>`<tr><td>${escapeHtml(row.name)}<br><small>${row.nmId}</small></td><td>${simaRub.format(row.price)} ₽</td><td><strong>${simaRub.format(need)} ₽</strong></td><td class="sima-profit-mark ${diff>0?'up':'down'}">${diff>0?'+':'−'}${simaPercent.format(Math.abs(diff))}%</td></tr>`).join('');
  openModal(`<p class="eyebrow">Прибыль Сималенда</p><h2>Применить цены</h2>
    <p class="sima-apply-note">Цена со скидкой станет «Ценой для нужной прибыли»: прибыль ${simaPercent.format(s.target)}%, налог ${simaPercent.format(s.tax)}%, сборка ${simaRub.format(s.assembly)} ₽, закупка по ${cost} цене поставщика. Скидка продавца не меняется — пересчитывается цена до скидки (целая, с округлением вверх).</p>
    <div class="sima-apply-summary">${tile(plan.up,'цена вырастет')}${tile(plan.down,'цена снизится')}${plan.steps?tile(plan.steps,'снизятся ступенями — больше чем на 30%'):''}${plan.same?tile(plan.same,'почти без изменений'):''}${plan.skipped?tile(plan.skipped,'без расчёта — пропустим'):''}</div>
    ${list?`<div class="sima-apply-list"><table><thead><tr><th>Товар</th><th>Сейчас</th><th>Станет</th><th>Изменение</th></tr></thead><tbody>${list}</tbody></table></div>`:''}
    <p class="sima-apply-note">Перед загрузкой прежние цены сохранятся в файл для отката (data/Sima/Откаты цен). Снижение больше чем на 30% WB отправил бы в карантин, поэтому такие товары снижаются в несколько загрузок, по 30% за раз.</p>
    <button class="primary" id="simaApplyConfirm"${plan.items.length?'':' disabled'}>Отправить в WB: ${fmtNum(plan.items.length)} ${pluralRu(plan.items.length,['товар','товара','товаров'])}</button>
    <div class="sima-apply-status" id="simaApplyStatus"></div>`);
  $('#simaApplyConfirm').onclick=async()=>{
    const button=$('#simaApplyConfirm');button.disabled=true;button.textContent='Отправляем…';
    try{const result=await api('/api/sima-profit/apply',{method:'POST',body:JSON.stringify({cabinet:state.cabinet,items:plan.items,confirm:true})});button.remove();watchSimaApply(state.cabinet,result.job)}
    catch(error){button.disabled=false;button.textContent='Отправить в WB';$('#simaApplyStatus').className='sima-apply-status error';$('#simaApplyStatus').textContent=error.message}
  };
  // Если цены этого кабинета уже меняются — сразу ход загрузки.
  api(`/api/sima-profit/apply?cabinet=${encodeURIComponent(state.cabinet)}`).then(result=>{if(result.job?.running&&$('#simaApplyConfirm')){$('#simaApplyConfirm').remove();watchSimaApply(state.cabinet,result.job)}}).catch(()=>{});
}
// Ход и итог: опрос раз в 2 секунды, пока окно открыто и загрузка идёт.
function watchSimaApply(cabinet,job){
  clearTimeout(simaProfit.applyTimer);
  const box=$('#simaApplyStatus');if(!box||!job)return;
  const errors=job.errors||[];
  if(job.running){box.className='sima-apply-status';box.textContent=`${job.phase||'Идёт загрузка'}… Окно можно закрыть — загрузка продолжится на сервере.`}
  else{
    const lines=[job.error?`Загрузка прервалась: ${job.error}`:'Готово.',`Цена выросла: ${fmtNum(job.raised)}, снизилась: ${fmtNum(job.lowered)}${job.unchanged?`, уже была нужной: ${fmtNum(job.unchanged)}`:''}${job.steps>1?` · загрузок: ${job.steps}`:''}.`];
    if(job.errorCount)lines.push(`Не изменились: ${fmtNum(job.errorCount)}.`);
    if(job.rollback)lines.push(`Прежние цены — в файле ${job.rollback}`);
    box.className=`sima-apply-status${job.error||job.errorCount?' error':''}`;
    box.innerHTML=lines.map(line=>escapeHtml(line)).join('<br>')+(errors.length?`<div class="sima-apply-list"><table><tbody>${errors.map(item=>`<tr><td>${item.nmId}</td><td>${escapeHtml(item.text)}</td></tr>`).join('')}</tbody></table></div>`:'');
    simaProfit.selected.clear();
    if(state.cabinet===cabinet&&state.activePage==='sima-profit')loadSimaProfit(true);
    return;
  }
  simaProfit.applyTimer=setTimeout(async()=>{
    if(!$('#simaApplyStatus'))return;
    try{watchSimaApply(cabinet,(await api(`/api/sima-profit/apply?cabinet=${encodeURIComponent(cabinet)}`)).job)}
    catch{watchSimaApply(cabinet,job)}
  },2000);
}

// Скачать то, что отобрано, в CSV для Excel: точка с запятой, запятая в дробях, BOM — чтобы Excel узнал UTF-8.
function exportSimaProfit(){
  const v=simaProfit,s=v.settings;if(!v.data?.rows?.length)return toast('Нет товаров для выгрузки');
  const number=value=>value==null||!Number.isFinite(value)?'':String(Math.round(value*100)/100).replace('.',',');
  const text=value=>/[;"\n]/.test(String(value))?`"${String(value).replace(/"/g,'""')}"`:String(value);
  const head=['Название товара','Арт. WB','Арт. продавца','Поставщик','Арт. поставщика','Цена WB','Комиссия, %','Опт. цена','Розн. цена','Налог','Комиссия, ₽','Сборка','Объём, л','Логистика','Чистая прибыль','Прибыль от цены, %','Цена для нужной прибыли','Отличие от текущей цены, %','Состояние у поставщика'];
  const lines=simaProfitRows().rows.map(({row,calc})=>[text(row.name),row.nmId,text(row.vendorCode),row.supplier.source==='sima'?'Сималенд':'Lenardi',text(row.article),number(row.price),number(row.commission),number(row.supplier.wholesale),number(row.supplier.retail),number(calc.tax),number(calc.fee),number(s.assembly),number(row.volume),number(calc.logistics),number(calc.profit),number(calc.margin),calc.need==='unreachable'?'недостижимо':number(calc.need),number(calc.diff),text(simaSupplierStatus(row.supplier))].join(';'));
  const settings=`Желаемая прибыль ${number(s.target)}%; налог ${number(s.tax)}%; сборка ${number(s.assembly)} ₽; закупка по ${s.cost==='retail'?'обычной':'оптовой'} цене поставщика`;
  const link=document.createElement('a'),cabinet=state.cabinets.find(item=>item.id===state.cabinet)?.name||'кабинет';
  link.href=URL.createObjectURL(new Blob([`﻿${settings}\n${head.join(';')}\n${lines.join('\n')}`],{type:'text/csv;charset=utf-8'}));
  link.download=`Прибыль Сималенда — ${cabinet.replace(/[\\/:*?"<>|]/g,' ')} — ${new Date().toLocaleDateString('ru-RU')}.csv`;
  document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(link.href),1000);
}

// Опт Lenardi: файл xlsx уходит на сервер в base64, тот читает его и сохраняет цены; потом раздел перечитывается.
async function uploadLenardi(input){
  const file=input.files?.[0];input.value='';if(!file)return;
  const label=$('#lenardiUploadLabel');label.classList.add('busy');
  try{
    const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]||'');reader.onerror=()=>reject(new Error('Не удалось прочитать файл'));reader.readAsDataURL(file)});
    const result=(await api('/api/lenardi/upload',{method:'POST',body:JSON.stringify({name:file.name,data})})).lenardi;
    toast(`Опт Lenardi загружен: артикулов ${fmtNum(result.articles)}, с оптом ${fmtNum(result.withPrice)}`);
    loadSimaProfit(true);
  }catch(error){toast(error.message)}
  finally{label.classList.remove('busy')}
}

document.addEventListener('click',event=>{
  if(event.target.closest('#simaProfitExport'))return exportSimaProfit();
  if(event.target.closest('#simaProfitApply'))return openSimaApply();
  if(event.target.closest('#simaProfitClear')){simaProfit.selected.clear();return renderSimaProfit()}
  if(event.target.closest('#simaProfitSelectFiltered')){for(const id of simaProfit.filtered||[])simaProfit.selected.add(id);return renderSimaProfit()}
  const th=event.target.closest('#page-sima-profit [data-sima-sort]');if(!th)return;
  const key=th.dataset.simaSort,v=simaProfit;v.sort=v.sort.key===key?{key,dir:v.sort.dir==='asc'?'desc':'asc'}:{key,dir:['name'].includes(key)?'asc':'desc'};v.page=1;renderSimaProfit();
});
// Поиск и настройки — после паузы в наборе: не пересчитывать таблицу на каждую букву.
document.addEventListener('input',event=>{
  const v=simaProfit,id=event.target.id;
  if(id==='simaProfitSearch'){clearTimeout(v.searchTimer);v.searchTimer=setTimeout(()=>{v.search=event.target.value;v.page=1;if(v.data)renderSimaProfit()},250);return}
  const key={simaProfitTarget:'target',simaProfitTax:'tax',simaProfitAssembly:'assembly'}[id];if(!key)return;
  const value=Number(String(event.target.value).replace(',','.'));if(event.target.value===''||!Number.isFinite(value)||value<0||(key!=='assembly'&&value>=100))return;
  clearTimeout(v.settingsTimer);v.settingsTimer=setTimeout(()=>{v.settings[key]=value;saveSimaProfitSettings();if(v.data)renderSimaProfit()},250);
});
document.addEventListener('change',event=>{
  const v=simaProfit;
  if(event.target.id==='simaProfitFilter'){v.filter=event.target.value;v.page=1;renderSimaProfit()}
  if(event.target.id==='simaProfitSupplier'){v.supplier=event.target.value;v.page=1;renderSimaProfit()}
  if(event.target.id==='lenardiFile')uploadLenardi(event.target);
  if(event.target.id==='simaProfitCost'){v.settings.cost=event.target.value==='retail'?'retail':'wholesale';saveSimaProfitSettings();renderSimaProfit()}
  if(event.target.dataset?.simaSelect){const id=event.target.dataset.simaSelect;if(event.target.checked)v.selected.add(id);else v.selected.delete(id);renderSimaProfit()}
  if(event.target.id==='simaProfitSelectAll'){for(const input of $$('#simaProfitBody [data-sima-select]')){if(event.target.checked)v.selected.add(input.dataset.simaSelect);else v.selected.delete(input.dataset.simaSelect)}renderSimaProfit()}
});
