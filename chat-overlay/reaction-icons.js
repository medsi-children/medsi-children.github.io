(function(){
  if(window.MedsiReactionIcons)return;

  // Visual-only reaction skin. The chat still stores/sends normal Unicode reactions.
  // Preview source: Microsoft Fluent Emoji 3D (MIT License).
  const REACTIONS={
    '❤️':'https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Red%20heart/3D/red_heart_3d.png',
    '👍':'https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Thumbs%20up/Default/3D/thumbs_up_3d_default.png',
    '👌':'https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Ok%20hand/Default/3D/ok_hand_3d_default.png',
    '🙏':'https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Folded%20hands/Default/3D/folded_hands_3d_default.png',
    '🥰':'https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Smiling%20face%20with%20hearts/3D/smiling_face_with_hearts_3d.png',
    '😁':'https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Beaming%20face%20with%20smiling%20eyes/3D/beaming_face_with_smiling_eyes_3d.png',
    '🔥':'https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Fire/3D/fire_3d.png'
  };
  const selector='.parent-chat-reaction,.parent-chat-reaction-btn,.educator-exact-clone .msg-reaction,.educator-exact-clone .msg-reaction-btn';

  const style=document.createElement('style');
  style.id='medsi-reaction-icons-style';
  style.textContent=`
    .medsi-reaction-icon{display:block;width:1.5em;height:1.5em;object-fit:contain;pointer-events:none;user-select:none;-webkit-user-drag:none}
    .parent-chat-reaction .medsi-reaction-icon,.educator-exact-clone .msg-reaction .medsi-reaction-icon{width:23px;height:23px}
    .parent-chat-reaction-btn .medsi-reaction-icon,.educator-exact-clone .msg-reaction-btn .medsi-reaction-icon{width:28px;height:28px}
    .parent-chat-reaction-btn,.educator-exact-clone .msg-reaction-btn{display:inline-flex!important;align-items:center!important;justify-content:center!important}
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

  window.MedsiReactionIcons={paint,scan,source:'Microsoft Fluent Emoji 3D'};
})();
