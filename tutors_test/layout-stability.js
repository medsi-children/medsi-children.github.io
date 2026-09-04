(function(){
  function stabilize(root){
    if(!root)return;
    const screen=root.querySelector('#screenNewChat');
    if(screen){
      const list=screen.querySelector('#parentsList');
      const error=screen.querySelector('#parentsError');
      const back=screen.querySelector('#btnParentsBack');
      const row=back&&back.closest('.row');
      if(row&&!row.classList.contains('medsi-new-chat-back-row')){
        row.classList.add('medsi-new-chat-back-row');
      }
      if(row&&screen.firstElementChild!==row){
        screen.insertBefore(row,screen.firstChild);
      }
      if(list&&row&&row.nextElementSibling!==list){
        screen.insertBefore(list,row.nextSibling);
      }
      if(error&&list&&list.nextElementSibling!==error){
        screen.insertBefore(error,list.nextSibling);
      }
    }
  }

  const run=()=>document.querySelectorAll('.educator-exact-clone').forEach(stabilize);
  const observer=new MutationObserver(run);
  observer.observe(document.documentElement,{subtree:true,childList:true});
  run();
})();
