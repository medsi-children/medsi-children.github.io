(function(){
  function savedSession(){
    try{
      const s=JSON.parse(localStorage.getItem('medsi_d1_educator_session_v1')||'null');
      return s&&s.token?s:null;
    }catch(_){return null}
  }
  function showError(message){
    const el=document.getElementById('chatListError');
    if(!el)return;
    el.textContent=message||'Не удалось изменить статус чата.';
    el.classList.remove('hidden');
  }
  document.addEventListener('click',async e=>{
    const toggle=e.target&&e.target.closest&&e.target.closest('.educator-exact-clone .chat-read-toggle');
    if(!toggle||!toggle.classList.contains('is-read'))return;
    const controls=toggle.closest('.chat-controls');
    if(matchMedia('(hover: none)').matches&&controls&&!controls.classList.contains('is-menu-open'))return;
    const card=toggle.closest('.chat-card');
    const phone=card&&card.dataset&&card.dataset.phone||'';
    const session=savedSession();
    const transport=window.MedsiOverlayTransport;
    if(!phone||!session||!transport||typeof transport.markUnread!=='function')return;
    e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
    if(toggle.classList.contains('is-busy'))return;
    toggle.classList.add('is-busy');
    try{
      await transport.markUnread(session,phone);
      const refresh=document.getElementById('btnRefreshChats');
      if(refresh)refresh.click();
    }catch(err){showError(err&&err.message)}
    finally{toggle.classList.remove('is-busy')}
  },true);
})();
