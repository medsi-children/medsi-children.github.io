(function(){
  const style=document.createElement('style');
  style.textContent=`
    .educator-exact-clone .refresh-btn{
      position:relative!important;
      display:inline-flex!important;
      align-items:center!important;
      justify-content:center!important;
      overflow:hidden!important;
    }
    .educator-exact-clone .refresh-btn .refresh-label{
      position:absolute!important;
      left:50%!important;
      top:50%!important;
      width:34px!important;
      height:34px!important;
      display:grid!important;
      place-items:center!important;
      line-height:1!important;
      transform:translate(-50%,-50%)!important;
      margin:0!important;
      padding:0!important;
    }
    #btnRefreshChats.refresh-btn .refresh-label{
      font-size:2.28rem!important;
    }
    .educator-exact-clone .refresh-btn.loading .refresh-label{
      display:none!important;
    }
    .educator-exact-clone .refresh-btn .refresh-spinner{
      position:absolute!important;
      left:50%!important;
      top:50%!important;
      width:28px!important;
      height:28px!important;
      margin:-14px 0 0 -14px!important;
    }
    .educator-exact-clone .refresh-btn.loading .refresh-spinner{
      display:block!important;
    }
  `;
  document.head.appendChild(style);

  if(!document.querySelector('script[data-medsi-reaction-icons]')){
    const s=document.createElement('script');
    s.src='/chat-overlay/reaction-icons.js?v=20260907-twemoji-1';
    s.dataset.medsiReactionIcons='1';
    document.head.appendChild(s);
  }

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
