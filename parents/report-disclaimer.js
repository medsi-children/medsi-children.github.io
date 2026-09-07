(function(){
  const banner=document.getElementById('reportDisclaimer');if(!banner)return;
  const standard='<strong>Пожалуйста, не обсуждайте отчёты с ребёнком и не показывайте их ему.</strong><div class="chat-note-list"><span class="chat-note-item">В отчётах содержатся безоценочные наблюдения о состоянии и поведении ребёнка.</span><span class="chat-note-item">Даже нейтральные фразы могут повлиять на доверие и работу специалистов.</span></div>';
  const psychology='<strong>Групповая психотерапия</strong><div class="chat-note-list"><span class="chat-note-item">Здесь вы можете прочесть отчёт с групповой психотерапии.</span><span class="chat-note-item">Отчёты об индивидуальной работе с вашим ребёнком вам предоставит ваш психолог.</span></div>';
  function apply(kind){banner.classList.remove('hidden','report-disclaimer-morning','report-disclaimer-evening','report-disclaimer-psychology');banner.classList.add('report-disclaimer-'+kind);banner.innerHTML=kind==='psychology'?psychology:standard}
  document.getElementById('btnMorning')?.addEventListener('click',()=>setTimeout(()=>apply('morning'),0));
  document.getElementById('btnEvening')?.addEventListener('click',()=>setTimeout(()=>apply('evening'),0));
  document.getElementById('btnPsychology')?.addEventListener('click',()=>setTimeout(()=>apply('psychology'),0));
})();
