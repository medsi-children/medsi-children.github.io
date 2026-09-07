(function(){
  let activeMessage=null;
  const menuEl=()=>document.getElementById('chatContextMenu');
  const hide=()=>{const menu=menuEl();if(menu)menu.classList.add('hidden');activeMessage=null};
  function position(anchor){
    const menu=menuEl();
    if(!menu||menu.classList.contains('hidden')||!anchor||!anchor.isConnected)return;
    const viewport=window.visualViewport;
    const viewTop=viewport?viewport.offsetTop:0;
    const viewHeight=viewport?viewport.height:window.innerHeight;
    const viewBottom=viewTop+viewHeight;
    const viewLeft=viewport?viewport.offsetLeft:0;
    const viewWidth=viewport?viewport.width:window.innerWidth;
    const margin=12,gap=10;
    const anchorRect=anchor.getBoundingClientRect();
    const menuRect=menu.getBoundingClientRect();
    const menuWidth=Math.min(menuRect.width||310,viewWidth-margin*2);
    const menuHeight=menuRect.height||220;
    const spaceAbove=anchorRect.top-viewTop-gap-margin;
    const spaceBelow=viewBottom-anchorRect.bottom-gap-margin;
    let top;
    if(spaceAbove>=menuHeight){top=anchorRect.top-gap-menuHeight;menu.dataset.placement='above'}
    else if(spaceBelow>=menuHeight){top=anchorRect.bottom+gap;menu.dataset.placement='below'}
    else{const ideal=anchorRect.top+(anchorRect.height-menuHeight)/2;top=Math.max(viewTop+margin,Math.min(viewBottom-margin-menuHeight,ideal));menu.dataset.placement='overlay'}
    const idealLeft=anchorRect.left+(anchorRect.width-menuWidth)/2;
    const left=Math.max(viewLeft+margin,Math.min(viewLeft+viewWidth-margin-menuWidth,idealLeft));
    menu.style.position='fixed';
    menu.style.width=Math.min(310,viewWidth-margin*2)+'px';
    menu.style.maxHeight=Math.max(120,viewHeight-margin*2)+'px';
    menu.style.overflowY='auto';
    menu.style.left=left+'px';
    menu.style.top=top+'px';
    menu.style.bottom='auto';
    menu.style.zIndex='5000';
  }
  function toggle(event){
    const bubble=event.target&&event.target.closest?event.target.closest('.educator-exact-clone .msg'):null;
    if(!bubble)return;
    const menu=menuEl();
    if(menu&&activeMessage===bubble&&!menu.classList.contains('hidden')){
      event.preventDefault();
      event.stopImmediatePropagation();
      hide();
      return;
    }
    activeMessage=bubble;
    requestAnimationFrame(()=>position(bubble));
  }
  document.addEventListener('click',toggle,true);
  document.addEventListener('contextmenu',toggle,true);
  document.addEventListener('click',()=>{const menu=menuEl();if(menu&&menu.classList.contains('hidden'))activeMessage=null});
  window.addEventListener('resize',()=>{if(activeMessage)position(activeMessage)});
  if(window.visualViewport)window.visualViewport.addEventListener('resize',()=>{if(activeMessage)position(activeMessage)});
})();
