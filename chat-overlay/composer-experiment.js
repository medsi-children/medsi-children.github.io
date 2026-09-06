(function(){
  if(window.MedsiComposerExperiment)return;

  function injectStyles(){
    if(document.getElementById('medsi-composer-experiment-style'))return;
    const style=document.createElement('style');
    style.id='medsi-composer-experiment-style';
    style.textContent=`
      /* Experimental messenger-style composer. Kept isolated for easy rollback. */

      /* Shared circular attachment/send language. */
      #parentChatAttach,#parentChatSend,
      .educator-exact-clone #chatAttachBtn,.educator-exact-clone #chatReplySendBtn{
        box-sizing:border-box!important;
        width:44px!important;min-width:44px!important;max-width:44px!important;
        height:44px!important;min-height:44px!important;max-height:44px!important;
        padding:0!important;margin:0!important;border-radius:999px!important;
        display:inline-flex!important;align-items:center!important;justify-content:center!important;
        flex:0 0 44px!important;line-height:1!important;font-size:0!important;
      }
      #parentChatAttach,.educator-exact-clone #chatAttachBtn{
        border:1.5px solid rgba(22,184,192,.46)!important;
        background:#f7fdfd!important;color:#16b8c0!important;
        box-shadow:0 3px 10px rgba(22,184,192,.06)!important;
      }
      #parentChatAttach::before,.educator-exact-clone #chatAttachBtn::before{
        content:'+';display:block;font-size:30px;font-weight:400;line-height:.86;
        transform:translateY(-1px);color:#16b8c0;
      }
      #parentChatSend,.educator-exact-clone #chatReplySendBtn{
        border:0!important;background:#18bcc5!important;color:#fff!important;
        box-shadow:0 5px 14px rgba(22,184,192,.20)!important;text-shadow:none!important;
      }
      #parentChatSend::before,.educator-exact-clone #chatReplySendBtn::before{
        content:'↑';display:block;font-size:24px;font-weight:800;line-height:1;color:#fff;
        transform:translateY(-1px);
      }
      #parentChatAttach:disabled,#parentChatSend:disabled,
      .educator-exact-clone #chatAttachBtn:disabled,.educator-exact-clone #chatReplySendBtn:disabled{
        opacity:.52!important;
      }

      /* Parent composer: plus | rounded field | send circle. */
      #parentChatCompose{
        display:grid!important;
        grid-template-columns:44px minmax(0,1fr) 44px!important;
        grid-template-areas:'attach text send'!important;
        gap:8px!important;align-items:center!important;
      }
      #parentChatAttach{grid-area:attach!important}
      #parentChatInput{
        grid-area:text!important;width:100%!important;
        height:50px!important;min-height:50px!important;max-height:120px!important;
        border-radius:25px!important;padding:12px 16px!important;
        border:1.5px solid rgba(15,199,206,.28)!important;
        background:#fff!important;line-height:1.35!important;
        box-shadow:inset 0 1px 0 rgba(255,255,255,.75)!important;
      }
      #parentChatSend{grid-area:send!important}
      #parentChatBack{
        font-size:0!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;
      }
      #parentChatBack::before{
        content:'<';font-size:29px;font-weight:500;line-height:1;color:#16b8c0;
        transform:translateY(-1px);
      }

      /* Educator top row: compact back control to the left of the parent/child card. */
      .educator-exact-clone .medsi-chat-thread-top{
        display:grid!important;grid-template-columns:44px minmax(0,1fr)!important;
        align-items:center!important;gap:9px!important;margin:0 0 10px!important;width:100%!important;
      }
      .educator-exact-clone .medsi-chat-thread-top #chatThreadHeader{
        min-width:0!important;margin:0!important;padding:10px 13px!important;border-radius:14px!important;
      }
      .educator-exact-clone #btnThreadBack{
        box-sizing:border-box!important;width:44px!important;min-width:44px!important;max-width:44px!important;
        height:44px!important;min-height:44px!important;max-height:44px!important;
        padding:0!important;margin:0!important;border-radius:999px!important;
        border:1.5px solid rgba(22,184,192,.30)!important;background:#fff!important;color:#16b8c0!important;
        display:inline-flex!important;align-items:center!important;justify-content:center!important;
        font-size:0!important;box-shadow:0 3px 10px rgba(22,184,192,.05)!important;
      }
      .educator-exact-clone #btnThreadBack::before{
        content:'<';font-size:29px;font-weight:500;line-height:1;color:#16b8c0;transform:translateY(-1px);
      }

      /* Educator composer: same geometry as parent, with quick replies embedded in field. */
      .educator-exact-clone #screenChatThread .chat-compose{
        display:grid!important;
        grid-template-columns:44px minmax(0,1fr) 44px!important;
        grid-template-areas:'attach editor send'!important;
        column-gap:8px!important;row-gap:0!important;align-items:center!important;
      }
      .educator-exact-clone #chatAttachBtn{grid-area:attach!important}
      .educator-exact-clone #chatReplyEditor{
        grid-area:editor!important;position:relative!important;box-sizing:border-box!important;
        width:100%!important;min-width:0!important;height:auto!important;min-height:50px!important;max-height:140px!important;
        padding:0!important;border:1.5px solid rgba(15,199,206,.28)!important;border-radius:25px!important;
        background:#fff!important;overflow:visible!important;
      }
      .educator-exact-clone #chatReplyInput{
        box-sizing:border-box!important;width:100%!important;height:auto!important;min-height:47px!important;max-height:137px!important;
        padding:12px 48px 11px 16px!important;margin:0!important;border:0!important;border-radius:24px!important;
        background:transparent!important;outline:none!important;box-shadow:none!important;line-height:1.35!important;
        overflow-y:auto!important;
      }
      .educator-exact-clone #chatReplySendBtn{grid-area:send!important}
      .educator-exact-clone #btnQuickReplies{
        position:absolute!important;right:7px!important;top:50%!important;transform:translateY(-50%)!important;
        z-index:3!important;box-sizing:border-box!important;width:33px!important;min-width:33px!important;max-width:33px!important;
        height:33px!important;min-height:33px!important;max-height:33px!important;padding:0!important;margin:0!important;
        border-radius:10px!important;border:1px solid rgba(95,127,134,.19)!important;
        background:rgba(247,252,252,.94)!important;color:#789aa0!important;
        display:inline-flex!important;align-items:center!important;justify-content:center!important;
        font-size:0!important;box-shadow:none!important;text-shadow:none!important;
      }
      .educator-exact-clone #btnQuickReplies::before{
        content:'☰';font-size:17px;font-weight:600;line-height:1;color:#789aa0;
      }
      .educator-exact-clone #btnQuickReplies:active{transform:translateY(-50%) scale(.94)!important}
      .educator-exact-clone #screenChatThread.medsi-composer-ready > .row{display:none!important}
      .educator-exact-clone #btnVideo.medsi-composer-redundant{display:none!important}
      .educator-exact-clone #quickRepliesPanel{margin-top:8px!important}

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
        .educator-exact-clone #chatReplyInput{min-height:45px!important;padding-top:11px!important;padding-bottom:10px!important}
        .educator-exact-clone .medsi-chat-thread-top{grid-template-columns:42px minmax(0,1fr)!important;gap:8px!important}
        .educator-exact-clone #btnThreadBack{width:42px!important;min-width:42px!important;max-width:42px!important;height:42px!important;min-height:42px!important;max-height:42px!important}
      }
    `;
    document.head.appendChild(style);
  }

  function installParent(){
    const compose=document.getElementById('parentChatCompose');
    if(!compose)return false;
    const attach=document.getElementById('parentChatAttach');
    const send=document.getElementById('parentChatSend');
    const back=document.getElementById('parentChatBack');
    if(attach){attach.setAttribute('aria-label','Прикрепить фото или видео');attach.title='Прикрепить фото или видео'}
    if(send)send.setAttribute('aria-label','Отправить сообщение');
    if(back)back.setAttribute('aria-label','Назад');
    compose.dataset.medsiComposerExperiment='1';
    return true;
  }

  function installTutor(){
    const screen=document.getElementById('screenChatThread');
    const header=document.getElementById('chatThreadHeader');
    const back=document.getElementById('btnThreadBack');
    const compose=screen&&screen.querySelector('.chat-compose');
    const editorWrap=document.getElementById('chatReplyEditor');
    const quick=document.getElementById('btnQuickReplies');
    const quickPanel=document.getElementById('quickRepliesPanel');
    const doctors=document.getElementById('doctorButtons');
    const attach=document.getElementById('chatAttachBtn');
    const send=document.getElementById('chatReplySendBtn');
    const video=document.getElementById('btnVideo');
    if(!screen||!header||!back||!compose||!editorWrap||!quick)return false;

    let top=screen.querySelector(':scope > .medsi-chat-thread-top');
    if(!top){
      top=document.createElement('div');
      top.className='medsi-chat-thread-top';
      screen.insertBefore(top,header);
    }
    if(back.parentNode!==top)top.appendChild(back);
    if(header.parentNode!==top)top.appendChild(header);
    if(quick.parentNode!==editorWrap)editorWrap.appendChild(quick);

    if(video)video.classList.add('medsi-composer-redundant');
    if(attach){attach.setAttribute('aria-label','Прикрепить фото или видео');attach.title='Прикрепить фото или видео'}
    if(send)send.setAttribute('aria-label','Отправить сообщение');
    back.setAttribute('aria-label','Назад');
    quick.setAttribute('aria-label','Быстрые ответы');quick.title='Быстрые ответы';

    if(quickPanel&&!quickPanel.dataset.medsiComposerExperiment){
      quickPanel.dataset.medsiComposerExperiment='1';
      quickPanel.addEventListener('click',e=>{
        const chosen=e.target&&e.target.closest&&e.target.closest('.quick-btn:not(.quick-doctors),.quick-doctor-btn');
        if(chosen){quickPanel.classList.add('hidden');if(doctors)doctors.classList.add('hidden')}
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
  function install(){
    scheduled=false;
    injectStyles();
    installParent();
    installTutor();
  }
  function schedule(){
    if(scheduled)return;
    scheduled=true;
    requestAnimationFrame(install);
  }

  injectStyles();
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',schedule,{once:true});else schedule();
  new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});

  window.MedsiComposerExperiment={install};
})();
