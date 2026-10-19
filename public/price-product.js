// --- «Цены и скидки»: окно товара — текущие цены, история цены из Google Таблицы и изменение цены ---
// История — /api/sheet-history: таблица (google-sheets/) раз в час записывает изменения цен в «Историю».
// Изменение — тот же /api/prices/update, что и у массового «Задать цену и скидку», но с подтверждением:
// показываем, что было и что станет, прежде чем отправить в WB.
const priceChange=(now,before)=>{if(!before||now===before)return '';const change=Math.round((now-before)/before*100);return change?`<span class="${change<0?'price-down':'price-up'}">${change>0?'▲':'▼'} ${Math.abs(change)}%</span>`:''};
const priceProduct={nmId:null,points:null,request:0};
const PRICE_SERIES=[{key:'discountedPrice',label:'Цена со скидкой',className:'current'},{key:'price',label:'Цена до скидки',className:'base'}];
// Столбец «Что изменилось» в «Истории» таблицы → поле строки цен.
const PRICE_HISTORY_FIELDS={'Цена до скидки, ₽':'price','Скидка продавца, %':'discount','Цена со скидкой, ₽':'discountedPrice','Скидка WB Клуба, %':'clubDiscount','Цена в WB Клубе, ₽':'clubDiscountedPrice'};
const priceDateTime=iso=>new Date(iso).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).replace(',','');

function openPriceProduct(nmId){
  const row=(state.prices?.rows||[]).find(item=>String(item.nmId)===String(nmId));if(!row)return;
  Object.assign(priceProduct,{nmId:row.nmId,points:null});
  const request=++priceProduct.request;
  openModal(`<div class="price-product">
    <div class="price-product-head">${row.photo?`<img class="price-product-photo" src="${escapeHtml(row.photo)}" alt="">`:''}<div><p class="eyebrow">Цена товара</p><h2>${escapeHtml(row.name)}</h2><p>${escapeHtml(row.vendorCode||'—')} · nmID ${row.nmId} · ${escapeHtml(row.category)} · ${escapeHtml(row.brand)}</p></div></div>
    <div class="price-product-now">${[['Цена до скидки',fmtRub(row.price)],['Скидка продавца',fmtPercent(row.discount)],['Цена со скидкой',fmtRub(row.discountedPrice)],['Скидка WB Клуба',fmtPercent(row.clubDiscount)],['Цена в WB Клубе',fmtRub(row.clubDiscountedPrice)]].map(([label,value])=>`<div><span>${label}</span><strong>${value}</strong></div>`).join('')}</div>
    <section class="price-product-section"><h3>История цены</h3><div id="priceHistoryBox"><p class="price-product-note">Загрузка истории из Google Таблицы…</p></div></section>
    <section class="price-product-section"><h3>Изменить цену</h3>${priceEditForm(row)}</section>
  </div>`,true);
  bindPriceEditForm(row);
  api(`/api/sheet-history?id=${row.nmId}&sections=${encodeURIComponent('Цены')}`).then(data=>{if(request===priceProduct.request)renderPriceHistory(row,data)})
    .catch(error=>{if(request===priceProduct.request&&$('#priceHistoryBox'))$('#priceHistoryBox').innerHTML=`<p class="price-product-note error">Не удалось загрузить историю: ${escapeHtml(error.message)}</p>`});
}

// Точки истории: таблица хранит только изменения (было → стало), поэтому цена до первого изменения — «было» первого,
// а для полей без изменений — текущая цена. Изменения одного обновления таблицы — одна точка; последняя — «сейчас».
function priceHistoryPoints(row,items,since){
  const num=value=>value===''||value==null||value==='—'?null:Number(value);
  const groups=new Map();
  items.filter(item=>PRICE_HISTORY_FIELDS[item.what]).sort((a,b)=>String(a.at).localeCompare(String(b.at))).forEach(item=>{if(!groups.has(item.at))groups.set(item.at,[]);groups.get(item.at).push(item)});
  const state0={};Object.values(PRICE_HISTORY_FIELDS).forEach(key=>{state0[key]=row[key]});
  for(const list of [...groups.values()].reverse())list.forEach(item=>{state0[PRICE_HISTORY_FIELDS[item.what]]=num(item.before)});
  const start=since&&(!groups.size||since<[...groups.keys()][0])?since:[...groups.keys()][0]||since;
  const points=start?[{takenAt:start,...state0}]:[];let current={...state0};
  for(const [at,list] of groups){current={...current};list.forEach(item=>{current[PRICE_HISTORY_FIELDS[item.what]]=num(item.after)});points.push({takenAt:at,...current})}
  points.push({takenAt:new Date().toISOString(),price:row.price,discount:row.discount,discountedPrice:row.discountedPrice,clubDiscount:row.clubDiscount,clubDiscountedPrice:row.clubDiscountedPrice,now:true});
  return {points,changes:groups.size};
}
function renderPriceHistory(row,data){
  const box=$('#priceHistoryBox');if(!box)return;
  if(!data.configured){box.innerHTML='<p class="price-product-note">Google Таблица не подключена: впишите в .env сайта WB_SHEET_URL и WB_SHEET_KEY (ключ — в таблице «WB → Ключ для сайта») и перезапустите сервер. Инструкция — google-sheets/README.md.</p>';return}
  const {points,changes}=priceHistoryPoints(row,data.items||[],data.since);priceProduct.points=points;
  const since=data.since?` с ${priceDateTime(data.since)}`:'';
  if(!changes){box.innerHTML=`<p class="price-product-note">Изменений цены${since} в таблице нет — таблица записывает их раз в час.</p>`;return}
  const rows=points.slice().reverse().map((point,index,list)=>{const previous=list[index+1];
    return `<tr${point.now?' class="price-history-now"':''}><td>${point.now?'Сейчас':priceDateTime(point.takenAt)}</td><td>${fmtRub(point.price)}</td><td>${fmtPercent(point.discount)}</td><td><strong>${fmtRub(point.discountedPrice)}</strong> ${previous?priceChange(point.discountedPrice,previous.discountedPrice):''}</td><td>${fmtPercent(point.clubDiscount)}</td></tr>`}).join('');
  box.innerHTML=`<div class="summary-chart price-history-chart" id="priceHistoryChart"></div><div class="summary-legend price-history-legend">${PRICE_SERIES.map(series=>`<span><i class="price-legend ${series.className}"></i>${series.label}</span>`).join('')}</div>`+
    `<p class="price-product-note">Изменений${since}: ${fmtNum(changes)} · данные из Google Таблицы, она обновляется раз в час</p>`+
    `<div class="table-wrap price-history-table"><table><thead><tr><th>Когда</th><th>Цена до скидки</th><th>Скидка</th><th>Со скидкой</th><th>WB Клуб</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  renderPriceHistoryChart(points);
}
// Ступенчатый график: цена меняется скачком и держится до следующего изменения. Шкала не от нуля — иначе
// изменения в несколько процентов не видны; запас 8% сверху и снизу.
function renderPriceHistoryChart(points){
  const el=$('#priceHistoryChart');if(!el)return;
  const w=Math.max(480,Math.round(el.clientWidth-40)),h=210,left=10,right=70,top=14,bottom=28,plotW=w-left-right,plotH=h-top-bottom;
  const times=points.map(point=>new Date(point.takenAt).getTime()),start=times[0],end=Math.max(times.at(-1),start+3_600_000);
  const values=points.flatMap(point=>PRICE_SERIES.map(series=>point[series.key])).filter(Number.isFinite);
  if(!values.length){el.innerHTML='';return}
  const minValue=Math.min(...values),maxValue=Math.max(...values),pad=Math.max(1,(maxValue-minValue)*.08||maxValue*.05),low=Math.max(0,minValue-pad),high=maxValue+pad;
  const x=time=>left+(time-start)/(end-start)*plotW,y=value=>top+plotH-(value-low)/(high-low)*plotH;
  const step=key=>points.map((point,index)=>`${index?`H${x(times[index])}V`:`M${x(times[index])} `}${y(point[key])}`).join('')+`H${x(end)}`;
  const ticks=[0,.5,1].map(ratio=>{const value=low+(high-low)*ratio;return `<line class="trend-grid" x1="${left}" x2="${w-right}" y1="${y(value)}" y2="${y(value)}"/><text class="trend-axis" x="${w-right+10}" y="${y(value)+4}">${fmtNum(Math.round(value))} ₽</text>`}).join('');
  const labels=[start,(start+end)/2,end].map((time,index)=>`<text class="trend-axis" x="${x(time)}" y="${h-8}" text-anchor="${index===0?'start':index===2?'end':'middle'}">${priceDateTime(new Date(time).toISOString())}</text>`).join('');
  el.innerHTML=`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="История цены товара">${ticks}${labels}${PRICE_SERIES.slice().reverse().map(series=>`<path class="price-step ${series.className}" d="${step(series.key)}"/>`).join('')}`+
    `<g class="trend-hover hidden"><line class="hover-line" y1="${top}" y2="${top+plotH}"/></g><rect x="${left}" y="${top}" width="${plotW}" height="${plotH}" fill="transparent"/></svg><div class="chart-tooltip hidden"></div>`;
  const svg=el.querySelector('svg'),tip=el.querySelector('.chart-tooltip'),hover=svg.querySelector('.trend-hover');
  svg.onpointermove=event=>{
    const rect=svg.getBoundingClientRect(),time=start+((event.clientX-rect.left)/rect.width*w-left)/plotW*(end-start);
    let index=0;times.forEach((value,i)=>{if(value<=time)index=i});
    const point=points[index],line=hover.querySelector('line');hover.classList.remove('hidden');line.setAttribute('x1',x(times[index]));line.setAttribute('x2',x(times[index]));
    tip.innerHTML=`<strong>${point.now?'Сейчас':index===0?`С ${priceDateTime(point.takenAt)}`:priceDateTime(point.takenAt)}</strong><span style="--dot:var(--purple)"><i></i>Со скидкой<b>${fmtRub(point.discountedPrice)}</b></span><span style="--dot:#9aa39e"><i></i>До скидки<b>${fmtRub(point.price)}</b></span><span>Скидка<b>${fmtPercent(point.discount)}</b></span>`;
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
document.addEventListener('click',event=>{const cell=event.target.closest('[data-price-open]');if(cell&&!event.target.closest('input,button'))openPriceProduct(cell.dataset.priceOpen)});
