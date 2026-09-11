(function(){
  const registrations=[];
  const READY_OFFSET=46;
  const MAX_OFFSET=78;
  let active=null,startY=0,startX=0,pulling=false,refreshing=false,suppressClick=false;
  const indicator=document.createElement('div');
  indicator.className='medsi-pull-refresh';
  indicator.setAttribute('aria-live','polite');
  indicator.setAttribute('aria-label','Потяните вниз, чтобы обновить');
  indicator.setAttribute('aria-hidden','true');
  indicator.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6v5h-5"></path><path d="M19 11a7.5 7.5 0 1 0 .2 5.6"></path></svg>';

  function mount(){if(!indicator.isConnected&&document.body)document.body.appendChild(indicator)}
  function scrollTop(registration){
    const scroller=registration.getScroller&&registration.getScroller();
    if(!scroller||scroller===window||scroller===document||scroller===document.body||scroller===document.documentElement){
      return Math.max(0,Number(window.scrollY||0),Number(document.documentElement.scrollTop||0),Number(document.body&&document.body.scrollTop||0));
    }
    return Math.max(0,Number(scroller.scrollTop||0));
  }
  function current(){
    for(let i=registrations.length-1;i>=0;i--){
      const item=registrations[i];
      try{if(item.isActive()&&scrollTop(item)<=1)return item}catch(_){}
    }
    return null;
  }
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
  function releasePage(){document.documentElement.classList.remove('medsi-pull-active')}
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
    const registration=current();if(!registration)return;
    const touch=event.touches[0];active=registration;startY=touch.clientY;startX=touch.clientX;pulling=false;mount();setPull(0);
  }
  function touchMove(event){
    if(!active||refreshing||event.touches.length!==1)return;
    if(scrollTop(active)>1){hide();return}
    const touch=event.touches[0],dy=touch.clientY-startY,dx=Math.abs(touch.clientX-startX);
    if(dy<=0||dx>dy){if(!pulling&&Math.max(dx,-dy)>10)hide();return}
    if(dy<4)return;
    pulling=true;document.documentElement.classList.add('medsi-pull-active');if(event.cancelable)event.preventDefault();setPull(dy);
  }
  function touchEnd(){
    if(!active||refreshing)return;
    const registration=active,ready=pulling&&indicator.classList.contains('is-ready');
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
  document.addEventListener('touchend',touchEnd,{passive:true,capture:true});
  document.addEventListener('touchcancel',()=>{if(!refreshing)hide()},{passive:true,capture:true});
  document.addEventListener('click',event=>{if(!suppressClick)return;suppressClick=false;event.preventDefault();event.stopPropagation()},{capture:true});
  window.MedsiPullToRefresh={register};
})();
