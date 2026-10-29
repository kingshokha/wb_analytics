// --- «Карточки товаров»: все карточки кабинета, корзина и ошибки сохранения ---
// Данные — /api/cards (сервер: content-cards.js, метод WB «Список карточек товаров»), /api/cards/trash, /api/cards/errors.
// Карточка открывается на отдельной странице card.html — там её данные можно изменить. Здесь же — ярлыки продавца
// (создать, переименовать, удалить) и восстановление карточек из корзины. Создавать карточки сайт не умеет — так задумано.
// Файл подключается до app.js: $, state, api, escapeHtml и прочее из app.js используются только внутри функций.
const CARD_PROBLEMS=[['','Все карточки'],['nophoto','Без фото'],['fewphoto','Меньше 3 фото'],['desc','Описание короче 1000 символов'],['dims','Габариты под вопросом'],['docs','Проверка документов не пройдена'],['docs-pending','Документы на проверке'],['kiz','Маркировка не подтверждена'],['group','В объединённой карточке']];
const CARD_TAG_COLORS=[['D1CFD7','серый'],['FEE0E0','красный'],['ECDAFF','фиолетовый'],['E4EAFF','синий'],['DEF1DD','зелёный'],['FFECC7','жёлтый']];
const cardsView={data:null,key:'',error:'',tab:'cards',trash:null,trashKey:'',errors:null,errorsKey:'',search:'',subject:'',brand:'',tag:'',problem:'',sort:{key:'updatedAt',dir:'desc'},page:1,pageSize:pageSizeFor('cards'),request:0};

const cardDate=iso=>iso?new Date(iso).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'}).replace(',',''):'—';
const cardLink=nmId=>`/card.html?${new URLSearchParams({cabinet:state.cabinet,nmId})}`;
// Причины результата проверки карточки (documents.overallVerdict.reason): известные — по-русски, остальные — как есть.
const CARD_VERDICT_REASONS={documents_missing:'нет нужных документов',valid:'',expired:'срок документа истёк',invalid:'документ недействителен'};
const cardVerdictReason=reason=>reason in CARD_VERDICT_REASONS?CARD_VERDICT_REASONS[reason]:reason;
const cardTagChip=tag=>`<span class="card-tag" style="--tag:#${escapeHtml(tag.color||'D1CFD7')}">${escapeHtml(tag.name)}</span>`;

async function loadCards(force=false){
  const key=state.cabinet,request=++cardsView.request;
  if(!force&&cardsView.key===key&&cardsView.data){renderCards();return}
  if(cardsView.key!==key){Object.assign(cardsView,{data:null,trash:null,errors:null,subject:'',brand:'',tag:'',page:1})}
  cardsView.key=key;cardsView.error='';renderCards();
  const btn=$('#refresh');btn.classList.add('loading');
  try{
    const data=await api(`/api/cards?${new URLSearchParams({cabinet:key,...(force?{force:'1'}:{})})}`);
    if(request!==cardsView.request)return;
    cardsView.data=data;setNotices('cards','load',data.warnings);
    if(force){cardsView.trash=null;cardsView.errors=null}
    loadCardErrors(false);
  }catch(e){if(request!==cardsView.request)return;cardsView.error=e.message;addNotice('cards',`Карточки: ${e.message}`)}
  finally{btn.classList.remove('loading');renderCards()}
}
async function loadCardTrash(force=false){
  if(!force&&cardsView.trashKey===state.cabinet&&cardsView.trash)return renderCards();
  cardsView.trashKey=state.cabinet;cardsView.trash=null;renderCards();
  try{cardsView.trash=await api(`/api/cards/trash?cabinet=${encodeURIComponent(state.cabinet)}`)}catch(e){cardsView.trash={error:e.message,cards:[]}}
  renderCards();
}
async function loadCardErrors(force=false){
  if(!force&&cardsView.errorsKey===state.cabinet&&cardsView.errors)return;
  cardsView.errorsKey=state.cabinet;
  try{cardsView.errors=await api(`/api/cards/errors?cabinet=${encodeURIComponent(state.cabinet)}`)}catch(e){cardsView.errors={error:e.message,items:[]}}
  renderCards();
}

function cardProblem(card,key){
  if(key==='nophoto')return !card.photos;
  if(key==='fewphoto')return card.photos<3;
  if(key==='desc')return card.descriptionLength<1000;
  if(key==='dims')return card.dimensions?.isValid===false;
  if(key==='docs')return card.verdict==='fail';
  if(key==='docs-pending')return card.verdict==='pending';
  if(key==='kiz')return card.needKiz&&!card.kizMarked;
  if(key==='group')return card.groupSize>1;
  return true;
}
function cardRows(){
  const v=cardsView,term=v.search.trim().toLowerCase();
  const rows=(v.data?.cards||[]).filter(card=>(!v.subject||card.subjectName===v.subject)&&(!v.brand||card.brand===v.brand)&&(!v.tag||card.tags.some(tag=>String(tag.id)===v.tag))&&cardProblem(card,v.problem)
    &&(!term||[card.title,card.vendorCode,card.nmID,card.brand,card.subjectName,...card.sizes.flatMap(size=>size.skus)].join(' ').toLowerCase().includes(term)));
  const dir=v.sort.dir==='asc'?1:-1,key=v.sort.key;
  return rows.sort((a,b)=>{const av=a[key]??'',bv=b[key]??'';return dir*(typeof av==='number'&&typeof bv==='number'?av-bv:String(av).localeCompare(String(bv),'ru',{numeric:true}))});
}

function renderCards(){
  const v=cardsView,data=v.data,cards=data?.cards||[];
  if(!$('#page-cards'))return;
  // Счётчики и вкладки
  const groups=new Set(cards.filter(card=>card.groupSize>1).map(card=>card.imtID)).size;
  const metrics=[['Карточек',fmtNum(cards.length),'в продаже и черновиках','#7651e5'],['Без фото и с 1–2 фото',fmtNum(cards.filter(card=>card.photos<3).length),'покупатели видят мало','#e76464'],
    ['Документы',fmtNum(cards.filter(card=>card.verdict==='fail').length),`не прошли проверку · на проверке ${fmtNum(cards.filter(card=>card.verdict==='pending').length)}`,'#f0a04b'],['Объединённых карточек',fmtNum(groups),'групп из 2 и больше карточек','#318f68']];
  $('#cardMetrics').innerHTML=data?metrics.map(x=>`<article class="metric" style="--accent:${x[3]}"><div class="metric-label">${x[0]}</div><div class="metric-value">${x[1]}</div><div class="metric-note">${escapeHtml(x[2])}</div></article>`).join(''):'';
  $$('[data-cards-tab]').forEach(button=>button.classList.toggle('active',button.dataset.cardsTab===v.tab));
  $('#cardsTabCount').textContent=data?fmtNum(cards.length):'';
  $('#trashTabCount').textContent=v.trash?.cards?fmtNum(v.trash.cards.length):'';
  const errorCount=v.errors?.items?.length||0;$('#errorsTabCount').textContent=errorCount?fmtNum(errorCount):'';$('#errorsTabCount').classList.toggle('alert',errorCount>0);
  $('#cardsFilters').classList.toggle('hidden',v.tab!=='cards');
  // Корзина и ошибки — в своей таблице (#cardsAlt): у основной таблицы запомненные ширины столбцов по ключам.
  $('#cardsMain').classList.toggle('hidden',v.tab!=='cards');$('#cardsAlt').classList.toggle('hidden',v.tab==='cards');
  if(v.tab==='trash')return renderCardTrash();
  if(v.tab==='errors')return renderCardErrors();
  $('#emptyCardsTitle').textContent='Карточек не найдено';
  // Фильтры: предметы, бренды, ярлыки — из данных; выбранное значение остаётся в списке.
  const options=(id,label,values,selected)=>{$(id).innerHTML=`<option value="">${label}</option>${values.map(([value,text])=>`<option value="${escapeHtml(value)}"${String(value)===selected?' selected':''}>${escapeHtml(text)}</option>`).join('')}`};
  const uniq=list=>[...new Set(list.filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru')).map(value=>[value,value]);
  options('#cardSubjectFilter','Все предметы',uniq(cards.map(card=>card.subjectName)),v.subject);
  options('#cardBrandFilter','Все бренды',uniq(cards.map(card=>card.brand)),v.brand);
  options('#cardTagFilter','Все ярлыки',(data?.tags||[]).map(tag=>[String(tag.id),tag.name]),v.tag);
  options('#cardProblemFilter','Все карточки',CARD_PROBLEMS.slice(1),v.problem);
  $('#cardsTitle').textContent='Карточки товаров';
  if(!data){$('#cardsCount').textContent=v.error?`Не удалось загрузить: ${v.error}`:'Загрузка карточек…';$('#cardsBody').innerHTML='';$('#emptyCards').classList.add('hidden');$('#cardsPagination').classList.add('hidden');return}
  const rows=cardRows(),pageCount=Math.ceil(rows.length/v.pageSize);
  v.page=Math.min(Math.max(1,v.page),Math.max(1,pageCount));
  $('#cardsCount').textContent=`${fmtNum(rows.length)} из ${fmtNum(cards.length)}${data.demo?' · демо-данные':''} · обновлено ${cardDate(data.fetchedAt)}`;
  const columns=[['title','Товар',360],['subjectName','Предмет',150],['brand','Бренд',120],['sizes','Размеры',140],['photos','Медиа',110],['tags','Ярлыки',150],['verdict','Проверка',170],['updatedAt','Изменена',120]];
  // Заголовки создаются один раз — так сохраняются ширины столбцов (initResizableTables); при сортировке меняется только стрелка.
  const head=$('#cardsHead');
  if(!head.children.length){head.innerHTML=columns.map(([key,label,width])=>`<th data-card-sort="${key}" data-col-key="${key}" data-col-width="${width}">${label} <span class="rating-sort-arrow"></span></th>`).join('')}
  head.querySelectorAll('[data-card-sort]').forEach(th=>{th.querySelector('.rating-sort-arrow').textContent=v.sort.key===th.dataset.cardSort?(v.sort.dir==='asc'?'↑':'↓'):'↕'});
  const verdict={ok:'<span class="status status-complete">пройдена</span>',fail:'<span class="status status-cancel">не пройдена</span>',pending:'<span class="status status-confirm">на проверке</span>'};
  $('#cardsBody').innerHTML=rows.slice((v.page-1)*v.pageSize,v.page*v.pageSize).map(card=>{
    const sizes=card.sizes.map(size=>size.techSize&&size.techSize!=='0'?size.techSize:'').filter(Boolean);
    const barcodes=card.sizes.flatMap(size=>size.skus);
    return `<tr><td><div class="card-cell">${card.photo?`<img class="stock-product-photo" src="${escapeHtml(card.photo)}" alt="" loading="lazy">`:'<span class="card-nophoto" title="Нет фото">нет фото</span>'}<span><a class="card-title-link" href="${escapeHtml(cardLink(card.nmID))}" target="_blank" rel="noopener noreferrer" title="Открыть карточку: ${escapeHtml(card.title)}">${escapeHtml(card.title||'Без названия')}</a><small>${escapeHtml(card.vendorCode||'—')} · <button type="button" class="copy-article" data-copy="${escapeHtml(card.nmID)}" title="Скопировать артикул WB">${escapeHtml(card.nmID)}</button>${card.groupSize>1?` · <span title="Объединена с другими карточками">группа из ${card.groupSize}</span>`:''}</small></span></div></td>`+
      `<td>${escapeHtml(card.subjectName||'—')}</td><td>${escapeHtml(card.brand||'—')}</td>`+
      `<td>${sizes.length?escapeHtml(sizes.slice(0,5).join(', '))+(sizes.length>5?` +${sizes.length-5}`:''):'без размера'}<small>${fmtNum(barcodes.length)} ${barcodes.length===1?'баркод':barcodes.length<5&&barcodes.length?'баркода':'баркодов'}</small></td>`+
      `<td class="${card.photos<3?'card-warn':''}">${fmtNum(card.photos)} фото${card.video?' · видео':''}</td>`+
      `<td>${card.tags.map(cardTagChip).join(' ')||'<span class="muted">—</span>'}</td>`+
      `<td>${card.verdict?verdict[card.verdict]:'<span class="muted">нет документов</span>'}${card.verdict==='fail'&&cardVerdictReason(card.verdictReason)?`<small>${escapeHtml(cardVerdictReason(card.verdictReason))}</small>`:''}${card.needKiz?`<small>${card.kizMarked?'маркировка подтверждена':'<b class="card-warn">маркировка не подтверждена</b>'}</small>`:''}${card.dimensions?.isValid===false?'<small class="card-warn">габариты под вопросом</small>':''}</td>`+
      `<td>${cardDate(card.updatedAt)}</td></tr>`;
  }).join('');
  $$('#cardsBody .stock-product-photo').forEach(image=>{if(image.dataset.previewBound)return;image.dataset.previewBound='1';bindPhotoPreview(image)});
  $('#emptyCards').classList.toggle('hidden',rows.length>0);
  renderPager($('#cardsPagination'),{page:v.page,pageCount,total:rows.length,sizeKey:'cards',onPage:page=>{v.page=page;renderCards();$('#page-cards .stock-panel').scrollIntoView({behavior:'smooth',block:'start'})},onSize:size=>{v.pageSize=size;v.page=1;renderCards()}});
}
// Корзина: карточка продаётся, пока есть остатки; без остатков WB удаляет её через 30 дней.
function renderCardTrash(){
  const trash=cardsView.trash;
  $('#cardsTitle').textContent='Корзина';
  $('#cardsPagination').classList.add('hidden');
  if(!trash){$('#cardsCount').textContent='Загрузка корзины…';$('#cardsAlt').innerHTML='';$('#emptyCards').classList.add('hidden');return}
  $('#cardsCount').textContent=trash.error?`Не удалось загрузить: ${trash.error}`:`${fmtNum(trash.cards.length)} карточек · без остатков WB удаляет их через 30 дней в корзине`;
  $('#cardsAlt').innerHTML='<table class="stock-table cards-alt-table" data-resizable="1"><thead><tr><th>Товар</th><th>Предмет</th><th>В корзине с</th><th>Удалится</th><th></th></tr></thead><tbody>'+trash.cards.map(card=>{const removeAt=card.trashedAt?new Date(Date.parse(card.trashedAt)+30*86_400_000).toISOString():'';
    return `<tr><td><div class="card-cell"><span><a class="card-title-link" href="${escapeHtml(cardLink(card.nmID))}" target="_blank" rel="noopener noreferrer">${escapeHtml(card.title||card.vendorCode||'Без названия')}</a><small>${escapeHtml(card.vendorCode||'—')} · ${escapeHtml(card.nmID)}</small></span></div></td><td>${escapeHtml(card.subjectName||'—')}</td><td>${cardDate(card.trashedAt)}</td><td>${removeAt?`${cardDate(removeAt).slice(0,8)}<small>если нет остатков</small>`:'—'}</td>`+
      `<td><button type="button" class="ghost card-recover" data-card-recover="${escapeHtml(card.nmID)}" data-card-name="${escapeHtml(card.vendorCode||card.nmID)}">Восстановить</button></td></tr>`}).join('')+'</tbody></table>';
  $('#emptyCards').classList.toggle('hidden',trash.cards.length>0||Boolean(trash.error));
  $('#emptyCardsTitle').textContent='Корзина пуста';
}
// Ошибки сохранения: WB проверяет изменения после ответа «успешно» — отклонённые попадают сюда.
function renderCardErrors(){
  const errors=cardsView.errors;
  $('#cardsTitle').textContent='Ошибки сохранения';
  $('#cardsPagination').classList.add('hidden');
  if(!errors){$('#cardsCount').textContent='Загрузка…';$('#cardsAlt').innerHTML='';loadCardErrors();return}
  $('#cardsCount').textContent=errors.error?`Не удалось загрузить: ${errors.error}`:'Изменения, которые WB не принял после проверки. Чтобы ошибка ушла, сохраните карточку ещё раз с исправлениями.';
  const byVendor=new Map((cardsView.data?.cards||[]).map(card=>[card.vendorCode,card]));
  $('#cardsAlt').innerHTML=(errors.items||[]).length?'<table class="stock-table cards-alt-table" data-resizable="1"><thead><tr><th>Артикул продавца</th><th>Предмет</th><th>Что не так</th><th>Когда</th></tr></thead><tbody>'+errors.items.map(item=>{const card=byVendor.get(item.vendorCode);
    return `<tr><td>${card?`<a class="card-title-link" href="${escapeHtml(cardLink(card.nmID))}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.vendorCode)}</a>`:escapeHtml(item.vendorCode)}</td><td>${escapeHtml(item.subject||'—')}</td><td class="card-errors">${item.errors.map(text=>`<div>${escapeHtml(text)}</div>`).join('')}</td><td>${cardDate(item.updatedAt)}</td></tr>`}).join('')+'</tbody></table>':'';
  $('#emptyCards').classList.toggle('hidden',(errors.items||[]).length>0||Boolean(errors.error));
  $('#emptyCardsTitle').textContent='Ошибок нет';
}

// --- Ярлыки продавца: до 15, имя до 15 символов, цвет из шести ---
function openCardTags(){
  const tags=cardsView.data?.tags||[];
  openModal(`<div class="card-tags-modal"><p class="eyebrow">Карточки товаров</p><h2>Ярлыки</h2><p class="muted">Ярлыки видны только вам — для группировки и поиска карточек. До 15 ярлыков, название до 15 символов. Изменения сразу уходят в WB.</p>
    <div class="card-tag-list">${tags.map(tag=>cardTagRow(tag)).join('')||'<p class="muted">Ярлыков пока нет.</p>'}</div>
    ${tags.length<15?`<form class="card-tag-row new" data-card-tag-form="create">${cardTagFields({name:'',color:'D1CFD7'})}<button type="submit" class="primary">Создать</button></form>`:'<p class="muted">Создано 15 ярлыков — это максимум.</p>'}
    <p class="card-tag-note" id="cardTagNote" role="status"></p></div>`);
}
const cardTagFields=tag=>`<input name="name" maxlength="15" value="${escapeHtml(tag.name)}" placeholder="Название" required aria-label="Название ярлыка"><select name="color" aria-label="Цвет">${CARD_TAG_COLORS.map(([value,label])=>`<option value="${value}"${value===String(tag.color||'').toUpperCase()?' selected':''}>${label}</option>`).join('')}</select>`;
const cardTagRow=tag=>`<form class="card-tag-row" data-card-tag-form="update" data-tag-id="${escapeHtml(tag.id)}">${cardTagChip(tag)}${cardTagFields(tag)}<button type="submit">Сохранить</button><button type="button" class="danger-link" data-card-tag-delete="${escapeHtml(tag.id)}" data-tag-name="${escapeHtml(tag.name)}">Удалить</button></form>`;
async function sendCardTag(body){
  const note=$('#cardTagNote');note.textContent='Отправляем в WB…';note.classList.remove('error');
  try{const result=await api('/api/cards/tag',{method:'POST',body:JSON.stringify({cabinet:state.cabinet,confirm:true,...body})});
    if(cardsView.data)cardsView.data.tags=result.tags||cardsView.data.tags;
    if(body.action==='delete'&&cardsView.data)cardsView.data.cards.forEach(card=>{card.tags=card.tags.filter(tag=>String(tag.id)!==String(body.id))});
    openCardTags();renderCards();toast('Ярлыки обновлены')}
  catch(e){note.textContent=`Не удалось: ${e.message}`;note.classList.add('error')}
}

document.addEventListener('click',event=>{
  if(!event.target.closest('#page-cards')&&!event.target.closest('.card-tags-modal')&&!event.target.closest('.card-recover-confirm'))return;
  const tab=event.target.closest('[data-cards-tab]');
  if(tab){cardsView.tab=tab.dataset.cardsTab;if(cardsView.tab==='trash')loadCardTrash();if(cardsView.tab==='errors')loadCardErrors(true);renderCards();return}
  const sort=event.target.closest('[data-card-sort]');
  if(sort&&!event.target.closest('.column-resizer')){const key=sort.dataset.cardSort;cardsView.sort=cardsView.sort.key===key?{key,dir:cardsView.sort.dir==='asc'?'desc':'asc'}:{key,dir:['title','subjectName','brand'].includes(key)?'asc':'desc'};renderCards();return}
  if(event.target.closest('#cardTagsButton'))return openCardTags();
  const remove=event.target.closest('[data-card-tag-delete]');
  if(remove){
    if(remove.dataset.confirming){sendCardTag({action:'delete',id:Number(remove.dataset.cardTagDelete)});return}
    remove.dataset.confirming='1';remove.textContent=`Удалить «${remove.dataset.tagName}» из всех карточек?`;return;
  }
  const recover=event.target.closest('[data-card-recover]');
  if(recover){
    openModal(`<div class="card-recover-confirm"><h2>Восстановить карточку?</h2><p class="muted">Карточка ${escapeHtml(recover.dataset.cardName)} вернётся из корзины в список карточек WB. Метод WB: не чаще 3 раз в минуту.</p><div class="modal-actions"><button type="button" data-modal-close-inline>Отмена</button><button type="button" class="primary" data-card-recover-confirm="${escapeHtml(recover.dataset.cardRecover)}">Восстановить</button></div></div>`);return;
  }
  const confirmRecover=event.target.closest('[data-card-recover-confirm]');
  if(confirmRecover){
    confirmRecover.disabled=true;confirmRecover.textContent='Отправляем…';
    api('/api/cards/recover',{method:'POST',body:JSON.stringify({cabinet:state.cabinet,confirm:true,nmIds:[Number(confirmRecover.dataset.cardRecoverConfirm)]})})
      .then(()=>{closeModal();toast('Карточка восстановлена');cardsView.trash=null;loadCardTrash(true);loadCards(true)})
      .catch(e=>{confirmRecover.disabled=false;confirmRecover.textContent='Восстановить';toast(e.message)});
    return;
  }
  if(event.target.closest('[data-modal-close-inline]'))closeModal();
});
document.addEventListener('submit',event=>{
  const form=event.target.closest('[data-card-tag-form]');if(!form)return;
  event.preventDefault();
  sendCardTag({action:form.dataset.cardTagForm,id:Number(form.dataset.tagId)||undefined,name:form.elements.name.value.trim(),color:form.elements.color.value});
});
document.addEventListener('input',event=>{if(event.target.id!=='cardSearch')return;cardsView.search=event.target.value;cardsView.page=1;if(cardsView.data)renderCards()});
document.addEventListener('change',event=>{
  const map={cardSubjectFilter:'subject',cardBrandFilter:'brand',cardTagFilter:'tag',cardProblemFilter:'problem'},key=map[event.target.id];
  if(key){cardsView[key]=event.target.value;cardsView.page=1;renderCards()}
});
