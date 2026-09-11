(function(){
  if(window.MedsiChatMotion)return;
  window.MedsiChatMotion=true;

  function redrawRefresh(){const btn=document.getElementById('btnRefreshChats');if(!btn||btn.dataset.medsiRefreshV3==='1')return;btn.dataset.medsiRefreshV3='1';const label=btn.querySelector('.refresh-label');if(label)label.textContent='⟳'}

  function animateMessages(){
    for(const box of [document.getElementById('chatThreadBox'),document.getElementById('parentChatMessages')]){
      if(!box||!box.isConnected)continue;
      const nodes=[...box.children].filter(el=>el.matches&&el.matches('.msg,.parent-chat-msg')&&!el.dataset.medsiAnimated);
      nodes.forEach((el,i)=>{
        el.dataset.medsiAnimated='1';
        el.style.setProperty('--medsi-message-delay',Math.min(i*22,154)+'ms');
        el.classList.add('medsi-message-enter');
        const finish=()=>{el.classList.remove('medsi-message-enter');el.style.removeProperty('--medsi-message-delay')};
        el.addEventListener('animationend',finish,{once:true});
        setTimeout(finish,500);
      });
    }
  }

  let lastVisible='';
  function animateScreens(){
    for(const id of ['screenChats','screenChatThread','screenChat']){const el=document.getElementById(id);if(!el||el.classList.contains('hidden'))continue;if(lastVisible===id)return;lastVisible=id;el.classList.remove('medsi-screen-enter');void el.offsetWidth;el.classList.add('medsi-screen-enter');return}
  }

  let polishQueued=false;
  function polish(){polishQueued=false;redrawRefresh();animateScreens();animateMessages()}
  function queuePolish(){if(polishQueued)return;polishQueued=true;requestAnimationFrame(polish)}

  const contentObserver=new MutationObserver(queuePolish);
  function boot(){contentObserver.observe(document.body,{subtree:true,childList:true});const screenObserver=new MutationObserver(queuePolish);screenObserver.observe(document.body,{attributes:true,attributeFilter:['data-screen']});queuePolish()}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
