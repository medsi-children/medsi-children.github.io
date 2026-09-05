(function(){
  const PRIMARY='https://chat.xn----btbhdqvtun.xn--p1ai';
  const BACKUP='https://medsi-chat-worker.medsi-children.workers.dev';

  function mediaKey(src){
    try{
      const u=new URL(src,location.href);
      const marker='/media/';
      const i=u.pathname.indexOf(marker);
      if(i<0)return'';
      return decodeURIComponent(u.pathname.slice(i+marker.length));
    }catch(_){return''}
  }

  function patch(el){
    if(!el||el.dataset.medsiMediaRoute==='1')return;
    const src=String(el.getAttribute('src')||'');
    if(!src||src.startsWith('blob:'))return;
    const key=mediaKey(src);if(!key)return;

    el.dataset.medsiMediaRoute='1';
    const backupUrl=BACKUP+'/media/'+encodeURIComponent(key);
    const primaryUrl=PRIMARY+'/media/'+encodeURIComponent(key);
    let triedPrimary=false;

    el.onerror=()=>{
      if(triedPrimary)return;
      triedPrimary=true;
      el.src=primaryUrl;
      if(el.tagName==='VIDEO')el.load();
    };

    if(src!==backupUrl){
      el.src=backupUrl;
      if(el.tagName==='VIDEO')el.load();
    }
  }

  function scan(root){
    (root||document).querySelectorAll('img[src*="/media/"],video[src*="/media/"]').forEach(patch);
  }

  const observer=new MutationObserver(records=>{
    records.forEach(r=>{
      if(r.type==='attributes'&&r.target)patch(r.target);
      r.addedNodes&&r.addedNodes.forEach(n=>{if(n.nodeType!==1)return;patch(n);scan(n)});
    });
  });
  observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['src']});
  scan(document);
})();