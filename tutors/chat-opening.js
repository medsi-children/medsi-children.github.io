(function(){
  const btn=document.getElementById('btnParentChats');
  if(!btn||btn.dataset.medsiOpeningUx)return;
  btn.dataset.medsiOpeningUx='1';
  let timer=0;
  const clear=()=>{
    if(timer){clearTimeout(timer);timer=0}
    btn.classList.remove('medsi-chat-opening');
    const spinner=btn.querySelector('.medsi-chat-opening-spinner');
    if(spinner)spinner.remove();
  };
  btn.addEventListener('click',()=>{
    clear();
    timer=setTimeout(()=>{
      if(document.body.classList.contains('medsi-chat-overlay-open'))return;
      btn.classList.add('medsi-chat-opening');
      if(!btn.querySelector('.medsi-chat-opening-spinner')){
        const spinner=document.createElement('span');
        spinner.className='medsi-chat-opening-spinner';
        spinner.setAttribute('aria-hidden','true');
        btn.appendChild(spinner);
      }
    },1000);
  },true);
  new MutationObserver(()=>{
    if(document.body.classList.contains('medsi-chat-overlay-open'))clear();
  }).observe(document.body,{attributes:true,attributeFilter:['class']});
  window.addEventListener('pageshow',clear);
})();
