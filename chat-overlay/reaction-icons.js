(function(){
  if(window.MedsiReactionIcons)return;

  // Visual-only reaction skin. The chat still stores/sends normal Unicode reactions.
  // Preview source: Twitter Twemoji graphics (CC BY 4.0).
  const REACTIONS={
    '❤️':'https://raw.githubusercontent.com/twitter/twemoji/master/assets/svg/2764.svg',
    '👍':'https://raw.githubusercontent.com/twitter/twemoji/master/assets/svg/1f44d.svg',
    '👌':'https://raw.githubusercontent.com/twitter/twemoji/master/assets/svg/1f44c.svg',
    '🙏':'https://raw.githubusercontent.com/twitter/twemoji/master/assets/svg/1f64f.svg',
    '🥰':'https://raw.githubusercontent.com/twitter/twemoji/master/assets/svg/1f970.svg',
    '😁':'https://raw.githubusercontent.com/twitter/twemoji/master/assets/svg/1f601.svg',
    '🔥':'https://raw.githubusercontent.com/twitter/twemoji/master/assets/svg/1f525.svg'
  };
  const selector='.parent-chat-reaction,.parent-chat-reaction-btn,.msg-reaction,.msg-reaction-btn';

  const style=document.createElement('style');
  style.id='medsi-reaction-icons-style';
  style.textContent=`
    .medsi-reaction-icon{display:block;width:1.5em;height:1.5em;object-fit:contain;pointer-events:none;user-select:none;-webkit-user-drag:none}
    .parent-chat-reaction .medsi-reaction-icon,.msg-reaction .medsi-reaction-icon{width:23px;height:23px}
    .parent-chat-reaction-btn .medsi-reaction-icon,.msg-reaction-btn .medsi-reaction-icon{width:28px;height:28px}
    .parent-chat-reaction-btn,.msg-reaction-btn{display:inline-flex!important;align-items:center!important;justify-content:center!important}
  `;
  document.head.appendChild(style);

  function getReaction(el){
    const saved=String(el&&el.dataset&&el.dataset.medsiReaction||'');
    if(REACTIONS[saved])return saved;
    const text=String(el&&el.textContent||'').trim();
    return REACTIONS[text]?text:'';
  }

  function paint(el){
    if(!el||el.nodeType!==1||el.dataset.medsiReactionIcon==='1'||el.dataset.medsiReactionLoading==='1')return;
    const reaction=getReaction(el);if(!reaction)return;
    el.dataset.medsiReaction=reaction;
    el.dataset.medsiReactionLoading='1';
    const img=new Image();
    img.className='medsi-reaction-icon';
    img.alt=reaction;
    img.draggable=false;
    img.decoding='async';
    img.onload=()=>{
      delete el.dataset.medsiReactionLoading;
      if(!el.isConnected)return;
      el.dataset.medsiReactionIcon='1';
      el.replaceChildren(img);
    };
    img.onerror=()=>{
      delete el.dataset.medsiReactionLoading;
      el.dataset.medsiReactionFallback='1';
      if(el.isConnected&&!String(el.textContent||'').trim())el.textContent=reaction;
    };
    img.src=REACTIONS[reaction];
  }

  function scan(root){
    if(!root)return;
    if(root.nodeType===1&&root.matches&&root.matches(selector))paint(root);
    if(root.querySelectorAll)root.querySelectorAll(selector).forEach(paint);
  }

  const observer=new MutationObserver(records=>{
    records.forEach(record=>record.addedNodes.forEach(scan));
  });
  observer.observe(document.documentElement,{childList:true,subtree:true});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>scan(document),{once:true});else scan(document);

  if(!document.querySelector('script[data-medsi-menu-twemoji]')){
    const s=document.createElement('script');
    s.async=false;
    s.src='/chat-overlay/menu-twemoji.js?v=20260907-2';
    s.dataset.medsiMenuTwemoji='1';
    document.head.appendChild(s);
  }
  if(!document.querySelector('script[data-medsi-chat-copy-polish]')){
    const s=document.createElement('script');
    s.async=false;
    s.src='/chat-overlay/chat-copy-polish.js?v=20260907-1';
    s.dataset.medsiChatCopyPolish='1';
    document.head.appendChild(s);
  }

  window.MedsiReactionIcons={paint,scan,source:'Twitter Twemoji'};
})();
