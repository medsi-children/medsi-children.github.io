(function(){
  if(window.__medsiChatPolish)return;
  window.__medsiChatPolish=true;

  const style=document.createElement('style');
  style.textContent=`
    @keyframes medsiScreenIn{from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:none}}
    @keyframes medsiShimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
    @keyframes medsiSpin{to{transform:rotate(360deg)}}
    #screenChats.medsi-screen-enter,#screenChatThread.medsi-screen-enter,#screenChat.medsi-screen-enter{animation:medsiScreenIn .22s ease both}
    .msg-image-wrap,.parent-chat-media-frame{position:relative;overflow:hidden;width:min(270px,68vw);max-width:100%;aspect-ratio:1/1;border-radius:12px;background:linear-gradient(100deg,rgba(223,244,245,.78) 20%,rgba(248,253,253,.98) 38%,rgba(223,244,245,.78) 56%);background-size:220% 100%;animation:medsiShimmer 1.15s linear infinite}
    .msg-image-wrap.medsi-media-ready,.parent-chat-media-frame.medsi-media-ready{animation:none;background:rgba(230,247,248,.72)}
    .msg-image-wrap img,.msg-image-wrap video,.parent-chat-media-frame img,.parent-chat-media-frame video{display:block!important;width:100%!important;height:100%!important;object-fit:cover!important;opacity:0;transform:scale(.985);transition:opacity .22s ease,transform .28s ease}
    .msg-image-wrap.medsi-media-ready img,.msg-image-wrap.medsi-media-ready video,.parent-chat-media-frame.medsi-media-ready img,.parent-chat-media-frame.medsi-media-ready video{opacity:1;transform:none}
    .medsi-media-error::after{content:'Не удалось загрузить вложение';position:absolute;inset:0;display:grid;place-items:center;text-align:center;padding:16px;color:#6d969a;font-size:13px;font-weight:700;background:#eef9fa}
    .chat-delete-toggle.medsi-deleting,.phone-delete.medsi-deleting{opacity:.42!important;pointer-events:none!important}
    .medsi-delete-spinner{width:17px;height:17px;border:2px solid rgba(22,184,192,.20);border-top-color:#16b8c0;border-radius:50%;animation:medsiSpin .65s linear infinite;display:inline-block;vertical-align:middle;margin-left:7px}
    .chat-card.medsi-deleting-card,.phone-card.medsi-deleting-card{opacity:.38;transform:scale(.992);transition:opacity .2s ease,transform .2s ease}
    .msg-author,.parent-chat-author{letter-spacing:.01em}
  `;
  document.head.appendChild(style);

  const p10=v=>String(v||'').replace(/\D+/g,'').slice(-10);
  function educatorSession(){
    try{const s=JSON.parse(localStorage.getItem('medsi_d1_educator_session_v1')||'null');return s&&s.token?s:null}catch(_){return null}
  }
  function tutorToken(){try{return String(localStorage.getItem('medsi_tutor_session_v1')||'')}catch(_){return''}}
  function parentName(){try{return String(localStorage.getItem('medsi_parent')||'').trim()}catch(_){return''}}
  function activeEducatorParentName(){
    const lines=[...document.querySelectorAll('#chatThreadHeader > div')].map(x=>String(x.textContent||''));
    const line=lines.find(x=>x.startsWith('Родитель:'))||'';
    return line.replace(/^Родитель:\s*/,'').trim();
  }

  function markMedia(frame){
    if(!frame||frame.dataset.medsiPolished==='1')return;
    frame.dataset.medsiPolished='1';
    const media=frame.querySelector('img,video');if(!media)return;
    const ready=()=>{frame.classList.add('medsi-media-ready');frame.classList.remove('medsi-media-error')};
    const fail=()=>{
      const tries=Number(media.dataset.medsiRetry||0);
      if(tries<1&&media.src){
        media.dataset.medsiRetry=String(tries+1);
        const src=media.src;
        setTimeout(()=>{media.src=src+(src.includes('?')?'&':'?')+'retry='+Date.now()},320);
      }else frame.classList.add('medsi-media-error');
    };
    if(media.tagName==='VIDEO'){
      media.addEventListener('loadeddata',ready,{once:true});
      media.addEventListener('loadedmetadata',ready,{once:true});
      media.addEventListener('error',fail);
      if(media.readyState>=1)ready();
    }else{
      media.addEventListener('load',ready,{once:true});
      media.addEventListener('error',fail);
      if(media.complete&&media.naturalWidth>0)ready();
    }
  }

  function fixAuthors(){
    const educatorParent=activeEducatorParentName();
    document.querySelectorAll('#chatThreadBox .msg').forEach(el=>{
      let author=el.querySelector('.msg-author');
      const isParent=el.classList.contains('parent');
      const text=isParent?'Родитель'+(educatorParent?' '+educatorParent:''):'Детское Отделение Медси';
      if(!author){author=document.createElement('div');author.className='msg-author';el.prepend(author)}
      author.textContent=text;
    });
    const ownParent=parentName();
    document.querySelectorAll('#parentChatMessages .parent-chat-msg').forEach(el=>{
      let author=el.querySelector('.parent-chat-author');
      const isParent=el.classList.contains('parent');
      const text=isParent?'Родитель'+(ownParent?' '+ownParent:''):'Детское Отделение Медси';
      if(!author){author=document.createElement('div');author.className='parent-chat-author';el.prepend(author)}
      author.textContent=text;
    });
  }

  let lastVisible='';
  function animateScreens(){
    ['screenChats','screenChatThread','screenChat'].forEach(id=>{
      const el=document.getElementById(id);if(!el||el.classList.contains('hidden'))return;
      if(lastVisible===id)return;lastVisible=id;el.classList.remove('medsi-screen-enter');void el.offsetWidth;el.classList.add('medsi-screen-enter');
    });
  }

  function polish(){
    document.querySelectorAll('.msg-image-wrap,.parent-chat-media-frame').forEach(markMedia);
    fixAuthors();animateScreens();
  }

  async function purgeMedia(phone){
    const session=educatorSession();
    if(!session||!session.token||!phone)return;
    try{await fetch('/__chat/purge-media',{method:'POST',headers:{'content-type':'application/json','X-Medsi-Chat-Session':session.token},body:JSON.stringify({phone:p10(phone)}),cache:'no-store'})}catch(_){}
  }

  let pendingChatDelete=null;
  document.addEventListener('click',e=>{
    const del=e.target.closest&&e.target.closest('.chat-delete-toggle');
    if(del){const card=del.closest('.chat-card');pendingChatDelete={button:del,card,phone:card&&card.dataset.phone||''};return}

    const confirm=e.target.closest&&e.target.closest('#childDeleteConfirm');
    if(confirm&&pendingChatDelete&&pendingChatDelete.phone&&!confirm.dataset.medsiReplay){
      e.preventDefault();e.stopImmediatePropagation();
      const target=pendingChatDelete;pendingChatDelete=null;
      target.button.classList.add('medsi-deleting');target.card&&target.card.classList.add('medsi-deleting-card');
      if(target.card&&!target.card.querySelector('.medsi-delete-spinner'))target.button.insertAdjacentHTML('afterend','<span class="medsi-delete-spinner" aria-hidden="true"></span>');
      confirm.closest('.link-modal-overlay')?.classList.add('hidden');
      purgeMedia(target.phone).finally(()=>{
        confirm.dataset.medsiReplay='1';confirm.click();delete confirm.dataset.medsiReplay;
        setTimeout(()=>{if(target.card&&target.card.isConnected){target.card.classList.remove('medsi-deleting-card');target.button.classList.remove('medsi-deleting');target.card.querySelector('.medsi-delete-spinner')?.remove()}},5000);
      });
      return;
    }

    const phoneDelete=e.target.closest&&e.target.closest('.phone-delete');
    if(phoneDelete&&!phoneDelete.dataset.medsiManaged){
      e.preventDefault();e.stopImmediatePropagation();
      const card=phoneDelete.closest('.phone-card');
      const phoneText=[...card.querySelectorAll('*')].map(x=>x.childElementCount?null:String(x.textContent||'')).filter(Boolean).find(x=>/Номер телефона/i.test(x))||card.textContent||'';
      const phone=p10(phoneText);
      const child=(card.querySelector('.phone-card-title')?.textContent||'ребёнка').trim();
      if(!confirm('Удалить ребёнка '+child+' из бота?\n\nВся история сообщений и вложения будут удалены.'))return;
      phoneDelete.dataset.medsiManaged='1';phoneDelete.classList.add('medsi-deleting');card.classList.add('medsi-deleting-card');phoneDelete.insertAdjacentHTML('afterend','<span class="medsi-delete-spinner" aria-hidden="true"></span>');
      const token=tutorToken();
      Promise.resolve().then(()=>purgeMedia(phone)).then(()=>fetch(window.MEDSI_APP_BASE_URL||'https://script.google.com/macros/s/AKfycbzRKRjjI7NoHx8rD5ifEdrcexGuYlMEB453sOC2UTZDeBaybZiNPIY0vDTMkmeHhebVpA/exec',{method:'POST',headers:{'content-type':'text/plain;charset=UTF-8'},body:JSON.stringify({action:'api',method:'deleteReportChildByPhone',args:[phone,token]}),cache:'no-store'})).then(r=>r.json()).then(payload=>{if(!payload||!payload.ok)throw new Error(payload&&payload.message||'Не удалось удалить ребёнка.');card.remove();document.getElementById('btnParentPhones')?.click()}).catch(err=>{phoneDelete.classList.remove('medsi-deleting');card.classList.remove('medsi-deleting-card');card.querySelector('.medsi-delete-spinner')?.remove();delete phoneDelete.dataset.medsiManaged;alert(err&&err.message||'Не удалось удалить ребёнка.')});
    }
  },true);

  new MutationObserver(polish).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['class','src']});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',polish,{once:true});else polish();
})();
