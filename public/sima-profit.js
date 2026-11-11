// --- «Прибыль Сималенда»: оптовые цены Сималенда против цен товаров на WB выбранного кабинета ---
// Как таблица «Артикулы … с логистикой.xlsx». Данные — /api/sima-profit?cabinet= (модуль sima-profit.js): товары, у
// которых артикул продавца начинается с артикула Сималенда, их цена на WB, комиссия FBS предмета, объём, тариф
// логистики и цены Сималенда последней загрузки. Расчёт — здесь, как формулы таблицы:
//   налог = цена × налог %; комиссия = цена × комиссия %;
//   логистика: объём > 1 л — первый литр + следующие литры по тарифу склада, до литра — ступень × коэффициент склада;
//   чистая прибыль = цена − налог − комиссия − сборка − логистика − закупка;
//   цена для нужной прибыли = (закупка + сборка + логистика) / (1 − налог − комиссия − желаемая прибыль), всё в долях
//   цены; если знаменатель ≤ 0 — «недостижимо»; отличие = цена для нужной прибыли / текущая цена − 1.
// Желаемая прибыль, налог, сборка и чем считать закупку (оптовой или обычной ценой Сималенда) запоминаются в браузере.
// Файл подключается до app.js: $, escapeHtml и прочее из app.js используются только внутри функций.
const SIMA_PROFIT_FILTERS=[['','Все товары'],['loss','Убыток'],['below','Прибыль ниже желаемой'],['above','Прибыль не ниже желаемой'],['noSima','Нет цены Сималенда'],['notListed','Нет на листе «Артикулы» таблицы'],['noStock','Нет в наличии на Сималенде']];
const SIMA_PROFIT_STATUS={noPrice:'Нет цены на Сималенде',missing:'Нет на Сималенде',failed:'Цена не загрузилась',notListed:'Нет на листе «Артикулы» таблицы',notLoaded:'Цены Сималенда ещё не загружались'};
const simaProfit={data:null,error:'',request:0,key:'',search:'',filter:'',sort:{key:'margin',dir:'asc'},page:1,pageSize:pageSizeFor('sima-profit'),searchTimer:0,settingsTimer:0,
  settings:{target:20,tax:6,assembly:50,cost:'wholesale'}};
try{
  const saved=JSON.parse(localStorage.getItem('wb-sima-profit')||'{}');
  for(const key of ['target','tax','assembly'])if(Number.isFinite(saved[key]))simaProfit.settings[key]=saved[key];
  if(['wholesale','retail'].includes(saved.cost))simaProfit.settings.cost=saved.cost;
}catch{/* настройки по умолчанию */}
const simaRub=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0});
const simaKopecks=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2});
const simaPercent=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1});

function simaLogistics(volume,tariff){
  if(!volume||!tariff)return null;
  if(volume>1)return tariff.base+tariff.liter*(volume-1);
  return (tariff.small.find(([liters])=>volume<=liters)||tariff.small[tariff.small.length-1])[1]*tariff.coef/100;
}
// Расчёт одной строки; null — посчитать нельзя (нет цены, комиссии, объёма или цены Сималенда).
function simaProfitCalc(row,settings,tariff){
  const cost=settings.cost==='retail'?row.sima.retail:row.sima.wholesale,logistics=simaLogistics(row.volume,tariff);
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
  if(v.key!==key){v.data=null;v.page=1}
  v.key=key;v.error='';renderSimaProfit();
  api(`/api/sima-profit?cabinet=${encodeURIComponent(key)}${force?'&force=1':''}`).then(data=>{
    if(request!==v.request||state.cabinet!==key)return;
    v.data=data;renderSimaProfit();
  }).catch(error=>{if(request!==v.request||state.cabinet!==key)return;v.error=error.message;renderSimaProfit()});
}
function saveSimaProfitSettings(){try{localStorage.setItem('wb-sima-profit',JSON.stringify(simaProfit.settings))}catch{/* без сохранения */}}

// Все строки с расчётом, отобранные и отсортированные; пустые значения — всегда в конце.
function simaProfitRows(){
  const v=simaProfit,s=v.settings,data=v.data,term=v.search.trim().toLowerCase();
  const all=(data?.rows||[]).map(row=>({row,calc:simaProfitCalc(row,s,data.tariff)}));
  const test={loss:({calc})=>calc.profit!=null&&calc.profit<0,below:({calc})=>calc.margin!=null&&calc.margin<s.target,above:({calc})=>calc.margin!=null&&calc.margin>=s.target,
    noSima:({calc})=>calc.cost==null,notListed:({row})=>row.sima.status==='notListed',noStock:({row})=>row.sima.inStock===false}[v.filter];
  const value={name:({row})=>row.name,nmId:({row})=>row.nmId,sid:({row})=>Number(row.sid),price:({row})=>row.price,cost:({calc})=>calc.cost,commission:({row})=>row.commission,
    tax:({calc})=>calc.tax,logistics:({calc})=>calc.logistics,profit:({calc})=>calc.profit,margin:({calc})=>calc.margin,need:({calc})=>calc.need==='unreachable'?Infinity:calc.need,diff:({calc})=>calc.diff==null&&calc.need==='unreachable'?Infinity:calc.diff}[v.sort.key]||(()=>null);
  const rows=all.filter(item=>(!test||test(item))&&(!term||[item.row.name,item.row.nmId,item.row.vendorCode,item.row.sid,item.row.subject].join(' ').toLowerCase().includes(term)));
  rows.sort((a,b)=>{const x=value(a),y=value(b);if(x==null||y==null)return x==null&&y==null?0:x==null?1:-1;const result=typeof x==='number'?x-y:String(x).localeCompare(String(y),'ru');return v.sort.dir==='asc'?result:-result});
  return {all,rows};
}
const simaMoney=(value,format=simaRub)=>value==null?'<span class="change-muted">—</span>':`${format.format(value)} ₽`;
function simaProfitCells({row,calc}){
  const s=simaProfit.settings,sima=row.sima,status=sima.status==='ok'?(sima.inStock===false?'Нет в наличии':''):SIMA_PROFIT_STATUS[sima.status]||'';
  const other=s.cost==='retail'?['опт.',sima.wholesale]:['розн.',sima.retail];
  const margin=calc.margin==null?'':`<small class="sima-profit-mark ${calc.margin<0?'down':calc.margin<s.target?'warn':'up'}">${simaPercent.format(calc.margin)}% от цены</small>`;
  const need=calc.need==='unreachable'?'<span class="sima-profit-mark down" title="Налог, комиссия и желаемая прибыль вместе — 100% цены или больше">недостижимо</span>':simaMoney(calc.need);
  const diff=calc.diff==null?'<span class="change-muted">—</span>':`<strong class="sima-profit-mark ${calc.diff>0?'down':'up'}">${calc.diff>0?'+':calc.diff<0?'−':''}${simaPercent.format(Math.abs(calc.diff))}%</strong>`;
  return `<td><div class="sima-profit-product">${row.photo?`<img class="stock-product-photo" src="${escapeHtml(row.photo)}" alt="" loading="lazy">`:''}<span><strong title="${escapeHtml(row.name)}">${escapeHtml(row.name)}</strong><small>${escapeHtml(row.subject||'')}</small></span></div></td>`+
    `<td><a class="change-link" href="https://www.wildberries.ru/catalog/${row.nmId}/detail.aspx" target="_blank" rel="noopener noreferrer" title="Открыть на WB">${row.nmId}</a><small class="sima-profit-sub">${escapeHtml(row.vendorCode)}</small></td>`+
    `<td><a class="change-link" href="https://www.sima-land.ru/${encodeURIComponent(row.sid)}/" target="_blank" rel="noopener noreferrer" title="${escapeHtml(sima.name||'Открыть на Сималенде')}">${escapeHtml(row.sid)}</a>${status?`<small class="sima-profit-sub sima-profit-mark ${sima.status==='ok'?'warn':'down'}">${escapeHtml(status)}</small>`:''}</td>`+
    `<td><strong>${simaMoney(row.price)}</strong></td>`+
    `<td><strong>${simaMoney(calc.cost,simaKopecks)}</strong>${other[1]!=null?`<small class="sima-profit-sub">${other[0]} ${simaKopecks.format(other[1])} ₽</small>`:''}</td>`+
    `<td>${row.commission==null?'<span class="change-muted">—</span>':`${simaPercent.format(row.commission)}%`}${calc.fee!=null?`<small class="sima-profit-sub">${simaRub.format(calc.fee)} ₽</small>`:''}</td>`+
    `<td>${simaMoney(calc.tax)}</td>`+
    `<td>${simaMoney(calc.logistics)}${row.volume?`<small class="sima-profit-sub">${simaKopecks.format(row.volume)} л</small>`:''}</td>`+
    `<td><strong>${simaMoney(calc.profit)}</strong>${margin}</td><td><strong>${need}</strong></td><td>${diff}</td>`;
}
function simaProfitNotes(data,rows){
  const t=data.tariff,notes=[];
  notes.push(data.simaAt?`Цены Сималенда загружены ${changeTime(data.simaAt)}${data.simaRefreshing?' · сейчас загружаются новые':''}`:'Цены Сималенда ещё не загружались — нажмите «Загрузить цены сейчас» в разделе «Цены Сималенда» или подождите плановой загрузки');
  notes.push(`Логистика — тариф WB «${t.warehouse}»: ${simaKopecks.format(t.base)} ₽ первый литр, ${simaKopecks.format(t.liter)} ₽ каждый следующий; до литра — ${t.small.map(([liters,rub])=>`до ${simaKopecks.format(liters)} л ${simaKopecks.format(rub*t.coef/100)} ₽`).join(', ')}`);
  const notListed=rows.filter(item=>item.row.sima.status==='notListed').length,other=(data.cards||0)-rows.length;
  if(notListed)notes.push(`${fmtNum(notListed)} ${pluralRu(notListed,['артикула','артикулов','артикулов'])} нет на листе «Артикулы» таблицы Сималенда — допишите их туда, чтобы загружались цены`);
  if(other>0)notes.push(`Товары без артикула Сималенда в начале артикула продавца не показаны: ${fmtNum(other)}`);
  return [...notes,...(data.warnings||[])].join(' · ');
}

function renderSimaProfit(){
  const v=simaProfit,data=v.data,body=$('#simaProfitBody');
  if(!body)return;
  for(const [id,key] of [['#simaProfitTarget','target'],['#simaProfitTax','tax'],['#simaProfitAssembly','assembly']]){const input=$(id);if(document.activeElement!==input)input.value=String(v.settings[key])}
  $('#simaProfitCost').value=v.settings.cost;
  $('#simaProfitFilter').innerHTML=SIMA_PROFIT_FILTERS.map(([value,label])=>`<option value="${value}"${value===v.filter?' selected':''}>${label}</option>`).join('');
  $$('#page-sima-profit [data-sima-sort]').forEach(th=>{const active=th.dataset.simaSort===v.sort.key;th.classList.toggle('sorted',active);th.dataset.label??=th.textContent;th.textContent=`${th.dataset.label} ${active?(v.sort.dir==='asc'?'↑':'↓'):'↕'}`});
  const empty=(count,text)=>{body.innerHTML='';$('#simaProfitCount').textContent=count;$('#simaProfitHint').textContent='';$('#emptySimaProfitText').textContent=text;$('#emptySimaProfit').classList.toggle('hidden',!text);$('#simaProfitPagination').classList.add('hidden')};
  if(!data)return empty(v.error?`Не удалось загрузить: ${v.error}`:'Загрузка товаров и цен…','');
  if(data.demo)return empty('Демо-кабинет','Выберите кабинет с токеном WB: раздел сравнивает цены его товаров с ценами Сималенда.');
  if(!data.configured)return empty('Таблица Сималенда не подключена','Впишите в .env сайта SIMA_SHEET_URL и SIMA_SHEET_KEY и перезапустите сервер. Инструкция — google-sheets/sima-land/README.md.');
  const {all,rows}=simaProfitRows(),pageCount=Math.ceil(rows.length/v.pageSize);
  v.page=Math.min(Math.max(1,v.page),Math.max(1,pageCount));
  const count=test=>all.filter(test).length;
  $('#simaProfitCount').textContent=`${fmtNum(rows.length)} из ${fmtNum(all.length)} товаров · убыток: ${fmtNum(count(({calc})=>calc.profit!=null&&calc.profit<0))} · ниже желаемой прибыли: ${fmtNum(count(({calc})=>calc.margin!=null&&calc.margin<v.settings.target))} · без цены Сималенда: ${fmtNum(count(({calc})=>calc.cost==null))}`;
  $('#simaProfitHint').textContent=simaProfitNotes(data,all);
  body.innerHTML=rows.slice((v.page-1)*v.pageSize,v.page*v.pageSize).map(item=>`<tr>${simaProfitCells(item)}</tr>`).join('');
  $$('#simaProfitBody .stock-product-photo').forEach(image=>{if(image.dataset.previewBound)return;image.dataset.previewBound='1';bindPhotoPreview(image)});
  $('#emptySimaProfitText').textContent=all.length?'Измените поиск или отбор.':'В кабинете нет товаров, у которых артикул продавца начинается с артикула Сималенда (например, 6938164/125/ШДФ).';
  $('#emptySimaProfit').classList.toggle('hidden',rows.length>0);
  renderPager($('#simaProfitPagination'),{page:v.page,pageCount,total:rows.length,sizeKey:'sima-profit',onPage:page=>{v.page=page;renderSimaProfit();document.querySelector('#page-sima-profit .stock-panel')?.scrollIntoView({behavior:'smooth',block:'start'})},onSize:size=>{v.pageSize=size;v.page=1;renderSimaProfit()}});
}

// Скачать то, что отобрано, в CSV для Excel: точка с запятой, запятая в дробях, BOM — чтобы Excel узнал UTF-8.
function exportSimaProfit(){
  const v=simaProfit,s=v.settings;if(!v.data?.rows?.length)return toast('Нет товаров для выгрузки');
  const number=value=>value==null||!Number.isFinite(value)?'':String(Math.round(value*100)/100).replace('.',',');
  const text=value=>/[;"\n]/.test(String(value))?`"${String(value).replace(/"/g,'""')}"`:String(value);
  const head=['Название товара','Арт. WB','Арт. продавца','Арт. Сималенда','Цена WB','Комиссия, %','Опт. цена Сималенда','Розн. цена Сималенда','Налог','Комиссия, ₽','Сборка','Объём, л','Логистика','Чистая прибыль','Прибыль от цены, %','Цена для нужной прибыли','Отличие от текущей цены, %','Сималенд'];
  const lines=simaProfitRows().rows.map(({row,calc})=>[text(row.name),row.nmId,text(row.vendorCode),row.sid,number(row.price),number(row.commission),number(row.sima.wholesale),number(row.sima.retail),number(calc.tax),number(calc.fee),number(s.assembly),number(row.volume),number(calc.logistics),number(calc.profit),number(calc.margin),calc.need==='unreachable'?'недостижимо':number(calc.need),number(calc.diff),text(row.sima.status==='ok'?(row.sima.inStock===false?'Нет в наличии':''):SIMA_PROFIT_STATUS[row.sima.status]||'')].join(';'));
  const settings=`Желаемая прибыль ${number(s.target)}%; налог ${number(s.tax)}%; сборка ${number(s.assembly)} ₽; закупка по ${s.cost==='retail'?'обычной':'оптовой'} цене Сималенда`;
  const link=document.createElement('a'),cabinet=state.cabinets.find(item=>item.id===state.cabinet)?.name||'кабинет';
  link.href=URL.createObjectURL(new Blob([`﻿${settings}\n${head.join(';')}\n${lines.join('\n')}`],{type:'text/csv;charset=utf-8'}));
  link.download=`Прибыль Сималенда — ${cabinet.replace(/[\\/:*?"<>|]/g,' ')} — ${new Date().toLocaleDateString('ru-RU')}.csv`;
  document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(link.href),1000);
}

document.addEventListener('click',event=>{
  if(event.target.closest('#simaProfitExport'))return exportSimaProfit();
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
  if(event.target.id==='simaProfitCost'){v.settings.cost=event.target.value==='retail'?'retail':'wholesale';saveSimaProfitSettings();renderSimaProfit()}
});
