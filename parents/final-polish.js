(function(){
  const PUSH_ORIGIN='https://medsi-push-worker.medsi-children.workers.dev';
  const nativeFetch=window.fetch.bind(window);
  window.fetch=function(input,init){
    let nextInput=input;
    try{
      const url=typeof input==='string'?input:String(input&&input.url||'');
      if(url.startsWith(PUSH_ORIGIN)){
        const parsed=new URL(url);
        nextInput='/push'+parsed.pathname+parsed.search;
      }
    }catch(_){}
    return nativeFetch(nextInput,init);
  };

  function normalizeParentCopy(){
    const replacements=[
      ['воспитателями и психологами','воспитателями'],
      ['воспитателей и психологов','воспитателей'],
      ['Воспитатели и психологи','Воспитатели'],
      ['воспитатели и психологи','воспитатели']
    ];
    const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
    const nodes=[];let node;
    while((node=walker.nextNode()))nodes.push(node);
    nodes.forEach(textNode=>{
      let value=textNode.nodeValue||'';
      let next=value;
      replacements.forEach(([from,to])=>{next=next.split(from).join(to)});
      if(next!==value)textNode.nodeValue=next;
    });
    const chatTitle=document.querySelector('#btnChat .menu-card-title');
    if(chatTitle)chatTitle.style.fontSize='calc(1em + 2px)';
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',normalizeParentCopy,{once:true});else normalizeParentCopy();

  function installChatOpeningUx(){
    if(document.getElementById('medsi-parent-chat-opening-style'))return;
    const style=document.createElement('style');
    style.id='medsi-parent-chat-opening-style';
    style.textContent=`
      #btnChat{position:relative!important;transition:opacity .18s ease,filter .18s ease,transform .18s ease!important}
      #btnChat.medsi-chat-opening{opacity:.76!important;filter:saturate(.88)}
      .medsi-chat-opening-spinner{position:absolute;right:18px;bottom:16px;width:24px;height:24px;border:3px solid rgba(255,255,255,.42);border-top-color:#fff;border-radius:50%;animation:medsiChatOpenSpin .72s linear infinite;pointer-events:none;z-index:5}
      @keyframes medsiChatOpenSpin{to{transform:rotate(360deg)}}
    `;
    document.head.appendChild(style);
    const btn=document.getElementById('btnChat');
    if(!btn||btn.dataset.medsiOpeningUx)return;
    btn.dataset.medsiOpeningUx='1';
    let timer=0;
    const clear=()=>{
      if(timer){clearTimeout(timer);timer=0}
      btn.classList.remove('medsi-chat-opening');
      const spin=btn.querySelector('.medsi-chat-opening-spinner');if(spin)spin.remove();
    };
    btn.addEventListener('click',()=>{
      clear();
      timer=setTimeout(()=>{
        if(document.body.dataset.screen==='screenChat')return;
        btn.classList.add('medsi-chat-opening');
        if(!btn.querySelector('.medsi-chat-opening-spinner')){const s=document.createElement('span');s.className='medsi-chat-opening-spinner';s.setAttribute('aria-hidden','true');btn.appendChild(s)}
      },1000);
    },true);
    new MutationObserver(()=>{if(document.body.dataset.screen==='screenChat')clear()}).observe(document.body,{attributes:true,attributeFilter:['data-screen']});
    window.addEventListener('pageshow',clear);
  }
  installChatOpeningUx();

  const banner=document.getElementById('reportDisclaimer');
  if(banner){
    const standard='<strong>Пожалуйста, не обсуждайте отчёты с ребёнком и не показывайте их ему.</strong><div class="chat-note-list"><span class="chat-note-item">В отчётах содержатся безоценочные наблюдения о состоянии и поведении ребёнка.</span><span class="chat-note-item">Даже нейтральные фразы могут повлиять на доверие и работу специалистов.</span></div>';
    const psychology='<strong>Групповая психотерапия</strong><div class="chat-note-list"><span class="chat-note-item">Здесь вы можете прочесть отчёт с групповой психотерапии.</span><span class="chat-note-item">Отчёты об индивидуальной работе с вашим ребёнком вам предоставит ваш психолог.</span></div>';
    function apply(kind){
      banner.classList.remove('hidden','report-disclaimer-morning','report-disclaimer-evening','report-disclaimer-psychology');
      banner.classList.add('report-disclaimer-'+kind);
      banner.innerHTML=kind==='psychology'?psychology:standard;
    }
    const morning=document.getElementById('btnMorning');
    const evening=document.getElementById('btnEvening');
    const therapy=document.getElementById('btnPsychology');
    if(morning)morning.addEventListener('click',()=>setTimeout(()=>apply('morning'),0));
    if(evening)evening.addEventListener('click',()=>setTimeout(()=>apply('evening'),0));
    if(therapy)therapy.addEventListener('click',()=>setTimeout(()=>apply('psychology'),0));
  }

  function syncPushPanel(){
    if(!window.MedsiPush)return;
    MedsiPush.setPanelVisible(document.body.dataset.screen==='screenChoose');
  }
  const observer=new MutationObserver(syncPushPanel);
  observer.observe(document.body,{attributes:true,attributeFilter:['data-screen']});
  syncPushPanel();

  if(!window.MedsiVideoLink&&!document.querySelector('script[data-medsi-video-link]')){
    const s=document.createElement('script');s.src='/chat-overlay/video-link.js?v=1';s.dataset.medsiVideoLink='1';document.head.appendChild(s);
  }
  if(!document.querySelector('script[data-medsi-reaction-icons]')){
    const s=document.createElement('script');s.src='/chat-overlay/reaction-icons.js?v=20260907-1';s.dataset.medsiReactionIcons='1';document.head.appendChild(s);
  }
  if(!document.querySelector('script[data-medsi-message-enhancements]')){
    const s=document.createElement('script');s.src='/chat-overlay/message-enhancements.js?v=20260906-receipt-layout';s.dataset.medsiMessageEnhancements='1';document.head.appendChild(s);
  }
  if(!document.querySelector('script[data-medsi-bottom-lock]')){
    const s=document.createElement('script');s.src='/chat-overlay/bottom-lock.js?v=20260906-1';s.dataset.medsiBottomLock='1';document.head.appendChild(s);
  }
})();
