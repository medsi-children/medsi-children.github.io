(function(){
  function prepareMedia(media){
    if(!media||media.dataset.medsiFadeBound==='1')return;
    media.dataset.medsiFadeBound='1';
    const wrap=media.closest('.msg-image-wrap');if(!wrap)return;
    const reveal=()=>{wrap.classList.add('loaded');media.classList.add('loaded')};
    if(media.tagName==='IMG'){
      if(media.complete&&media.naturalWidth>0){reveal();return}
      media.addEventListener('load',reveal,{once:true});
      media.addEventListener('error',reveal,{once:true});
    }else{
      if(media.readyState>=1){reveal();return}
      media.addEventListener('loadedmetadata',reveal,{once:true});
      media.addEventListener('error',reveal,{once:true});
    }
  }

  function patchOverlay(root){
    if(!root)return;
    root.querySelectorAll('.msg-image-wrap img,.msg-image-wrap video').forEach(prepareMedia);
    root.querySelectorAll('#screenChats:not(.hidden),#screenNewChat:not(.hidden),#screenChatThread:not(.hidden)').forEach(el=>{
      if(el.dataset.medsiEnter==='1')return;
      el.dataset.medsiEnter='1';el.classList.add('web-polish-enter');
    });
  }

  const patchAll=()=>document.querySelectorAll('.educator-exact-clone').forEach(patchOverlay);
  const observer=new MutationObserver(patchAll);
  observer.observe(document.documentElement,{subtree:true,childList:true});
  patchAll();
})();
