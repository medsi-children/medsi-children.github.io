(function(){
  if(window.__medsiTerminologyFix)return;
  window.__medsiTerminologyFix=true;

  const style=document.createElement('style');
  style.id='medsi-chat-background-style';
  style.textContent=`
    #chatThreadBox.chat-box,
    .parent-chat-messages{
      background:
        radial-gradient(circle at 18% 12%,rgba(36,211,218,.10),transparent 30%),
        radial-gradient(circle at 82% 88%,rgba(15,199,206,.08),transparent 32%),
        linear-gradient(180deg,#fbfefe 0%,#f5fbfc 100%) !important;
      background-image:
        radial-gradient(circle at 18% 12%,rgba(36,211,218,.10),transparent 30%),
        radial-gradient(circle at 82% 88%,rgba(15,199,206,.08),transparent 32%),
        linear-gradient(180deg,#fbfefe 0%,#f5fbfc 100%) !important;
      background-size:auto !important;
      background-position:initial !important;
      background-repeat:no-repeat !important;
    }

    /* Keep refresh icon centered exactly like the paperclip button. */
    #btnRefreshChats{
      display:flex !important;
      align-items:center !important;
      justify-content:center !important;
      padding:0 !important;
      line-height:1 !important;
    }
    #btnRefreshChats .refresh-label{
      position:static !important;
      inset:auto !important;
      display:flex !important;
      flex:1 1 auto !important;
      align-items:center !important;
      justify-content:center !important;
      width:100% !important;
      height:100% !important;
      margin:0 !important;
      padding:0 !important;
      line-height:1 !important;
      transform:none !important;
      font-weight:700 !important;
      -webkit-text-stroke:.35px currentColor;
    }
    #btnRefreshChats.loading .refresh-label{display:none !important;}
  `;
  document.head.appendChild(style);

  const pairs=[
    ['воспитателей и психологов','воспитателей'],
    ['Воспитателей и психологов','Воспитателей'],
    ['воспитатели и психологи','воспитатели'],
    ['Воспитатели и психологи','Воспитатели'],
    ['работают с детьми','находятся с детьми'],
    ['Работают с детьми','Находятся с детьми']
  ];

  function replaceText(root){
    if(!root)return;
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    const nodes=[];
    while(walker.nextNode())nodes.push(walker.currentNode);
    nodes.forEach(node=>{
      let text=node.nodeValue;
      pairs.forEach(([from,to])=>{text=text.split(from).join(to)});
      if(text!==node.nodeValue)node.nodeValue=text;
    });
  }

  function apply(){
    if(document.getElementById('screenStart')){
      ['headerBlock','screenStart','screenChoose','screenChat'].forEach(id=>replaceText(document.getElementById(id)));
    }
    if(document.getElementById('tutorAuthGate')){
      replaceText(document.getElementById('tutorAuthGate'));
      replaceText(document.getElementById('screenChoose'));
    }
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',apply,{once:true});else apply();
})();
