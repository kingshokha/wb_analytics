// --- «Дела»: список дел по WB — обжаловать отзыв, ответить клиенту, изменить рекламу, проверить что-то ---
// Задачи хранятся на сервере в data/todos.json (/api/todos). У задачи тип, приоритет, кабинет и артикул; ссылки в тексте
// и комментариях открываются по клику. Показываются только дела кабинета, выбранного на сайте: новое дело получает этот
// кабинет, при изменении кабинет дела не меняется (в демо-режиме кабинетов нет — дела без кабинета). Выполненные уходят во вкладку «Выполненные» (можно вернуть), у каждой задачи —
// журнал: создана, что изменилось, комментарии, выполнена, возвращена.
// Файл подключается до app.js: $, api, state и прочее из app.js используются только внутри функций.
const TODO_TYPES=[['review','Отзыв'],['client','Клиент'],['ads','Реклама'],['prices','Цены'],['stock','Остатки и поставки'],['card','Карточка'],['check','Проверить'],['other','Прочее']];
const TODO_PRIORITIES=[['urgent','Срочно'],['high','Важно'],['normal','Обычно']];
const TODO_FIELD_LABELS={text:'текст',type:'тип',priority:'приоритет',cabinet:'кабинет',nmId:'артикул'};
const TODO_PAGE=100;
const todoView={tasks:null,error:'',tab:'open',editing:null,draft:null,openLog:new Set(),limit:TODO_PAGE,request:0,ready:false};

const todoTypeLabel=key=>(TODO_TYPES.find(([k])=>k===key)||TODO_TYPES.at(-1))[1];
const todoPriorityLabel=key=>(TODO_PRIORITIES.find(([k])=>k===key)||TODO_PRIORITIES.at(-1))[1];
const todoCabinetName=id=>id?((state.cabinets||[]).find(item=>item.id===id)?.name||`Кабинет ${id}`):'';
// Кабинет дел — выбранный на сайте (демо-кабинет сервер хранит как «без кабинета»).
const todoCabinet=()=>(state.cabinets||[]).find(item=>item.id===state.cabinet&&item.configured)?.id||'';
const todoOfCabinet=task=>(task.cabinet||'')===todoCabinet();
const todoTime=iso=>new Date(iso).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'}).replace(',','');
const todoComments=task=>(task.log||[]).filter(entry=>entry.action==='comment');

// Ссылки (http, https, www.) превращаются в кликабельные — открываются в новой вкладке. Остальной текст экранируется.
function todoLinkify(text){
  const value=String(text||''),pattern=/(?:https?:\/\/|www\.)[^\s<>"']*[^\s<>"'.,;:!?)\]»]/gi;let html='',last=0;
  for(const match of value.matchAll(pattern)){
    const url=match[0],href=/^www\./i.test(url)?`https://${url}`:url,label=url.replace(/^https?:\/\//i,'');
    html+=escapeHtml(value.slice(last,match.index))+`<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(href)}">${escapeHtml(label.length>70?`${label.slice(0,67)}…`:label)}</a>`;
    last=match.index+url.length;
  }
  return html+escapeHtml(value.slice(last));
}

// Поля задачи — одни и те же для новой задачи (форма сверху) и для изменения в списке.
function todoFormFields(task={}){
  const type=task.type||'other',priority=task.priority||'normal';
  return `<textarea data-todo-field="text" rows="2" maxlength="4000" placeholder="Что сделать? Например: обжаловать отзыв на худи — ссылки можно вставлять прямо в текст">${escapeHtml(task.text||'')}</textarea>`+
    `<div class="todo-type-picker" role="radiogroup" aria-label="Тип дела">${TODO_TYPES.map(([key,label])=>`<button type="button" class="todo-type-chip t-${key}${key===type?' active':''}" data-todo-type="${key}" role="radio" aria-checked="${key===type}">${label}</button>`).join('')}</div>`+
    `<div class="todo-form-row"><select data-todo-field="priority" aria-label="Приоритет">${TODO_PRIORITIES.map(([key,label])=>`<option value="${key}"${key===priority?' selected':''}>${label}</option>`).join('')}</select>`+
    `<input data-todo-field="nmId" placeholder="Артикул WB или ссылка на товар" value="${escapeHtml(task.nmId||'')}"></div>`;
}
function todoFormValues(root){
  const field=name=>root.querySelector(`[data-todo-field="${name}"]`)?.value??'';
  return {text:field('text'),type:root.querySelector('.todo-type-chip.active')?.dataset.todoType||'other',priority:field('priority'),nmId:field('nmId').trim()};
}
function ensureTodoUi(){
  if(todoView.ready)return;todoView.ready=true;
  $('#todoForm').innerHTML=todoFormFields()+
    '<div class="todo-form-foot"><span class="todo-hint">Enter — добавить, Shift+Enter — новая строка. Ссылки в тексте открываются по клику.</span><button class="primary" type="submit">Добавить дело</button></div>';
  $('#todoTypeFilter').innerHTML='<option value="">Все типы</option>'+TODO_TYPES.map(([key,label])=>`<option value="${key}">${label}</option>`).join('');
  $('#todoPriorityFilter').innerHTML='<option value="">Любой приоритет</option>'+TODO_PRIORITIES.map(([key,label])=>`<option value="${key}">${label}</option>`).join('');
  ['#todoSearch','#todoTypeFilter','#todoPriorityFilter'].forEach(id=>$(id).addEventListener('input',()=>{todoView.limit=TODO_PAGE;renderTodos()}));
}

async function loadTodos(quiet=false){
  ensureTodoUi();
  const request=++todoView.request;
  if(!quiet&&!todoView.tasks)renderTodos();
  try{
    const data=await api('/api/todos');
    if(request!==todoView.request)return;
    todoView.tasks=data.tasks||[];todoView.error='';
  }catch(e){if(request!==todoView.request)return;todoView.error=e.message;if(!quiet)toast(e.message)}
  renderTodos();
}

function todoRows(){
  const search=$('#todoSearch').value.trim().toLowerCase(),type=$('#todoTypeFilter').value,priority=$('#todoPriorityFilter').value;
  const rank={urgent:0,high:1,normal:2},done=todoView.tab==='done';
  return (todoView.tasks||[]).filter(task=>todoOfCabinet(task)&&Boolean(task.doneAt)===done)
    .filter(task=>(!type||task.type===type)&&(!priority||task.priority===priority))
    .filter(task=>!search||[task.text,task.nmId,task.product?.name,task.product?.vendorCode,todoTypeLabel(task.type),...todoComments(task).map(entry=>entry.text)].join(' ').toLowerCase().includes(search))
    // В работе: сначала срочные, потом важные, внутри — новые сверху. Выполненные — по дате выполнения, свежие сверху.
    .sort((a,b)=>done?String(b.doneAt).localeCompare(String(a.doneAt)):(rank[a.priority]??2)-(rank[b.priority]??2)||String(b.createdAt).localeCompare(String(a.createdAt)));
}
function todoDay(iso){
  const day=new Date(iso),today=new Date(),yesterday=new Date(Date.now()-86_400_000),same=(a,b)=>a.toDateString()===b.toDateString();
  return same(day,today)?'Сегодня':same(day,yesterday)?'Вчера':day.toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'});
}
function renderTodos(){
  const list=$('#todoList');if(!list)return;
  // Несохранённые правки задачи в режиме изменения переживают перерисовку (фильтры, «Показать ещё»).
  const editRoot=list.querySelector('.todo-item.editing');if(editRoot)todoView.draft={id:editRoot.dataset.todoId,values:todoFormValues(editRoot)};
  const tasks=todoView.tasks?todoView.tasks.filter(todoOfCabinet):null,open=(tasks||[]).filter(task=>!task.doneAt).length;
  $('#todoOpenCount').textContent=tasks?fmtNum(open):'';$('#todoDoneCount').textContent=tasks?fmtNum(tasks.length-open):'';
  $$('[data-todo-tab]').forEach(button=>button.classList.toggle('active',button.dataset.todoTab===todoView.tab));
  $('#todoListTitle').textContent=todoView.tab==='done'?'Выполненные':'В работе';
  if(!tasks){$('#todoCount').textContent=todoView.error?`Ошибка: ${todoView.error}`:'Загрузка дел…';list.innerHTML='';return}
  const rows=todoRows(),shown=rows.slice(0,todoView.limit),all=tasks.filter(task=>Boolean(task.doneAt)===(todoView.tab==='done')).length;
  $('#todoCount').textContent=rows.length===all?`${fmtNum(all)} ${pluralRu(all,['задача','задачи','задач'])}`:`Найдено ${fmtNum(rows.length)} из ${fmtNum(all)}`;
  if(!rows.length){
    list.innerHTML=`<div class="todo-empty">${all?'Ничего не найдено — измените поиск или фильтры.':todoView.tab==='done'?'Выполненных дел пока нет. Отметьте дело кружком слева — оно появится здесь.':'Дел нет. Добавьте первое в форме выше.'}</div>`;return;
  }
  let lastDay='';
  list.innerHTML=shown.map(task=>{
    const day=todoView.tab==='done'?todoDay(task.doneAt):'',head=day&&day!==lastDay?`<h4 class="todo-day">${day}</h4>`:'';lastDay=day||lastDay;
    return head+todoItem(task);
  }).join('')+(rows.length>shown.length?`<button type="button" class="todo-more" data-todo-more>Показать ещё ${fmtNum(Math.min(TODO_PAGE,rows.length-shown.length))}</button>`:'');
}
function todoItem(task){
  if(todoView.editing===task.id){
    const draft=todoView.draft?.id===task.id?{...task,...todoView.draft.values}:task;
    return `<article class="todo-item editing" data-todo-id="${escapeHtml(task.id)}"><div class="todo-edit">${todoFormFields(draft)}<div class="todo-form-foot"><span class="todo-hint">Enter — сохранить, Esc — отмена</span><div class="modal-actions"><button type="button" class="todo-button" data-todo-cancel>Отмена</button><button type="button" class="primary" data-todo-save>Сохранить</button></div></div></div></article>`;
  }
  const done=Boolean(task.doneAt),comments=todoComments(task),logOpen=todoView.openLog.has(task.id),lastComment=comments.at(-1);
  const product=task.nmId?`<a class="todo-product" href="https://www.wildberries.ru/catalog/${encodeURIComponent(task.nmId)}/detail.aspx" target="_blank" rel="noopener noreferrer" title="Открыть товар на WB">${task.product?.photo?`<img src="${escapeHtml(task.product.photo)}" alt="" loading="lazy">`:''}<span>${escapeHtml(task.product?.name||'Товар на WB')}</span><small>${task.product?.vendorCode?`${escapeHtml(task.product.vendorCode)} · `:''}${escapeHtml(task.nmId)}</small></a>`:'';
  return `<article class="todo-item p-${escapeHtml(task.priority)}${done?' done':''}" data-todo-id="${escapeHtml(task.id)}">
    <button type="button" class="todo-check" data-todo-toggle title="${done?'Вернуть в работу':'Отметить выполненным'}" aria-label="${done?'Вернуть в работу':'Отметить выполненным'}">${done?'✓':''}</button>
    <div class="todo-main"><div class="todo-text">${todoLinkify(task.text)}</div>
      <div class="todo-meta"><span class="todo-type t-${escapeHtml(task.type)}">${todoTypeLabel(task.type)}</span>${task.priority!=='normal'?`<span class="todo-prio p-${escapeHtml(task.priority)}">${todoPriorityLabel(task.priority)}</span>`:''}${product}<span>${done?`выполнено ${todoTime(task.doneAt)}`:`создано ${todoTime(task.createdAt)}`}</span></div>
      ${lastComment&&!logOpen?`<div class="todo-last-comment" title="Последний комментарий, ${todoTime(lastComment.at)}">${todoLinkify(lastComment.text)}</div>`:''}
      ${logOpen?todoLog(task):''}
    </div>
    <div class="todo-actions"><button type="button" data-todo-log class="${logOpen?'active':''}" aria-expanded="${logOpen}">История${comments.length?` · ${fmtNum(comments.length)}`:''}</button>${done?'<button type="button" data-todo-toggle>Вернуть</button>':'<button type="button" data-todo-edit>Изменить</button>'}<button type="button" data-todo-delete>Удалить</button></div>
  </article>`;
}
function todoValue(field,value){
  if(value==null||value==='')return '—';
  if(field==='type')return todoTypeLabel(value);
  if(field==='priority')return todoPriorityLabel(value);
  if(field==='cabinet')return escapeHtml(todoCabinetName(value));
  if(field==='text'){const text=String(value);return `«${escapeHtml(text.length>140?`${text.slice(0,137)}…`:text)}»`}
  return escapeHtml(String(value));
}
function todoLogText(entry){
  if(entry.action==='created')return 'Создана';
  if(entry.action==='done')return '<b class="todo-log-done">Выполнена</b>';
  if(entry.action==='reopened')return '<b>Возвращена в работу</b>';
  if(entry.action==='comment')return `<span class="todo-log-comment">${todoLinkify(entry.text)}</span>`;
  if(entry.action==='edited')return 'Изменено: '+(entry.changes||[]).map(change=>`${TODO_FIELD_LABELS[change.field]||escapeHtml(change.field)} <span class="todo-was">${todoValue(change.field,change.from)}</span> → ${todoValue(change.field,change.to)}`).join('; ');
  return escapeHtml(entry.action);
}
function todoLog(task){
  const entries=[...(task.log||[])].reverse().map(entry=>`<li><time>${todoTime(entry.at)}</time><div>${todoLogText(entry)}</div></li>`).join('');
  return `<div class="todo-log"><form class="todo-comment" data-todo-comment><input maxlength="2000" placeholder="Комментарий: что сделано, ответ клиента, ссылка…" aria-label="Комментарий"><button type="submit">Добавить</button></form><ol>${entries}</ol></div>`;
}

// Ответ сервера — задача без названия и фото товара: берём их из прежней версии, а при новом артикуле дочитываем список.
function todoApply(task){
  const index=todoView.tasks.findIndex(item=>item.id===task.id),before=todoView.tasks[index];
  const merged={...task,product:before&&String(before.nmId||'')===String(task.nmId||'')?before.product:null};
  if(index<0)todoView.tasks.push(merged);else todoView.tasks[index]=merged;
  if(task.nmId&&!merged.product)loadTodos(true);
}
async function todoSend(body){return api('/api/todos',{method:'POST',body:JSON.stringify(body)})}
async function todoAdd(){
  const form=$('#todoForm'),values=todoFormValues(form),button=form.querySelector('[type="submit"]');
  if(!values.text.trim())return toast('Напишите, что нужно сделать');
  button.disabled=true;
  try{
    const {task}=await todoSend({...values,cabinet:todoCabinet()});
    todoView.tasks=todoView.tasks||[];todoApply(task);
    // Тип и приоритет остаются — удобно добавлять несколько похожих дел подряд.
    const text=form.querySelector('[data-todo-field="text"]');text.value='';text.style.height='';form.querySelector('[data-todo-field="nmId"]').value='';
    todoView.tab='open';renderTodos();toast('Дело добавлено');text.focus();
  }catch(e){toast(e.message)}finally{button.disabled=false}
}
async function todoUpdate(id,body,message){
  try{const {task}=await todoSend({id,...body});todoApply(task);renderTodos();if(message)toast(message);return true}
  catch(e){toast(e.message);return false}
}
async function todoSaveEdit(item){
  const id=item.dataset.todoId,values=todoFormValues(item);
  if(!values.text.trim())return toast('Текст задачи не может быть пустым');
  todoView.draft={id,values};
  if(await todoUpdate(id,values,'Изменения сохранены')){todoView.editing=null;todoView.draft=null;renderTodos()}
}
function todoDelete(id){
  const task=todoView.tasks.find(item=>item.id===id);if(!task)return;
  openModal(`<p class="eyebrow">Дела</p><h2>Удалить задачу?</h2><p class="todo-delete-text">${escapeHtml(task.text.length>200?`${task.text.slice(0,197)}…`:task.text)}</p><p class="todo-hint">Задача и её история удалятся насовсем. Если дело сделано — лучше отметьте его выполненным: оно останется во вкладке «Выполненные».</p><div class="modal-actions"><button type="button" class="todo-button" id="todoDeleteCancel">Отмена</button><button type="button" class="primary todo-danger" id="todoDeleteConfirm">Удалить</button></div>`);
  $('#todoDeleteCancel').onclick=closeModal;
  $('#todoDeleteConfirm').onclick=async()=>{
    const button=$('#todoDeleteConfirm');button.disabled=true;
    try{await todoSend({id,remove:true});todoView.tasks=todoView.tasks.filter(item=>item.id!==id);todoView.openLog.delete(id);closeModal();renderTodos();toast('Задача удалена')}
    catch(e){button.disabled=false;toast(e.message)}
  };
}

document.addEventListener('click',event=>{
  if(!event.target.closest('#page-todo'))return;
  const tab=event.target.closest('[data-todo-tab]');
  if(tab){todoView.tab=tab.dataset.todoTab;todoView.limit=TODO_PAGE;todoView.editing=null;todoView.draft=null;renderTodos();return}
  const chip=event.target.closest('[data-todo-type]');
  if(chip){chip.parentElement.querySelectorAll('.todo-type-chip').forEach(item=>{item.classList.toggle('active',item===chip);item.setAttribute('aria-checked',String(item===chip))});return}
  if(event.target.closest('[data-todo-more]')){todoView.limit+=TODO_PAGE;renderTodos();return}
  const item=event.target.closest('.todo-item');if(!item)return;
  const id=item.dataset.todoId,task=(todoView.tasks||[]).find(entry=>entry.id===id);if(!task)return;
  if(event.target.closest('[data-todo-toggle]'))return todoUpdate(id,{done:!task.doneAt},task.doneAt?'Дело возвращено в работу':'Готово — дело во вкладке «Выполненные»');
  if(event.target.closest('[data-todo-edit]')){todoView.editing=id;todoView.draft=null;renderTodos();const text=$(`.todo-item.editing [data-todo-field="text"]`);text?.focus();text?.setSelectionRange(text.value.length,text.value.length);return}
  if(event.target.closest('[data-todo-cancel]')){todoView.editing=null;todoView.draft=null;renderTodos();return}
  if(event.target.closest('[data-todo-save]'))return todoSaveEdit(item);
  if(event.target.closest('[data-todo-delete]'))return todoDelete(id);
  if(event.target.closest('[data-todo-log]')){
    if(todoView.openLog.has(id))todoView.openLog.delete(id);else todoView.openLog.add(id);
    renderTodos();if(todoView.openLog.has(id))$(`.todo-item[data-todo-id="${CSS.escape(id)}"] .todo-comment input`)?.focus();
  }
});
document.addEventListener('submit',event=>{
  if(event.target.id==='todoForm'){event.preventDefault();todoAdd();return}
  const form=event.target.closest('[data-todo-comment]');if(!form)return;
  event.preventDefault();
  const input=form.querySelector('input'),text=input.value.trim(),id=form.closest('.todo-item')?.dataset.todoId;
  if(!text||!id)return;
  input.disabled=true;
  todoUpdate(id,{comment:text}).then(ok=>{const field=$(`.todo-item[data-todo-id="${CSS.escape(id)}"] .todo-comment input`);if(field){field.disabled=false;if(!ok)field.value=text;field.focus()}});
});
document.addEventListener('keydown',event=>{
  const field=event.target.closest?.('#page-todo [data-todo-field="text"]');
  if(field&&event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();const item=field.closest('.todo-item.editing');if(item)todoSaveEdit(item);else $('#todoForm').requestSubmit();return}
  if(event.key==='Escape'&&event.target.closest?.('#page-todo .todo-item.editing')){todoView.editing=null;todoView.draft=null;renderTodos()}
});
// Поле текста растёт по мере ввода (до ограничения в стилях).
document.addEventListener('input',event=>{const field=event.target.closest?.('#page-todo [data-todo-field="text"]');if(field){field.style.height='auto';field.style.height=`${field.scrollHeight+2}px`}});
