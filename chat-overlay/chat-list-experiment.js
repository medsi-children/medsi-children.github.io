(function(){
  if(window.MedsiChatListExperiment)return;

  const transport=window.MedsiOverlayTransport;
  const phone10=v=>String(v||'').replace(/\D+/g,'').slice(-10);
  const normalize=v=>String(v||'').toLocaleLowerCase('ru-RU').replace(/ё/g,'е').replace(/\s+/g,' ').trim();
  const sourceBucketByPhone=new Map();

  const ICONS={
    back:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7"/></svg>',
    plus:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    search:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="5.8"/><path d="m15 15 4.2 4.2"/></svg>',
    phone:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.2 4.2 9.5 8.5 7.6 10.4c1.3 2.6 3.4 4.7 6 6l1.9-1.9 4.3 2.3c.5.3.8.9.6 1.5l-.5 2.1c-.2.7-.8 1.1-1.5 1.1C9.7 21.5 2.5 14.3 2.5 5.6c0-.7.4-1.3 1.1-1.5l2.1-.5c.6-.1 1.2.1 1.5.6Z"/></svg>',
    close:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"/></svg>'
  };

  function listIsVisible(){
    const screen=document.getElementById('screenChats');
    return document.body.dataset.screen==='screenChats'&&!!document.querySelector('.educator-exact-clone')&&screen&&!screen.classList.contains('hidden');
  }

  function installUnifiedTransport(){
    if(!transport||typeof transport.chats!=='function'||transport.__medsiUnifiedChatList)return;
    transport.__medsiUnifiedChatList=true;
    const baseChats=transport.chats.bind(transport);
    const basePin=typeof transport.pin==='function'?transport.pin.bind(transport):null;

    transport.chats=async function(session,bucket,options){
      if(String(bucket||'')!=='unread'||!listIsVisible())return baseChats(session,bucket,options);

      const [unreadRes,readRes]=await Promise.all([
        baseChats(session,'unread',options),
        baseChats(session,'read',options)
      ]);
      const unread=Array.isArray(unreadRes&&unreadRes.chats)?unreadRes.chats:[];
      const read=Array.isArray(readRes&&readRes.chats)?readRes.chats:[];
      const merged=new Map();
      let order=0;

      const add=(chat,source)=>{
        if(!chat)return;
        const phone=phone10(chat.phone);
        if(!phone)return;
        if(merged.has(phone)&&source==='read')return;
        sourceBucketByPhone.set(phone,source);
        const copy={...chat};
        copy.__medsiSourceBucket=source;
        copy.__medsiOrder=order++;
        if(source==='read')copy.hasUnread=false;
        // The legacy renderer only knows the "unread" visual bucket. Keep its
        // pin state visually correct and translate the bucket back in pin().
        if(copy.pinnedBucket)copy.pinnedBucket='unread';
        merged.set(phone,copy);
      };
      unread.forEach(chat=>add(chat,'unread'));
      read.forEach(chat=>add(chat,'read'));

      const chats=[...merged.values()].sort((a,b)=>{
        const pin=Number(!!b.pinnedBucket)-Number(!!a.pinnedBucket);
        if(pin)return pin;
        const time=Number(b.lastTimestamp||0)-Number(a.lastTimestamp||0);
        if(time)return time;
        return Number(a.__medsiOrder||0)-Number(b.__medsiOrder||0);
      });
      return {...(unreadRes||{}),chats,medsiUnified:true};
    };

    if(basePin){
      transport.pin=async function(session,phone,bucket){
        const source=sourceBucketByPhone.get(phone10(phone));
        const actual=bucket==='unread'&&source==='read'?'read':bucket;
        return basePin(session,phone,actual);
      };
    }
  }

  function injectStyles(){
    if(document.getElementById('medsi-chat-list-experiment-style'))return;
    const style=document.createElement('style');
    style.id='medsi-chat-list-experiment-style';
    style.textContent=`
      /* Unified messenger-style educator chat list. */
      body[data-screen="screenChats"] .educator-exact-clone #title,
      body[data-screen="screenChats"] .educator-exact-clone #meta{display:none!important}
      .educator-exact-clone #screenChats{min-height:0!important}

      .educator-exact-clone .medsi-chat-list-toolbar{
        display:grid;grid-template-columns:42px minmax(0,1fr) 42px;gap:8px;align-items:center;
        width:100%;margin:2px 0 11px;padding:0;
      }
      .educator-exact-clone .medsi-list-icon-btn{
        appearance:none;box-sizing:border-box;width:42px;min-width:42px;height:42px;min-height:42px;
        padding:0;border-radius:999px;border:1.5px solid rgba(22,184,192,.34);background:#f9fefe;color:#16b8c0;
        display:inline-grid;place-items:center;cursor:pointer;box-shadow:0 3px 10px rgba(22,184,192,.045);
      }
      .educator-exact-clone .medsi-list-icon-btn svg,
      #screenPhones .medsi-phone-mini svg{
        width:21px;height:21px;display:block;fill:none;stroke:currentColor;stroke-width:2.25;
        stroke-linecap:round;stroke-linejoin:round;pointer-events:none;
      }
      .educator-exact-clone .medsi-list-back svg{width:22px;height:22px}
      .educator-exact-clone .medsi-list-new svg{width:22px;height:22px;stroke-width:2.45}

      .educator-exact-clone .medsi-list-search{
        box-sizing:border-box;min-width:0;height:42px;border-radius:999px;
        display:flex;align-items:center;gap:8px;padding:0 13px;
        background:#f7fbfc;border:1.5px solid rgba(95,127,134,.14);
        box-shadow:inset 0 1px 0 rgba(255,255,255,.85);
      }
      .educator-exact-clone .medsi-list-search svg{
        width:18px;height:18px;flex:0 0 18px;fill:none;stroke:#98a8b2;stroke-width:2;
        stroke-linecap:round;stroke-linejoin:round;
      }
      .educator-exact-clone .medsi-list-search input{
        min-width:0;width:100%;height:38px;padding:0;border:0!important;outline:0!important;background:transparent!important;
        box-shadow:none!important;font:inherit;font-size:.86rem;color:#315b62;-webkit-appearance:none;
      }
      .educator-exact-clone .medsi-list-search input::placeholder{color:#a0abb5;opacity:1}
      .educator-exact-clone #screenChats > .medsi-list-legacy-actions{display:none!important}
      .educator-exact-clone #chatList > .medsi-legacy-bucket-switch{display:none!important}

      .educator-exact-clone #chatList{gap:7px!important;min-height:120px!important}
      .educator-exact-clone #chatList .chat-card{
        min-height:94px!important;padding:12px 50px 12px 15px!important;border-radius:17px!important;
        border-width:1px!important;box-shadow:0 3px 12px rgba(17,66,74,.035)!important;background:rgba(255,255,255,.94)!important;
        transition:opacity .16s ease,background .16s ease,border-color .16s ease,box-shadow .16s ease!important;
      }
      .educator-exact-clone #chatList .chat-card.medsi-chat-card-enter{
        animation:medsiChatCardCascade .23s cubic-bezier(.2,.72,.28,1) both;
        animation-delay:var(--medsi-card-delay,0ms);
      }
      @keyframes medsiChatCardCascade{
        from{opacity:0;transform:translateY(7px) scale(.993)}
        to{opacity:1;transform:none}
      }
      .educator-exact-clone #chatList .chat-card.unread{
        border-width:1.5px!important;background:#fff!important;box-shadow:0 5px 15px rgba(22,184,192,.075)!important;
      }
      .educator-exact-clone #chatList .chat-card:not(.unread) .chat-card-title,
      .educator-exact-clone #chatList .chat-card:not(.unread) .chat-card-meta,
      .educator-exact-clone #chatList .chat-card:not(.unread) .chat-card-last{opacity:.66!important}
      .educator-exact-clone #chatList .chat-card.pinned{box-shadow:0 5px 15px rgba(217,158,25,.055)!important}
      .educator-exact-clone #chatList .chat-card-title{font-size:.97rem!important;margin-bottom:2px!important}
      .educator-exact-clone #chatList .chat-card-meta{font-size:.84rem!important;line-height:1.34!important}
      .educator-exact-clone #chatList .chat-card-last{
        margin-top:6px!important;font-size:.86rem!important;line-height:1.36!important;max-height:calc(1.36em * 2.5)!important;
        -webkit-line-clamp:2!important;line-clamp:2!important;
      }
      .educator-exact-clone #chatList .chat-controls{top:10px!important;right:10px!important}
      .educator-exact-clone #chatList .chat-empty{padding:25px 10px!important;color:rgba(95,127,134,.72)!important;animation:medsiListSoftIn .18s ease both}
      .educator-exact-clone #chatList .medsi-search-hidden{display:none!important}
      .educator-exact-clone .medsi-search-empty{padding:28px 10px;text-align:center;color:#83999e;font-size:.88rem;animation:medsiListSoftIn .18s ease both}

      .educator-exact-clone .medsi-list-skeleton{display:grid;gap:7px;width:100%}
      .educator-exact-clone .medsi-list-skeleton-card{
        min-height:92px;border-radius:17px;border:1px solid rgba(22,184,192,.10);background:rgba(255,255,255,.72);padding:14px 16px;
      }
      .educator-exact-clone .medsi-list-skeleton-line{
        height:10px;border-radius:999px;background:linear-gradient(90deg,rgba(133,182,188,.08),rgba(133,182,188,.16),rgba(133,182,188,.08));
        background-size:220% 100%;animation:medsiListShimmer 1.15s ease-in-out infinite;
      }
      .educator-exact-clone .medsi-list-skeleton-line.title{width:38%;height:12px;margin-bottom:13px}
      .educator-exact-clone .medsi-list-skeleton-line.meta{width:66%;margin-bottom:9px}
      .educator-exact-clone .medsi-list-skeleton-line.last{width:52%;margin-top:14px}
      @keyframes medsiListShimmer{0%{background-position:100% 0}100%{background-position:-100% 0}}
      @keyframes medsiListSoftIn{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}

      /* Minimal phone cards: call + delete on the right, no giant action row. */
      #screenPhones .phone-card{position:relative!important;padding-right:108px!important;min-height:102px!important}
      #screenPhones .phone-card-actions.medsi-phone-mini-actions{
        position:absolute!important;right:12px!important;top:50%!important;transform:translateY(-50%)!important;
        display:flex!important;align-items:center!important;gap:7px!important;margin:0!important;width:auto!important;
      }
      #screenPhones .medsi-phone-mini{
        box-sizing:border-box!important;width:41px!important;min-width:41px!important;max-width:41px!important;height:41px!important;min-height:41px!important;max-height:41px!important;
        padding:0!important;margin:0!important;border-radius:999px!important;display:inline-grid!important;place-items:center!important;
        background:#f9fefe!important;color:#16b8c0!important;border:1.5px solid rgba(22,184,192,.32)!important;box-shadow:0 3px 10px rgba(22,184,192,.045)!important;
        text-decoration:none!important;font-size:0!important;line-height:1!important;
      }
      #screenPhones .medsi-phone-delete-mini{color:#c76272!important;border-color:rgba(199,98,114,.24)!important;background:#fffafb!important;position:static!important;transform:none!important}
      #screenPhones .medsi-phone-delete-mini svg{stroke-width:2.1!important}

      @media(max-width:560px){
        .educator-exact-clone .medsi-chat-list-toolbar{grid-template-columns:40px minmax(0,1fr) 40px;gap:7px;margin-top:1px;margin-bottom:10px}
        .educator-exact-clone .medsi-list-icon-btn{width:40px;min-width:40px;height:40px;min-height:40px}
        .educator-exact-clone .medsi-list-search{height:40px;padding:0 11px}
        .educator-exact-clone .medsi-list-search input{height:36px;font-size:.80rem}
        .educator-exact-clone #chatList .chat-card{min-height:90px!important;padding:11px 48px 11px 13px!important;border-radius:16px!important}
        #screenPhones .phone-card{padding-right:101px!important}
        #screenPhones .medsi-phone-mini{width:39px!important;min-width:39px!important;max-width:39px!important;height:39px!important;min-height:39px!important;max-height:39px!important}
      }
      @media(prefers-reduced-motion:reduce){
        .educator-exact-clone #chatList .chat-card.medsi-chat-card-enter{animation:none!important}
      }
    `;
    document.head.appendChild(style);
  }

  function skeleton(){
    const wrap=document.createElement('div');
    wrap.className='medsi-list-skeleton';
    wrap.setAttribute('aria-label','Загрузка чатов');
    for(let i=0;i<3;i++){
      const card=document.createElement('div');card.className='medsi-list-skeleton-card';
      ['title','meta','last'].forEach(cls=>{const line=document.createElement('div');line.className='medsi-list-skeleton-line '+cls;card.appendChild(line)});
      wrap.appendChild(card);
    }
    return wrap;
  }

  function markLegacyBucketSwitches(list){
    if(!list)return;
    Array.from(list.children).forEach(child=>{
      const text=String(child.textContent||'');
      if(text.includes('Вернуться к непрочитанным')||text.includes('Открыть прочитанные чаты'))child.classList.add('medsi-legacy-bucket-switch');
    });
  }

  function applyFilter(state){
    if(!state||!state.list)return;
    const q=normalize(state.input&&state.input.value||'');
    const cards=[...state.list.querySelectorAll(':scope > .chat-card')];
    let visible=0;
    cards.forEach(card=>{
      const title=card.querySelector('.chat-card-title');
      const hay=normalize(title&&title.textContent||'');
      const show=!q||hay.includes(q);
      card.classList.toggle('medsi-search-hidden',!show);
      if(show)visible++;
    });
    let empty=state.list.querySelector(':scope > .medsi-search-empty');
    if(q&&cards.length&&visible===0){
      if(!empty){empty=document.createElement('div');empty.className='medsi-search-empty';empty.textContent='Ребёнок не найден.';state.list.appendChild(empty)}
    }else if(empty)empty.remove();
  }

  function polishList(state){
    const list=state&&state.list;if(!list)return;
    markLegacyBucketSwitches(list);
    const only=list.children.length===1?list.firstElementChild:null;
    if(only&&only.classList.contains('chat-empty')&&/^Загрузка/i.test(String(only.textContent||'').trim())){
      list.replaceChildren(skeleton());
      return;
    }
    const empty=list.querySelector(':scope > .chat-empty');
    if(empty&&(/Новых сообщений нет/i.test(empty.textContent||'')||/Прочитанных чатов нет/i.test(empty.textContent||'')))empty.textContent='Чатов пока нет.';
    const cards=[...list.querySelectorAll(':scope > .chat-card')];
    if(!state.didCascade&&cards.length){
      cards.forEach((card,i)=>{
        card.style.setProperty('--medsi-card-delay',Math.min(i,8)*26+'ms');
        card.classList.add('medsi-chat-card-enter');
      });
      state.didCascade=true;
    }
    applyFilter(state);
  }

  function installList(){
    const screen=document.getElementById('screenChats');
    const list=document.getElementById('chatList');
    const back=document.getElementById('btnChatsBack');
    const newChat=document.getElementById('btnNewChat');
    if(!screen||!list||!back||!newChat)return false;

    const legacyRow=back.parentElement;
    if(legacyRow)legacyRow.classList.add('medsi-list-legacy-actions');

    let toolbar=screen.querySelector(':scope > .medsi-chat-list-toolbar');
    let state=toolbar&&toolbar._medsiState;
    if(!toolbar){
      toolbar=document.createElement('div');toolbar.className='medsi-chat-list-toolbar';

      const backProxy=document.createElement('button');
      backProxy.type='button';backProxy.className='medsi-list-icon-btn medsi-list-back';backProxy.innerHTML=ICONS.back;
      backProxy.setAttribute('aria-label','Назад');backProxy.title='Назад';backProxy.onclick=()=>back.click();

      const search=document.createElement('label');search.className='medsi-list-search';search.innerHTML=ICONS.search;
      const input=document.createElement('input');input.type='search';input.placeholder='Поиск по имени ребёнка';input.autocomplete='off';input.spellcheck=false;
      input.setAttribute('aria-label','Поиск по имени ребёнка');search.appendChild(input);

      const newProxy=document.createElement('button');
      newProxy.type='button';newProxy.className='medsi-list-icon-btn medsi-list-new';newProxy.innerHTML=ICONS.plus;
      newProxy.setAttribute('aria-label','Написать родителю');newProxy.title='Написать родителю';newProxy.onclick=()=>newChat.click();

      toolbar.append(backProxy,search,newProxy);
      screen.insertBefore(toolbar,list);
      state={list,input,didCascade:false};toolbar._medsiState=state;
      input.addEventListener('input',()=>applyFilter(state));
      new MutationObserver(()=>polishList(state)).observe(list,{childList:true,subtree:false});
    }
    polishList(state);
    return true;
  }

  function polishPhoneCard(card){
    if(!card||card.dataset.medsiPhoneMinimal==='1')return;
    const actions=card.querySelector('.phone-card-actions');
    const call=actions&&actions.querySelector('a[href^="tel:"]');
    const del=card.querySelector('.phone-delete');
    if(!actions||!call||!del)return;
    card.dataset.medsiPhoneMinimal='1';

    actions.querySelectorAll('button.phone-action-btn').forEach(btn=>btn.remove());
    actions.classList.add('medsi-phone-mini-actions');
    call.classList.add('medsi-phone-mini','medsi-phone-call-mini');
    call.innerHTML=ICONS.phone;call.setAttribute('aria-label','Позвонить родителю');call.title='Позвонить родителю';
    del.classList.add('medsi-phone-mini','medsi-phone-delete-mini');
    del.innerHTML=ICONS.close;del.setAttribute('aria-label','Удалить ребёнка');del.title='Удалить ребёнка';
    actions.appendChild(del);
  }

  function installPhones(){
    document.querySelectorAll('#screenPhones .phone-card').forEach(polishPhoneCard);
  }

  let scheduled=false;
  function install(){
    scheduled=false;
    installUnifiedTransport();
    injectStyles();
    installList();
    installPhones();
  }
  function schedule(){if(scheduled)return;scheduled=true;requestAnimationFrame(install)}

  installUnifiedTransport();
  injectStyles();
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',schedule,{once:true});else schedule();
  new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});

  window.MedsiChatListExperiment={install};
})();
