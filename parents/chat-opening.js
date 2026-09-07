(function(){
  if(window.MedsiParentChatOpening)return;
  const btn=document.getElementById('btnChat');if(!btn)return;
  window.MedsiParentChatOpening=true;
  let timer=0;
  const clear=()=>{if(timer){clearTimeout(timer);timer=0}btn.classList.remove('medsi-chat-opening');btn.querySelector('.medsi-chat-opening-spinner')?.remove()};
  btn.addEventListener('click',()=>{clear();timer=setTimeout(()=>{if(document.body.dataset.screen==='screenChat')return;btn.classList.add('medsi-chat-opening');if(!btn.querySelector('.medsi-chat-opening-spinner')){const spinner=document.createElement('span');spinner.className='medsi-chat-opening-spinner';spinner.setAttribute('aria-hidden','true');btn.appendChild(spinner)}},1000)},true);
  new MutationObserver(()=>{if(document.body.dataset.screen==='screenChat')clear()}).observe(document.body,{attributes:true,attributeFilter:['data-screen']});
  window.addEventListener('pageshow',clear);
})();
