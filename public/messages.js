// --- Раздел «Сообщения»: чаты с покупателями, вопросы, отзывы и заявки на возврат текущего кабинета ---
// Открывается кнопкой слева от колокольчика; на кнопке — сколько ждёт ответа: чаты, где последнее сообщение от
// покупателя не старше 10 дней (старше — «без ответа», в счётчик не входят), неотвеченные вопросы и отзывы, заявки на рассмотрении (/api/messages/summary, раз в 5 минут и при смене кабинета).
// Сервер — communications.js (методы WB «Общение с покупателями»). Ответ уходит покупателю по кнопке «Ответить» /
// «Отправить»; отклонение вопроса, возврат по отзыву и решения по заявкам — после подтверждения в окне.
// Файлы из чатов WB отдаёт по одному и не чаще раза в секунду, поэтому они открываются по клику, а не все сразу.
// Файл подключается до app.js: $, state, api, escapeHtml и прочее из app.js используются только внутри функций.
const MSG_TABS={chats:'Чаты',questions:'Вопросы',feedbacks:'Отзывы',claims:'Заявки на возврат'};
const MSG_SUMMARY_EVERY=5*60_000;
const msgView={tab:'chats',cabinet:'',summary:null,summaryTimer:0,
  chats:{data:null,error:'',loading:false,search:'',awaiting:false,openId:'',thread:null,threadError:'',files:[],sending:false},
  questions:{mode:'new',nmId:'',page:1,pageSize:pageSizeFor('messages-questions'),data:null,error:'',loading:false,request:0},
  feedbacks:{mode:'new',nmId:'',rating:'',page:1,pageSize:pageSizeFor('messages-feedbacks'),data:null,error:'',loading:false,request:0},
  claims:{mode:'new',page:1,pageSize:pageSizeFor('messages-claims'),data:null,error:'',loading:false,request:0}};
const MSG_ORDER_STATUS={buyout:'выкуплен',rejected:'отказ',returned:'возврат',notSpecified:''};
const MSG_SIZE={ok:'размер соответствует',smaller:'маломерит',bigger:'большемерит'};
const MSG_ANSWER_STATE={reviewRequired:'ответ на проверке',rejected:'ответ отклонён WB',none:'',wbRu:''};
const MSG_CLAIM_STATUS={0:'на рассмотрении',1:'отклонена',2:'одобрена'};
const MSG_CLAIM_GOODS={0:'',1:'товар остаётся у покупателя',2:'товар сдаётся на WB и утилизируется',5:'товар остаётся у покупателя',8:'товар вернётся в продажу после проверки WB',10:'товар возвращается продавцу'};
const MSG_SOURCE={'seller-portal':'портал продавца','seller-public-api':'через API',rusite:'сайт',global:'global',ios:'iOS',android:'Android'};

const msgTime=value=>{const date=new Date(typeof value==='number'?value:String(value||''));return Number.isNaN(date.getTime())?'':date.toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'}).replace(',','')};
// У заявок WB даты — по Москве без часового пояса.
const msgMoscowTime=value=>value?msgTime(/[zZ]|[+-]\d\d:?\d\d$/.test(value)?value:`${value}+03:00`):'';
const msgQuery=params=>new URLSearchParams({cabinet:state.cabinet,...params});
const msgProductLink=(product,label)=>product?.nmId?`<a class="msg-product" href="/product.html?${new URLSearchParams({cabinet:state.cabinet,nmId:product.nmId})}" target="_blank" rel="noopener noreferrer">${escapeHtml(label||product.name||`Артикул ${product.nmId}`)}</a>`:escapeHtml(label||product?.name||'');
const msgStars=rating=>`<span class="msg-stars" aria-label="Оценка ${rating} из 5">${'★'.repeat(rating)}<i>${'★'.repeat(Math.max(0,5-rating))}</i></span>`;
const msgText=text=>escapeHtml(text).replace(/\n/g,'<br>');
const msgPlural=(count,forms)=>{const n=Math.abs(count)%100,d=n%10;return forms[n>10&&n<20?2:d>1&&d<5?1:d===1?0:2]};

// --- Кнопка в шапке: счётчик ждущих ответа ---
async function loadMessagesSummary(force=false){
  clearTimeout(msgView.summaryTimer);
  const cabinet=state.cabinet;if(!cabinet)return;
  try{
    const data=await api(`/api/messages/summary?${msgQuery(force?{force:'1'}:{})}`);
    if(cabinet!==state.cabinet)return;
    msgView.summary=data;renderMessagesButton();if(state.activePage==='messages')renderMessageTabs();
  }catch{/* счётчик — не главное: ошибку покажет сам раздел */}
  finally{if(cabinet===state.cabinet)msgView.summaryTimer=setTimeout(()=>loadMessagesSummary(),MSG_SUMMARY_EVERY)}
}
function renderMessagesButton(){
  const count=document.getElementById('messagesCount'),button=document.getElementById('messagesButton');if(!count||!button)return;
  const s=msgView.summary,total=s?.total||0;
  count.textContent=total>99?'99+':String(total);count.hidden=!total;
  const parts=s?[['чатов ждут ответа',s.chats],['вопросов',s.questions],['отзывов',s.feedbacks],['заявок на возврат',s.claims]].filter(([,item])=>item?.count).map(([label,item])=>`${label}: ${item.count}`):[];
  button.title=parts.length?`Сообщения покупателей — ${parts.join(', ')}`:'Сообщения покупателей';
}
function renderMessageTabs(){
  const s=msgView.summary;
  document.querySelectorAll('[data-msg-tab]').forEach(tab=>{
    const key=tab.dataset.msgTab,item=s?.[key];tab.classList.toggle('active',key===msgView.tab);tab.setAttribute('aria-selected',String(key===msgView.tab));
    const badge=tab.querySelector('b');if(badge){badge.textContent=item?.count?fmtNum(item.count):'';badge.title=item?.error||''}
  });
}

// --- Раздел ---
function loadMessages(force=false){
  if(msgView.cabinet!==state.cabinet){
    // Другой кабинет — всё заново.
    msgView.cabinet=state.cabinet;
    Object.assign(msgView.chats,{data:null,error:'',openId:'',thread:null,threadError:'',files:[]});
    for(const key of ['questions','feedbacks','claims'])Object.assign(msgView[key],{data:null,error:'',page:1});
  }
  if(force)loadMessagesSummary(true);
  renderMessageTabs();
  loadMessageTab(force);
}
function loadMessageTab(force=false){
  const tab=msgView.tab;
  if(tab==='chats')return loadChats(force);
  const view=msgView[tab];if(view.data&&!force){renderMessages();return}
  const request=++view.request;view.loading=true;view.error='';renderMessages();
  const params={skip:String((view.page-1)*view.pageSize),take:String(view.pageSize)};
  if(tab==='questions')Object.assign(params,{answered:view.mode==='answered'?'1':'0'},view.nmId?{nmId:view.nmId}:{});
  if(tab==='feedbacks')Object.assign(params,{mode:view.mode},view.nmId?{nmId:view.nmId}:{});
  if(tab==='claims')params.archive=view.mode==='archive'?'1':'0';
  api(`/api/messages/${tab}?${msgQuery(params)}`).then(data=>{if(request===view.request)view.data=data}).catch(error=>{if(request===view.request){view.error=error.message;view.data=null}})
    .finally(()=>{if(request!==view.request)return;view.loading=false;if(msgView.tab===tab&&state.activePage==='messages')renderMessages()});
}
function renderMessages(){
  const body=$('#msgBody');if(!body)return;
  renderMessageTabs();
  $('#msgTitle').textContent=MSG_TABS[msgView.tab];
  body.className=`msg-body msg-body-${msgView.tab}`;
  if(msgView.tab==='chats')return renderChats();
  renderMessageList();
}

// --- Чаты ---
function loadChats(force=false){
  const view=msgView.chats;
  if(view.data&&!force){renderMessages();return}
  view.loading=true;view.error='';renderMessages();
  const cabinet=state.cabinet;
  api(`/api/messages/chats?${msgQuery(force?{force:'1'}:{})}`).then(data=>{if(cabinet!==state.cabinet)return;view.data=data;if(view.openId)openChat(view.openId,true)})
    .catch(error=>{if(cabinet===state.cabinet)view.error=error.message}).finally(()=>{if(cabinet!==state.cabinet)return;view.loading=false;if(msgView.tab==='chats'&&state.activePage==='messages')renderMessages()});
}
function chatRows(){
  const view=msgView.chats,term=view.search.trim().toLowerCase();
  return (view.data?.chats||[]).filter(chat=>(!view.awaiting||chat.awaiting)&&(!term||[chat.clientName,chat.product?.name,chat.product?.nmId,chat.lastText].join(' ').toLowerCase().includes(term)));
}
function renderChats(){
  const view=msgView.chats,data=view.data,body=$('#msgBody');
  $('#msgFilters').innerHTML=`<label class="search">⌕ <input id="msgChatSearch" placeholder="Покупатель, товар, текст" value="${escapeHtml(view.search)}"></label><label class="msg-check"><input type="checkbox" id="msgChatAwaiting"${view.awaiting?' checked':''}> Ждут ответа</label>`;
  $('#msgPagination').classList.add('hidden');
  if(!data){$('#msgInfo').textContent=view.error?`Не удалось загрузить чаты: ${view.error}`:'Загрузка чатов… Первый раз сообщения скачиваются целиком — это может занять минуту.';body.innerHTML='';return}
  const awaiting=data.chats.filter(chat=>chat.awaiting).length;
  $('#msgInfo').textContent=`${fmtNum(data.chats.length)} ${msgPlural(data.chats.length,['чат','чата','чатов'])} · ждут ответа ${fmtNum(awaiting)}${data.syncedAt?` · сообщения на ${msgTime(data.syncedAt)}`:''}${data.warning?` · ${data.warning}`:''}${view.loading?' · обновляем…':''}`;
  body.classList.toggle('msg-chat-open',Boolean(view.openId));
  body.innerHTML=`<div class="msg-chat-list" id="msgChatList">${chatListHtml()}</div><div class="msg-thread" id="msgThread">${chatThreadHtml()}</div>`;
  const thread=$('#msgThreadMessages');if(thread)thread.scrollTop=thread.scrollHeight;
}
function chatListHtml(){
  const view=msgView.chats,rows=chatRows();
  return rows.length?rows.map(chat=>`<button type="button" class="msg-chat${chat.chatId===view.openId?' active':''}${chat.awaiting?' awaiting':''}" data-msg-chat="${escapeHtml(chat.chatId)}">
      <span class="msg-chat-top"><b>${escapeHtml(chat.clientName)}</b><small>${escapeHtml(msgTime(chat.lastAt))}</small></span>
      <span class="msg-chat-product">${escapeHtml(chat.product?.name||(chat.product?.nmId?`Артикул ${chat.product.nmId}`:''))}</span>
      <span class="msg-chat-last">${chat.lastSender==='seller'?'<i>Вы:</i> ':''}${escapeHtml(chat.lastText||'—')}</span>
      ${chat.awaiting?'<em>ждёт ответа</em>':chat.unanswered?'<em class="stale" title="Покупатель написал последним больше 10 дней назад">без ответа</em>':''}</button>`).join(''):`<p class="msg-empty">${view.data?.chats.length?'Таких чатов нет — измените фильтр.':'Чатов пока нет: чат всегда начинает покупатель.'}</p>`;
}
function chatThreadHtml(){
  const view=msgView.chats,thread=view.thread;
  if(!view.openId)return '<p class="msg-empty">Выберите чат слева.</p>';
  if(!thread)return `<p class="msg-empty">${view.threadError?`Не удалось открыть чат: ${escapeHtml(view.threadError)}`:'Загрузка переписки…'}</p>`;
  const chat=thread.chat,product=chat.product||{};
  const messages=thread.messages.map(message=>{
    const files=message.files.map(file=>`<button type="button" class="msg-file" data-msg-file="${escapeHtml(file.downloadId)}" data-msg-file-name="${escapeHtml(file.name)}"${file.downloadId?'':' disabled'}>📎 ${escapeHtml(file.name)}${file.size?` · ${fmtNum(Math.ceil(file.size/1024))} КБ`:''}</button>`).join('');
    const images=message.images.map((image,index)=>image.downloadId?`<button type="button" class="msg-file" data-msg-file="${escapeHtml(image.downloadId)}" data-msg-file-name="Изображение ${index+1}">🖼 Изображение</button>`:'<span class="msg-file muted">🖼 Изображение недоступно</span>').join('');
    const productCard=message.product?.nmId?`<div class="msg-good">Товар: ${msgProductLink(message.product)}${message.product.size&&message.product.size!=='0'?` · размер ${escapeHtml(message.product.size)}`:''}</div>`:'';
    const who=message.sender==='client'?escapeHtml(message.clientName||chat.clientName):message.sender==='wb'?'Wildberries':'Вы';
    return `<div class="msg-bubble ${escapeHtml(message.sender||'client')}"><div class="msg-bubble-head"><b>${who}</b><small>${escapeHtml(msgTime(message.at))}${MSG_SOURCE[message.source]?` · ${MSG_SOURCE[message.source]}`:''}</small></div>${productCard}${message.text?`<p>${msgText(message.text)}</p>`:''}${files||images?`<div class="msg-files">${files}${images}</div>`:''}</div>`;
  }).join('')||'<p class="msg-empty">Сообщений пока нет.</p>';
  const attached=view.files.map((file,index)=>`<span class="msg-attached">${escapeHtml(file.name)} · ${fmtNum(Math.ceil(file.size/1024))} КБ <button type="button" data-msg-unattach="${index}" aria-label="Убрать файл">×</button></span>`).join('');
  return `<div class="msg-thread-head"><button type="button" class="msg-back" data-msg-back aria-label="К списку чатов">←</button><div><b>${escapeHtml(chat.clientName)}</b><small>${product.nmId?`${msgProductLink(product)} · арт. ${product.nmId}`:''}${product.size&&product.size!=='0'?` · размер ${escapeHtml(product.size)}`:''}${product.price?` · ${fmtNum(product.price)} ₽`:''}</small></div></div>
    <div class="msg-thread-messages" id="msgThreadMessages">${messages}</div>
    <form class="msg-compose" id="msgCompose"><textarea id="msgComposeText" maxlength="1000" rows="3" placeholder="Сообщение покупателю — до 1000 символов"></textarea>
      <div class="msg-compose-row"><label class="msg-attach">📎 Файл<input type="file" id="msgComposeFiles" accept="image/jpeg,image/png,application/pdf" multiple hidden></label>${attached}<small id="msgComposeCount">0 / 1000</small><button type="submit" class="primary"${view.sending?' disabled':''}>${view.sending?'Отправка…':'Отправить'}</button></div></form>`;
}
async function openChat(chatId,quiet=false){
  const view=msgView.chats,cabinet=state.cabinet;
  if(view.openId!==chatId){view.files=[];view.thread=null}
  view.openId=chatId;view.threadError='';
  if(!quiet)renderChats();
  try{const data=await api(`/api/messages/chat?${msgQuery({chatId})}`);if(cabinet!==state.cabinet||view.openId!==chatId)return;view.thread=data}
  catch(error){if(view.openId===chatId)view.threadError=error.message}
  if(msgView.tab==='chats'&&state.activePage==='messages'){
    // Набранный текст не теряется при перерисовке.
    const draft=$('#msgComposeText')?.value||'';renderChats();const box=$('#msgComposeText');if(box&&draft){box.value=draft;updateComposeCount()}
  }
}
function updateComposeCount(){const box=$('#msgComposeText'),count=$('#msgComposeCount');if(box&&count)count.textContent=`${box.value.length} / 1000`}
const fileToBase64=file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]||'');reader.onerror=()=>reject(new Error(`Не удалось прочитать «${file.name}»`));reader.readAsDataURL(file)});
async function sendChatMessage(){
  const view=msgView.chats,box=$('#msgComposeText'),message=(box?.value||'').trim(),chatId=view.openId,cabinet=state.cabinet;
  if(!message&&!view.files.length)return toast('Напишите сообщение или приложите файл');
  if(view.sending)return;
  view.sending=true;renderChatKeepDraft();
  try{
    const files=await Promise.all(view.files.map(async file=>({name:file.name,type:file.type,data:await fileToBase64(file)})));
    const result=await api(`/api/messages/chat/send?${msgQuery({chatId,confirm:'1'})}`,{method:'POST',body:JSON.stringify({message,files})});
    view.files=[];if(box)box.value='';
    toast(result.warnings?.length?`Отправлено, но: ${result.warnings.join('; ')}`:'Сообщение отправлено');
    view.sending=false;
    if(cabinet!==state.cabinet)return;
    view.data=null;loadChats(true);loadMessagesSummary(true);
  }catch(error){view.sending=false;toast(error.message);renderChatKeepDraft()}
}
function renderChatKeepDraft(){const draft=$('#msgComposeText')?.value||'';renderChats();const box=$('#msgComposeText');if(box){box.value=draft;updateComposeCount()}}
function addChatFiles(list){
  const view=msgView.chats,allowed=['image/jpeg','image/png','application/pdf'];
  for(const file of list){
    if(!allowed.includes(file.type)){toast(`«${file.name}»: можно только JPEG, PNG или PDF`);continue}
    if(file.size>5*1024*1024){toast(`«${file.name}»: файл больше 5 Мб`);continue}
    if(view.files.reduce((sum,item)=>sum+item.size,0)+file.size>30*1024*1024){toast('Файлы вместе — не больше 30 Мб');break}
    view.files.push(file);
  }
  renderChatKeepDraft();
}
// Файл из чата: картинку показываем в окне, PDF — в новой вкладке. На модерации — подсказка, когда повторить.
async function openChatFile(id,name){
  try{
    const response=await fetch(`/api/messages/file?${msgQuery({id})}`);
    const type=response.headers.get('content-type')||'';
    if(type.includes('application/json')){const data=await response.json();if(!response.ok)throw new Error(data.error||`Ошибка ${response.status}`);if(data.pending)return toast(`Файл на модерации WB — повторите через ${data.retrySeconds} с`);throw new Error('Файл не получен')}
    if(!response.ok)throw new Error(`Ошибка ${response.status}`);
    const url=URL.createObjectURL(await response.blob());
    if(type.startsWith('image/'))openModal(`<p class="eyebrow">Файл из чата</p><h2>${escapeHtml(name)}</h2><img class="msg-image" src="${url}" alt="${escapeHtml(name)}"><div class="modal-actions"><a class="primary msg-download" href="${url}" download="${escapeHtml(name)}">Скачать</a></div>`,true);
    else window.open(url,'_blank','noopener');
  }catch(error){toast(error.message)}
}

// --- Вопросы, отзывы, заявки: списки с ответами ---
function renderMessageList(){
  const tab=msgView.tab,view=msgView[tab],data=view.data,body=$('#msgBody');
  const modes=tab==='questions'?[['new','Без ответа'],['answered','С ответом']]:tab==='feedbacks'?[['new','Без ответа'],['answered','С ответом'],['archive','Архив']]:[['new','На рассмотрении'],['archive','Архив']];
  $('#msgFilters').innerHTML=`<select id="msgMode" aria-label="Какие показывать">${modes.map(([value,label])=>`<option value="${value}"${view.mode===value?' selected':''}>${label}</option>`).join('')}</select>`+
    (tab!=='claims'?`<label class="search">⌕ <input id="msgNmId" inputmode="numeric" placeholder="Артикул WB" value="${escapeHtml(view.nmId)}"></label>`:'')+
    (tab==='feedbacks'?`<select id="msgRating" aria-label="Оценка"><option value="">Все оценки</option>${[5,4,3,2,1].map(value=>`<option value="${value}"${String(view.rating)===String(value)?' selected':''}>${'★'.repeat(value)}</option>`).join('')}</select>`:'');
  if(!data){
    $('#msgInfo').textContent=view.error?`Не удалось загрузить: ${view.error}`:'Загрузка…';body.innerHTML=view.error?`<p class="msg-empty">${escapeHtml(view.error)}</p>`:'';$('#msgPagination').classList.add('hidden');return;
  }
  let items=data.items||[];
  if(tab==='feedbacks'&&view.rating)items=items.filter(item=>item.rating===Number(view.rating));
  const total=data.total;
  const counts=tab==='claims'?`${fmtNum(total||0)} ${view.mode==='archive'?'в архиве':'на рассмотрении'} · заявки за последние 14 дней`
    :`без ответа ${fmtNum(data.countUnanswered||0)} · с ответом ${fmtNum(data.countArchive||0)}${tab==='feedbacks'&&view.rating?` · на странице с оценкой ${view.rating}: ${items.length}`:''}`;
  $('#msgInfo').textContent=`${counts}${view.loading?' · обновляем…':''}`;
  const html=tab==='questions'?items.map(questionHtml):tab==='feedbacks'?items.map(feedbackHtml):items.map(claimHtml);
  body.innerHTML=html.length?`<div class="msg-items">${html.join('')}</div>`:`<p class="msg-empty">${tab==='claims'?'Заявок нет.':view.mode==='new'?'Всё отвечено — новых нет.':'Ничего не найдено.'}</p>`;
  // Страниц: по общему числу, если WB его дал; иначе — «есть ещё», если страница полная.
  const pageCount=total!=null?Math.ceil(total/view.pageSize):(data.items||[]).length===view.pageSize?view.page+1:view.page;
  renderPager($('#msgPagination'),{page:view.page,pageCount,total:total??(view.page-1)*view.pageSize+(data.items||[]).length,sizeKey:`messages-${tab}`,
    onPage:page=>{view.page=page;loadMessageTab(true);document.querySelector('#page-messages .msg-panel')?.scrollIntoView({behavior:'smooth',block:'start'})},
    onSize:size=>{view.pageSize=size;view.page=1;loadMessageTab(true)}});
}
function answerFormHtml(kind,id,{editing=false,reject=false,text=''}={}){
  return `<form class="msg-answer" data-msg-answer="${kind}" data-msg-id="${escapeHtml(id)}" data-msg-editing="${editing?'1':''}"><textarea rows="3" maxlength="5000" placeholder="${editing?'Новый текст ответа — изменить можно один раз':'Ответ покупателю'}">${escapeHtml(text)}</textarea>
    <div class="msg-answer-actions"><button type="submit" class="primary">${editing?'Сохранить ответ':'Ответить'}</button>${reject?'<button type="button" data-msg-reject>Отклонить вопрос</button>':''}${editing?'<button type="button" data-msg-cancel-edit>Отмена</button>':''}</div></form>`;
}
function questionHtml(item){
  const answer=item.answer?`<div class="msg-reply"><b>${item.state==='none'?'Вопрос отклонён':'Ваш ответ'}</b>${item.answer.createDate?` <small>${escapeHtml(msgTime(item.answer.createDate))}</small>`:''}<p>${msgText(item.answer.text)}</p>${item.answer.editable&&item.state!=='none'?`<button type="button" class="msg-link-button" data-msg-edit="question" data-msg-id="${escapeHtml(item.id)}">Изменить ответ</button>`:''}</div>`:answerFormHtml('question',item.id,{reject:true});
  return `<article class="msg-item${item.wasViewed?'':' unseen'}" data-msg-item="${escapeHtml(item.id)}"><div class="msg-item-head"><div>${msgProductLink(item.product)}<small>арт. ${item.product.nmId||'—'}${item.product.vendorCode?` · ${escapeHtml(item.product.vendorCode)}`:''}${item.product.brand?` · ${escapeHtml(item.product.brand)}`:''}</small></div><small>${escapeHtml(msgTime(item.createdDate))}${item.wasViewed?'':' · <b class="msg-new">новый</b>'}${item.isWarned?' · <b class="msg-warn">подозрительный</b>':''}</small></div>
    <p class="msg-question">${msgText(item.text)}</p>${answer}</article>`;
}
function feedbackHtml(item){
  const meta=[item.userName,MSG_ORDER_STATUS[item.orderStatus],MSG_SIZE[item.matchingSize],item.color&&item.color!=='colorless'?item.color:'',item.product.size&&item.product.size!=='0'?`размер ${item.product.size}`:''].filter(Boolean).map(escapeHtml).join(' · ');
  const photos=item.photos.length?`<div class="msg-photos">${item.photos.map(photo=>`<a href="${escapeHtml(photo.full||photo.mini)}" target="_blank" rel="noopener noreferrer"><img src="${escapeHtml(photo.mini||photo.full)}" alt="Фото из отзыва" loading="lazy"></a>`).join('')}</div>`:'';
  const video=item.video?`<a class="msg-video" href="${escapeHtml(item.video.link)}" target="_blank" rel="noopener noreferrer">${item.video.preview?`<img src="${escapeHtml(item.video.preview)}" alt="" loading="lazy">`:''}▶ Видео${item.video.duration?` · ${item.video.duration} с`:''}</a>`:'';
  const parts=[item.text&&`<p>${msgText(item.text)}</p>`,item.pros&&`<p><b>Достоинства:</b> ${msgText(item.pros)}</p>`,item.cons&&`<p><b>Недостатки:</b> ${msgText(item.cons)}</p>`].filter(Boolean).join('')||'<p class="muted">Только оценка, без текста.</p>';
  const answerState=item.answer?MSG_ANSWER_STATE[item.answer.state]:'';
  // Только оценка, без текста и фото — WB считает отзыв обработанным, отвечать не нужно.
  const ratingOnly=!item.text&&!item.pros&&!item.cons&&!item.photos.length&&!item.video;
  const answer=item.answer?`<div class="msg-reply"><b>Ваш ответ</b>${answerState?` <small class="msg-warn">${escapeHtml(answerState)}</small>`:''}<p>${msgText(item.answer.text)}</p>${item.answer.editable?`<button type="button" class="msg-link-button" data-msg-edit="feedback" data-msg-id="${escapeHtml(item.id)}">Изменить ответ</button>`:''}</div>`
    :ratingOnly?'<small class="msg-muted-line">Ответ не нужен — WB считает такой отзыв обработанным.</small>':answerFormHtml('feedback',item.id);
  const returned=item.returnDate?`<small class="msg-muted-line">Возврат запрошен ${escapeHtml(msgTime(item.returnDate))}</small>`:'';
  return `<article class="msg-item${item.wasViewed?'':' unseen'}" data-msg-item="${escapeHtml(item.id)}"><div class="msg-item-head"><div>${msgStars(item.rating)} ${msgProductLink(item.product)}<small>арт. ${item.product.nmId||'—'}${item.product.vendorCode?` · ${escapeHtml(item.product.vendorCode)}`:''}${item.subjectName?` · ${escapeHtml(item.subjectName)}`:''}</small></div><small>${escapeHtml(msgTime(item.createdDate))}${item.wasViewed?'':' · <b class="msg-new">новый</b>'}</small></div>
    ${meta?`<small class="msg-muted-line">${meta}</small>`:''}<div class="msg-feedback-text">${parts}</div>${photos}${video}${item.tags.length?`<div class="msg-tags">${item.tags.map(tag=>`<span>${escapeHtml(tag)}</span>`).join('')}</div>`:''}
    ${answer}${item.canReturn?`<button type="button" class="msg-link-button danger" data-msg-return="${escapeHtml(item.id)}">Запросить возврат товара</button>`:''}${returned}</article>`;
}
function claimHtml(item){
  const photos=item.photos.length?`<div class="msg-photos">${item.photos.map(link=>`<a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer"><img src="${escapeHtml(link)}" alt="Фото из заявки" loading="lazy"></a>`).join('')}</div>`:'';
  const videos=item.videos.map(link=>`<a class="msg-video" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">▶ Видео из заявки</a>`).join('');
  const status=[MSG_CLAIM_STATUS[item.status],MSG_CLAIM_GOODS[item.statusEx]].filter(Boolean).join(' · ');
  const actions=item.actions.length?`<div class="msg-claim-actions">${item.actions.map(({action,label})=>`<button type="button" class="${action.startsWith('reject')?'':'primary'}" data-msg-claim="${escapeHtml(item.id)}" data-msg-claim-action="${escapeHtml(action)}">${escapeHtml(label)}</button>`).join('')}</div>`:'';
  return `<article class="msg-item" data-msg-item="${escapeHtml(item.id)}"><div class="msg-item-head"><div>${msgProductLink({nmId:item.nmId,name:item.productName})}<small>арт. ${item.nmId||'—'} · ${fmtNum(item.price)} ₽ · через ${escapeHtml(item.source)}</small></div><small>${escapeHtml(msgMoscowTime(item.createdAt))}</small></div>
    <small class="msg-muted-line">${escapeHtml(status)}${item.orderedAt?` · заказ ${escapeHtml(msgMoscowTime(item.orderedAt))}`:''}${item.deliveredAt?` · получен ${escapeHtml(msgMoscowTime(item.deliveredAt))}`:''}${item.imei?` · IMEI: ${escapeHtml(item.imei)}`:''}</small>
    <p class="msg-question">${msgText(item.userComment||'Без комментария')}</p>${photos}${videos}${item.wbComment?`<div class="msg-reply"><b>Ответ покупателю</b> <small>${escapeHtml(msgMoscowTime(item.updatedAt))}</small><p>${msgText(item.wbComment)}</p></div>`:''}${actions}</article>`;
}
function msgItem(tab,id){return (msgView[tab].data?.items||[]).find(item=>item.id===id)}
// Подтверждение в окне; comment — поле комментария (обязательное — для отклонения с комментарием).
function msgConfirm({title,text,button,danger=false,comment=null},onConfirm){
  openModal(`<p class="eyebrow">Сообщения покупателей</p><h2>${escapeHtml(title)}</h2><p class="muted">${text}</p>${comment?`<textarea id="msgConfirmComment" rows="4" maxlength="1000" placeholder="${escapeHtml(comment.placeholder)}"></textarea><small class="muted">${escapeHtml(comment.hint)}</small>`:''}<div class="modal-actions"><button type="button" id="msgConfirmCancel">Отмена</button><button type="button" class="${danger?'danger':'primary'}" id="msgConfirmOk">${escapeHtml(button)}</button></div>`);
  $('#msgConfirmCancel').onclick=closeModal;
  $('#msgConfirmOk').onclick=async()=>{
    const value=$('#msgConfirmComment')?.value.trim()||'';
    if(comment?.required&&value.length<10)return toast('Комментарий — не короче 10 символов');
    $('#msgConfirmOk').disabled=true;
    try{await onConfirm(value);closeModal()}catch(error){toast(error.message);$('#msgConfirmOk').disabled=false}
  };
}
async function msgPost(path,body){return api(path,{method:'POST',body:JSON.stringify({cabinet:state.cabinet,confirm:true,...body})})}
function afterMessageAction(tab,text){toast(text);msgView[tab].data=null;loadMessageTab(true);loadMessagesSummary(true)}
async function submitAnswer(form){
  const kind=form.dataset.msgAnswer,id=form.dataset.msgId,editing=form.dataset.msgEditing==='1',text=form.querySelector('textarea').value.trim(),button=form.querySelector('button[type="submit"]');
  if(text.length<(kind==='feedback'?2:1))return toast(kind==='feedback'?'Ответ — не короче 2 символов':'Напишите ответ');
  button.disabled=true;
  try{await msgPost(`/api/messages/${kind}`,{id,action:editing?'edit':'answer',text});afterMessageAction(kind==='feedback'?'feedbacks':'questions',editing?'Ответ изменён':'Ответ отправлен')}
  catch(error){toast(error.message);button.disabled=false}
}

// --- События ---
document.addEventListener('click',event=>{
  const tab=event.target.closest('[data-msg-tab]');
  if(tab){msgView.tab=tab.dataset.msgTab;try{localStorage.setItem('wb-messages-tab',msgView.tab)}catch{}renderMessages();loadMessageTab();return}
  const chat=event.target.closest('[data-msg-chat]');if(chat)return openChat(chat.dataset.msgChat);
  if(event.target.closest('[data-msg-back]')){msgView.chats.openId='';msgView.chats.thread=null;return renderChats()}
  const file=event.target.closest('[data-msg-file]');if(file)return openChatFile(file.dataset.msgFile,file.dataset.msgFileName);
  const unattach=event.target.closest('[data-msg-unattach]');if(unattach){msgView.chats.files.splice(Number(unattach.dataset.msgUnattach),1);return renderChatKeepDraft()}
  const edit=event.target.closest('[data-msg-edit]');
  if(edit){
    const kind=edit.dataset.msgEdit,item=msgItem(kind==='feedback'?'feedbacks':'questions',edit.dataset.msgId);
    edit.closest('.msg-reply').insertAdjacentHTML('afterend',answerFormHtml(kind,edit.dataset.msgId,{editing:true,text:item?.answer?.text||''}));edit.remove();return;
  }
  if(event.target.closest('[data-msg-cancel-edit]'))return renderMessages();
  const reject=event.target.closest('[data-msg-reject]');
  if(reject){
    const form=reject.closest('form'),id=form.dataset.msgId,text=form.querySelector('textarea').value.trim();
    if(!text)return toast('Напишите причину отклонения в поле ответа');
    return msgConfirm({title:'Отклонить вопрос?',text:'Вопрос не будет показан на сайте WB. Текст из поля ответа уйдёт в WB как причина.',button:'Отклонить',danger:true},async()=>{await msgPost('/api/messages/question',{id,action:'reject',text});afterMessageAction('questions','Вопрос отклонён')});
  }
  const returnButton=event.target.closest('[data-msg-return]');
  if(returnButton){
    const item=msgItem('feedbacks',returnButton.dataset.msgReturn);
    return msgConfirm({title:'Запросить возврат товара?',text:`WB запросит у покупателя возврат товара «${escapeHtml(item?.product?.name||'')}» по этому отзыву. Отменить запрос нельзя.`,button:'Запросить возврат',danger:true},async()=>{await msgPost('/api/messages/feedback',{id:returnButton.dataset.msgReturn,action:'return'});afterMessageAction('feedbacks','Возврат запрошен')});
  }
  const claim=event.target.closest('[data-msg-claim]');
  if(claim){
    const item=msgItem('claims',claim.dataset.msgClaim),action=claim.dataset.msgClaimAction,label=item?.actions.find(entry=>entry.action===action)?.label||action;
    const comment=action==='rejectcustom'?{required:true,placeholder:'Комментарий покупателю — от 10 до 1000 символов',hint:'Покупатель увидит этот комментарий.'}:action==='approvecc1'?{required:false,placeholder:'Комментарий (необязательно): телефон, часы работы отдела возвратов',hint:'Если пишете комментарий — от 10 до 1000 символов.'}:null;
    return msgConfirm({title:`${label}?`,text:`Заявка на возврат «${escapeHtml(item?.productName||'')}» (арт. ${item?.nmId||'—'}). Решение уйдёт покупателю.`,button:label,danger:action.startsWith('reject'),comment},async value=>{
      if(action==='approvecc1'&&value&&value.length<10)throw new Error('Комментарий — не короче 10 символов');
      await msgPost('/api/messages/claim',{id:item.id,action,comment:value});afterMessageAction('claims','Ответ на заявку отправлен');
    });
  }
});
document.addEventListener('submit',event=>{
  if(event.target.id==='msgCompose'){event.preventDefault();return sendChatMessage()}
  const form=event.target.closest('[data-msg-answer]');if(form){event.preventDefault();submitAnswer(form)}
});
document.addEventListener('input',event=>{
  if(event.target.id==='msgChatSearch'){msgView.chats.search=event.target.value;const list=$('#msgChatList');if(list)list.innerHTML=chatListHtml()}
  if(event.target.id==='msgComposeText')updateComposeCount();
});
document.addEventListener('keydown',event=>{
  // Ctrl+Enter — отправить сообщение в чат.
  if(event.target.id==='msgComposeText'&&event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();sendChatMessage()}
  if(event.target.id==='msgNmId'&&event.key==='Enter'){const view=msgView[msgView.tab];view.nmId=event.target.value.replace(/\D/g,'');view.page=1;loadMessageTab(true)}
});
document.addEventListener('change',event=>{
  if(event.target.id==='msgChatAwaiting'){msgView.chats.awaiting=event.target.checked;const list=$('#msgChatList');if(list)list.innerHTML=chatListHtml()}
  if(event.target.id==='msgComposeFiles'){addChatFiles([...event.target.files]);event.target.value=''}
  if(event.target.id==='msgMode'){const view=msgView[msgView.tab];view.mode=event.target.value;view.page=1;loadMessageTab(true)}
  if(event.target.id==='msgNmId'){const view=msgView[msgView.tab];const value=event.target.value.replace(/\D/g,'');if(value!==view.nmId){view.nmId=value;view.page=1;loadMessageTab(true)}}
  if(event.target.id==='msgRating'){msgView.feedbacks.rating=event.target.value;renderMessages()}
});
try{const saved=localStorage.getItem('wb-messages-tab');if(MSG_TABS[saved])msgView.tab=saved}catch{}
