(function(){
  const t=window.MedsiOverlayTransport;
  if(!t||t.__medsiMessageEnhancements)return;
  t.__medsiMessageEnhancements=true;

  let lastThread=[];
  let activeSession=null;
  let activePhone='';
  let replyTarget=null;
  const originalThread=t.thread.bind(t);
  const originalSend=t.sendMessage.bind(t);

  t.thread=async function(session,phone,before,limit){
    const res=await originalThread(session,phone,before,limit);
    if(!before&&res&&Array.isArray(res.messages)) lastThread=res.messages.slice();
    return res;
  };

  function explicitRead(m,side){
    if(!m)return false;
    if(side==='parent') return !!(m.readByEducator||m.educatorRead||m.educatorReadAt||m.readByOther||m.otherReadAt||m.isRead===true||m.read===true);
    return !!(m.readByParent||m.parentRead||m.parentReadAt||m.readByOther||m.otherReadAt||m.isRead===true||m.read===true);
  }

  function receiptNode(read){
    const s=document.createElement('span');
    s.className='medsi-read-receipt'+(read?' is-read':'');
    s.textContent=read?'✓✓':'✓';
    s.title=read?'Прочитано':'Отправлено';
    s.setAttribute('aria-label',s.title);
    return s;
  }

  function decorateParent(){
    const nodes=[...document.querySelectorAll('#parentChatMessages .parent-chat-msg')];
    nodes.forEach((el,i)=>{
      const m=lastThread[i];
      if(!m||m.side!=='parent'||el.querySelector('.medsi-read-receipt'))return;
      el.appendChild(receiptNode(explicitRead(m,'parent')));
      el.dataset.medsiMessageIndex=String(i);
    });
  }

  function decorateEducator(){
    const nodes=[...document.querySelectorAll('#chatThreadBox .msg')];
    nodes.forEach((el,i)=>{
      const m=lastThread[i];
      if(!m||m.side!=='educator'||el.querySelector('.medsi-read-receipt'))return;
      el.appendChild(receiptNode(explicitRead(m,'educator'));
      el.dataset.medsiMessageIndex=String(i);
    });
  }

  function ensureReplyPreview(){
    let p=document.getElementById('medsiParentReplyPreview');
    if(p)return p;
    const compose=document.getElementById('parentChatCompose');
    if(!compose)return null;
    p=document.createElement('div');p.id='medsiParentReplyPreview';p.className='medsi-parent-reply-preview hidden';
    p.innerHTML='<div><strong>Ответ на сообщение</strong><div class="medsi-parent-reply-text"></div></div><button type="button" aria-label="Отменить ответ">×</button>';
    p.querySelector('button').onclick=()=>setReply(null);
    compose.parentNode.insertBefore(p,compose);
    return p;
  }

  function label(m){
    if(!m)return'';
    if(m.text)return String(m.text).slice(0,140);
    if(m.type==='image')return'Фотография';
    if(m.type==='video')return'Видео';
    return'Сообщение';
  }

  function setReply(m){
    replyTarget=m||null;
    const p=ensureReplyPreview();if(!p)return;
    p.classList.toggle('hidden',!replyTarget);
    p.querySelector('.medsi-parent-reply-text').textContent=replyTarget?label(replyTarget):'';
    if(replyTarget) document.getElementById('parentChatInput')?.focus();
  }

  function selectedParentMessage(){
    const menu=document.querySelector('.parent-chat-context:not(.hidden)');
    if(!menu)return null;
    const idx=Number(menu.dataset.medsiIndex);
    return Number.isInteger(idx)?lastThread[idx]:null;
  }

  document.addEventListener('click',e=>{
    const msg=e.target.closest&&e.target.closest('#parentChatMessages .parent-chat-msg');
    if(msg){
      const nodes=[...document.querySelectorAll('#parentChatMessages .parent-chat-msg')];
      const idx=nodes.indexOf(msg);
      const menu=document.querySelector('.parent-chat-context');
      if(menu&&idx>=0) menu.dataset.medsiIndex=String(idx);
    }
  },true);

  const mo=new MutationObserver(()=>{
    decorateParent();decorateEducator();
    const menu=document.querySelector('.parent-chat-context:not(.hidden)');
    if(menu&&!menu.querySelector('.medsi-reply-action')){
      const m=selectedParentMessage();
      if(m&&m.messageKey){
        const b=document.createElement('button');b.type='button';b.className='medsi-reply-action';
        b.innerHTML='<span>↩</span><span>Ответить</span>';
        b.onclick=e=>{e.preventDefault();e.stopPropagation();menu.classList.add('hidden');setReply(m)};
        menu.appendChild(b);
      }
    }
  });
  mo.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});

  function captureParentState(){
    const api=window.MedsiParentChatScreen;
    if(!api||api.__medsiReplyWrapped)return;
    api.__medsiReplyWrapped=true;
    const open=api.open.bind(api);
    api.open=async function(next){activeSession=next&&next.session||null;activePhone=next&&next.phone||'';setReply(null);return open(next)};
    const close=api.close&&api.close.bind(api);
    if(close)api.close=function(){activeSession=null;activePhone='';setReply(null);return close()};
  }

  function wrapSubmit(){
    const form=document.getElementById('parentChatCompose');
    if(!form||form.dataset.medsiReplyWrapped)return;
    form.dataset.medsiReplyWrapped='1';
    form.addEventListener('submit',async e=>{
      if(!replyTarget||!activeSession||!activePhone)return;
      const input=document.getElementById('parentChatInput');
      const text=String(input&&input.value||'').trim();
      if(!text)return;
      e.preventDefault();e.stopImmediatePropagation();
      const send=document.getElementById('parentChatSend'),attach=document.getElementById('parentChatAttach');
      if(send)send.disabled=true;if(attach)attach.disabled=true;if(input)input.disabled=true;
      try{
        await originalSend(activeSession,'parent',activePhone,{type:'text',text,replyToKey:replyTarget.messageKey});
        if(input)input.value='';setReply(null);
        await window.MedsiParentChatScreen?.refresh({stick:true});
      }catch(err){
        const box=document.getElementById('parentChatError');if(box){box.textContent=err&&err.message||'Не удалось отправить ответ.';box.classList.remove('hidden')}
      }finally{
        if(send)send.disabled=false;if(attach)attach.disabled=false;if(input){input.disabled=false;input.focus()}
      }
    },true);
  }

  function boot(){captureParentState();wrapSubmit();decorateParent();decorateEducator()}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(boot,0),{once:true});else setTimeout(boot,0);
  setInterval(boot,700);
})();