(function(){
  const hint=document.querySelector('#screenForm .report-hint');
  const syncHint=type=>{if(hint)hint.classList.toggle('hidden',type==='psychology')};
  const bind=(id,type)=>{const button=document.getElementById(id);if(button)button.addEventListener('click',()=>syncHint(type))};
  bind('btnMorning','morning');
  bind('btnEvening','evening');
  bind('btnPsychology','psychology');
})();
