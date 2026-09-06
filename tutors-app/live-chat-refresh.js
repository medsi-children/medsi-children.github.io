(function(){
  if(window.__medsiTutorLiveChatRefresh)return;
  window.__medsiTutorLiveChatRefresh=true;

  const t=window.MedsiOverlayTransport;
  if(!t||typeof t.thread!=='function'||typeof t.chats!=='function')return;

  const LIVE_MS=5000;
  const baseThread=t.thread.bind(t);
  const baseChats=t.chats.bind(t);
  const threadSignatures=new Map();
  const listSignatures=new Map();
  let timer=0;
  let running=false;
  let useCachedThreadPhone='';
  let useCachedListOnce=false;
  let pendingDeletePhone='';
  let deleteRefreshPhone='';
  let silentThreadRefresh=false;

  const phone10=v=>String(v||'').replace(/\D+/g,'').slice(-10);
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

  function session(){
    try{
      const s=JSON.parse(localStorage.getItem('medsi_d1_educator_session_v1')||'null');
      return s&&s.token?s:null;
    }catch(_){return null}
  }
  function overlayOpen(){return !!document.querySelector('.medsi-chat-overlay.educator-exact-clone')}
  function listVisible(){const el=document.getElementById('screenChats');return overlayOpen()&&document.body.dataset.screen==='screenChats'&&el&&!el.classList.contains('hidden')}
  function threadVisible(){const el=document.getElementById('screenChatThread');return overlayOpen()&&document.body.dataset.screen==='screenChatThread'&&el&&!el.classList.contains('hidden')}
  function modalOpen(){const el=document.getElementById('childDeleteModal');return !!el&&!el.classList.contains('hidden')}
  function currentBucket(){
    const list=document.getElementById('chatList');
    if(list&&[...list.querySelectorAll('button')].some(b=>/Вернуться к непрочитанным/i.test(b.textContent||'')))return'read';
    return'unread';
  }
  function currentPhone(){
    const header=document.getElementById('chatThreadHeader');
    if(!header)return'';
    const line=[...header.querySelectorAll('div')].map(x=>String(x.textContent||'')).find(x=>/Номер телефона/i.test(x))||'';
    return phone10(line)
  }
  function readState(m){return [m&&m.readByEducator,m&&m.readByEducatorAt,m&&m.educatorRead,m&&m.educatorReadAt,m&&m.read_by_educator,m&&m.educator_read_at,m&&m.readByParent,m&&m.readByParentAt,m&&m.parentRead,m&&m.parentReadAt,m&&m.read_by_parent,m&&m.parent_read_at,m&&m.readByOther,m&&m.otherReadAt,m&&m.isRead,m&&m.read]}
  function threadSig(rows){
    return JSON.stringify((rows||[]).map(m=>[
      m&&m.messageKey||'',m&&m.side||'',m&&m.type||'',m&&m.text||'',m&&m.fileId||'',m&&m.reaction||'',
      m&&m.editedAt||'',m&&m.timestamp||'',m&&m.replyToKey||'',m&&m.reply&&m.reply.messageKey||'',m&&m.reply&&m.reply.text||'',readState(m)
    ]))
  }
  function chatSig(rows){
    return JSON.stringify((rows||[]).map(c=>[
      phone10(c&&c.phone),c&&c.parentName||'',c&&c.childName||'',!!(c&&c.hasUnread),c&&c.pinnedBucket||'',
      c&&c.lastSide||'',c&&c.lastType||'',c&&c.lastText||'',c&&c.lastMessageKey||'',c&&c.lastTimestamp||''
    ]))
  }
  function chatsFrom(res){return Array.isArray(res&&res.chats)?res.chats:[]}
  function messagesFrom(res){return Array.isArray(res&&res.messages)?res.messages:[]}
  function containsPhone(res,phone){return chatsFrom(res).some(c=>phone10(c&&c.phone)===phone10(phone))}

  t.thread=async function(sessionArg,phone,before,limit,options){
    const p=phone10(phone);
    let nextOptions=options;
    if(!before&&p&&useCachedThreadPhone===p){
      useCachedThreadPhone='';
      nextOptions=undefined;
    }else if(!before&&p&&threadVisible()&&!(options&&options.fresh)){
      nextOptions={...(options||{}),fresh:true};
    }
    const res=await baseThread(sessionArg,phone,before,limit,nextOptions);
    if(!before&&p)threadSignatures.set(p,threadSig(messagesFrom(res)));
    return res;
  };

  t.chats=async function(sessionArg,bucket,options){
    if(useCachedListOnce){
      useCachedListOnce=false;
      const res=await baseChats(sessionArg,bucket,undefined);
      listSignatures.set(String(bucket||'all'),chatSig(chatsFrom(res)));
      return res;
    }

    if(deleteRefreshPhone){
      const target=deleteRefreshPhone;
      deleteRefreshPhone='';
      const modal=document.getElementById('childDeleteModal');
      if(modal)modal.classList.remove('hidden');
      let res=null;
      const waits=[0,280,650,1100];
      for(const wait of waits){
        if(wait)await sleep(wait);
        res=await baseChats(sessionArg,bucket,{fresh:true});
        if(!containsPhone(res,target))break;
      }
      listSignatures.set(String(bucket||'all'),chatSig(chatsFrom(res)));
      if(modal)modal.classList.add('hidden');
      pendingDeletePhone='';
      return res;
    }

    const nextOptions=listVisible()&&!(options&&options.fresh)?{...(options||{}),fresh:true}:options;
    const res=await baseChats(sessionArg,bucket,nextOptions);
    listSignatures.set(String(bucket||'all'),chatSig(chatsFrom(res)));
    return res;
  };

  function markQuietMessages(root){
    if(!silentThreadRefresh||!root||root.nodeType!==1)return;
    if(root.matches&&root.matches('#chatThreadBox .msg'))root.dataset.medsiAnimated='1';
    if(root.querySelectorAll)root.querySelectorAll('#chatThreadBox .msg').forEach(el=>{el.dataset.medsiAnimated='1'});
  }
  const quietObserver=new MutationObserver(records=>{
    if(!silentThreadRefresh)return;
    records.forEach(record=>record.addedNodes.forEach(markQuietMessages));
  });
  if(document.documentElement)quietObserver.observe(document.documentElement,{childList:true,subtree:true});

  async function refreshVisibleList(s){
    const bucket=currentBucket();
    const res=await baseChats(s,bucket,{fresh:true});
    const next=chatSig(chatsFrom(res));
    const previous=listSignatures.get(bucket);
    if(previous==null){listSignatures.set(bucket,next);return}
    if(next===previous)return;
    listSignatures.set(bucket,next);
    const btn=document.getElementById('btnRefreshChats');
    if(!btn||!btn.isConnected)return;
    useCachedListOnce=true;
    btn.dataset.medsiSilentRefresh='1';
    btn.click();
    setTimeout(()=>{if(btn)delete btn.dataset.medsiSilentRefresh},500);
  }

  function activeCard(phone){
    return [...document.querySelectorAll('#chatList .chat-card')].find(card=>phone10(card.dataset.phone||'')===phone10(phone))||null;
  }
  async function refreshVisibleThread(s){
    const phone=currentPhone();if(!phone)return;
    const res=await baseThread(s,phone,'',100,{fresh:true});
    const next=threadSig(messagesFrom(res));
    const previous=threadSignatures.get(phone);
    if(previous==null){threadSignatures.set(phone,next);return}
    if(next===previous)return;
    threadSignatures.set(phone,next);

    const card=activeCard(phone);if(!card)return;
    const box=document.getElementById('chatThreadBox');
    const oldTop=box?box.scrollTop:0;
    const wasNearBottom=!box||box.scrollHeight-box.scrollTop-box.clientHeight<90;
    useCachedThreadPhone=phone;
    silentThreadRefresh=true;
    card.click();
    if(!wasNearBottom){
      setTimeout(()=>{const current=document.getElementById('chatThreadBox');if(current)current.scrollTop=oldTop},0);
      setTimeout(()=>{const current=document.getElementById('chatThreadBox');if(current)current.scrollTop=oldTop},90);
    }
    setTimeout(()=>{silentThreadRefresh=false},260);
  }

  async function tick(){
    if(running||document.hidden||!overlayOpen()||modalOpen())return;
    const s=session();if(!s)return;
    running=true;
    try{
      if(threadVisible())await refreshVisibleThread(s);
      else if(listVisible())await refreshVisibleList(s);
    }catch(_){}
    finally{running=false}
  }
  function schedule(delay){
    if(timer)clearTimeout(timer);
    timer=setTimeout(async()=>{timer=0;await tick();schedule(LIVE_MS)},Math.max(150,Number(delay)||LIVE_MS));
  }

  document.addEventListener('click',event=>{
    const target=event.target&&event.target.closest?event.target:null;if(!target)return;
    const del=target.closest('.chat-delete-toggle');
    if(del){const card=del.closest('.chat-card');pendingDeletePhone=phone10(card&&card.dataset.phone||'');return}
    if(target.closest('#childDeleteCancel')){pendingDeletePhone='';deleteRefreshPhone='';return}
    const confirm=target.closest('#childDeleteConfirm');
    if(confirm&&pendingDeletePhone){deleteRefreshPhone=pendingDeletePhone}
  },true);

  function injectStyles(){
    if(document.getElementById('medsi-tutor-live-refresh-style'))return;
    const style=document.createElement('style');
    style.id='medsi-tutor-live-refresh-style';
    style.textContent=`
      #childDeleteConfirm{display:inline-flex!important;align-items:center!important;justify-content:center!important;gap:8px!important}
      #childDeleteConfirm:disabled::before{content:'';width:15px;height:15px;flex:0 0 15px;border:2px solid rgba(255,255,255,.38);border-top-color:#fff;border-radius:50%;animation:spin .7s linear infinite}
      #btnRefreshChats[data-medsi-silent-refresh="1"].loading .refresh-spinner{display:none!important}
      #btnRefreshChats[data-medsi-silent-refresh="1"].loading .refresh-label{display:flex!important}
    `;
    document.head.appendChild(style)
  }

  document.addEventListener('visibilitychange',()=>{if(!document.hidden)schedule(250)});
  injectStyles();
  schedule(LIVE_MS);
})();