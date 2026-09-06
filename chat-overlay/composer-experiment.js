(function(){
  if(window.MedsiComposerExperiment)return;

  const GLYPHS={
    plus:`url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 5v14M5 12h14' fill='none' stroke='%2316b8c0' stroke-width='2.6' stroke-linecap='round'/%3E%3C/svg%3E")`,
    send:`url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 19V5M6.5 10.5 12 5l5.5 5.5' fill='none' stroke='%23fff' stroke-width='2.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
    back:`url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='m15 5-7 7 7 7' fill='none' stroke='%2316b8c0' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`
  };

  function injectStyles(){
    if(document.getElementById('medsi-composer-experiment-style'))return;
    const style=document.createElement('style');
    style.id='medsi-composer-experiment-style';
    style.textContent=`
      /* Experimental messenger-style composer. Kept isolated for easy rollback. */

      #parentChatAttach,#parentChatSend,
      .educator-exact-clone #chatAttachBtn,.educator-exact-clone #chatReplySendBtn{
        box-sizing:border-box!important;
        width:44px!important;min-width:44px!important;max-width:44px!important;
        height:44px!important;min-height:44px!important;max-height:44px!important;
        padding:0!important;margin:0!important;border-radius:999px!important;
        display:inline-flex!important;align-items:center!important;justify-content:center!important;
        flex:0 0 44px!important;line-height:1!important;font-size:0!important;
        position:relative!important;overflow:hidden!important;
      }
      #parentChatAttach,.educator-exact-clone #chatAttachBtn{
        border:1.5px solid rgba(22,184,192,.46)!important;
        background:#f7fdfd!important;color:#16b8c0!important;
        box-shadow:0 3px 10px rgba(22,184,192,.06)!important;
      }
      #parentChatSend,.educator-exact-clone #chatReplySendBtn{
        border:0!important;background:#18bcc5!important;color:#fff!important;
        box-shadow:0 5px 14px rgba(22,184,192,.20)!important;text-shadow:none!important;
      }
      #parentChatAttach::before,.educator-exact-clone #chatAttachBtn::before,
      #parentChatSend::before,.educator-exact-clone #chatReplySendBtn::before,
      #parentChatBack::before,.educator-exact-clone #btnThreadBack::before{
        content:''!important;display:block!important;background-repeat:no-repeat!important;
        background-position:center!important;background-size:contain!important;transform:none!important;
      }
      #parentChatAttach::before,.educator-exact-clone #chatAttachBtn::before{
        width:22px!important;height:22px!important;background-image:${GLYPHS.plus}!important;
      }
      #parentChatSend::before,.educator-exact-clone #chatReplySendBtn::before{
        width:22px!important;height:22px!important;background-image:${GLYPHS.send}!important;
      }
      #parentChatAttach::after,.educator-exact-clone #chatAttachBtn::after,
      #parentChatSend::after,.educator-exact-clone #chatReplySendBtn::after{content:none!important}
      #parentChatAttach:disabled,#parentChatSend:disabled,
      .educator-exact-clone #chatAttachBtn:disabled,.educator-exact-clone #chatReplySendBtn:disabled{opacity:.52!important}

      #parentChatCompose{
        display:grid!important;grid-template-columns:44px minmax(0,1fr) 44px!important;
        grid-template-areas:'attach text send'!important;gap:8px!important;align-items:end!important;
      }
      #parentChatAttach{grid-area:attach!important;align-self:end!important}
      #parentChatInput{
        grid-area:text!important;box-sizing:border-box!important;width:100%!important;
        height:48px!important;min-height:48px!important;max-height:120px!important;
        border-radius:24px!important;padding:12px 16px!important;
        border:1.5px solid rgba(15,199,206,.28)!important;background:#fff!important;
        line-height:1.35!important;resize:none!important;overflow-y:auto!important;
        box-shadow:inset 0 1px 0 rgba(255,255,255,.75)!important;
      }
      #parentChatSend{grid-area:send!important;align-self:end!important}

      #parentChatBack,
      .educator-exact-clone #btnThreadBack,
      .educator-exact-clone .medsi-tutor-call{
        box-sizing:border-box!important;width:48px!important;min-width:48px!important;max-width:48px!important;
        height:48px!important;min-height:48px!important;max-height:48px!important;
        padding:0!important;margin:0!important;border-radius:999px!important;
        border:1.5px solid rgba(22,184,192,.30)!important;background:#fff!important;color:#16b8c0!important;
        display:inline-flex!important;align-items:center!important;justify-content:center!important;
        box-shadow:0 3px 10px rgba(22,184,192,.05)!important;text-decoration:none!important;
      }
      #parentChatBack,.educator-exact-clone #btnThreadBack{font-size:0!important}
      #parentChatBack::before,.educator-exact-clone #btnThreadBack::before{
        width:22px!important;height:22px!important;background-image:${GLYPHS.back}!important;
      }

      .educator-exact-clone .medsi-chat-thread-top{
        display:grid!important;grid-template-columns:48px minmax(0,1fr) 48px!important;
        align-items:center!important;gap:9px!important;margin:0 0 10px!important;width:100%!important;
      }
      .educator-exact-clone .medsi-chat-thread-top #chatThreadHeader{
        min-width:0!important;width:min(100%,420px)!important;justify-self:center!important;
        margin:0!important;padding:9px 12px!important;border-radius:14px!important;
        font-size:.86rem!important;line-height:1.34!important;
      }
      .educator-exact-clone .medsi-tutor-call{
        justify-self:end!important;font-size:25px!important;font-weight:500!important;line-height:1!important;
      }

      .educator-exact-clone #screenChatThread .chat-compose{
        display:grid!important;grid-template-columns:44px minmax(0,1fr) 44px!important;
        grid-template-areas:'attach editor send'!important;column-gap:8px!important;row-gap:0!important;
        align-items:end!important;border:0!important;border-top:0!important;box-shadow:none!important;
      }
      .educator-exact-clone #chatAttachBtn{grid-area:attach!important;align-self:end!important}
      .educator-exact-clone #chatReplyEditor{
        grid-area:editor!important;position:relative!important;box-sizing:border-box!important;
        width:100%!important;min-width:0!important;height:auto!important;min-height:48px!important;max-height:136px!important;
        padding:0!important;border:1.5px solid rgba(15,199,206,.28)!important;border-radius:24px!important;
        background:#fff!important;overflow:hidden!important;
      }
      .educator-exact-clone #chatReplyInput{
        box-sizing:border-box!important;width:100%!important;height:46px!important;min-height:46px!important;max-height:134px!important;
        padding:11px 48px 10px 16px!important;margin:0!important;border:0!important;border-radius:23px!important;
        background:transparent!important;outline:none!important;box-shadow:none!important;line-height:1.35!important;
        overflow-y:auto!important;
      }
      .educator-exact-clone #chatReplySendBtn{grid-area:send!important;align-self:end!important}
      .educator-exact-clone #btnQuickReplies{
        position:absolute!important;right:8px!important;bottom:7px!important;top:auto!important;transform:none!important;
        z-index:3!important;box-sizing:border-box!important;width:31px!important;min-width:31px!important;max-width:31px!important;
        height:31px!important;min-height:31px!important;max-height:31px!important;padding:0!important;margin:0!important;
        border-radius:9px!important;border:1px solid rgba(95,127,134,.18)!important;
        background:rgba(247,252,252,.94)!important;color:#789aa0!important;
        display:inline-flex!important;align-items:center!important;justify-content:center!important;
        font-size:0!important;box-shadow:none!important;text-shadow:none!important;
      }
      .educator-exact-clone #btnQuickReplies::before{
        content:'☰'!important;font-size:16px!important;font-weight:600!important;line-height:1!important;color:#789aa0!important;
      }
      .educator-exact-clone #btnQuickReplies:active{transform:scale(.94)!important}
      .educator-exact-clone #screenChatThread.medsi-composer-ready > .row{display:none!important}
      .educator-exact-clone #btnVideo.medsi-composer-redundant{display:none!important}
      .educator-exact-clone #quickRepliesPanel{margin-top:8px!important}
      .educator-exact-clone #chatThreadBox{border-bottom-color:transparent!important}

      @media(max-width:560px){
        #parentChatCompose,.educator-exact-clone #screenChatThread .chat-compose{
          grid-template-columns:42px minmax(0,1fr) 42px!important;gap:7px!important;
        }
        #parentChatAttach,#parentChatSend,
        .educator-exact-clone #chatAttachBtn,.educator-exact-clone #chatReplySendBtn{
          width:42px!important;min-width:42px!important;max-width:42px!important;
          height:42px!important;min-height:42px!important;max-height:42px!important;flex-basis:42px!important;
        }
        #parentChatInput{height:48px!important;min-height:48px!important;border-radius:24px!important}
        .educator-exact-clone #chatReplyEditor{min-height:48px!important;border-radius:24px!important}
        .educator-exact-clone #chatReplyInput{height:46px!important;min-height:46px!important}
        .educator-exact-clone .medsi-chat-thread-top{
          grid-template-columns:48px minmax(0,1fr) 48px!important;gap:7px!important;
        }
        .educator-exact-clone .medsi-chat-thread-top #chatThreadHeader{
          width:min(100%,360px)!important;padding:8px 10px!important;font-size:.80rem!important;line-height:1.31!important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function autoGrow(el,min,max){
    if(!el)return;
    el.style.setProperty('height','0px','important');
    const next=Math.max(min,Math.min(max,el.scrollHeight||min));
    el.style.setProperty('height',next+'px','important');
  }

  function installParent(){
    const compose=document.getElementById('parentChatCompose');
    if(!compose)return false;
    const attach=document.getElementById('parentChatAttach');
    const send=document.getElementById('parentChatSend');
    const back=document.getElementById('parentChatBack');
    const input=document.getElementById('parentChatInput');
    if(attach){attach.setAttribute('aria-label','Прикрепить фото или видео');attach.title='Прикрепить фото или видео'}
    if(send)send.setAttribute('aria-label','Отправить сообщение');
    if(back)back.setAttribute('aria-label','Назад');
    if(input&&!input.dataset.medsiAutoGrow){
      input.dataset.medsiAutoGrow='1';
      const grow=()=>autoGrow(input,48,120);
      input.addEventListener('input',grow);
      compose.addEventListener('submit',()=>setTimeout(grow,0));
      grow();
    }
    compose.dataset.medsiComposerExperiment='1';
    return true;
  }

  function phoneHrefFromHeader(header){
    const text=String(header&&header.textContent||'');
    const match=text.match(/Номер телефона:\s*([+\d][\d\s()+-]*)/i);
    const digits=String(match&&match[1]||'').replace(/\D+/g,'').slice(-10);
    return digits.length===10?'tel:8'+digits:'';
  }

  function ensureCallButton(top,header){
    let call=top.querySelector('.medsi-tutor-call');
    if(!call){
      call=document.createElement('a');
      call.className='medsi-tutor-call';
      call.textContent='✆';
      call.setAttribute('aria-label','Позвонить родителю');
      call.title='Позвонить родителю';
      top.appendChild(call);
    }
    const href=phoneHrefFromHeader(header);
    if(href){call.href=href;call.removeAttribute('aria-disabled');call.style.visibility='visible'}
    else{call.removeAttribute('href');call.setAttribute('aria-disabled','true');call.style.visibility='hidden'}
    return call;
  }

  function installTutor(){
    const screen=document.getElementById('screenChatThread');
    const header=document.getElementById('chatThreadHeader');
    const back=document.getElementById('btnThreadBack');
    const compose=screen&&screen.querySelector('.chat-compose');
    const editorWrap=document.getElementById('chatReplyEditor');
    const editor=document.getElementById('chatReplyInput');
    const quick=document.getElementById('btnQuickReplies');
    const quickPanel=document.getElementById('quickRepliesPanel');
    const doctors=document.getElementById('doctorButtons');
    const attach=document.getElementById('chatAttachBtn');
    const send=document.getElementById('chatReplySendBtn');
    const video=document.getElementById('btnVideo');
    if(!screen||!header||!back||!compose||!editorWrap||!editor||!quick)return false;

    let top=screen.querySelector(':scope > .medsi-chat-thread-top');
    if(!top){
      top=document.createElement('div');
      top.className='medsi-chat-thread-top';
      screen.insertBefore(top,header);
    }
    if(back.parentNode!==top)top.insertBefore(back,top.firstChild);
    if(header.parentNode!==top)top.appendChild(header);
    ensureCallButton(top,header);
    if(quick.parentNode!==editorWrap)editorWrap.appendChild(quick);

    if(video)video.classList.add('medsi-composer-redundant');
    if(attach){attach.setAttribute('aria-label','Прикрепить фото или видео');attach.title='Прикрепить фото или видео'}
    if(send)send.setAttribute('aria-label','Отправить сообщение');
    back.setAttribute('aria-label','Назад');
    quick.setAttribute('aria-label','Быстрые ответы');quick.title='Быстрые ответы';
    if(editor.dataset.placeholder==='Введите ответ родителю...')editor.dataset.placeholder='Введите ответ…';

    if(!editor.dataset.medsiAutoGrow){
      editor.dataset.medsiAutoGrow='1';
      const grow=()=>autoGrow(editor,46,134);
      editor.addEventListener('input',grow);
      new MutationObserver(()=>requestAnimationFrame(grow)).observe(editor,{childList:true,subtree:true,characterData:true});
      grow();
    }

    if(quickPanel&&!quickPanel.dataset.medsiComposerExperiment){
      quickPanel.dataset.medsiComposerExperiment='1';
      quickPanel.addEventListener('click',e=>{
        const chosen=e.target&&e.target.closest&&e.target.closest('.quick-btn:not(.quick-doctors),.quick-doctor-btn');
        if(chosen){
          quickPanel.classList.add('hidden');
          if(doctors)doctors.classList.add('hidden');
          setTimeout(()=>autoGrow(editor,46,134),0);
        }
      });
      quick.addEventListener('click',()=>{
        if(quickPanel.classList.contains('hidden')&&doctors)doctors.classList.add('hidden');
      });
    }

    screen.classList.add('medsi-composer-ready');
    compose.dataset.medsiComposerExperiment='1';
    return true;
  }

  let scheduled=false;
  function install(){scheduled=false;injectStyles();installParent();installTutor()}
  function schedule(){if(scheduled)return;scheduled=true;requestAnimationFrame(install)}

  injectStyles();
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',schedule,{once:true});else schedule();
  new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});

  window.MedsiComposerExperiment={install};
})();
