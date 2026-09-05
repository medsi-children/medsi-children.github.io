(function(){
  const hint=document.querySelector('#screenForm .report-hint');
  if(!hint)return;
  function sync(type){hint.classList.toggle('hidden',type==='psychology')}
  const morning=document.getElementById('btnMorning');
  const evening=document.getElementById('btnEvening');
  const psychology=document.getElementById('btnPsychology');
  if(morning)morning.addEventListener('click',()=>sync('morning'));
  if(evening)evening.addEventListener('click',()=>sync('evening'));
  if(psychology)psychology.addEventListener('click',()=>sync('psychology'));
})();
