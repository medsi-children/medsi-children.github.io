(function(){
  const $=id=>document.getElementById(id);

  function installStyle(){
    const style=document.createElement('style');
    style.textContent=`
      #rim{display:none!important}
      body[data-screen="screenStart"] #chips,
      body[data-screen="screenNames"] #chips,
      body[data-screen="screenPhoneReg"] #chips,
      body[data-screen="screenAuth"] #chips{display:none!important}
      body[data-screen="screenStart"] #headerBlock,
      body[data-screen="screenNames"] #headerBlock,
      body[data-screen="screenPhoneReg"] #headerBlock,
      body[data-screen="screenAuth"] #headerBlock,
      body[data-screen="screenChoose"] #headerBlock,
      body[data-screen="screenChat"] #headerBlock{display:none!important}
      #boot.hidden{display:none!important}
    `;
    document.head.appendChild(style);
  }

  function installPsychologyFormatter(){
    if(!document.querySelector('link[data-medsi-psych-format]')){
      const link=document.createElement('link');link.rel='stylesheet';link.href='/parents_test/psychology-format.css?v=4';link.dataset.medsiPsychFormat='1';document.head.appendChild(link);
    }
    if(!window.MedsiPsychologyFormatter&&!document.querySelector('script[data-medsi-psych-format]')){
      const script=document.createElement('script');script.src='/parents_test/psychology-format.js?v=4';script.defer=true;script.dataset.medsiPsychFormat='1';document.head.appendChild(script);
    }
  }

  installStyle();
  installPsychologyFormatter();
})();