(function(){
  if(window.MedsiChatCopyPolish)return;
  window.MedsiChatCopyPolish=true;

  function normalizeNativeParentTime(root){
    const scope=root&&root.querySelectorAll?root:document;
    const nodes=[];
    if(root&&root.nodeType===1&&root.matches&&root.matches('#parentChatMessages .parent-chat-time'))nodes.push(root);
    scope.querySelectorAll?.('#parentChatMessages .parent-chat-time').forEach(el=>nodes.push(el));
    nodes.forEach(el=>{
      const text=String(el.textContent||'').trim();
      const match=text.match(/(?:^|[•·]\s*)(\d{1,2}:\d{2})$/);
      if(match&&text!==match[1])el.textContent=match[1];
    });
  }

  function syncPlaceholders(){
    const parent=document.getElementById('parentChatInput');
    if(parent&&parent.placeholder!=='Введите сообщение…')parent.placeholder='Введите сообщение…';
    const tutor=document.getElementById('chatReplyInput');
    if(tutor&&tutor.placeholder!=='Введите сообщение…')tutor.placeholder='Введите сообщение…';
  }

  function scan(root){normalizeNativeParentTime(root);syncPlaceholders()}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>scan(document),{once:true});else scan(document);
  new MutationObserver(records=>{
    records.forEach(record=>record.addedNodes.forEach(scan));
    syncPlaceholders();
  }).observe(document.documentElement,{childList:true,subtree:true});
})();
