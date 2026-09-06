(function(){
  if(window.MedsiMenuTwemoji)return;
  window.MedsiMenuTwemoji=true;

  const BASE='https://raw.githubusercontent.com/twitter/twemoji/master/assets/svg/';
  const ITEMS=[
    ['#btnChat .menu-card-title','💬','1f4ac.svg'],
    ['#btnParentChats .menu-card-title','💬','1f4ac.svg'],
    ['#btnMorning .menu-card-title','☀️','2600.svg'],
    ['#btnEvening .menu-card-title','🌙','1f319.svg'],
    ['#btnPsychology .menu-card-title','🧠','1f9e0.svg'],
    ['#btnSchedule .menu-card-title','🕘','1f558.svg'],
    ['#btnParentPhones .menu-card-title','📞','1f4de.svg']
  ];

  function injectStyles(){
    if(document.getElementById('medsi-menu-twemoji-style'))return;
    const style=document.createElement('style');
    style.id='medsi-menu-twemoji-style';
    style.textContent=`
      .menu-card-title .medsi-menu-twemoji{
        width:1.08em;height:1.08em;display:inline-block;object-fit:contain;
        margin-right:.26em;vertical-align:-.12em;pointer-events:none;user-select:none;-webkit-user-drag:none
      }
    `;
    document.head.appendChild(style);
  }

  function paintOne(selector,emoji,file){
    const title=document.querySelector(selector);
    if(!title||title.dataset.medsiMenuTwemoji)return;
    const original=String(title.textContent||'');
    const trimmed=original.trimStart();
    if(!trimmed.startsWith(emoji))return;
    const text=trimmed.slice(emoji.length).trimStart();
    const img=document.createElement('img');
    img.className='medsi-menu-twemoji';
    img.src=BASE+file;
    img.alt='';img.setAttribute('aria-hidden','true');
    img.onerror=()=>{title.textContent=original;title.dataset.medsiMenuTwemoji='fallback'};
    title.replaceChildren(img,document.createTextNode(text));
    title.dataset.medsiMenuTwemoji='1';
  }

  function scan(){ITEMS.forEach(item=>paintOne(...item))}
  injectStyles();
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',scan,{once:true});else scan();
  new MutationObserver(scan).observe(document.documentElement,{childList:true,subtree:true});
})();
