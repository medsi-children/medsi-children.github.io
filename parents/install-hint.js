(function(){
  const key='medsi-install-hint-shown';
  const standalone=()=>!!navigator.standalone||window.matchMedia('(display-mode: standalone)').matches||window.matchMedia('(display-mode: fullscreen)').matches;
  if(standalone())return;
  let seen=false;try{seen=sessionStorage.getItem(key)==='1'}catch(_){}
  if(seen)return;
  const card=document.createElement('aside');
  card.className='medsi-install-hint';card.hidden=true;card.setAttribute('role','status');
  card.innerHTML='<button type="button" class="medsi-install-hint-close" aria-label="Закрыть подсказку об установке">×</button><strong><img class="medsi-install-emoji" src="/chat-overlay/assets/twemoji/1f4f1.svg" alt="📱"> Медси Бот под рукой</strong><p>Добавьте сайт на экран «Домой», чтобы открывать его как приложение.</p>';
  document.body.appendChild(card);
  let timer=null,hideTimer=null;
  function hide(){clearTimeout(timer);clearTimeout(hideTimer);timer=null;card.hidden=true}
  function sync(){
    if(document.body.dataset.screen!=='screenChoose'||standalone()){hide();return}
    if(seen||timer)return;
    timer=setTimeout(()=>{
      timer=null;if(document.body.dataset.screen!=='screenChoose'||document.hidden||standalone())return;
      seen=true;try{sessionStorage.setItem(key,'1')}catch(_){}
      card.hidden=false;hideTimer=setTimeout(hide,12000);
    },3500);
  }
  card.querySelector('button').addEventListener('click',hide);
  document.addEventListener('click',event=>{if(event.target.closest('.medsi-bot-launcher,.medsi-bot-hint'))hide()},true);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)hide();else sync()});
  new MutationObserver(sync).observe(document.body,{attributes:true,attributeFilter:['data-screen']});
  sync();
})();
