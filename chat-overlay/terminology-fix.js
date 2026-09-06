(function(){
  if(window.__medsiTerminologyFix)return;
  window.__medsiTerminologyFix=true;

  const pairs=[
    ['воспитателей и психологов','воспитателей'],
    ['Воспитателей и психологов','Воспитателей'],
    ['воспитатели и психологи','воспитатели'],
    ['Воспитатели и психологи','Воспитатели']
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
