(function(){
  if(window.MedsiGestureNavigation)return;

  const EDGE_PX=38;
  const MIN_X=68;
  const MAX_MS=1150;
  let gesture=null;

  function injectTouchups(){
    if(document.getElementById('medsi-gesture-navigation-style'))return;
    const style=document.createElement('style');
    style.id='medsi-gesture-navigation-style';
    style.textContent=`
      /* Small composer finish: parent circles sit optically level with the field. */
      #parentChatCompose #parentChatAttach,
      #parentChatCompose #parentChatSend{
        top:-2px!important;
      }

      /* Quick replies stay a generous tap target, but visually become only three quiet lines. */
      .educator-exact-clone #btnQuickReplies{
        border:0!important;
        background:transparent!important;
        box-shadow:none!important;
        color:#9aa6b5!important;
      }
      .educator-exact-clone #btnQuickReplies::before{
        content:''!important;
        display:block!important;
        width:16px!important;
        height:12px!important;
        background:
          linear-gradient(#9aa6b5,#9aa6b5) 0 0/16px 2px no-repeat,
          linear-gradient(#9aa6b5,#9aa6b5) 0 5px/16px 2px no-repeat,
          linear-gradient(#9aa6b5,#9aa6b5) 0 10px/16px 2px no-repeat!important;
        border-radius:1px!important;
      }
    `;
    document.head.appendChild(style);
  }

  function visibleModal(){
    return !!document.querySelector(
      '.link-modal-overlay:not(.hidden),.parent-chat-lightbox:not(.hidden),.overlay-image-viewer.is-open'
    );
  }

  function click(el){
    if(!el||el.disabled)return false;
    el.click();
    return true;
  }

  function buttonByText(root,text){
    if(!root)return null;
    return Array.from(root.querySelectorAll('button')).find(btn=>String(btn.textContent||'').trim()===text)||null;
  }

  function tutorBucketIsRead(){
    const active=document.querySelector('.educator-exact-clone .medsi-list-tab.is-active');
    if(active)return String(active.textContent||'').trim()==='Прочитанные';
    const list=document.getElementById('chatList');
    if(!list)return false;
    return !!Array.from(list.querySelectorAll('button')).find(btn=>String(btn.textContent||'').includes('Вернуться к непрочитанным'));
  }

  function tutorToUnread(){
    const tabs=Array.from(document.querySelectorAll('.educator-exact-clone .medsi-list-tab'));
    const unread=tabs.find(btn=>String(btn.textContent||'').trim()==='Непрочитанные');
    if(unread&&click(unread))return true;
    const legacy=Array.from((document.getElementById('chatList')||document).querySelectorAll('button')).find(btn=>String(btn.textContent||'').includes('Вернуться к непрочитанным'));
    return click(legacy);
  }

  function tutorOverlayBack(screen){
    if(screen==='screenChatThread')return click(document.getElementById('btnThreadBack'));

    if(screen==='screenNewChat'){
      const moved=click(document.getElementById('btnParentsBack'));
      if(moved){
        setTimeout(()=>tutorToUnread(),0);
        setTimeout(()=>tutorToUnread(),80);
      }
      return moved;
    }

    if(screen==='screenChats'){
      if(tutorBucketIsRead())return tutorToUnread();
      return click(document.getElementById('btnChatsBack'));
    }
    return false;
  }

  function tutorMainBack(screen){
    if(/^report-/.test(screen))return click(document.getElementById('btnBack'));
    if(screen==='screenPhones')return click(document.getElementById('btnPhonesBack'));
    if(screen==='screenDone')return click(document.getElementById('btnAgain'));
    return false;
  }

  function parentBack(screen){
    if(screen==='screenChat')return click(document.getElementById('parentChatBack'));
    if(screen==='screenReport')return click(document.getElementById('reportBackBtn'));
    if(screen==='screenSchedule')return click(document.getElementById('scheduleBackBtn'));

    // Registration/auth screens follow their fixed structural parent as well.
    if(screen==='screenPhoneReg')return click(document.getElementById('phoneRegBackBtn'));
    if(screen==='screenNames')return click(document.getElementById('namesBackBtn'));
    if(screen==='screenAuth')return click(document.getElementById('authBackBtn'));
    return false;
  }

  function resolveAction(){
    if(visibleModal())return null;
    const screen=String(document.body.dataset.screen||'');

    if(document.getElementById('btnParentChats')){
      if(document.body.classList.contains('medsi-chat-overlay-open')||document.querySelector('.educator-exact-clone')){
        if(['screenChatThread','screenChats','screenNewChat'].includes(screen))return()=>tutorOverlayBack(screen);
      }
      if(/^report-/.test(screen)||screen==='screenPhones'||screen==='screenDone')return()=>tutorMainBack(screen);
      return null;
    }

    if(document.getElementById('btnChat')){
      if(['screenChat','screenReport','screenSchedule','screenPhoneReg','screenNames','screenAuth'].includes(screen))return()=>parentBack(screen);
    }
    return null;
  }

  function interactiveStart(target){
    return !!(target&&target.closest&&target.closest('input,textarea,[contenteditable="true"],video,audio'));
  }

  document.addEventListener('touchstart',e=>{
    gesture=null;
    if(e.touches.length!==1||interactiveStart(e.target))return;
    const action=resolveAction();
    if(!action)return;
    const t=e.touches[0];
    const left=window.visualViewport?window.visualViewport.offsetLeft:0;
    if(t.clientX-left>EDGE_PX)return;
    gesture={action,startX:t.clientX,startY:t.clientY,lastX:t.clientX,lastY:t.clientY,started:Date.now(),valid:true};
  },{capture:true,passive:true});

  document.addEventListener('touchmove',e=>{
    if(!gesture||!gesture.valid||e.touches.length!==1)return;
    const t=e.touches[0];
    gesture.lastX=t.clientX;gesture.lastY=t.clientY;
    const dx=t.clientX-gesture.startX,dy=t.clientY-gesture.startY;
    if(dx<0||Math.abs(dy)>Math.max(24,Math.abs(dx)*1.15))gesture.valid=false;
  },{capture:true,passive:true});

  document.addEventListener('touchend',e=>{
    if(!gesture)return;
    const current=gesture;gesture=null;
    if(!current.valid)return;
    const t=e.changedTouches&&e.changedTouches[0];
    const endX=t?t.clientX:current.lastX,endY=t?t.clientY:current.lastY;
    const dx=endX-current.startX,dy=endY-current.startY,elapsed=Date.now()-current.started;
    if(dx<MIN_X||Math.abs(dx)<Math.abs(dy)*1.35||elapsed>MAX_MS)return;

    // Capture the completed gesture so legacy screen-specific swipe handlers cannot perform a second jump.
    e.preventDefault();
    e.stopImmediatePropagation();
    requestAnimationFrame(()=>current.action());
  },{capture:true,passive:false});

  document.addEventListener('touchcancel',()=>{gesture=null},{capture:true,passive:true});

  injectTouchups();
  window.MedsiGestureNavigation={resolveAction};
})();
