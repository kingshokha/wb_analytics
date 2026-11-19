// --- «Остатки FBS» → «Добавить вручную»: товары кабинета — на склады FBS с остатком ---
// Товары для поиска — /api/fbs-stocks/products (из сохранённого списка карточек: название, артикулы, предмет, бренд,
// размеры с chrtId и баркодом). Можно выбрать несколько товаров (все их размеры) и несколько складов; остаток один
// для всех. Отправка — POST /api/fbs-stocks/add: сервер ставит остаток каждому размеру на каждом складе (метод WB
// PUT /api/v3/stocks/{warehouseId}); размеры, которые WB не принял (не тот склад для габарита, нет ТНВЭД и т. п.),
// возвращаются с причиной. Размеры, которые уже есть на складе, по умолчанию пропускаются (галочка «Не менять остаток…»);
// без галочки их остаток заменится — окно предупреждает об этом.
// Файл подключается до app.js: $, state, api и прочее из app.js используются только внутри функций.
const STOCK_ADD_SHOWN=100,STOCK_ADD_MAX_AMOUNT=100000;
const stockAdd={cabinet:'',products:null,loading:false,error:'',search:'',selected:new Map(),warehouses:new Set(),amount:'',sending:false,result:null,searchTimer:0,keepExisting:true};

async function openStockAdd(){
  if(state.demo)return toast('В демо-режиме добавление остатков отключено');
  const cabinet=state.cabinet;
  if(stockAdd.cabinet!==cabinet)Object.assign(stockAdd,{cabinet,products:null,error:'',search:'',selected:new Map(),warehouses:new Set(),amount:'',result:null});
  stockAdd.result=null;stockAdd.sending=false;
  openModal('<div class="stock-add" id="stockAdd"></div>',true);
  renderStockAdd();
  if(!stockAdd.products&&!stockAdd.loading){
    stockAdd.loading=true;stockAdd.error='';renderStockAdd();
    try{const data=await api(`/api/fbs-stocks/products?cabinet=${encodeURIComponent(cabinet)}`);if(stockAdd.cabinet!==cabinet)return;
      stockAdd.products=(data.products||[]).map(product=>({...product,text:[product.name,product.vendorCode,product.nmId,product.category,product.brand,...product.sizes.map(size=>size.sku)].join(' ').toLowerCase()}))}
    catch(e){stockAdd.error=e.message}
    finally{stockAdd.loading=false;if($('#stockAdd'))renderStockAdd()}
  }
}
// Склады FBS кабинета — из загруженных остатков; что уже стоит на складе — тоже оттуда.
const stockAddWarehouses=()=>state.stocksKey===stockAdd.cabinet?(state.stocks?.warehouses||[]):[];
function stockAddExisting(){const map=new Map();if(state.stocksKey===stockAdd.cabinet)for(const row of state.stocks?.rows||[])map.set(`${row.warehouseId}:${row.chrtId}`,row.amount);return map}
function stockAddFound(){
  const term=stockAdd.search.trim().toLowerCase();
  if(!term||!stockAdd.products)return [];
  const words=term.split(/\s+/);
  return stockAdd.products.filter(product=>words.every(word=>product.text.includes(word)));
}
// keepExisting (по умолчанию) — размеры, которые уже есть на складе, пропускаются: их остаток не меняется.
function stockAddPlan(){
  const existing=stockAddExisting(),items=[];let replace=0;
  for(const product of stockAdd.selected.values())for(const size of product.sizes)for(const warehouseId of stockAdd.warehouses){
    if(existing.has(`${warehouseId}:${size.chrtId}`)){replace++;if(stockAdd.keepExisting)continue}
    items.push({warehouseId,chrtId:size.chrtId});
  }
  return {items,replace};
}
const stockAddSizes=product=>product.sizes.length>1?`${fmtNum(product.sizes.length)} ${pluralRu(product.sizes.length,['размер','размера','размеров'])}`:product.sizes[0]?.size&&product.sizes[0].size!=='0'?product.sizes[0].size:'без размера';

function renderStockAdd(){
  const box=$('#stockAdd');if(!box)return;
  const warehouses=stockAddWarehouses(),found=stockAddFound(),shown=found.slice(0,STOCK_ADD_SHOWN),plan=stockAddPlan(),amount=Number(stockAdd.amount);
  const validAmount=stockAdd.amount!==''&&Number.isInteger(amount)&&amount>=0&&amount<=STOCK_ADD_MAX_AMOUNT;
  const results=!stockAdd.products?`<p class="muted">${stockAdd.loading?'Загружаем товары кабинета…':stockAdd.error?`Не удалось загрузить товары: ${escapeHtml(stockAdd.error)}`:''}</p>`
    :!stockAdd.search.trim()?`<p class="muted">Начните вводить название, артикул продавца, артикул WB, баркод, предмет или бренд — найдётся среди ${fmtNum(stockAdd.products.length)} товаров кабинета.</p>`
    :!found.length?'<p class="muted">Ничего не найдено.</p>'
    :`<div class="stock-add-found-head"><label><input type="checkbox" id="stockAddAllFound"${shown.every(product=>stockAdd.selected.has(product.nmId))?' checked':''}> Выбрать ${found.length>shown.length?`первые ${fmtNum(shown.length)}`:'все найденные'}</label><span class="muted">найдено ${fmtNum(found.length)}${found.length>shown.length?` · показаны первые ${fmtNum(shown.length)} — уточните поиск`:''}</span></div>
      <div class="stock-add-list">${shown.map(product=>`<label class="stock-add-item"><input type="checkbox" data-stock-add-product="${product.nmId}"${stockAdd.selected.has(product.nmId)?' checked':''}>${product.photo?`<img src="${escapeHtml(product.photo)}" alt="" loading="lazy">`:'<span class="stock-add-nophoto"></span>'}<span><b>${escapeHtml(product.name)}</b><small>${escapeHtml(product.vendorCode||'—')} · ${product.nmId} · ${escapeHtml(product.category||'')} · ${escapeHtml(stockAddSizes(product))}</small></span></label>`).join('')}</div>`;
  const chosen=[...stockAdd.selected.values()];
  box.innerHTML=`<p class="eyebrow">Остатки FBS</p><h2>Добавить товары на склады</h2>
    <p class="muted">Выберите товары (у товара с размерами — все размеры) и склады FBS, укажите остаток — он поставится каждому размеру на каждом выбранном складе.</p>
    <label class="search stock-add-search">⌕ <input id="stockAddSearch" placeholder="Название, артикул, артикул WB, баркод, предмет, бренд" value="${escapeHtml(stockAdd.search)}" autocomplete="off"></label>
    ${results}
    ${chosen.length?`<div class="stock-add-chosen"><b>Выбрано товаров: ${fmtNum(chosen.length)}</b>${chosen.slice(0,30).map(product=>`<span class="stock-add-chip">${escapeHtml(product.vendorCode||product.nmId)}<button type="button" data-stock-add-remove="${product.nmId}" aria-label="Убрать ${escapeHtml(product.vendorCode||product.nmId)}">×</button></span>`).join('')}${chosen.length>30?`<span class="muted">и ещё ${fmtNum(chosen.length-30)}</span>`:''}<button type="button" class="stock-add-clear" data-stock-add-clear>Очистить</button></div>`:''}
    <div class="stock-add-section"><b>Склады FBS</b>${warehouses.length?`<div class="stock-add-warehouses">${warehouses.map(warehouse=>`<label><input type="checkbox" data-stock-add-warehouse="${escapeHtml(warehouse.id)}"${stockAdd.warehouses.has(String(warehouse.id))?' checked':''}> ${escapeHtml(warehouse.name)}</label>`).join('')}</div>`:'<p class="muted">Склады ещё не загрузились — дождитесь загрузки остатков.</p>'}</div>
    <div class="stock-add-section"><b>Остаток, шт</b><div class="stock-add-amount"><input id="stockAddAmount" type="number" min="0" max="${STOCK_ADD_MAX_AMOUNT}" step="1" inputmode="numeric" value="${escapeHtml(stockAdd.amount)}" placeholder="0">${[1,5,10,20,50,100].map(value=>`<button type="button" data-stock-add-quick="${value}"${String(value)===stockAdd.amount?' class="active"':''}>${value}</button>`).join('')}</div></div>
    <label class="stock-add-keep"><input type="checkbox" id="stockAddKeep"${stockAdd.keepExisting?' checked':''}> Не менять остаток у товаров, которые уже есть на выбранном складе</label>
    <p class="stock-add-total">${plan.items.length?`Будет позиций: <b>${fmtNum(plan.items.length)}</b> (размеры × склады)`:plan.replace?'Все выбранные товары уже есть на этих складах.':'Выберите товары и склады.'}${plan.replace?stockAdd.keepExisting?` · ${fmtNum(plan.replace)} уже есть на складе — пропустим`:` · <span class="card-warn">${fmtNum(plan.replace)} уже есть на складе — их остаток заменится</span>`:''}</p>
    <div class="stock-add-result" id="stockAddResult"></div>
    <div class="modal-actions"><button type="button" id="stockAddCancel">Закрыть</button><button type="button" class="primary" id="stockAddConfirm"${!plan.items.length||!validAmount||stockAdd.sending?' disabled':''}>${stockAdd.sending?'Отправляем…':`Добавить${plan.items.length?`: ${fmtNum(plan.items.length)} поз.`:''}`}</button></div>`;
  renderStockAddResult();
}
function renderStockAddResult(){
  const box=$('#stockAddResult'),result=stockAdd.result;if(!box||!result)return;
  const name=new Map();for(const product of stockAdd.products||[])for(const size of product.sizes)name.set(size.chrtId,`${product.vendorCode||product.nmId}${product.sizes.length>1?` (${size.size})`:''}`);
  const warehouse=new Map(stockAddWarehouses().map(item=>[String(item.id),item.name]));
  if(result.error){box.innerHTML=`<p class="card-warn">Не удалось: ${escapeHtml(result.error)}</p>`;return}
  box.innerHTML=`<p>${result.added?`Добавлено: <b>${fmtNum(result.added)}</b> поз.`:'Ничего не добавлено.'}${result.failed.length?` · <span class="card-warn">не принято WB: ${fmtNum(result.failed.length)}</span>`:''}</p>`+
    (result.failed.length?`<ul class="stock-add-failed">${result.failed.slice(0,50).map(item=>`<li><b>${escapeHtml(name.get(item.chrtId)||item.chrtId)}</b> · ${escapeHtml(warehouse.get(String(item.warehouseId))||item.warehouseId)} — ${escapeHtml(item.text)}</li>`).join('')}${result.failed.length>50?`<li class="muted">…и ещё ${fmtNum(result.failed.length-50)}</li>`:''}</ul>`:'')+
    (result.warnings?.length?`<p class="muted">${escapeHtml(result.warnings.join(' '))}</p>`:'');
}
async function sendStockAdd(){
  const plan=stockAddPlan(),amount=Number(stockAdd.amount),cabinet=stockAdd.cabinet;
  if(!plan.items.length||!Number.isInteger(amount)||amount<0||amount>STOCK_ADD_MAX_AMOUNT)return;
  stockAdd.sending=true;stockAdd.result=null;renderStockAdd();
  try{
    const result=await api('/api/fbs-stocks/add',{method:'POST',body:JSON.stringify({cabinet,confirm:true,items:plan.items.map(item=>({...item,amount}))})});
    stockAdd.result={added:result.added||0,failed:result.failed||[],warnings:result.warnings||[]};
    // Новые строки таблицы: сведения о товаре — из списка товаров окна.
    const meta=new Map();for(const product of stockAdd.selected.values())for(const size of product.sizes)meta.set(String(size.chrtId),{nmId:product.nmId,vendorCode:product.vendorCode,name:product.name,category:product.category||'Без категории',size:size.size||'—',sku:size.sku,photo:product.photo,chrtId:size.chrtId});
    applyStockChanges({stocks:result.stocks||[],warnings:[]},cabinet,meta);
    if(result.added){toast(`Добавлено на склады: ${fmtNum(result.added)} поз.`);if(!(result.failed||[]).length){stockAdd.selected.clear()}}
  }catch(e){stockAdd.result={error:e.message,added:0,failed:[]}}
  finally{stockAdd.sending=false;if($('#stockAdd'))renderStockAdd()}
}

document.addEventListener('click',event=>{
  if(event.target.closest('#stockAddButton'))return openStockAdd();
  if(!event.target.closest('#stockAdd'))return;
  if(event.target.closest('#stockAddCancel'))return closeModal();
  if(event.target.closest('#stockAddConfirm'))return sendStockAdd();
  const quick=event.target.closest('[data-stock-add-quick]');if(quick){stockAdd.amount=quick.dataset.stockAddQuick;return renderStockAdd()}
  const remove=event.target.closest('[data-stock-add-remove]');if(remove){stockAdd.selected.delete(Number(remove.dataset.stockAddRemove));return renderStockAdd()}
  if(event.target.closest('[data-stock-add-clear]')){stockAdd.selected.clear();return renderStockAdd()}
});
document.addEventListener('change',event=>{
  if(!event.target.closest('#stockAdd'))return;
  const product=event.target.closest('[data-stock-add-product]');
  if(product){const nmId=Number(product.dataset.stockAddProduct),item=(stockAdd.products||[]).find(entry=>entry.nmId===nmId);if(item){if(product.checked)stockAdd.selected.set(nmId,item);else stockAdd.selected.delete(nmId)}return renderStockAdd()}
  if(event.target.id==='stockAddKeep'){stockAdd.keepExisting=event.target.checked;return renderStockAdd()}
  if(event.target.id==='stockAddAllFound'){for(const item of stockAddFound().slice(0,STOCK_ADD_SHOWN)){if(event.target.checked)stockAdd.selected.set(item.nmId,item);else stockAdd.selected.delete(item.nmId)}return renderStockAdd()}
  const warehouse=event.target.closest('[data-stock-add-warehouse]');
  if(warehouse){const id=String(warehouse.dataset.stockAddWarehouse);if(warehouse.checked)stockAdd.warehouses.add(id);else stockAdd.warehouses.delete(id);return renderStockAdd()}
});
// Поиск — после паузы в наборе; поле ввода не перерисовывается, чтобы не терять курсор.
document.addEventListener('input',event=>{
  if(event.target.id==='stockAddAmount'){stockAdd.amount=event.target.value.trim();const plan=stockAddPlan(),amount=Number(stockAdd.amount),button=$('#stockAddConfirm');if(button)button.disabled=!plan.items.length||stockAdd.amount===''||!Number.isInteger(amount)||amount<0||amount>STOCK_ADD_MAX_AMOUNT||stockAdd.sending;$$('[data-stock-add-quick]').forEach(item=>item.classList.toggle('active',item.dataset.stockAddQuick===stockAdd.amount));return}
  if(event.target.id!=='stockAddSearch')return;
  clearTimeout(stockAdd.searchTimer);
  stockAdd.searchTimer=setTimeout(()=>{stockAdd.search=event.target.value;const input=$('#stockAddSearch'),position=input?.selectionStart;renderStockAdd();const next=$('#stockAddSearch');if(next){next.focus();next.setSelectionRange(position,position)}},200);
});
