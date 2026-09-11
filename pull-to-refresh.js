(function(){
  const registrations=[];
  const READY_OFFSET=46;
  const MAX_OFFSET=78;
  const READY_DISTANCE=Math.ceil(READY_OFFSET/.82);
  let active=null,startY=0,startX=0,lastY=0,lastX=0,pulling=false,refreshing=false,suppressClick=false;
  const indicator=document.createElement('div');
  indicator.className='medsi-pull-refresh';
  indicator.setAttribute('aria-live','polite');
  indicator.setAttribute('aria-label','Потяните вниз, чтобы обновить');
  indicator.setAttribute('aria-hidden','true');
  indicator.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6v5h-5"></path><path d="M19 11a7.5 7.5 0 1 0 .2 5.6"></path></svg>';

  function mount(){if(!indicator.isConnected&&document.body)document.body.appendChild(indicator)}
  function getScroller(registration){
    try{return registration&&registration.getScroller?registration.getScroller():window}catch(_){return window}
  }
  function scrollTop(registration){
    const scroller=getScroller(registration);
    if(!scroller||scroller===window||scroller===document||scroller===document.body||scroller===document.documentElement){
      return Math.max(0,Number(window.scrollY||0),Number(document.documentElement.scrollTop||0),Number(document.body&&document.body.scrollTop||0));
    }
    return Math.max(0,Number(scroller.scrollTop||0));
  }
  function containsTarget(registration,target){
    const scroller=getScroller(registration);
    if(!scroller||scroller===window||scroller===document||scroller===document.body||scroller===document.documentElement)return true;
    return !target||!scroller.contains||scroller.contains(target);
  }
  function current(target){
    for(let i=registrations.length-1;i>=0;i--){
      const item=registrations[i];
      try{if(item.isActive()&&scrollTop(item)<=1&&containsTarget(item,target))return item}catch(_){}
    }
    return null;
  }
  function holdPage(){document.documentElement.classList.add('medsi-pull-active')}
  function releasePage(){document.documentElement.classList.remove('medsi-pull-active')}
  function setPull(distance){
    const eased=Math.min(MAX_OFFSET,Math.max(0,distance)*.82);
    const progress=Math.min(1,eased/READY_OFFSET);
    indicator.style.setProperty('--medsi-pull-offset',eased+'px');
    indicator.style.setProperty('--medsi-pull-opacity',String(Math.min(1,eased/18)));
    indicator.style.setProperty('--medsi-pull-rotation',(progress*155)+'deg');
    indicator.setAttribute('aria-hidden',eased>0?'false':'true');
    indicator.classList.toggle('is-pulling',eased>0);
    indicator.classList.toggle('is-ready',eased>=READY_OFFSET);
  }
  function hide(){
    pulling=false;active=null;releasePage();indicator.classList.remove('is-pulling','is-ready','is-refreshing');
    indicator.style.setProperty('--medsi-pull-offset','0px');
    indicator.style.setProperty('--medsi-pull-opacity','0');
    indicator.style.setProperty('--medsi-pull-rotation','0deg');
    indicator.setAttribute('aria-hidden','true');
  }
  async function runRefresh(registration){
    refreshing=true;suppressClick=true;releasePage();
    indicator.classList.remove('is-pulling','is-ready');indicator.classList.add('is-refreshing');
    indicator.setAttribute('aria-label','Обновляем');
    indicator.setAttribute('aria-hidden','false');
    indicator.style.setProperty('--medsi-pull-offset','50px');indicator.style.setProperty('--medsi-pull-opacity','1');
    try{await registration.onRefresh()}catch(_){}
    await new Promise(resolve=>setTimeout(resolve,260));
    refreshing=false;indicator.setAttribute('aria-label','Потяните вниз, чтобы обновить');hide();
    setTimeout(()=>{suppressClick=false},120);
  }
  function touchStart(event){
    if(refreshing||event.touches.length!==1)return;
    const registration=current(event.target);if(!registration)return;
    const touch=event.touches[0];
    active=registration;startY=lastY=touch.clientY;startX=lastX=touch.clientX;pulling=false;mount();setPull(0);holdPage();
  }
  function touchMove(event){
    if(!active||refreshing||event.touches.length!==1)return;
    if(scrollTop(active)>1){hide();return}
    const touch=event.touches[0];lastY=touch.clientY;lastX=touch.clientX;
    const dy=lastY-startY,dx=Math.abs(lastX-startX);
    if(dy<=0||dx>Math.max(8,dy*1.08)){if(!pulling&&Math.max(dx,-dy)>10)hide();return}
    if(event.cancelable)event.preventDefault();
    event.stopImmediatePropagation();
    if(dy<2)return;
    pulling=true;setPull(dy);
  }
  function finishTouch(event){
    if(!active||refreshing)return;
    const registration=active;
    const touch=event&&event.changedTouches&&event.changedTouches[0];
    const endY=touch?touch.clientY:lastY,endX=touch?touch.clientX:lastX;
    const dy=endY-startY,dx=Math.abs(endX-startX);
    const releaseReady=dy>=READY_DISTANCE&&dx<=Math.max(14,dy*1.08);
    const ready=releaseReady||(pulling&&indicator.classList.contains('is-ready'));
    if((pulling||releaseReady)&&event){if(event.cancelable)event.preventDefault();event.stopImmediatePropagation()}
    if(ready)runRefresh(registration);else hide();
  }
  function register(options){
    if(!options||typeof options.isActive!=='function'||typeof options.onRefresh!=='function')return function(){};
    const item={id:String(options.id||Date.now()),isActive:options.isActive,getScroller:options.getScroller||(()=>window),onRefresh:options.onRefresh};
    registrations.push(item);mount();
    return function(){const index=registrations.indexOf(item);if(index>=0)registrations.splice(index,1);if(active===item)hide()};
  }

  document.addEventListener('touchstart',touchStart,{passive:true,capture:true});
  document.addEventListener('touchmove',touchMove,{passive:false,capture:true});
  document.addEventListener('touchend',finishTouch,{passive:false,capture:true});
  document.addEventListener('touchcancel',finishTouch,{passive:false,capture:true});
  document.addEventListener('click',event=>{if(!suppressClick)return;suppressClick=false;event.preventDefault();event.stopPropagation()},{capture:true});
  window.MedsiPullToRefresh={register};
})();
