// --- Уведомления по разделам: колокольчик справа от «Обновить» ---
// У каждого раздела свой список: предупреждения из ответов WB (например «Баланс: scope is not allowed for this resource»)
// и ошибки загрузки. setNotices(раздел, источник, тексты) заменяет уведомления этого источника целиком — при новой
// загрузке исправившиеся пропадают сами; addNotice добавляет ошибку. Раздел '*' — видно во всех разделах (демо-режим).
const notices={byPage:new Map(),seen:new Set(),open:false};
const NOTICE_PAGES={summary:'Сводка',orders:'Лента заказов','fbs-orders':'Новые заказы','fbw-stocks':'Остатки FBW',stocks:'Остатки FBS',prices:'Цены и скидки',funnel:'Воронка',ratings:'Оценки товаров',ads:'Реклама'};
const noticeList=page=>[...(notices.byPage.get('*')||[]),...(notices.byPage.get(page)||[])];
function setNotices(page,source,items=[],level='warning'){
  const now=new Date().toISOString(),old=notices.byPage.get(page)||[],kept=old.filter(item=>item.source!==source);
  // Уведомление, которое уже было, сохраняет время и отметку «прочитано».
  const fresh=[...new Set((items||[]).filter(Boolean).map(String))].map(text=>old.find(item=>item.source===source&&item.text===text)||{id:`${page}|${source}|${text}`,text,level,source,at:now});
  notices.byPage.set(page,[...kept,...fresh]);
  renderNoticeBell();
}
function addNotice(page,text,level='error',source='error'){
  const list=(notices.byPage.get(page)||[]).filter(item=>!(item.source===source&&item.text===text));
  list.push({id:`${page}|${source}|${text}|${Date.now()}`,text,level,source,at:new Date().toISOString()});
  notices.byPage.set(page,list.slice(-30));
  renderNoticeBell();
}
function renderNoticeBell(){
  const bell=document.getElementById('noticeBell');if(!bell)return;
  const list=noticeList(state.activePage),unseen=list.filter(item=>!notices.seen.has(item.id)),count=document.getElementById('noticeCount');
  count.textContent=list.length;count.hidden=!list.length;
  // Красный счётчик — есть непрочитанные ошибки, оранжевый — непрочитанные предупреждения, серый — всё прочитано.
  count.className=unseen.some(item=>item.level==='error')?'error':unseen.length?'warning':'seen';
  bell.title=list.length?`Уведомления раздела «${NOTICE_PAGES[state.activePage]||''}»: ${list.length}`:'Уведомлений нет';
  if(notices.open)renderNoticePanel();
}
// Текст из ответов экранируется; разрешены только <b>…</b> из собственных подсказок сайта.
const noticeText=text=>escapeHtml(text).replace(/&lt;(\/?)b&gt;/g,'<$1b>');
function renderNoticePanel(){
  const panel=document.getElementById('noticePanel'),list=noticeList(state.activePage).slice().reverse();
  const time=iso=>new Date(iso).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
  panel.innerHTML=`<div class="notice-head"><strong>Уведомления · ${escapeHtml(NOTICE_PAGES[state.activePage]||'раздел')}</strong>${list.some(item=>item.source!=='demo')?'<button type="button" class="notice-clear" data-notice-clear>Очистить</button>':''}</div>`+
    (list.length?`<div class="notice-list">${list.map(item=>`<div class="notice-item ${item.level}"><i aria-hidden="true">${item.level==='error'?'!':item.level==='info'?'i':'⚠'}</i><p>${noticeText(item.text)}</p><small>${time(item.at)}</small></div>`).join('')}</div>`:
    '<p class="notice-empty">В этом разделе ошибок и предупреждений нет.</p>');
  list.forEach(item=>notices.seen.add(item.id));
}
function toggleNotices(open=!notices.open){
  notices.open=open;
  const panel=document.getElementById('noticePanel'),bell=document.getElementById('noticeBell');if(!panel)return;
  panel.hidden=!open;bell.setAttribute('aria-expanded',String(open));
  if(open)renderNoticePanel();
  renderNoticeBell();
}
document.addEventListener('click',event=>{
  if(event.target.closest('#noticeBell'))return toggleNotices();
  if(event.target.closest('[data-notice-clear]')){notices.byPage.set(state.activePage,[]);return renderNoticeBell()}
  if(notices.open&&!event.target.closest('#noticePanel'))toggleNotices(false);
});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&notices.open)toggleNotices(false)});
