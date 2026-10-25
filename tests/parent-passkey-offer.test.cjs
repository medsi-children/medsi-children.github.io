const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

const root=path.join(__dirname,'..');
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('a temporary passkey status failure still shows the offer and allows retry on iPhone',async()=>{
  const elements=new Map(),storage=new Map();
  const makeNode=()=>({
    classList:{values:new Set(),add(value){this.values.add(value)},remove(value){this.values.delete(value)},contains(value){return this.values.has(value)}},
    style:{},dataset:{},value:'',textContent:'',disabled:false,open:false,
    showModal(){this.open=true},close(){this.open=false},
    addEventListener(){},setAttribute(){},scrollTo(){},replaceChildren(){},appendChild(){},querySelector(){return null}
  });
  const fetchCalls=[];let statusCalls=0,credentialCalls=0;
  const fetch=async(url,options)=>{
    fetchCalls.push(String(url));
    if(String(url).endsWith('/status')){
      statusCalls++;
      if(statusCalls===1)throw new Error('temporary network failure');
      return {ok:true,json:async()=>({ok:true,hasPasskey:false})};
    }
    if(String(url).endsWith('/registration/options'))return {ok:true,json:async()=>({ok:true,challengeId:'pach_test',options:{challenge:'AA',user:{id:'AQ'}}})};
    if(String(url).endsWith('/registration/verify'))return {ok:true,json:async()=>({ok:true})};
    throw new Error('Unexpected request: '+url);
  };
  const navigator={credentials:{create:async()=>{
    credentialCalls++;
    return {id:'credential',rawId:new Uint8Array([1]),type:'public-key',response:{clientDataJSON:new Uint8Array([2]),attestationObject:new Uint8Array([3]),getTransports:()=>[]}};
  }}};
  const context={
    console,AbortController,fetch,navigator,atob,btoa,Uint8Array,Date,Math,Promise,Response,
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
    document:{getElementById:id=>{if(!elements.has(id))elements.set(id,makeNode());return elements.get(id)},createElement:makeNode,addEventListener(){},body:makeNode()},
    window:{PublicKeyCredential:function(){},isSecureContext:true,fetch,scrollTo(){},addEventListener(){}}
  };
  context.window.audit=undefined;
  vm.createContext(context);
  let source=fs.readFileSync(path.join(root,'parents/full-web.js'),'utf8');
  source=source.replace('  boot();','  window.audit={askToSavePasskey,setup(){parentSession="test-session"}};');
  vm.runInContext(source,context);
  context.window.audit.setup();

  const pending=context.window.audit.askToSavePasskey();
  await tick();
  const dialog=elements.get('passkeyOfferDialog');
  const error=elements.get('passkeyOfferError');
  const save=elements.get('passkeySaveBtn');
  assert.equal(dialog.open,true);
  assert.equal(error.classList.contains('hidden'),false);
  assert.equal(credentialCalls,0);

  await save.onclick();
  assert.equal(statusCalls,2);
  assert.equal(credentialCalls,0,'preparation completes before a fresh user gesture');
  await save.onclick();
  await pending;
  assert.equal(credentialCalls,1);
  assert.equal(dialog.open,false);
  assert.ok(fetchCalls.some(url=>url.endsWith('/registration/verify')));
});
