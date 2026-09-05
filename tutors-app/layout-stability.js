(function(){
  function textOf(el){return String(el&&el.textContent||'').trim()}

  function findRealReadButton(list){
    return [...list.querySelectorAll('button')].find(btn=>btn.id!=='medsiReadChatsProxy'&&textOf(btn)==='Открыть прочитанные чаты')||null;
  }

  function findReadBackButton(list){
    return [...list.querySelectorAll('button')].find(btn=>textOf(btn).includes('Вернуться к непрочитанным'))||null;
  }

  function ensureReadProxy(screenChats){
    const list=screenChats&&screenChats.querySelector('#chatList');
    if(!list)return;

    let wrap=list.querySelector(':scope > .medsi-read-chats-proxy-wrap');
    let proxy=wrap&&wrap.querySelector('#medsiReadChatsProxy');
    if(!wrap){
      wrap=document.createElement('div');
      wrap.className='medsi-read-chats-proxy-wrap';
      wrap.style.cssText='text-align:center;margin-top:16px;animation:none;';
      proxy=document.createElement('button');
      proxy.id='medsiReadChatsProxy';
      proxy.type='button';
      proxy.className='btn';
      proxy.textContent='Открыть прочитанные чаты';
      proxy.style.animation='none';
      proxy.addEventListener('click',()=>{
        const started=Date.now();
        const open=()=>{
          const real=findRealReadButton(list);
          if(real){real.click();return}
          if(Date.now()-started<1200)setTimeout(open,20);
        };
        open();
      });
      wrap.appendChild(proxy);
      list.appendChild(wrap);
    }

    const readBack=findReadBackButton(list);
    if(readBack){
      wrap.style.display='none';
      return;
    }

    wrap.style.display='block';
    const hasCards=!!list.querySelector('.chat-card');
    wrap.style.marginTop=hasCards?'20px':'16px';
    wrap.style.padding=hasCards?'16px':'0';
    wrap.style.borderTop=hasCards?'1px solid rgba(36,211,218,0.18)':'0';
    proxy.style.width=hasCards?'100%':'';
    proxy.style.maxWidth=hasCards?'100%':'';

    const real=findRealReadButton(list);
    if(real){
      const realWrap=real.parentElement;
      if(realWrap&&realWrap!==wrap)realWrap.style.display='none';
    }

    if(list.lastElementChild!==wrap)list.appendChild(wrap);
  }

  function stabilize(root){
    if(!root)return;

    const screenChats=root.querySelector('#screenChats');
    if(screenChats)ensureReadProxy(screenChats);

    const screen=root.querySelector('#screenNewChat');
    if(screen){
      const list=screen.querySelector('#parentsList');
      const error=screen.querySelector('#parentsError');
      const back=screen.querySelector('#btnParentsBack');
      const row=back&&back.closest('.row');
      if(row&&!row.classList.contains('medsi-new-chat-back-row'))row.classList.add('medsi-new-chat-back-row');
      if(row&&screen.firstElementChild!==row)screen.insertBefore(row,screen.firstChild);
      if(list&&row&&row.nextElementSibling!==list)screen.insertBefore(list,row.nextSibling);
      if(error&&list&&list.nextElementSibling!==error)screen.insertBefore(error,list.nextSibling);
    }
  }

  const run=()=>document.querySelectorAll('.educator-exact-clone').forEach(stabilize);
  const observer=new MutationObserver(run);
  observer.observe(document.documentElement,{subtree:true,childList:true});
  run();
})();