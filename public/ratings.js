// --- Оценки товаров: рейтинг продавца, новые оценки по звёздам, товары, которым нужно внимание, таблица товаров ---
// Данные — /api/ratings (метод WB item-rating, обновляется раз в час). Период заканчивается не позже вчерашнего дня.
// Динамика везде — разница с прошлым периодом той же длины (+18 отзывов, −0,49 рейтинга), а не проценты.
const ratings={data:null,key:'',error:'',search:'',filter:'',sort:{key:'newFeedbacks',dir:'desc'},page:1,pageSize:100,request:0};
const RATING_COLUMNS=[
  {key:'title',label:'Товар',width:300},
  {key:'feedbackRating',label:'Рейтинг',hint:'Рейтинг товара по отзывам и изменение к прошлому периоду',width:110},
  {key:'percentile',label:'Лучше конкурентов',hint:'У скольких процентов товаров этого предмета у других продавцов рейтинг ниже',width:150},
  {key:'newFeedbacks',label:'Новые отзывы',hint:'Отзывы за период и изменение к прошлому периоду',width:120},
  {key:'s5',label:'5★',width:62},{key:'s4',label:'4★',width:62},{key:'s3',label:'3★',width:62},{key:'s2',label:'2★',width:62},{key:'s1',label:'1★',width:62},
  {key:'negativeShare',label:'1–2★, %',hint:'Доля отзывов на 1 и 2 звезды среди новых за период',width:90},
  {key:'cardRating',label:'Карточка',hint:'Рейтинг карточки товара по оценке WB, из 10',width:95},
  {key:'status',label:'Статус',width:170}];
// «Отзывы, исключённые из рейтинга» WB иногда отдаёт отрицательными (−151 за неделю) — смысл таких значений неясен,
// поэтому отдельного столбца нет, а положительное число показывается пометкой в «Статусе».
const ratingFixed=(value,digits=2)=>Number(value).toLocaleString('ru-RU',{minimumFractionDigits:digits,maximumFractionDigits:digits});
// Изменение рейтинга: рост — зелёный, падение — красный; меньше 0,005 — «без изменений».
function ratingDelta(value){
  if(value==null)return '';
  if(Math.abs(value)<0.005)return '<small class="rating-delta">±0</small>';
  return `<small class="rating-delta ${value>0?'up':'down'}">${value>0?'▲':'▼'} ${ratingFixed(Math.abs(value))}</small>`;
}
// Изменение количества: для 1–2★ рост — плохо, для остальных — хорошо.
function countDelta(value,negative=false){
  if(value==null||value===0)return value===0?'<small class="rating-delta">±0</small>':'';
  const good=negative?value<0:value>0;
  return `<small class="rating-delta ${good?'up':'down'}">${value>0?'+':'−'}${fmtNum(Math.abs(value))}</small>`;
}
// Почему товар требует внимания; score — чтобы самые срочные были сверху.
function ratingIssues(item){
  const issues=[],negative=item.stars[1].count+item.stars[2].count;let score=0;
  if(item.shadowed){issues.push({text:'скрыт из каталога',level:'bad'});score+=5}
  if(item.feedbackRatingDelta!=null&&item.feedbackRatingDelta<=-0.05){issues.push({text:`рейтинг ▼ ${ratingFixed(Math.abs(item.feedbackRatingDelta))}`,level:'bad'});score+=2+Math.abs(item.feedbackRatingDelta)*4}
  if(negative>=2&&item.newFeedbacks&&negative/item.newFeedbacks>=0.2){issues.push({text:`${negative} из ${item.newFeedbacks} новых — 1–2★`,level:'bad'});score+=2+negative/item.newFeedbacks}
  if(item.percentile!=null&&item.percentile<25){issues.push({text:`хуже ${Math.round(100-item.percentile)}% конкурентов`,level:'warn'});score+=1+(25-item.percentile)/25}
  if(item.disqualified>0)issues.push({text:`${item.disqualified} ${pluralRu(item.disqualified,['отзыв исключён','отзыва исключено','отзывов исключено'])} из рейтинга`,level:'info'});
  return {issues,score,attention:score>0};
}
function ratingRows(){
  const items=(ratings.data?.items||[]).map(item=>{const negative=item.stars[1].count+item.stars[2].count;return {...item,...ratingIssues(item),
    s5:item.stars[5].count,s4:item.stars[4].count,s3:item.stars[3].count,s2:item.stars[2].count,s1:item.stars[1].count,
    negativeShare:item.newFeedbacks?negative/item.newFeedbacks*100:null,status:item.shadowed?1:0}});
  const term=ratings.search.trim().toLowerCase();
  const filtered=items.filter(item=>(!term||[item.title,item.vendorCode,item.nmId,item.subjectName,item.brandName].join(' ').toLowerCase().includes(term))&&
    (ratings.filter!=='new'||item.newFeedbacks>0)&&(ratings.filter!=='attention'||item.attention)&&(ratings.filter!=='weak'||(item.percentile!=null&&item.percentile<25))&&(ratings.filter!=='shadowed'||item.shadowed));
  // Пустые значения (нет рейтинга, нет новых отзывов для доли) — всегда в конце.
  const {key,dir}=ratings.sort,factor=dir==='asc'?1:-1;
  const compare=(a,b)=>key==='title'?String(a.title).localeCompare(String(b.title),'ru')*factor:(Number(a[key])-Number(b[key]))*factor;
  return [...filtered.filter(item=>item[key]!=null).sort(compare),...filtered.filter(item=>item[key]==null)];
}
async function loadRatings(force=false){
  const key=[state.cabinet,$('#dateFrom').value,$('#dateTo').value].join(':');
  if(!force&&ratings.key===key&&ratings.data){renderRatings();return}
  const request=++ratings.request,btn=$('#refresh');
  if(ratings.key.split(':')[0]!==state.cabinet){ratings.data=null;ratings.error='';renderRatings()}
  btn.classList.add('loading');$('#syncText').textContent='Получаем оценки товаров…';
  try{
    const data=await api('/api/ratings?'+new URLSearchParams({cabinet:state.cabinet,from:$('#dateFrom').value,to:$('#dateTo').value}));
    if(request!==ratings.request)return;
    Object.assign(ratings,{data,key,error:'',page:1});state.demo=data.demo;renderRatings();
    $('#syncText').textContent=`Оценки · ${new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}`;
  }catch(e){if(request!==ratings.request)return;ratings.error=e.message;renderRatings();$('#syncText').textContent='Ошибка загрузки оценок';toast(e.message)}
  finally{if(request===ratings.request)btn.classList.remove('loading')}
}
function renderRatings(){
  const data=ratings.data;
  if(!data){
    const text=ratings.error?`Не удалось загрузить оценки: ${escapeHtml(ratings.error)}`:'Загрузка оценок…';
    $('#ratingMetrics').innerHTML='';$('#ratingStars').innerHTML=`<p class="rating-empty">${text}</p>`;$('#ratingAttention').innerHTML='';
    $('#ratingCount').textContent=ratings.error?'Ошибка загрузки':'Загрузка оценок…';$('#ratingBody').innerHTML='';$('#ratingStarsNote').textContent='';return;
  }
  renderRatingSummary(data);
  renderRatingTable();
}
function renderRatingSummary(data){
  const seller=data.seller,items=data.items||[],evaluated=items.map(item=>({...item,...ratingIssues(item)}));
  const negative=seller.stars[1].count+seller.stars[2].count,attention=evaluated.filter(item=>item.attention);
  const period=`${trendFullDate(data.periods.current.start)} – ${trendFullDate(data.periods.current.end)}`;
  const past=data.periods.past?`к ${trendFullDate(data.periods.past.start)} – ${trendFullDate(data.periods.past.end)}`:'';
  const metrics=[
    ['Рейтинг продавца',seller.rating==null?'—':ratingFixed(seller.rating),seller.ratingDelta==null?'по отзывам покупателей':`${Math.abs(seller.ratingDelta)<0.005?'без изменений':`${seller.ratingDelta>0?'▲':'▼'} ${ratingFixed(Math.abs(seller.ratingDelta))}`} ${past}`,'#f0a04b'],
    ['Новые оценки',fmtNum(seller.newFeedbacks),`${seller.newFeedbacksDelta==null?'':`${seller.newFeedbacksDelta>0?'+':seller.newFeedbacksDelta<0?'−':'±'}${fmtNum(Math.abs(seller.newFeedbacksDelta))} к прошлому периоду · `}всего ${fmtNum(seller.totalFeedbacks)}`,'#7651e5'],
    ['Оценки 1–2★',fmtNum(negative),seller.newFeedbacks?`${Math.round(negative/seller.newFeedbacks*100)}% новых оценок`:'за период','#e76464'],
    ['Требуют внимания',fmtNum(attention.length),`из ${fmtNum(items.length)} товаров${evaluated.some(item=>item.shadowed)?` · скрыто из каталога: ${evaluated.filter(item=>item.shadowed).length}`:''}`,'#318f68']];
  $('#ratingMetrics').innerHTML=metrics.map(x=>`<article class="metric" style="--accent:${x[3]}"><div class="metric-label">${x[0]}</div><div class="metric-value">${x[1]}</div><div class="metric-note">${escapeHtml(x[2])}</div></article>`).join('');
  $('#ratingStarsNote').textContent=`${period}${data.periods.endClamped?' · WB считает оценки до вчерашнего дня':''}${data.demo?' · демо-данные':''}`;
  // Распределение новых оценок: одна шкала для всех звёзд, рядом — число, доля и изменение к прошлому периоду.
  const max=Math.max(1,...[5,4,3,2,1].map(star=>seller.stars[star].count));
  $('#ratingStars').innerHTML=[5,4,3,2,1].map(star=>{const s=seller.stars[star],share=seller.newFeedbacks?s.count/seller.newFeedbacks*100:0;
    return `<div class="rating-star-row" title="Всего оценок ${star}★: ${fmtNum(s.total)}"><span class="rating-star-label">${star}<i>★</i></span><span class="rating-star-track"><span style="width:${s.count/max*100}%"></span></span><b>${fmtNum(s.count)}</b><small>${Math.round(share)}%</small>${countDelta(s.delta,star<=2)}</div>`}).join('');
  const top=attention.sort((a,b)=>b.score-a.score||b.newFeedbacks-a.newFeedbacks).slice(0,6);
  $('#ratingAttention').innerHTML=top.length?top.map(item=>`<button type="button" class="rating-attention-row" data-rating-focus="${item.nmId}" title="Показать товар в таблице">${item.photo?`<img class="stock-product-photo" src="${escapeHtml(item.photo)}" alt="" loading="lazy">`:'<i class="rating-photo-stub"></i>'}<span><strong>${escapeHtml(item.title)}</strong><span class="rating-issues">${item.issues.filter(issue=>issue.level!=='info').map(issue=>`<em class="${issue.level}">${escapeHtml(issue.text)}</em>`).join('')}</span></span><b class="rating-attention-value">${item.feedbackRating==null?'—':ratingFixed(item.feedbackRating)}</b></button>`).join('')+
    (attention.length>top.length?`<button type="button" class="rating-attention-more" data-rating-filter="attention">Все ${fmtNum(attention.length)} ${pluralRu(attention.length,['товар','товара','товаров'])} →</button>`:''):
    '<p class="rating-empty">Всё в порядке: рейтинги не проседают, негативных отзывов немного.</p>';
}
function ratingCell(item,key){
  if(key==='title')return `<td class="price-product-cell">${item.photo?`<img class="stock-product-photo" src="${escapeHtml(item.photo)}" alt="" loading="lazy">`:''}<span><strong title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</strong><small>${escapeHtml(item.vendorCode||'—')} · ${item.nmId}</small></span></td>`;
  if(key==='feedbackRating')return `<td><strong>${item.feedbackRating==null?'—':ratingFixed(item.feedbackRating)}</strong>${ratingDelta(item.feedbackRatingDelta)}</td>`;
  if(key==='percentile'){if(item.percentile==null)return '<td title="WB не сравнил товар с конкурентами">—</td>';const level=item.percentile<25?'bad':item.percentile<50?'warn':'good';
    return `<td><span class="rating-percentile ${level}"><b>${Math.round(item.percentile)}%</b><span><i style="width:${Math.max(2,item.percentile)}%"></i></span></span></td>`}
  if(key==='newFeedbacks')return `<td><strong>${fmtNum(item.newFeedbacks)}</strong>${countDelta(item.newFeedbacksDelta)}</td>`;
  if(/^s[1-5]$/.test(key)){const star=Number(key[1]),s=item.stars[star];return `<td class="${star<=2&&s.count?'rating-negative':''}" title="${s.delta==null?'':`К прошлому периоду: ${s.delta>0?'+':''}${s.delta}`}">${s.count?fmtNum(s.count):'<span class="muted">0</span>'}</td>`}
  if(key==='negativeShare')return `<td>${item.negativeShare==null?'—':`<span class="${item.negativeShare>=20?'rating-negative':''}">${Math.round(item.negativeShare)}%</span>`}</td>`;
  if(key==='cardRating')return `<td>${item.cardRating==null?'—':`<strong>${ratingFixed(item.cardRating,1)}</strong><small class="muted"> / 10</small>`}</td>`;
  return `<td>${item.shadowed?'<span class="status status-cancel">Скрыт из каталога</span>':'<span class="status status-complete">В каталоге</span>'}${item.pinned?'<small>Есть закреплённый отзыв</small>':''}${item.disqualified>0?`<small>${fmtNum(item.disqualified)} ${pluralRu(item.disqualified,['отзыв исключён','отзыва исключено','отзывов исключено'])} из рейтинга</small>`:''}</td>`;
}
function renderRatingTable(){
  const all=ratings.data?.items||[],rows=ratingRows(),pageCount=Math.ceil(rows.length/ratings.pageSize);
  ratings.page=Math.min(Math.max(1,ratings.page),Math.max(1,pageCount));
  const pageRows=rows.slice((ratings.page-1)*ratings.pageSize,ratings.page*ratings.pageSize);
  $('#ratingCount').textContent=`${fmtNum(rows.length)} из ${fmtNum(all.length)} товаров · отзывы за ${trendFullDate(ratings.data.periods.current.start)} – ${trendFullDate(ratings.data.periods.current.end)}`;
  $('#ratingHead').innerHTML=RATING_COLUMNS.map(c=>`<th data-rating-sort="${c.key}" data-col-key="${c.key}" data-col-width="${c.width}"${c.hint?` title="${escapeHtml(c.hint)}"`:''}>${escapeHtml(c.label)} ${ratings.sort.key===c.key?(ratings.sort.dir==='asc'?'↑':'↓'):'↕'}</th>`).join('');
  $('#ratingBody').innerHTML=pageRows.map(item=>`<tr class="${item.attention?'rating-row-attention':''}">${RATING_COLUMNS.map(c=>ratingCell(item,c.key)).join('')}</tr>`).join('');
  $('#emptyRatings').classList.toggle('hidden',rows.length>0);
  $$('#ratingBody .stock-product-photo,#ratingAttention .stock-product-photo').forEach(image=>{if(image.dataset.previewBound)return;image.dataset.previewBound='1';bindPhotoPreview(image)});
  renderRatingPagination(pageCount);
}
function renderRatingPagination(pageCount){
  const el=$('#ratingPagination');
  if(pageCount<=1){el.innerHTML='';el.classList.add('hidden');return}
  el.classList.remove('hidden');
  el.innerHTML=`<button type="button" class="stock-page-button" data-rating-page="prev" ${ratings.page===1?'disabled':''}>Назад</button><div class="stock-page-numbers">${Array.from({length:pageCount},(_,i)=>i+1).map(page=>`<button type="button" class="stock-page-button ${page===ratings.page?'active':''}" data-rating-page="${page}" aria-current="${page===ratings.page?'page':'false'}">${page}</button>`).join('')}</div><button type="button" class="stock-page-button" data-rating-page="next" ${ratings.page===pageCount?'disabled':''}>Вперёд</button>`;
}
document.addEventListener('click',event=>{
  const sort=event.target.closest('[data-rating-sort]');
  if(sort&&!event.target.closest('.column-resizer')){const key=sort.dataset.ratingSort;ratings.sort=ratings.sort.key===key?{key,dir:ratings.sort.dir==='asc'?'desc':'asc'}:{key,dir:key==='title'?'asc':'desc'};ratings.page=1;renderRatingTable();return}
  const page=event.target.closest('[data-rating-page]');
  if(page&&!page.disabled){const target=page.dataset.ratingPage;ratings.page=target==='prev'?ratings.page-1:target==='next'?ratings.page+1:Number(target);renderRatingTable();$('#page-ratings .stock-panel').scrollIntoView({behavior:'smooth',block:'start'});return}
  // «Требуют внимания»: клик по товару находит его в таблице, «Все …» включает фильтр.
  const focus=event.target.closest('[data-rating-focus]');
  if(focus){ratings.search=focus.dataset.ratingFocus;$('#ratingSearch').value=ratings.search;ratings.filter='';$('#ratingFilter').value='';ratings.page=1;renderRatingTable();$('#page-ratings .stock-panel').scrollIntoView({behavior:'smooth',block:'start'});return}
  const filter=event.target.closest('[data-rating-filter]');
  if(filter){ratings.filter=filter.dataset.ratingFilter;$('#ratingFilter').value=ratings.filter;ratings.search='';$('#ratingSearch').value='';ratings.page=1;renderRatingTable();$('#page-ratings .stock-panel').scrollIntoView({behavior:'smooth',block:'start'})}
});
// Через document: скрипт подключается раньше app.js, где объявлен $.
document.addEventListener('input',event=>{if(event.target.id!=='ratingSearch')return;ratings.search=event.target.value;ratings.page=1;if(ratings.data)renderRatingTable()});
document.addEventListener('change',event=>{if(event.target.id!=='ratingFilter')return;ratings.filter=event.target.value;ratings.page=1;if(ratings.data)renderRatingTable()});
