(function(){
  if(window.MedsiGestureNavigation)return;

  const EDGE_PX=38;
  const MIN_X=68;
  const MAX_MS=1400;
  const COMMIT_RATIO=.24;
  let gesture=null;
  let animating=false;

  function injectTouchups(){
    if(document.getElementById('medsi-gesture-navigation-style'))return;
    const style=document.createElement('style');
    style.id='medsi-gesture-navigation-style';
    style.textContent=`
      /* Parent composer circles need a tiny optical lift on iOS. */
      #parentChatCompose #parentChatAttach,
      #parentChatCompose #parentChatSend{top:-2px!important}

      /* Quick replies keep the same tap target but visually become only quiet grey lines. */
      .educator-exact-clone #btnQuickReplies{
        border:0!important;background:transparent!important;box-shadow:none!important;color:#a0a9b3!important;
      }
      .educator-exact-clone #btnQuickReplies::before{
        content:''!important;display:block!important;width:16px!important;height:12px!important;
        background:
          linear-gradient(#a0a9b3,#a0a9b3) 0 0/16px 2px no-repeat,
          linear-gradient(#a0a9b3,#a0a9b3) 0 5px/16px 2px no-repeat,
          linear-gradient(#a0a9b3,#a0a9b3) 0 10px/16px 2px no-repeat!important;
        border-radius:1px!important;
      }

      /* Date chips are created in the same render turn as the messages. */
      .medsi-date-separator{animation:medsiDateChipIn .16s cubic-bezier(.22,.7,.3,1) both}
      @keyframes medsiDateChipIn{
        from{opacity:0;transform:translateY(2px) scale(.99)}
        to{opacity:1;transform:none}
      }

      .medsi-swipe-preview-stage{
        position:fixed;overflow:hidden;pointer-events:none;contain:paint;
        background:#f7fefe;box-shadow:inset 0 0 0 1px rgba(22,184,192,.06);
      }
      .medsi-swipe-preview-card{
        position:absolute!important;inset:0!important;margin:0!important;
        box-sizing:border-box!important;width:100%!important;max-width:none!important;
        height:100%!important;max-height:none!important;min-height:0!important;
        pointer-events:none!important;user-select:none!important;-webkit-user-select:none!important;
        transform:translate3d(-24px,0,0) scale(.988);opacity:.78;
        transform-origin:center center;will-change:transform,opacity;
      }
      .medsi-swipe-preview-stage[data-target-screen="screenChats"] #title,
      .medsi-swipe-preview-stage[data-target-screen="screenChats"] #meta{display:none!important}
      .medsi-swipe-preview-stage *{pointer-events:none!important}

      @media(prefers-reduced-motion:reduce){
        .medsi-date-separator{animation:none!important}
      }
    `;
    document.head.appendChild(style);
  }

  function visibleModal(){
    return !!document.querySelector('.link-modal-overlay:not(.hidden),.parent-chat-lightbox:not(.hidden),.overlay-image-viewer.is-open');
  }

  function click(el){
    if(!el||el.disabled)return false;
    el.click();
    return true;
  }

  function tutorOverlayBack(screen){
    if(screen==='screenChatThread')return click(document.getElementById('btnThreadBack'));
    if(screen==='screenNewChat')return click(document.getElementById('btnParentsBack'));
    if(screen==='screenChats')return click(document.getElementById('btnChatsBack'));
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
    if(screen==='screenPhoneReg')return click(document.getElementById('phoneRegBackBtn'));
    if(screen==='screenNames')return click(document.getElementById('namesBackBtn'));
    if(screen==='screenAuth')return click(document.getElementById('authBackBtn'));
    return false;
  }

  function mainTutorFrame(){
    return document.querySelector('body > .wrap > .frame')||document.querySelector('body > .wrap > article');
  }

  function showOnly(clone,ids,target){
    ids.forEach(id=>{
      const el=clone.querySelector('#'+id);if(!el)return;
      el.classList.toggle('hidden',id!==target);
    });
  }

  function configurePreview(clone,target,kind){
    if(!clone)return;
    clone.setAttribute('aria-hidden','true');
    clone.classList.add('medsi-swipe-preview-card');
    if(kind==='parent'){
      showOnly(clone,['screenStart','screenNames','screenPhoneReg','screenAuth','screenChoose','screenReport','screenSchedule','screenChat'],target);
      clone.classList.toggle('start-mode',target==='screenStart');
    }else if(kind==='tutor-main'){
      showOnly(clone,['screenChoose','screenForm','screenDone','screenPhones'],target);
      clone.classList.toggle('choose-mode',target==='screenChoose');
    }else if(kind==='tutor-overlay'){
      showOnly(clone,['screenChats','screenChatThread','screenNewChat'],target);
    }
    clone.querySelectorAll('input,textarea,button,a,[contenteditable="true"],video,audio').forEach(el=>{
      el.setAttribute('tabindex','-1');
      if(el.matches('video,audio'))try{el.pause()}catch(_){}
    });
  }

  function resolveDescriptor(){
    if(visibleModal()||animating)return null;
    const screen=String(document.body.dataset.screen||'');

    if(document.getElementById('btnParentChats')){
      const overlayFrame=document.querySelector('.educator-exact-clone .frame');
      if(overlayFrame&&['screenChatThread','screenChats','screenNewChat'].includes(screen)){
        if(screen==='screenChatThread')return{action:()=>tutorOverlayBack(screen),surface:overlayFrame,previewSource:overlayFrame,target:'screenChats',kind:'tutor-overlay'};
        if(screen==='screenNewChat')return{action:()=>tutorOverlayBack(screen),surface:overlayFrame,previewSource:overlayFrame,target:'screenChats',kind:'tutor-overlay'};
        const main=mainTutorFrame();
        return{action:()=>tutorOverlayBack(screen),surface:overlayFrame,previewSource:main,target:'screenChoose',kind:'tutor-main'};
      }
      if(/^report-/.test(screen)||screen==='screenPhones'||screen==='screenDone'){
        const main=mainTutorFrame();
        if(main)return{action:()=>tutorMainBack(screen),surface:main,previewSource:main,target:'screenChoose',kind:'tutor-main'};
      }
      return null;
    }

    if(document.getElementById('btnChat')){
      const card=document.getElementById('appCard');if(!card)return null;
      const targets={screenChat:'screenChoose',screenReport:'screenChoose',screenSchedule:'screenChoose',screenPhoneReg:'screenNames',screenNames:'screenStart',screenAuth:'screenStart'};
      if(targets[screen])return{action:()=>parentBack(screen),surface:card,previewSource:card,target:targets[screen],kind:'parent'};
    }
    return null;
  }

  function interactiveStart(target){
    return !!(target&&target.closest&&target.closest('input,textarea,[contenteditable="true"],video,audio'));
  }

  function snapshotInline(surface){
    return{
      transform:surface.style.transform,
      transition:surface.style.transition,
      willChange:surface.style.willChange,
      position:surface.style.position,
      zIndex:surface.style.zIndex,
      boxShadow:surface.style.boxShadow
    };
  }

  function restoreInline(surface,saved){
    if(!surface||!saved)return;
    surface.style.transform=saved.transform;
    surface.style.transition=saved.transition;
    surface.style.willChange=saved.willChange;
    surface.style.position=saved.position;
    surface.style.zIndex=saved.zIndex;
    surface.style.boxShadow=saved.boxShadow;
  }

  function makeStage(current){
    const desc=current.desc;
    if(!desc||!desc.surface||!desc.previewSource||!desc.surface.isConnected||!desc.previewSource.isConnected)return false;
    const rect=desc.surface.getBoundingClientRect();
    if(rect.width<40||rect.height<40)return false;
    const stage=document.createElement('div');
    stage.className='medsi-swipe-preview-stage';
    stage.dataset.targetScreen=desc.target||'';
    stage.setAttribute('aria-hidden','true');
    const radius=getComputedStyle(desc.surface).borderRadius||'0px';
    stage.style.left=rect.left+'px';stage.style.top=rect.top+'px';stage.style.width=rect.width+'px';stage.style.height=rect.height+'px';stage.style.borderRadius=radius;

    const clone=desc.previewSource.cloneNode(true);
    configurePreview(clone,desc.target,desc.kind);
    stage.appendChild(clone);

    const overlayRoot=desc.surface.closest('.medsi-chat-overlay');
    const host=overlayRoot||document.body;
    stage.style.zIndex=overlayRoot?'2':'10000';
    host.appendChild(stage);

    current.rect=rect;current.stage=stage;current.clone=clone;current.saved=snapshotInline(desc.surface);current.active=true;
    desc.surface.style.position='relative';desc.surface.style.zIndex=overlayRoot?'3':'10001';desc.surface.style.transition='none';desc.surface.style.willChange='transform';
    return true;
  }

  function applyDrag(current,dx){
    if(!current||!current.active||!current.desc.surface)return;
    const width=current.rect.width||1;
    const x=Math.max(0,Math.min(width+12,dx));
    const p=Math.max(0,Math.min(1,x/width));
    current.lastDx=x;
    current.desc.surface.style.transform='translate3d('+x+'px,0,0)';
    current.desc.surface.style.boxShadow='-12px 0 30px rgba(17,66,74,'+(0.05+0.09*p)+')';
    if(current.clone){
      current.clone.style.transform='translate3d('+(-24*(1-p))+'px,0,0) scale('+(0.988+0.012*p)+')';
      current.clone.style.opacity=String(0.78+0.22*p);
    }
  }

  function cleanupVisual(current){
    if(!current)return;
    const surface=current.desc&&current.desc.surface;
    if(current.stage&&current.stage.isConnected)current.stage.remove();
    if(surface&&surface.isConnected)restoreInline(surface,current.saved);
    current.stage=null;current.clone=null;current.active=false;
  }

  function finishVisual(current,commit){
    if(!current||!current.active){
      if(commit&&current&&current.desc)current.desc.action();
      return;
    }
    const surface=current.desc.surface;
    const width=current.rect.width||window.innerWidth;
    animating=true;
    surface.style.transition='transform .19s cubic-bezier(.22,.72,.25,1),box-shadow .19s ease';
    if(current.clone)current.clone.style.transition='transform .19s cubic-bezier(.22,.72,.25,1),opacity .19s ease';

    if(commit){
      surface.style.transform='translate3d('+(width+14)+'px,0,0)';
      surface.style.boxShadow='-18px 0 34px rgba(17,66,74,.14)';
      if(current.clone){current.clone.style.transform='translate3d(0,0,0) scale(1)';current.clone.style.opacity='1'}
      setTimeout(()=>{
        try{current.desc.action()}catch(_){}
        requestAnimationFrame(()=>{
          cleanupVisual(current);animating=false;
        });
      },190);
    }else{
      surface.style.transform='translate3d(0,0,0)';surface.style.boxShadow=current.saved.boxShadow||'';
      if(current.clone){current.clone.style.transform='translate3d(-24px,0,0) scale(.988)';current.clone.style.opacity='.78'}
      setTimeout(()=>{cleanupVisual(current);animating=false},190);
    }
  }

  document.addEventListener('touchstart',e=>{
    if(animating){gesture=null;return}
    gesture=null;
    if(e.touches.length!==1||interactiveStart(e.target))return;
    const desc=resolveDescriptor();
    if(!desc)return;
    const t=e.touches[0];
    const left=window.visualViewport?window.visualViewport.offsetLeft:0;
    if(t.clientX-left>EDGE_PX)return;
    gesture={desc,startX:t.clientX,startY:t.clientY,lastX:t.clientX,lastY:t.clientY,lastAt:Date.now(),started:Date.now(),valid:true,active:false,lastDx:0};
  },{capture:true,passive:true});

  document.addEventListener('touchmove',e=>{
    if(!gesture||!gesture.valid||e.touches.length!==1)return;
    const t=e.touches[0];
    gesture.lastX=t.clientX;gesture.lastY=t.clientY;gesture.lastAt=Date.now();
    const dx=t.clientX-gesture.startX,dy=t.clientY-gesture.startY;
    if(dx<0){if(!gesture.active)gesture.valid=false;return}
    if(!gesture.active&&Math.abs(dy)>12&&Math.abs(dy)>Math.abs(dx)*1.08){gesture.valid=false;return}
    if(!gesture.active&&dx>7&&Math.abs(dx)>Math.abs(dy)*1.08)makeStage(gesture);
    if(gesture.active){e.preventDefault();e.stopPropagation();applyDrag(gesture,dx)}
  },{capture:true,passive:false});

  document.addEventListener('touchend',e=>{
    if(!gesture)return;
    const current=gesture;gesture=null;
    if(!current.valid){cleanupVisual(current);return}
    const t=e.changedTouches&&e.changedTouches[0];
    const endX=t?t.clientX:current.lastX,endY=t?t.clientY:current.lastY;
    const dx=Math.max(0,endX-current.startX),dy=endY-current.startY,elapsed=Math.max(1,Date.now()-current.started);
    const horizontal=Math.abs(dx)>Math.abs(dy)*1.25;
    const velocity=dx/elapsed;
    const threshold=current.rect?Math.max(MIN_X,current.rect.width*COMMIT_RATIO):MIN_X;
    const commit=horizontal&&elapsed<=MAX_MS&&(dx>=threshold||(dx>=42&&velocity>.55));

    if(current.active){
      e.preventDefault();e.stopImmediatePropagation();
      finishVisual(current,commit);
      return;
    }
    if(commit){
      e.preventDefault();e.stopImmediatePropagation();
      requestAnimationFrame(()=>current.desc.action());
    }
  },{capture:true,passive:false});

  document.addEventListener('touchcancel',()=>{
    if(!gesture)return;
    const current=gesture;gesture=null;
    if(current.active)finishVisual(current,false);else cleanupVisual(current);
  },{capture:true,passive:true});

  injectTouchups();
  window.MedsiGestureNavigation={resolveAction:()=>{const d=resolveDescriptor();return d&&d.action},resolveDescriptor};
})();
