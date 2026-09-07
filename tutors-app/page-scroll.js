(function(){
  try{if('scrollRestoration' in history)history.scrollRestoration='manual'}catch(_){}
  function reset(){
    if(document.body.classList.contains('medsi-chat-overlay-open'))return;
    const screen=String(document.body.dataset.screen||'');
    if(screen&&screen!=='screenChoose')return;
    window.scrollTo(0,0);
    document.documentElement.scrollTop=0;
    document.body.scrollTop=0;
  }
  window.MedsiTutorScroll={reset};
  reset();
  requestAnimationFrame(()=>requestAnimationFrame(reset));
  window.addEventListener('pageshow',()=>{reset();setTimeout(reset,80);setTimeout(reset,320)});
  window.addEventListener('load',()=>{reset();setTimeout(reset,120)},{once:true});
})();
