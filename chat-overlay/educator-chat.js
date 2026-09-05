(function(){
  const REACTIONS=['❤️','👍','👌','🙏','🥰','😁','🔥'];
  const QUICK_REPLIES={
    meetings:`💌 Дорогие родители!\n\n⭐️ Обращаем ваше внимание, что договариваться о встрече с ребенком необходимо напрямую с вашим лечащим врачом!\n\n💬 Пожалуйста, напишите ему и подберите оптимальное время для встречи, с учетом состояния ребенка!\n\n🕐 Расписание встреч с 17:00 до 20:00.\n\n🩵 Спасибо за понимание!\nДетское Отделение Медси`,
    meetTime:`💌 Дорогие родители!\n\n🕐 Время встреч с детьми:\n\nБУДНИ\n🌙 Вечер - 17:00 - 20:00\n\nВЫХОДНЫЕ\n☀️ Утро - 11:00 - 13:00\n🌙 Вечер - 17:00 - 20:00\n\n🙏 Просим приводить в указанное время, так как после встреч у детей начинается прием препаратов и терапия!\n\n🩵 Спасибо за понимание!\nДетское Отделение Медси`,
    calls:`💌 Дорогие родители!\n\n⭐️ Обращаем ваше внимание, что договариваться о звонках ребенку необходимо напрямую с вашим лечащим врачом!\n\n💬 Пожалуйста, напишите ему и подберите оптимальное время для звонка, с учетом состояния ребенка!\n\n🕐 Расписание звонков с 17:00 до 20:00.\n\n🩵 Спасибо за понимание!\nДетское Отделение Медси`,
    therapy:`💌 Дорогие родители!\n\n💊 Обращаем ваше внимание, что по вопросам лечения, процедур, препаратов и другим медицинским вопросам необходимо обращаться напрямую к лечащему врачу. Воспитатели и психологи не располагают такой информацией!\n\n🩵 Спасибо за понимание!\nДетское Отделение Медси`,
    delivery:`💌 Дорогие родители!\n\n🛵 Вы можете привезти или оформить доставку любых продуктов, напитков, еды, одежды и других вещей - в рамках ограничений по безопасности.\n\n🚫 Что запрещено:\n✂️ Канцелярия — ножницы, бумажный нож, точилка, циркуль, железная линейка, канцелярский нож и лезвия.\n💄 Косметика — стеклянные зеркала, щипцы, кусачки, ножницы, пинцеты, острые пилочки, стеклянные флаконы и дезодоранты в металлических аэрозолях.\n🫙 Стеклянная посуда — бутылки, баночки с йогуртом или соком, кружки, тарелки, контейнеры.\n🍴 Столовые приборы — вилки, ложки, ножи. Допустимы только пластиковые ложки.\n🥫 Металлические банки — газировка, соки и другие напитки в жестяных банках.\n⚡️ Кофе и энергетики — нежелательны при медикаментозной терапии и запрещены на этаже.\n🚬 Сигареты - табак, электронные сигареты и т.д.\n💻 Электроника - дети у нас находятся без телефонов, планшетов, компьютеров и наушников. Возможны только простые часы и лампы без острых металлических элементов.\n👕 Одежда — просим передавать одежду без ремней, цепочек, крестиков, металлических подвесок.\n🎨 Творческие наборы — заранее убирайте железные пинцеты, шурупы, гвоздики и прочие металлические детали, идущие в комплекте с аквамозайкой или картиной по номерам.\n🍬 Жевательная резинка — нежелательны при медикаментозной терапии, в связи с тем, что у детей возможна сонливость и они могут уснуть с жвачкой.\n\n✅ Что можно заказать:\n\n🍕 Пиццу, суши, чипсы, газировку, сок, сладости, фрукты и другую еду, которая нравится вашему ребенку, если она не нарушает ограничения по упаковке и безопасности.\n🩳 Одежду, вещи, творческие наборы, канцелярию, книги, раскраски и другие нужные предметы — в рамках описанных выше ограничений.\n💊 Медикаменты по назначению врача — только по предварительной договоренности с лечащим врачом и по назначению.\n💻 Ноутбук или планшет для онлайн-уроков — только для учебы и подключения к онлайн-занятиям.\n\n🩵 Для оформления доставки:\n\nАдрес: Гринвуд с11, Путилково\nКомментарий: доставка на 5 этаж + имя ребёнка.`,
    routine:`💌 Дорогие родители!\n\n🕘 РЕЖИМ ДНЯ\n\n☀️ Утро\n\n8:00 — Подъём\n8:30 — Зарядка\n9:00 — Завтрак\n9:30 — Игры и творчество\n10:00 — Групповая психотерапия\n11:00 — Прогулка\n12:00 — Игры и творчество\n13:00 — Обед\n14:00 — Сон-час\n\n🌙 Вечер\n\n16:00 — Йога / Танцы\n16:30 — Полдник\n17:00 — Игры и творчество\n18:00 — Ужин\n18:15 — Киносеанс\n21:00 — Подготовка ко сну / \nМедицинские процедуры\n22:00 — Отбой\n\n🩵 Спасибо за понимание!\nДетское Отделение Медси`,
    writeTopic:`💌 Дорогие родители!\n\n🗣️ Здесь можно задать вопрос, оставить пожелания по отчётам, получить просьбы ребёнка по доставке и согласовать звонки или онлайн-уроки.\n\n⭐ Вся информация по состоянию ребёнка входит в отчёт и обновляется два раза в день. Ответы на свои вопросы вы получите в составе следующего отчёта!\n\n💊 Все вопросы по медикаментам и терапии обсуждаются с вашим врачом!\n\n💬 Встречи и звонки также обсуждаются с лечащим врачом.\n\n‼️ У воспитателей и психологов нет возможности регулярно отвечать в чате, так как они работают с детьми.\n\n🔔 Расписание отчётов:\n\n☀️ Утро-день — до 16:00\n🌙 День-вечер — до 22:00\n🧠 Психотерапия — до 20:00\n\n🩵 Спасибо за понимание!\nДетское Отделение Медси`
  };
  const DOCTORS={
    anastasia:`Анастасия Михайловна\n+79253394090`,
    anna:`Антон Геннадьевич\n+79859927884`,
    kristina:`Кристина Федоровна\n+79647636887`
  };
  const threadCache=new Map();
  const phone10=v=>String(v||'').replace(/\D+/g,'').slice(-10);
  const displayPhone=v=>{const p=phone10(v);return p?'8'+p:''};
  const getCached=p=>threadCache.get(phone10(p))||null;
  const setCached=(p,rows)=>threadCache.set(phone10(p),{rows:Array.isArray(rows)?rows:[],at:Date.now()});

  function fmt(v){const d=new Date(Number(v));return Number.isNaN(d.getTime())?'':d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}
  function preview(c){if(!c)return'';if(c.lastType==='image')return c.lastText||'[Фотография]';if(c.lastType==='video')return c.lastText||'[Видео]';return c.lastText||'Нет сообщений'}
  function replyLabel(r){if(!r)return'';if(r.text)return String(r.text).slice(0,120);if(r.type==='image')return'Фотография';if(r.type==='video')return'Видео';return'Сообщение'}
  function mediaUrl(m){const id=String(m&&m.fileId||'');if(!id)return'';if(id.startsWith('kv:')||id.startsWith('r2:'))return window.MedsiOverlayTransport.baseUrl+'/media/'+encodeURIComponent(id.slice(3));return'https://drive.google.com/thumbnail?id='+encodeURIComponent(id)+'&sz=w1200'}

  function getEyeIconSvg(isRead){
    if(isRead){
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.6 12s3.4-6 9.4-6 9.4 6 9.4 6-3.4 6-9.4 6-9.4-6-9.4-6z"></path><circle cx="12" cy="12" r="2.7"></circle></svg>';
    }
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 13.2c1.7 2.1 4.1 3.2 7 3.2s5.3-1.1 7-3.2"></path><path d="M7.2 15.2 5.8 17"></path><path d="M12 16.4v2.2"></path><path d="m16.8 15.2 1.4 1.8"></path></svg>';
  }
  function getPinIconSvg(){return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.72 5.5 6.07.88-4.4 4.28 1.04 6.04L12 16.84 6.57 19.7l1.04-6.04-4.4-4.28 6.07-.88L12 3"></path></svg>'}
  function getDeleteIconSvg(){return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg>'}

  function mount(overlay,state){
    const transport=window.MedsiOverlayTransport;
    const session=state&&state.session;
    if(!overlay||!transport||!session||!session.token){if(overlay)overlay.showError('Не удалось получить сессию воспитательского чата.');return}

    const oldScreen=document.body.dataset.screen||'';
    overlay.root.classList.add('educator-exact-clone');
    overlay.body.replaceChildren();

    const wrap=document.createElement('div');wrap.className='wrap';
    const frame=document.createElement('article');frame.className='frame';frame.id='frame';
    const rim=document.createElement('div');rim.id='rim';rim.className='rim';
    const scene=document.createElement('div');scene.className='scene';
    const title=document.createElement('h1');title.id='title';title.className='title';title.textContent='Чат с родителями';
    const meta=document.createElement('p');meta.id='meta';meta.className='meta';meta.textContent='Выберите чат с нужным родителем.';
    const screenChats=document.createElement('section');screenChats.id='screenChats';
    const chatList=document.createElement('div');chatList.id='chatList';chatList.className='chat-list';
    const chatListError=document.createElement('p');chatListError.id='chatListError';chatListError.className='error hidden';
    const listRow=document.createElement('div');listRow.className='row';listRow.style.marginTop='14px';
    const btnChatsBack=document.createElement('button');btnChatsBack.id='btnChatsBack';btnChatsBack.className='btn';btnChatsBack.textContent='Назад';
    const btnNewChat=document.createElement('button');btnNewChat.id='btnNewChat';btnNewChat.className='btn btn-teal';btnNewChat.textContent='Написать родителю';
    const btnRefreshChats=document.createElement('button');btnRefreshChats.id='btnRefreshChats';btnRefreshChats.className='btn refresh-btn';btnRefreshChats.title='Обновить список';btnRefreshChats.innerHTML='<span class="refresh-label" aria-hidden="true">⟳</span><span class="refresh-spinner" aria-hidden="true"></span>';
    listRow.append(btnChatsBack,btnNewChat,btnRefreshChats);screenChats.append(chatList,chatListError,listRow);

    const screenChatThread=document.createElement('section');screenChatThread.id='screenChatThread';screenChatThread.className='hidden';
    const chatThreadHeader=document.createElement('div');chatThreadHeader.id='chatThreadHeader';chatThreadHeader.className='chat-info';
    const chatThreadBox=document.createElement('div');chatThreadBox.id='chatThreadBox';chatThreadBox.className='chat-box';
    const chatThreadError=document.createElement('p');chatThreadError.id='chatThreadError';chatThreadError.className='error hidden';
    const chatReplyPreview=document.createElement('div');chatReplyPreview.id='chatReplyPreview';chatReplyPreview.className='chat-reply-preview hidden';chatReplyPreview.innerHTML='<div id="chatReplyPreviewTitle" class="chat-reply-preview-title"></div><div id="chatReplyPreviewText" class="chat-reply-preview-text"></div><button id="chatReplyCancel" type="button" class="chat-reply-cancel" aria-label="Отменить ответ">×</button>';
    const chatCompose=document.createElement('div');chatCompose.className='chat-compose';
    const fileInput=document.createElement('input');fileInput.id='chatImageInput';fileInput.type='file';fileInput.accept='image/*,video/*';fileInput.className='hidden';
    const attach=document.createElement('button');attach.id='chatAttachBtn';attach.type='button';attach.className='btn chat-attach-btn';attach.textContent='📎';
    const editorWrap=document.createElement('div');editorWrap.id='chatReplyEditor';editorWrap.className='chat-reply-editor';
    const editor=document.createElement('div');editor.id='chatReplyInput';editor.contentEditable='true';editor.setAttribute('role','textbox');editor.setAttribute('aria-multiline','true');editor.dataset.placeholder='Введите ответ родителю...';editorWrap.appendChild(editor);
    const send=document.createElement('button');send.id='chatReplySendBtn';send.type='button';send.className='btn btn-mint chat-send-btn';send.textContent='Отправить';
    chatCompose.append(fileInput,attach,editorWrap,send);
    const imagePreview=document.createElement('div');imagePreview.id='chatImagePreview';imagePreview.className='chat-image-preview hidden';imagePreview.innerHTML='<div class="preview-item"><img id="chatImagePreviewImg" src="" alt="Превью фото"><button id="chatImageRemoveBtn" class="preview-remove-btn" type="button" title="Удалить фото">✕</button></div>';
    const threadRow=document.createElement('div');threadRow.className='row';threadRow.style.marginTop='14px';
    const btnThreadBack=document.createElement('button');btnThreadBack.id='btnThreadBack';btnThreadBack.className='btn chat-nav-btn';btnThreadBack.textContent='Назад';
    const btnQuickReplies=document.createElement('button');btnQuickReplies.id='btnQuickReplies';btnQuickReplies.className='btn quick-toggle';btnQuickReplies.textContent='Быстрые ответы';
    const btnVideo=document.createElement('button');btnVideo.id='btnVideo';btnVideo.className='btn btn-sky chat-nav-btn';btnVideo.type='button';btnVideo.textContent='Видео';
    threadRow.append(btnThreadBack,btnQuickReplies,btnVideo);
    const quickPanel=document.createElement('div');quickPanel.id='quickRepliesPanel';quickPanel.className='quick-panel hidden';
    const quickGrid=document.createElement('div');quickGrid.className='quick-grid';
    const quickDefs=[['meetings','Встречи с детьми','quick-red'],['meetTime','Время встреч','quick-orange'],['calls','Звонки детям','quick-yellow'],['therapy','Терапия и препараты','quick-green'],['delivery','Доставка еды и вещей','quick-cyan'],['routine','Режим дня','quick-blue'],['writeTopic','Пишите по делу','quick-purple']];
    quickDefs.forEach(([key,label,cls])=>{const b=document.createElement('button');b.type='button';b.className='quick-btn '+cls;b.textContent=label;b.onclick=()=>{editor.textContent=QUICK_REPLIES[key];quickPanel.classList.add('hidden');editor.focus()};quickGrid.appendChild(b)});
    const quickDoctors=document.createElement('button');quickDoctors.type='button';quickDoctors.className='quick-btn quick-doctors';quickDoctors.textContent='Контакты врачей';quickGrid.appendChild(quickDoctors);
    const doctorButtons=document.createElement('div');doctorButtons.id='doctorButtons';doctorButtons.className='quick-subgrid hidden';
    [['anastasia','Анастасия Михайловна','doctor-anastasia'],['anna','Антон Геннадьевич','doctor-anna'],['kristina','Кристина Федоровна','doctor-kristina']].forEach(([key,label,cls])=>{const b=document.createElement('button');b.type='button';b.className='quick-doctor-btn '+cls;b.textContent=label;b.onclick=()=>{editor.textContent=DOCTORS[key];quickPanel.classList.add('hidden');doctorButtons.classList.add('hidden');editor.focus()};doctorButtons.appendChild(b)});
    quickPanel.append(quickGrid,doctorButtons);
    screenChatThread.append(chatThreadHeader,chatThreadBox,chatThreadError,chatReplyPreview,chatCompose,imagePreview,threadRow,quickPanel);

    scene.append(title,meta,screenChats,screenChatThread);frame.append(rim,scene);wrap.appendChild(frame);overlay.body.appendChild(wrap);

    const childDeleteModal=document.createElement('div');childDeleteModal.id='childDeleteModal';childDeleteModal.className='link-modal-overlay hidden';childDeleteModal.setAttribute('role','dialog');childDeleteModal.setAttribute('aria-modal','true');childDeleteModal.innerHTML='<div class="link-modal" style="border-color:rgba(244,63,94,.38);"><h3 class="link-modal-title" style="color:#b91c35;">Внимание!</h3><p id="childDeleteText" class="link-modal-text"></p><div class="link-modal-actions child-delete-actions"><button id="childDeleteCancel" class="link-modal-cancel" type="button">Отмена</button><button id="childDeleteConfirm" class="link-modal-save link-modal-delete" type="button">Удалить</button></div></div>';
    document.body.appendChild(childDeleteModal);

    let bucket='unread';
    let currentChats=[];
    let activeChat=null;
    let activeRows=[];
    let replyTo=null;
    let editing=null;
    let pendingFile=null;
    let pendingUrl='';
    let sending=false;
    let disposed=false;
    let deleteTarget=null;

    function tutorToken(){try{return String(localStorage.getItem('medsi_tutor_session_v1')||'')}catch(_){return''}}
    async function appApi(method,args){
      const endpoint=window.MEDSI_APP_BASE_URL||'';
      if(!endpoint)throw new Error('Серверное действие пока не подключено к тестовой оболочке.');
      const res=await fetch(endpoint,{method:'POST',headers:{'content-type':'text/plain;charset=utf-8'},body:JSON.stringify({action:'api',method,args:args||[]})});
      const payload=await res.json();
      if(!payload||!payload.ok)throw new Error(payload&&payload.message||'Ошибка Apps Script API.');
      const result=payload.result;
      if(result&&result.ok===false)throw new Error(result.message||'Операция не выполнена.');
      return result;
    }

    function showListScreen(){
      document.body.dataset.screen='screenChats';
      title.textContent='Чат с родителями';
      meta.textContent=bucket==='read'?'Прочитанные чаты':'Выберите чат с нужным родителем.';
      screenChats.classList.remove('hidden');
      screenChatThread.classList.add('hidden');
    }
    function showThreadScreen(){document.body.dataset.screen='screenChatThread';screenChats.classList.add('hidden');screenChatThread.classList.remove('hidden')}
    function setRefresh(v){btnRefreshChats.classList.toggle('loading',!!v);btnRefreshChats.disabled=!!v}

    function makeReadToggle(chat,isRead){
      const toggle=document.createElement('span');toggle.className='chat-read-toggle';toggle.setAttribute('role','button');toggle.setAttribute('tabindex','0');
      const setState=value=>{toggle.classList.toggle('is-read',!!value);toggle.classList.toggle('is-unread',!value);toggle.innerHTML=getEyeIconSvg(!!value);toggle.title=value?'Пометить непрочитанным':'Пометить прочитанным'};
      setState(isRead);
      const activate=async event=>{
        event.preventDefault();event.stopPropagation();
        const controls=toggle.closest('.chat-controls');
        if(event.type==='click'&&matchMedia('(hover: none)').matches&&controls&&!controls.classList.contains('is-menu-open')){controls.classList.add('is-menu-open');return}
        if(toggle.classList.contains('is-busy'))return;
        toggle.classList.add('is-busy');
        try{
          if(isRead){await appApi('markParentMessagesAsUnreadByEducator',[chat.phone,tutorToken()])}
          else{await transport.markRead(session,'educator',chat.phone)}
          await loadChats(false);
        }catch(err){overlay.showError(err.message)}finally{toggle.classList.remove('is-busy')}
      };
      toggle.onclick=activate;toggle.onkeydown=e=>{if(e.key==='Enter'||e.key===' ')activate(e)};
      return toggle;
    }
    function makePinToggle(chat,primary){
      const isPinned=chat&&chat.pinnedBucket===bucket;
      const toggle=document.createElement('button');toggle.type='button';toggle.className='chat-pin-toggle'+(isPinned?' is-pinned':'')+(primary?' chat-primary-toggle':'');toggle.innerHTML=getPinIconSvg();toggle.title=isPinned?'Открепить':'Закрепить сверху';
      toggle.onclick=async event=>{
        event.preventDefault();event.stopPropagation();
        const controls=toggle.closest('.chat-controls');
        if(primary&&matchMedia('(hover: none)').matches&&controls&&!controls.classList.contains('is-menu-open')){controls.classList.add('is-menu-open');return}
        try{await transport.pin(session,chat.phone,isPinned?'':bucket);await loadChats(false)}catch(err){overlay.showError(err.message)}
      };
      return toggle;
    }
    function requestChildDeletion(chat){deleteTarget=chat;childDeleteModal.querySelector('#childDeleteText').textContent='Вы хотите удалить ребёнка '+(chat.childName||'Без имени ребёнка')+'. Вся история сообщений будет удалена!';childDeleteModal.classList.remove('hidden')}
    function makeDeleteToggle(chat){const toggle=document.createElement('span');toggle.className='chat-delete-toggle';toggle.setAttribute('role','button');toggle.setAttribute('tabindex','0');toggle.title='Удалить ребёнка';toggle.innerHTML=getDeleteIconSvg();toggle.onclick=e=>{e.preventDefault();e.stopPropagation();requestChildDeletion(chat)};return toggle}
    function makeControls(chat,isRead){
      const controls=document.createElement('div');controls.className='chat-controls';
      const menu=document.createElement('div');menu.className='chat-controls-menu';
      const pinned=chat&&chat.pinnedBucket===bucket;
      if(pinned){menu.append(makePinToggle(chat,true),makeReadToggle(chat,isRead))}
      else{menu.append(makeReadToggle(chat,isRead),makePinToggle(chat,false))}
      menu.appendChild(makeDeleteToggle(chat));controls.appendChild(menu);return controls;
    }
    function makeCard(chat){
      const card=document.createElement('button');card.className='chat-card'+(chat.hasUnread?' unread':'')+(chat.pinnedBucket?' pinned':'');card.type='button';card.dataset.phone=chat.phone||'';
      const cardTitle=document.createElement('div');cardTitle.className='chat-card-title';cardTitle.textContent=chat.childName||'Без имени ребёнка';
      const cardMeta=document.createElement('div');cardMeta.className='chat-card-meta';cardMeta.textContent='Родитель: '+(chat.parentName||'—')+'\nРебёнок: '+(chat.childName||'—')+'\nНомер телефона: '+(chat.phone?displayPhone(chat.phone):'—');
      const last=document.createElement('div');last.className='chat-card-last '+(chat.lastSide==='educator'?'educator':'parent');last.textContent=preview(chat);
      card.append(makeControls(chat,!chat.hasUnread),cardTitle,cardMeta,last);
      card.onclick=e=>{if(e.target.closest('.chat-read-toggle,.chat-delete-toggle,.chat-pin-toggle'))return;activeChat=chat;openThread(chat)};
      return card;
    }
    function renderList(){
      chatList.replaceChildren();
      if(bucket==='read'){
        const w=document.createElement('div');w.style.cssText='text-align:center; margin-bottom:12px; padding:12px;';
        const b=document.createElement('button');b.className='btn';b.style.cssText='width:100%; max-width:100%;';b.textContent='← Вернуться к непрочитанным';b.onclick=()=>{bucket='unread';loadChats(false)};w.appendChild(b);chatList.appendChild(w);
      }
      if(!currentChats.length){const e=document.createElement('div');e.className='chat-empty';e.textContent=bucket==='read'?'Прочитанных чатов нет.':'Новых сообщений нет.';chatList.appendChild(e)}
      currentChats.forEach(c=>chatList.appendChild(makeCard(c)));
      if(bucket==='unread'){
        const w=document.createElement('div');w.style.cssText='text-align:center; margin-top:20px; padding:16px; border-top:1px solid rgba(36,211,218,0.18);';
        const b=document.createElement('button');b.className='btn';b.style.cssText='width:100%; max-width:100%;';b.textContent='Открыть прочитанные чаты';b.onclick=()=>{bucket='read';loadChats(false)};w.appendChild(b);chatList.appendChild(w);
      }
    }
    async function loadChats(spinner){
      showListScreen();if(spinner)setRefresh(true);
      if(!chatList.childElementCount)chatList.innerHTML='<div class="chat-empty">Загрузка...</div>';
      try{
        const res=await transport.chats(session,bucket);
        if(disposed)return;
        currentChats=(res&&res.chats||[]).slice().sort((a,b)=>Number(b&&b.pinnedBucket===bucket)-Number(a&&a.pinnedBucket===bucket));
        renderList();
      }catch(err){overlay.showError(err.message||'Не удалось загрузить список чатов.')}finally{setRefresh(false)}
    }

    function renderThreadHeader(chat){chatThreadHeader.replaceChildren();['Родитель: '+(chat.parentName||'—'),'Ребёнок: '+(chat.childName||'—'),'Номер телефона: '+displayPhone(chat.phone||'')].forEach(text=>{const d=document.createElement('div');d.textContent=text;chatThreadHeader.appendChild(d)})}
    function messageNode(m){
      const el=document.createElement('div');el.className='msg '+(m.side==='educator'?'educator':'parent');
      if(m.side==='parent'){const a=document.createElement('div');a.className='msg-author';a.textContent='Родитель';el.appendChild(a)}
      if(m.reply){const q=document.createElement('div');q.className='msg-reply-quote';q.textContent=replyLabel(m.reply);el.appendChild(q)}
      const url=mediaUrl(m);if(url){const wrap=document.createElement('div');wrap.className='msg-image-wrap';const media=document.createElement(m.type==='video'?'video':'img');media.src=url;if(m.type==='video'){media.controls=true;media.preload='metadata'}wrap.appendChild(media);el.appendChild(wrap)}
      if(m.text){const body=document.createElement('div');body.className='msg-body';body.textContent=String(m.text);el.appendChild(body)}
      if(m.reaction){const r=document.createElement('span');r.className='msg-reaction';r.textContent=m.reaction;el.appendChild(r)}
      const time=document.createElement('span');time.className='msg-time';time.textContent=[fmt(m.timestamp),m.editedAt?'изм.':''].filter(Boolean).join(' · ');el.appendChild(time);
      el.onclick=e=>openMessageMenu(m,el,e);el.oncontextmenu=e=>openMessageMenu(m,el,e);return el;
    }
    function renderRows(rows,stick=true){activeRows=Array.isArray(rows)?rows:[];chatThreadBox.replaceChildren();if(!activeRows.length){const e=document.createElement('div');e.className='chat-empty';e.textContent='Сообщений пока нет.';chatThreadBox.appendChild(e)}else activeRows.forEach(m=>chatThreadBox.appendChild(messageNode(m)));if(stick)requestAnimationFrame(()=>chatThreadBox.scrollTop=chatThreadBox.scrollHeight)}
    async function refreshThread(preserve){if(!activeChat)return;const gap=chatThreadBox.scrollHeight-chatThreadBox.scrollTop-chatThreadBox.clientHeight;try{const res=await transport.thread(session,activeChat.phone,'',100);if(disposed)return;setCached(activeChat.phone,res.messages||[]);renderRows(res.messages||[],!preserve||gap<80);if(preserve&&gap>80)chatThreadBox.scrollTop=Math.max(0,chatThreadBox.scrollHeight-chatThreadBox.clientHeight-gap)}catch(err){overlay.showError(err.message||'Не удалось загрузить чат.')}}
    async function openThread(chat){activeChat=chat;showThreadScreen();renderThreadHeader(chat);const cached=getCached(chat.phone);if(cached)renderRows(cached.rows);else chatThreadBox.innerHTML='<div class="chat-empty">Загрузка...</div>';await refreshThread(false);transport.markRead(session,'educator',chat.phone).catch(()=>{});chat.hasUnread=false}

    const contextMenu=document.createElement('div');contextMenu.id='chatContextMenu';contextMenu.className='chat-context-menu hidden';contextMenu.innerHTML='<div class="chat-context-reactions"></div><div class="chat-context-actions"></div>';document.body.appendChild(contextMenu);
    function closeMessageMenu(){contextMenu.classList.add('hidden');contextMenu.querySelector('.chat-context-reactions').replaceChildren();contextMenu.querySelector('.chat-context-actions').replaceChildren()}
    function contextAction(icon,label,fn,danger){const b=document.createElement('button');b.type='button';b.className='chat-context-action'+(danger?' danger':'');b.innerHTML='<span class="chat-context-action-icon">'+icon+'</span><span></span>';b.lastChild.textContent=label;b.onclick=()=>{closeMessageMenu();fn()};return b}
    function setReply(m){replyTo=m||null;chatReplyPreview.classList.toggle('hidden',!replyTo);chatReplyPreview.querySelector('#chatReplyPreviewTitle').textContent=replyTo?'Ответ на сообщение':'';chatReplyPreview.querySelector('#chatReplyPreviewText').textContent=replyTo?replyLabel(replyTo):'';if(replyTo){editing=null;editor.focus()}}
    function setEdit(m){editing=m||null;if(editing){replyTo=null;chatReplyPreview.classList.add('hidden');editor.textContent=String(editing.text||'');editor.focus()}}
    function openMessageMenu(m,el,e){
      if(!m||!m.messageKey||String(m.messageKey).startsWith('pending-'))return;e.preventDefault();e.stopPropagation();closeMessageMenu();
      const rs=contextMenu.querySelector('.chat-context-reactions');REACTIONS.forEach(r=>{const b=document.createElement('button');b.className='msg-reaction-btn';b.type='button';b.textContent=r;b.onclick=async()=>{closeMessageMenu();try{await transport.react(session,m.messageKey,r);refreshThread(true)}catch(err){overlay.showError(err.message)}};rs.appendChild(b)});
      const acts=contextMenu.querySelector('.chat-context-actions');acts.appendChild(contextAction('↩','Ответить',()=>setReply(m)));if(m.side==='educator'&&m.type==='text')acts.appendChild(contextAction('✎','Редактировать',()=>setEdit(m)));if(m.side==='educator')acts.appendChild(contextAction('⌫','Удалить',async()=>{if(!confirm('Удалить это сообщение?'))return;try{await transport.remove(session,'educator',m.messageKey);refreshThread(false)}catch(err){overlay.showError(err.message)}},true));
      contextMenu.classList.remove('hidden');const r=el.getBoundingClientRect(),w=310;contextMenu.style.left=Math.min(innerWidth-w-12,Math.max(12,r.left+(r.width-w)/2))+'px';let top=r.bottom+8;if(top+220>innerHeight)top=Math.max(12,r.top-220);contextMenu.style.top=top+'px';
    }

    function clearFile(){pendingFile=null;imagePreview.classList.add('hidden');if(pendingUrl){URL.revokeObjectURL(pendingUrl);pendingUrl=''}imagePreview.querySelector('img').removeAttribute('src')}
    function setSending(v){sending=!!v;send.disabled=sending;attach.disabled=sending;editor.contentEditable=sending?'false':'true'}
    async function submit(){
      if(!activeChat||sending)return;const value=String(editor.textContent||'').trim();if(!value&&!pendingFile)return;setSending(true);
      try{
        if(editing){await transport.edit(session,'educator',editing.messageKey,value);editing=null;editor.textContent='';await refreshThread(false)}
        else if(pendingFile){const up=await transport.upload(session,activeChat.phone,pendingFile);await transport.sendMessage(session,'educator',activeChat.phone,{type:up.type||(pendingFile.type.startsWith('video/')?'video':'image'),text:value,fileId:up.fileId,replyToKey:replyTo&&replyTo.messageKey||''});editor.textContent='';setReply(null);clearFile();await refreshThread(false)}
        else{const optimistic={side:'educator',type:'text',text:value,timestamp:Date.now(),messageKey:'pending-'+Date.now().toString(36)};renderRows(activeRows.concat(optimistic));editor.textContent='';await transport.sendMessage(session,'educator',activeChat.phone,{type:'text',text:value,replyToKey:replyTo&&replyTo.messageKey||''});setReply(null);setSending(false);refreshThread(false);return}
      }catch(err){overlay.showError(err.message||'Не удалось отправить сообщение.')}finally{setSending(false);editor.focus()}
    }

    btnChatsBack.onclick=()=>overlay.close();
    btnNewChat.onclick=()=>overlay.showError('Экран выбора нового родителя перенесём следующим блоком из оригинала.');
    btnRefreshChats.onclick=()=>loadChats(true);
    btnThreadBack.onclick=()=>{activeChat=null;bucket='unread';loadChats(false)};
    btnQuickReplies.onclick=()=>quickPanel.classList.toggle('hidden');
    quickDoctors.onclick=()=>doctorButtons.classList.toggle('hidden');
    btnVideo.onclick=()=>fileInput.click();
    attach.onclick=()=>fileInput.click();
    send.onclick=submit;
    editor.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();submit()}};
    fileInput.onchange=()=>{const f=fileInput.files&&fileInput.files[0];fileInput.value='';if(!f)return;if(f.size>20*1024*1024){overlay.showError('Размер файла не должен превышать 20 МБ.');return}clearFile();pendingFile=f;pendingUrl=URL.createObjectURL(f);imagePreview.querySelector('img').src=pendingUrl;imagePreview.classList.remove('hidden')};
    imagePreview.querySelector('#chatImageRemoveBtn').onclick=clearFile;
    chatReplyPreview.querySelector('#chatReplyCancel').onclick=()=>setReply(null);
    childDeleteModal.querySelector('#childDeleteCancel').onclick=()=>{deleteTarget=null;childDeleteModal.classList.add('hidden')};
    childDeleteModal.querySelector('#childDeleteConfirm').onclick=async()=>{if(!deleteTarget)return;const target=deleteTarget;try{childDeleteModal.querySelector('#childDeleteConfirm').disabled=true;await appApi('deleteReportChildByPhone',[target.phone,tutorToken()]);deleteTarget=null;childDeleteModal.classList.add('hidden');await loadChats(false)}catch(err){overlay.showError(err.message)}finally{childDeleteModal.querySelector('#childDeleteConfirm').disabled=false}};
    childDeleteModal.onclick=e=>{if(e.target===childDeleteModal){deleteTarget=null;childDeleteModal.classList.add('hidden')}};
    document.addEventListener('click',closeMessageMenu);

    loadChats(false);
    return()=>{
      disposed=true;
      if(pendingUrl)URL.revokeObjectURL(pendingUrl);
      contextMenu.remove();childDeleteModal.remove();
      overlay.root.classList.remove('educator-exact-clone');
      if(oldScreen)document.body.dataset.screen=oldScreen;else delete document.body.dataset.screen;
    };
  }

  window.MedsiEducatorOverlayChat={mount};
})();
