(function(){
  if(window.MedsiMessageLongPress)return;

  const SELECTOR='#parentChatMessages .parent-chat-msg, .educator-exact-clone #chatThreadBox .msg';
  const INTERACTIVE='a,button,input,textarea,select,video,[contenteditable="true"],.parent-chat-media-frame,.msg-image-wrap,.parent-chat-reaction,.msg-reaction';
  const HOLD_MS=460;
  const ARM_MS=150;
  const MOVE_LIMIT=12;
  const RELEASE_HOLD_MS=180;

  let press=null;
  let blockedTarget=null;
  let blockClickUntil=0;
  let releaseTimer=0;

  function injectStyles(){
    if(document.getElementById('medsi-message-long-press-style'))return;
    const style=document.createElement('style');
    style.id='medsi-message-long-press-style';
    style.textContent=`
      .medsi-long-press-arming,
      .medsi-long-press-active{
        position:relative;
        z-index:7;
        -webkit-user-select:none;
        user-select:none;
        will-change:transform,filter,box-shadow;
        transition:transform .14s cubic-bezier(.2,.8,.2,1),filter .14s ease,box-shadow .14s ease!important;
        transform:translateZ(0) scale(1.018);
        filter:saturate(1.03);
        box-shadow:0 12px 28px rgba(18,92,101,.16)
      }
      .medsi-long-press-active{
        transform:translateZ(0) scale(1.035);
        filter:saturate(1.06);
        box-shadow:0 18px 38px rgba(18,92,101,.23)
      }
      @media(prefers-reduced-motion:reduce){
        .medsi-long-press-arming,.medsi-long-press-active{transition:none!important;transform:none}
      }
    `;
    document.head.appendChild(style);
  }

  function clearVisual(target){
    if(!target)return;
    target.classList.remove('medsi-long-press-arming','medsi-long-press-active');
  }

  function clearPress(keepTriggeredVisual){
    if(!press)return;
    clearTimeout(press.armTimer);
    clearTimeout(press.holdTimer);
    const target=press.target;
    const triggered=press.triggered;
    press=null;
    if(triggered&&keepTriggeredVisual){
      clearTimeout(releaseTimer);
      releaseTimer=setTimeout(()=>clearVisual(target),RELEASE_HOLD_MS);
    }else{
      clearVisual(target);
    }
  }

  function targetFor(event){
    const node=event.target&&event.target.closest?event.target.closest(SELECTOR):null;
    if(!node)return null;
    if(event.target&&event.target.closest&&event.target.closest(INTERACTIVE))return null;
    return node;
  }

  function start(event){
    if(event.pointerType==='mouse'||event.isPrimary===false)return;
    if(event.button!=null&&event.button!==0)return;
    const target=targetFor(event);
    if(!target)return;

    clearPress(false);
    clearTimeout(releaseTimer);
    press={
      pointerId:event.pointerId,
      pointerType:event.pointerType||'touch',
      target,
      x:event.clientX,
      y:event.clientY,
      triggered:false,
      armTimer:0,
      holdTimer:0
    };

    press.armTimer=setTimeout(()=>{
      if(!press||press.target!==target||!target.isConnected)return;
      target.classList.add('medsi-long-press-arming');
    },ARM_MS);

    press.holdTimer=setTimeout(()=>{
      if(!press||press.target!==target||!target.isConnected)return;
      press.triggered=true;
      target.classList.remove('medsi-long-press-arming');
      target.classList.add('medsi-long-press-active');
      blockedTarget=target;
      blockClickUntil=Date.now()+950;
      try{if(navigator.vibrate)navigator.vibrate(10)}catch(_){}
      target.dispatchEvent(new CustomEvent('medsi:message-longpress',{
        bubbles:true,
        cancelable:true,
        detail:{pointerType:press.pointerType}
      }));
    },HOLD_MS);
  }

  function move(event){
    if(!press||event.pointerId!==press.pointerId||press.triggered)return;
    if(Math.hypot(event.clientX-press.x,event.clientY-press.y)>MOVE_LIMIT)clearPress(false);
  }

  function end(event){
    if(!press||event.pointerId!==press.pointerId)return;
    clearPress(true);
  }

  function blockNativeContext(event){
    const recentBlocked=blockedTarget&&Date.now()<blockClickUntil&&blockedTarget.isConnected&&
      (event.target===blockedTarget||blockedTarget.contains(event.target));
    const activeTouch=press&&press.pointerType!=='mouse'&&
      (event.target===press.target||press.target.contains(event.target));
    if(recentBlocked||activeTouch)event.preventDefault();
  }

  function suppressReleaseClick(event){
    if(!blockedTarget||Date.now()>=blockClickUntil){blockedTarget=null;return}
    if(event.target===blockedTarget||blockedTarget.contains(event.target)){
      event.preventDefault();
      event.stopImmediatePropagation();
      blockedTarget=null;
    }
  }

  document.addEventListener('pointerdown',start,true);
  document.addEventListener('pointermove',move,true);
  document.addEventListener('pointerup',end,true);
  document.addEventListener('pointercancel',end,true);
  document.addEventListener('contextmenu',blockNativeContext,true);
  document.addEventListener('selectstart',event=>{
    if(press&&press.pointerType!=='mouse'&&(event.target===press.target||press.target.contains(event.target)))event.preventDefault();
  },true);
  document.addEventListener('click',suppressReleaseClick,true);

  injectStyles();
  window.MedsiMessageLongPress=Object.freeze({holdMs:HOLD_MS,selector:SELECTOR});
})();
