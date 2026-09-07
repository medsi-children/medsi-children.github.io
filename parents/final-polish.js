(function(){
  document.documentElement.classList.add('medsi-parent-ready');

  if(!document.getElementById('medsi-date-chip-theme')){
    const style=document.createElement('style');
    style.id='medsi-date-chip-theme';
    style.textContent=`
      .medsi-date-separator{
        background:#f2fcfd!important;
        border-color:rgba(22,184,192,.25)!important;
        box-shadow:0 3px 10px rgba(22,184,192,.06)!important;
        color:#16aeb7!important;
      }
    `;
    document.head.appendChild(style);
  }

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

})();
