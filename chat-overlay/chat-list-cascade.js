(function(){
  if(window.MedsiChatListCascade)return;
  window.MedsiChatListCascade=true;

  const seenByList=new WeakMap();
  let scheduled=false;

  function injectStyles(){
    if(document.getElementById('medsi-chat-list-cascade-style'))return;
    const style=document.createElement('style');
    style.id='medsi-chat-list-cascade-style';
    style.textContent=`
      .educator-exact-clone #chatList > .chat-card.medsi-cascade-in{
        animation:medsiChatCardCascade .24s cubic-bezier(.22,.72,.3,1) both!important;
        animation-delay:var(--medsi-cascade-delay,0ms)!important;
      }
      @keyframes medsiChatCardCascade{
        from{opacity:0;transform:translateY(5px) scale(.994)}
        to{opacity:1;transform:none}
      }
      @media(prefers-reduced-motion:reduce){
        .educator-exact-clone #chatList > .chat-card.medsi-cascade-in{animation:none!important}
      }
    `;
    document.head.appendChild(style);
  }

  function animateList(list){
    if(!list||!list.isConnected)return;
    let seen=seenByList.get(list);
    if(!seen){seen=new Set();seenByList.set(list,seen)}
    const cards=[...list.querySelectorAll(':scope > .chat-card')];
    let freshIndex=0;
    cards.forEach(card=>{
      const key=String(card.dataset.phone||card.querySelector('.chat-card-title')?.textContent||'card-'+cards.indexOf(card));
      if(seen.has(key))return;
      seen.add(key);
      const delay=Math.min(freshIndex,9)*30;
      freshIndex++;
      card.style.setProperty('--medsi-cascade-delay',delay+'ms');
      card.classList.add('medsi-cascade-in');
      setTimeout(()=>{
        if(!card.isConnected)return;
        card.classList.remove('medsi-cascade-in');
        card.style.removeProperty('--medsi-cascade-delay');
      },360+delay);
    });
  }

  function scan(){
    scheduled=false;
    document.querySelectorAll('.educator-exact-clone #chatList').forEach(animateList);
  }

  function schedule(){
    if(scheduled)return;
    scheduled=true;
    requestAnimationFrame(scan);
  }

  injectStyles();
  new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
  schedule();
})();
