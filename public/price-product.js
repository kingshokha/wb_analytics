// --- «Цены и скидки»: окно товара — текущие цены и изменение цены ---
// Изменение — тот же /api/prices/update, что и у массового «Задать цену и скидку», но с подтверждением:
// показываем, что было и что станет, прежде чем отправить в WB.
const priceChange=(now,before)=>{if(!before||now===before)return '';const change=Math.round((now-before)/before*100);return change?`<span class="${change<0?'price-down':'price-up'}">${change>0?'▲':'▼'} ${Math.abs(change)}%</span>`:''};

function openPriceProduct(nmId){
  const row=(state.prices?.rows||[]).find(item=>String(item.nmId)===String(nmId));if(!row)return;
  openModal(`<div class="price-product">
    <div class="price-product-head">${row.photo?`<img class="price-product-photo" src="${escapeHtml(row.photo)}" alt="">`:''}<div><p class="eyebrow">Цена товара</p><h2>${escapeHtml(row.name)}</h2><p>${escapeHtml(row.vendorCode||'—')} · nmID ${row.nmId} · ${escapeHtml(row.category)} · ${escapeHtml(row.brand)}</p></div></div>
    <div class="price-product-now">${[['Цена до скидки',fmtRub(row.price)],['Скидка продавца',fmtPercent(row.discount)],['Цена со скидкой',fmtRub(row.discountedPrice)],['Скидка WB Клуба',fmtPercent(row.clubDiscount)],['Цена в WB Клубе',fmtRub(row.clubDiscountedPrice)]].map(([label,value])=>`<div><span>${label}</span><strong>${value}</strong></div>`).join('')}</div>
    <section class="price-product-section"><h3>Изменить цену</h3>${priceEditForm(row)}</section>
  </div>`,true);
  bindPriceEditForm(row);
}

// Изменение цены: поля → предпросмотр → «Сохранить в WB» → подтверждение с «было → станет» → отправка.
function priceEditForm(row){
  if(state.demo)return '<p class="price-product-note">В демо-режиме изменение цен отключено.</p>';
  return `<div class="price-edit"><label class="stock-modal-label">Цена до скидки, ₽<input id="productPriceInput" type="number" min="1" step="1" value="${Math.round(row.price)}"></label>`+
    `<label class="stock-modal-label">Скидка продавца, %<input id="productDiscountInput" type="number" min="0" max="99" step="1" value="${row.discount}"></label></div>`+
    `<p class="price-edit-preview" id="productPricePreview"></p>${row.editableSizePrice?`<p class="price-product-note">У товара цены по размерам — новая цена применится ко всем размерам (${row.sizes}).</p>`:''}`+
    `<div id="productPriceActions"><button class="primary" id="productPriceSave">Сохранить в WB</button></div>`;
}
function priceEditValues(){const price=Number($('#productPriceInput').value),discount=Number($('#productDiscountInput').value);return {price,discount,valid:Number.isFinite(price)&&price>0&&Number.isInteger(discount)&&discount>=0&&discount<=99,discounted:Math.round(price*(100-discount)/100)}}
function bindPriceEditForm(row){
  if(state.demo)return;
  // Каждый раз заново рисуем кнопку «Сохранить в WB» — после «Отмена» на месте подтверждения её ещё нет.
  const preview=()=>{const value=priceEditValues(),el=$('#productPricePreview');
    $('#productPriceActions').innerHTML='<button class="primary" id="productPriceSave">Сохранить в WB</button>';
    const save=$('#productPriceSave');save.onclick=confirm;
    if(!value.valid){el.innerHTML='<span class="price-down">Цена — больше 0, скидка — целое число от 0 до 99%</span>';save.disabled=true;return}
    const club=row.clubDiscount?` · в WB Клубе ≈ ${fmtRub(Math.round(value.discounted*(100-row.clubDiscount)/100))}`:'';
    el.innerHTML=`Цена со скидкой: <strong>${fmtRub(value.discounted)}</strong> ${priceChange(value.discounted,row.discountedPrice)}${club}`};
  const confirm=()=>{const value=priceEditValues();if(!value.valid)return;
    if(value.price===Math.round(row.price)&&value.discount===row.discount)return toast('Цена и скидка не изменились');
    const drop=row.discountedPrice?(row.discountedPrice-value.discounted)/row.discountedPrice:0;
    $('#productPriceActions').innerHTML=`<div class="price-edit-confirm"><p>Цена до скидки: ${fmtRub(row.price)} → <strong>${fmtRub(value.price)}</strong><br>Скидка: ${fmtPercent(row.discount)} → <strong>${fmtPercent(value.discount)}</strong><br>Цена со скидкой: ${fmtRub(row.discountedPrice)} → <strong>${fmtRub(value.discounted)}</strong> ${priceChange(value.discounted,row.discountedPrice)}</p>`+
      (drop>=.3?`<p class="price-down">Цена со скидкой падает на ${Math.round(drop*100)}% — проверьте, нет ли опечатки.</p>`:'')+
      `<p class="price-product-note">Изменение сразу уйдёт в WB; в карточке оно появится через несколько минут.</p><div class="modal-actions"><button id="productPriceCancel">Отмена</button><button class="primary" id="productPriceConfirm">Подтвердить</button></div></div>`;
    $('#productPriceCancel').onclick=preview;
    $('#productPriceConfirm').onclick=async()=>{const button=$('#productPriceConfirm');button.disabled=true;button.textContent='Отправляем…';
      try{await api('/api/prices/update',{method:'POST',body:JSON.stringify({cabinet:state.cabinet,confirm:true,items:[{nmId:row.nmId,price:value.price,discount:value.discount,editableSizePrice:row.editableSizePrice,sizeItems:row.sizeItems}]})});
        $('#productPriceActions').innerHTML=`<p class="price-edit-done">Загрузка создана в WB: ${fmtRub(value.price)}, скидка ${fmtPercent(value.discount)}. Таблица обновится, когда WB применит цену.</p>`;
        toast('Цена отправлена в WB');loadPrices(true)}
      catch(error){toast(error.message);preview()}}};
  $('#productPriceInput').oninput=$('#productDiscountInput').oninput=preview;
  preview();
}
document.addEventListener('click',event=>{const cell=event.target.closest('[data-price-open]');if(cell&&!event.target.closest('input,button'))openPriceProduct(cell.dataset.priceOpen)});
