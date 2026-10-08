// --- «Цены и скидки»: окно товара — текущие цены, история по снимкам (GitHub Actions каждые 3 часа), изменение цены ---
// История — /api/price-history (расшифрованные снимки на компьютере). Изменение — тот же /api/prices/update, что и у
// массового «Задать цену и скидку», но с подтверждением: показываем, что было и что станет, прежде чем отправить в WB.
const priceProduct={nmId:null,history:null,request:0};
const PRICE_SERIES=[{key:'discountedPrice',label:'Цена со скидкой',className:'current'},{key:'price',label:'Цена до скидки',className:'base'}];
const mskDateTime=iso=>new Date(iso).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Moscow'}).replace(',','');
const priceChange=(now,before)=>{if(!before||now===before)return '';const change=Math.round((now-before)/before*100);return change?`<span class="${change<0?'price-down':'price-up'}">${change>0?'▲':'▼'} ${Math.abs(change)}%</span>`:''};

function openPriceProduct(nmId){
  const row=(state.prices?.rows||[]).find(item=>String(item.nmId)===String(nmId));if(!row)return;
  Object.assign(priceProduct,{nmId:row.nmId,history:null});
  const request=++priceProduct.request;
  openModal(`<div class="price-product">
    <div class="price-product-head">${row.photo?`<img class="price-product-photo" src="${escapeHtml(row.photo)}" alt="">`:''}<div><p class="eyebrow">Цена и история</p><h2>${escapeHtml(row.name)}</h2><p>${escapeHtml(row.vendorCode||'—')} · nmID ${row.nmId} · ${escapeHtml(row.category)} · ${escapeHtml(row.brand)}</p></div></div>
    <div class="price-product-now">${[['Цена до скидки',fmtRub(row.price)],['Скидка продавца',fmtPercent(row.discount)],['Цена со скидкой',fmtRub(row.discountedPrice)],['Скидка WB Клуба',fmtPercent(row.clubDiscount)],['Цена в WB Клубе',fmtRub(row.clubDiscountedPrice)]].map(([label,value])=>`<div><span>${label}</span><strong>${value}</strong></div>`).join('')}</div>
    <section class="price-product-section"><h3>История цены</h3><div id="priceHistoryBox"><p class="price-product-note">Загрузка истории…</p></div></section>
    <section class="price-product-section"><h3>Изменить цену</h3>${priceEditForm(row)}</section>
  </div>`,true);
  bindPriceEditForm(row);
  api(`/api/price-history?nmId=${row.nmId}`).then(history=>{if(request!==priceProduct.request)return;priceProduct.history=history;renderPriceHistory(row,history)})
    .catch(error=>{if(request===priceProduct.request)$('#priceHistoryBox').innerHTML=`<p class="price-product-note error">Не удалось загрузить историю: ${escapeHtml(error.message)}</p>`});
}

// История: точки из снимков плюс текущая цена из таблицы («сейчас»). Ступенчатый график — цена меняется скачком.
function renderPriceHistory(row,history){
  const box=$('#priceHistoryBox');if(!box)return;
  const points=[...history.points,{takenAt:new Date().toISOString(),price:row.price,discount:row.discount,discountedPrice:row.discountedPrice,clubDiscount:row.clubDiscount,clubDiscountedPrice:row.clubDiscountedPrice,now:true}];
  const since=history.firstSnapshot?` с ${mskDateTime(history.firstSnapshot)}`:'';
  if(!history.enabled){box.innerHTML='<p class="price-product-note">Снимки цен не настроены: на этом компьютере нет ключа data/snapshot-key.pem.</p>';return}
  // Изменения — только строки, где что-то поменялось относительно предыдущей точки; новые сверху.
  const changes=points.filter((point,index)=>!index||['price','discount','discountedPrice','clubDiscount'].some(key=>point[key]!==points[index-1][key]));
  const table=`<div class="table-wrap price-history-table"><table><thead><tr><th>Когда, МСК</th><th>Цена до скидки</th><th>Скидка</th><th>Со скидкой</th><th>WB Клуб</th></tr></thead><tbody>${changes.slice().reverse().slice(0,50).map((point,index,list)=>{const previous=list[index+1];
    return `<tr${point.now?' class="price-history-now"':''}><td>${point.now?'Сейчас':mskDateTime(point.takenAt)}</td><td>${fmtRub(point.price)}</td><td>${fmtPercent(point.discount)}</td><td><strong>${fmtRub(point.discountedPrice)}</strong> ${previous?priceChange(point.discountedPrice,previous.discountedPrice):''}</td><td>${fmtPercent(point.clubDiscount)}</td></tr>`}).join('')}</tbody></table></div>`;
  const note=history.points.length?`Снимков с этим товаром: ${fmtNum(history.points.length)}${since} · изменений: ${fmtNum(Math.max(0,changes.length-1))}`:`В снимках этого товара пока нет${since?` (снимки идут${since})`:''} — история появится после следующих снимков, GitHub делает их каждые 3 часа.`;
  box.innerHTML=(history.points.length?`<div class="summary-chart price-history-chart" id="priceHistoryChart"></div><div class="summary-legend price-history-legend">${PRICE_SERIES.map(series=>`<span><i class="price-legend ${series.className}"></i>${series.label}</span>`).join('')}</div>`:'')+`<p class="price-product-note">${note}</p>`+table;
  if(history.points.length)renderPriceHistoryChart(points);
}
function renderPriceHistoryChart(points){
  const el=$('#priceHistoryChart');if(!el)return;
  const w=Math.max(480,Math.round(el.clientWidth-40)),h=210,left=10,right=70,top=14,bottom=28,plotW=w-left-right,plotH=h-top-bottom;
  const times=points.map(point=>new Date(point.takenAt).getTime()),start=times[0],end=Math.max(times.at(-1),start+3_600_000);
  const values=points.flatMap(point=>PRICE_SERIES.map(series=>point[series.key])).filter(Number.isFinite);
  // Шкала не от нуля: цены близки друг к другу, от нуля изменения были бы не видны. Запас 8% сверху и снизу.
  const minValue=Math.min(...values),maxValue=Math.max(...values),pad=Math.max(1,(maxValue-minValue)*.08||maxValue*.05),low=Math.max(0,minValue-pad),high=maxValue+pad;
  const x=time=>left+(time-start)/(end-start)*plotW,y=value=>top+plotH-(value-low)/(high-low)*plotH;
  const step=key=>points.map((point,index)=>`${index?`H${x(times[index])}V`:`M${x(times[index])} `}${y(point[key])}`).join('')+`H${x(end)}`;
  const ticks=[0,.5,1].map(ratio=>{const value=low+(high-low)*ratio;return `<line class="trend-grid" x1="${left}" x2="${w-right}" y1="${y(value)}" y2="${y(value)}"/><text class="trend-axis" x="${w-right+10}" y="${y(value)+4}">${fmtNum(Math.round(value))} ₽</text>`}).join('');
  const labelTimes=[start,(start+end)/2,end];
  const labels=labelTimes.map((time,index)=>`<text class="trend-axis" x="${x(time)}" y="${h-8}" text-anchor="${index===0?'start':index===2?'end':'middle'}">${mskDateTime(new Date(time).toISOString())}</text>`).join('');
  el.innerHTML=`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="История цены товара">${ticks}${labels}${PRICE_SERIES.slice().reverse().map(series=>`<path class="price-step ${series.className}" d="${step(series.key)}"/>`).join('')}`+
    `<g class="trend-hover hidden"><line class="hover-line" y1="${top}" y2="${top+plotH}"/></g><rect x="${left}" y="${top}" width="${plotW}" height="${plotH}" fill="transparent"/></svg><div class="chart-tooltip hidden"></div>`;
  const svg=el.querySelector('svg'),tip=el.querySelector('.chart-tooltip'),hover=svg.querySelector('.trend-hover');
  svg.onpointermove=event=>{
    const rect=svg.getBoundingClientRect(),time=start+((event.clientX-rect.left)/rect.width*w-left)/plotW*(end-start);
    let index=0;times.forEach((value,i)=>{if(value<=time)index=i});
    const point=points[index],line=hover.querySelector('line');hover.classList.remove('hidden');line.setAttribute('x1',x(times[index]));line.setAttribute('x2',x(times[index]));
    tip.innerHTML=`<strong>${point.now?'Сейчас':mskDateTime(point.takenAt)+' МСК'}</strong><span style="--dot:var(--purple)"><i></i>Со скидкой<b>${fmtRub(point.discountedPrice)}</b></span><span style="--dot:#9aa39e"><i></i>До скидки<b>${fmtRub(point.price)}</b></span><span>Скидка<b>${fmtPercent(point.discount)}</b></span>`;
    tip.classList.remove('hidden');
    const chartRect=el.getBoundingClientRect(),px=rect.left-chartRect.left+el.scrollLeft+x(times[index])/w*rect.width,half=tip.offsetWidth/2;
    tip.style.left=`${Math.min(Math.max(px,el.scrollLeft+half+6),el.scrollLeft+el.clientWidth-half-6)}px`;
  };
  svg.onpointerleave=()=>{hover.classList.add('hidden');tip.classList.add('hidden')};
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
let priceHistoryResize=0;
window.addEventListener('resize',()=>{clearTimeout(priceHistoryResize);priceHistoryResize=setTimeout(()=>{const row=(state.prices?.rows||[]).find(item=>item.nmId===priceProduct.nmId);if(row&&priceProduct.history&&$('#priceHistoryChart'))renderPriceHistory(row,priceProduct.history)},150)});
document.addEventListener('click',event=>{const cell=event.target.closest('[data-price-open]');if(cell&&!event.target.closest('input,button'))openPriceProduct(cell.dataset.priceOpen)});
