(function(){
  const api=window.MedsiEducatorOverlayChat;
  const transport=window.MedsiOverlayTransport;
  if(!api||!transport||api.__medsiNewChatWrapped)return;
  api.__medsiNewChatWrapped=true;

  const phone10=v=>String(v||'').replace(/\D+/g,'').slice(-10);
  const displayPhone=v=>{const p=phone10(v);return p?'8'+p:''};
  const deleteIcon=()=>'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg>';

  if(!transport.__medsiForcedParentWrapped){
    transport.__medsiForcedParentWrapped=true;
    const originalChats=transport.chats.bind(transport);
    transport.chats=async function(session,bucket){
      const res=await originalChats(session,bucket);
      const forced=window.__medsiForcedEducatorParent;
      if(forced&&res&&Array.isArray(res.chats)&&!res.chats.some(x=>phone10(x&&x.phone)===phone10(forced.phone))){
        res.chats.push({
          phone:phone10(forced.phone),
          parentName:forced.parentName||'',
          childName:forced.childName||'',
          lastSide:'',lastType:'text',lastText:'Нет сообщений',hasUnread:false,pinnedBucket:''
        });
      }
      return res;
    };
  }

  function tutorToken(){try{return String(localStorage.getItem('medsi_tutor_session_v1')||'')}catch(_){return''}}
  async function appApi(method,args){
    const endpoint=window.MEDSI_APP_BASE_URL||'';
    if(!endpoint)throw new Error('Серверное действие недоступно.');
    const res=await fetch(endpoint,{method:'POST',headers:{'content-type':'text/plain;charset=utf-8'},body:JSON.stringify({action:'api',method,args:args||[]})});
    const payload=await res.json();
    if(!payload||!payload.ok)throw new Error(payload&&payload.message||'Ошибка Apps Script API.');
    const result=payload.result;
    if(result&&typeof result==='object'&&result.ok===false)throw new Error(result.message||'Apps Script вернул ошибку.');
    return result;
  }
  function skeleton(count=4){
    return '<div class="list-skeleton">'+Array.from({length:count}).map(()=>'<div class="skeleton-card"><div class="skeleton-line title"></div><div class="skeleton-line wide"></div><div class="skeleton-line mid"></div><div class="skeleton-line short"></div><div class="skeleton-line wide" style="margin-top:16px;"></div><div class="skeleton-line mid"></div></div>').join('')+'</div>';
  }

  const originalMount=api.mount.bind(api);
  api.mount=function(overlay,state){
    const originalCleanup=originalMount(overlay,state);
    let disposed=false,rowsCache=null,requestToken=0,bridgeTimer=null;
    const root=overlay.root;
    const scene=root&&root.querySelector('.scene');
    const title=root&&root.querySelector('#title');
    const meta=root&&root.querySelector('#meta');
    const screenChats=root&&root.querySelector('#screenChats');
    const screenThread=root&&root.querySelector('#screenChatThread');
    const btnNew=root&&root.querySelector('#btnNewChat');
    const btnRefresh=root&&root.querySelector('#btnRefreshChats');
    const deleteModal=root&&root.querySelector('#childDeleteModal');
    if(!scene||!title||!meta||!screenChats||!screenThread||!btnNew||!btnRefresh)return originalCleanup;

    const screen=document.createElement('section');
    screen.id='screenNewChat';screen.className='hidden';
    const list=document.createElement('div');list.id='parentsList';list.className='chat-list';
    const error=document.createElement('p');error.id='parentsError';error.className='error hidden';
    const row=document.createElement('div');row.className='row';row.style.marginTop='14px';
    const back=document.createElement('button');back.id='btnParentsBack';back.className='btn soft-back-btn';back.textContent='← Назад в меню';
    row.appendChild(back);screen.append(list,error,row);scene.insertBefore(screen,screenThread);

    function showNew(){
      document.body.dataset.screen='screenNewChat';
      title.textContent='Написать родителю';meta.textContent='Выберите родителя.';
      screenChats.classList.add('hidden');screenThread.classList.add('hidden');screen.classList.remove('hidden');
      requestAnimationFrame(()=>screen.classList.add('overlay-screen-ready'));
    }
    function showChats(){
      document.body.dataset.screen='screenChats';
      title.textContent='Чат с родителями';meta.textContent='Выберите чат с нужным родителем.';
      screen.classList.add('hidden');screen.classList.remove('overlay-screen-ready');screenThread.classList.add('hidden');screenChats.classList.remove('hidden');
      requestAnimationFrame(()=>screenChats.classList.add('overlay-screen-ready'));
    }
    function render(rows){
      list.replaceChildren();rows=Array.isArray(rows)?rows:[];
      if(!rows.length){list.innerHTML='<div class="chat-empty">Нет родителей.</div>';return}
      rows.forEach(r=>{
        const card=document.createElement('button');card.className='chat-card';card.type='button';card.dataset.phone=r.phone||'';
        const name=document.createElement('div');name.className='chat-card-title';name.textContent=r.childName||'Без имени ребёнка';
        const del=document.createElement('span');del.className='chat-delete-toggle';del.setAttribute('role','button');del.setAttribute('tabindex','0');del.title='Удалить ребёнка';del.innerHTML=deleteIcon();
        const info=document.createElement('div');info.className='chat-card-meta';info.textContent='Родитель: '+(r.parentName||'—')+'\nНомер телефона: '+(r.phone?displayPhone(r.phone):'—');
        del.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();bridgeToCard(r,'delete')});
        card.append(name,del,info);
        card.addEventListener('click',e=>{if(e.target.closest('.chat-delete-toggle'))return;bridgeToCard(r,'open')});
        list.appendChild(card);
      });
    }
    async function loadParents(){
      const token=++requestToken;error.classList.add('hidden');
      if(rowsCache)render(rowsCache);else list.innerHTML=skeleton(4);
      try{
        const res=await appApi('listAvailableParentsForChat',[tutorToken()]);
        if(disposed||token!==requestToken)return;
        rowsCache=Array.isArray(res&&res.rows)?res.rows:[];render(rowsCache);
      }catch(err){
        if(disposed||token!==requestToken)return;
        error.textContent=err.message||'Сервер недоступен.';error.classList.remove('hidden');
        if(!rowsCache)list.innerHTML='';
      }
    }
    function findChatCard(phone){return [...screenChats.querySelectorAll('.chat-card')].find(el=>phone10(el.dataset.phone)===phone10(phone))||null}
    function bridgeToCard(parent,mode){
      clearTimeout(bridgeTimer);
      window.__medsiForcedEducatorParent=parent;
      root.classList.add('educator-new-chat-bridging');
      btnRefresh.click();
      const started=Date.now();
      const probe=()=>{
        if(disposed)return;
        const card=findChatCard(parent.phone);
        if(card){
          window.__medsiForcedEducatorParent=null;
          if(mode==='delete'){
            const control=card.querySelector('.chat-delete-toggle');
            if(control)control.click();
            showNew();
            root.classList.remove('educator-new-chat-bridging');
            if(deleteModal){
              const observer=new MutationObserver(()=>{
                if(deleteModal.classList.contains('hidden')){observer.disconnect();setTimeout(()=>{if(!disposed){rowsCache=null;showNew();loadParents()}},120)}
              });
              observer.observe(deleteModal,{attributes:true,attributeFilter:['class']});
            }
          }else{
            screen.classList.add('hidden');
            card.click();
            root.classList.remove('educator-new-chat-bridging');
          }
          return;
        }
        if(Date.now()-started>4500){
          window.__medsiForcedEducatorParent=null;root.classList.remove('educator-new-chat-bridging');showNew();
          error.textContent='Не удалось открыть чат родителя.';error.classList.remove('hidden');return;
        }
        bridgeTimer=setTimeout(probe,35);
      };
      bridgeTimer=setTimeout(probe,35);
    }

    btnNew.onclick=e=>{e&&e.preventDefault();showNew();loadParents()};
    back.onclick=e=>{e.preventDefault();showChats()};

    return()=>{
      disposed=true;clearTimeout(bridgeTimer);window.__medsiForcedEducatorParent=null;
      try{screen.remove()}catch(_){}
      if(typeof originalCleanup==='function')originalCleanup();
    };
  };
})();