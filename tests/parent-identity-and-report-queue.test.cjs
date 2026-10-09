const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
function apps() {
  const properties = new Map([['MEDSI_SPREADSHEET_ID','synthetic']]);
  const context = {Logger:{log(){}},
    SpreadsheetApp:{openById:()=>({getSheetByName:()=>({getDataRange:()=>({getValues:()=>[[]]})})})},
    PropertiesService:{getScriptProperties:()=>({getProperty:key=>properties.get(key),setProperty:(key,value)=>properties.set(key,value)})},
    LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})}};
  vm.createContext(context);
  ['Медси бот.js','medsi-contacts.js','parent-relationships.js'].forEach(file=>vm.runInContext(read('apps-script/medsi-bot/'+file),context));
  return context;
}
test('full child name uses child gender and produces a full genitive label',()=>{
  const x=apps();
  assert.equal(x.parentChildGenitive_('Никита Иванов'),'Никиты Иванова');
  assert.equal(x.parentChildGenitive_('Лиза Иванова'),'Лизы Ивановой');
  assert.equal(x.parentChildGenitive_('Саша Иванова'),'Саши Ивановой');
  assert.equal(x.inheritedChildFamily_('Никита','Иванова'),'Иванов');
  assert.equal(x.inheritedChildFamily_('Лиза','Иванов'),'Иванова');
  assert.equal(x.inheritedChildFamily_('Саша','Иванова'),'Иванова');
  assert.equal(x.defaultParentRelationship_('Анна'),'Мама');
  assert.equal(x.defaultParentRelationship_('Андрей'),'Папа');
  assert.equal(x.defaultParentRelationship_('Саша'),'Родитель');
});
test('REPORTS G overrides inference and only empty adult statuses are filled',()=>{
  const x=apps(), rows=[['89990000001','Анна','Никита И.','Иванов','','','Бабушка'],['89990000002','Андрей','Никита И.','Иванов','','','']];
  const writes=[];
  x.getDataSheet_=()=>({getLastRow:()=>3,getRange:(r,c)=>({getValues:()=>rows,setValue:value=>writes.push({r,c,value})})});
  const profiles=[{phone:'9990000001',parentName:'Анна',childName:'Никита Иванов'},{phone:'9990000002',parentName:'Андрей',childName:'Никита Иванов'}];
  x.enrichProfilesWithRelationships_(profiles);
  assert.equal(profiles[0].relationship,'Бабушка');
  assert.equal(profiles[1].relationship,'Папа');
  assert.equal(profiles[0].childGenitive,'Никиты Иванова');
  assert.deepEqual(writes,[{r:3,c:7,value:'Папа'}]);
});
test('legacy registration corrects only an inherited surname; explicit surname is retained',()=>{
  for(const [child,expected] of [['Никита','Иванов'],['Никита Петров','Петров'],['Никита Иванова','Иванова']]) {
    const x=apps(), saved=[];
    x.getDataSheet_=()=>({getLastRow:()=>1,appendRow:row=>saved.push(row)});
    x.appendToDatabase_=()=>{};
    x.smartRegisterFromInboxCore('89990000001','Анна Иванова',child,true);
    assert.equal(saved[0][3],expected);
  }
});
test('failed report claims can retry; completed and active claims stay idempotent',()=>{
  const x=apps(), id='report_synthetic123';
  x.writeReportSubmission_(id,{type:'morning',fingerprint:'one',status:'failed',updatedAt:Date.now()});
  assert.equal(x.claimReportSubmission_(id,'morning','one').claimed,true);
  assert.equal(x.claimReportSubmission_(id,'morning','one').claimed,false);
  x.writeReportSubmission_(id,{type:'morning',fingerprint:'one',status:'completed',updatedAt:Date.now()});
  assert.equal(x.claimReportSubmission_(id,'morning','one').claimed,false);
  assert.equal(x.claimReportSubmission_(id,'morning','different').mismatch,true);
});
test('manual source processing reads A1 and clears an old error after valid distribution',()=>{
  const x=apps(); let note='Old error',distributed=false;
  x.buildReportValidationChildren_=()=>x.buildReportChildren_(['Лиза И.'],['Иванова']);
  x.distributeChildReports=()=>{distributed=true};
  const cell={getValue:()=> 'Лиза И.: Синтетический текст.',setValue(){},setNote:value=>{note=value},clearNote:()=>{note=''}};
  const sheet={getLastRow:()=>2,getRange:(r)=>{assert.equal(r,1);return cell}};
  assert.equal(x.processRawReportSourceEdit_('morning',sheet).ok,true);
  assert.equal(distributed,true);assert.equal(note,'');
});
test('assistant chooses the stored relationship instead of offering the other adult',async()=>{
  const context={window:{}};vm.createContext(context);vm.runInContext(read('tutors/assistant.js'),context);
  const rows=[{phone:'9990000001',childName:'Никита Иванов',parentName:'Анна',relationship:'Мама'},{phone:'9990000002',childName:'Никита Иванов',parentName:'Мария',relationship:'Бабушка'}];
  const bot=context.window.MedsiTutorAssistant.create({parents:async()=>rows});
  const response=await bot.respond('дай телефон бабушки Никиты');
  assert.match(response.text,/Бабушка: Мария/);assert.doesNotMatch(response.text,/Анна/);
  const prompt=await bot.respond('напиши маме Никиты');
  assert.match(prompt.text,/Что написать/);
  await bot.respond('отмена');
  const message=await bot.respond('напиши маме Никиты что Никита хочет позвонить');
  assert.match(message.text,/Никита хочет позвонить/);
});
test('Worker does not mark an in-progress Apps Script response as completed',async()=>{
  const updates=[];
  const context={Response,AbortSignal,console,fetch:async()=>new Response(JSON.stringify({ok:true,processing:true}))};
  vm.createContext(context);vm.runInContext(read('services/cloudflare/chat-worker/src/index.js').replace('export default {','const worker = {'),context);
  const env={APP_SCRIPT_URL:'https://example.invalid',CHAT_ADMIN_TOKEN:'synthetic',CHAT_DB:{prepare:sql=>({bind(...args){this.args=args;return this},all:async()=>({results:[{submission_id:'report_synthetic123',report_type:'morning',report_text:'Synthetic',attempts:0}]}),run:async function(){if(sql.includes('status=?'))updates.push(this.args[0]);if(sql.includes("status='retry', attempts="))updates.push('retry');if(sql.includes("status='completed'"))updates.push('completed');return {meta:{changes:1}}}})}};
  await context.drainReportQueue(env);
  assert.deepEqual(updates,['retry']);
  assert.equal(context.parentActorLabel({relationship:'Мама',child_genitive:'Никиты Иванова'}),'Мама Никиты Иванова');
});
test('an ambiguous child block is skipped while explicit and unrelated children distribute',()=>{
  const x=apps();
  const children=x.buildReportChildren_(['Артем К.','Артем И.','Лиза П.','Артем С.'],['Крылов','Иванов','Петрова','Смирнов']);
  x.buildReportValidationChildren_=()=>children;
  const text='Артем: Неоднозначный синтетический блок.\nАртем И.: Точный синтетический блок.\nЛиза: Другой синтетический блок.';
  const prepared=x.prepareRawReportSourceText_('morning',text);
  assert.equal(prepared.ok,true);
  assert.deepEqual(Array.from(prepared.validation.ambiguousNames),['Артем']);
  const ctx=x.buildDistributionContext_(children,[]);
  const distribution=x.buildSafeDistribution_('morning',x.parseReportBlocks_(prepared.text,x.buildKnownBaseKeys_(children),ctx),ctx);
  assert.equal(distribution.byRow[0],undefined);
  assert.match(distribution.byRow[1],/Точный синтетический блок/);
  assert.match(distribution.byRow[2],/Другой синтетический блок/);
  assert.doesNotMatch(Object.values(distribution.byRow).join(' '),/Неоднозначный синтетический блок/);
});
test('concurrent queue drains cannot let a newer report overtake the first',async()=>{
  const {DatabaseSync}=require('node:sqlite');
  const db=new DatabaseSync(':memory:');
  db.exec(read('services/cloudflare/chat-worker/migrations/0005_report_submission_queue.sql'));
  const insert=db.prepare('INSERT INTO report_submission_queue (submission_id,report_type,report_text,created_at,updated_at) VALUES (?,?,?,?,?)');
  insert.run('report_first','morning','First synthetic',1,Date.now());
  insert.run('report_second','morning','Second synthetic',2,Date.now());
  const calls=[];let release,started;
  const firstStarted=new Promise(resolve=>{started=resolve});
  const firstAllowed=new Promise(resolve=>{release=resolve});
  const context={Response,AbortSignal,console,fetch:async(_url,options)=>{
    const param=JSON.parse(options.body).param;calls.push(param.submissionId);
    if(param.submissionId==='report_first'){started();await firstAllowed;}
    return new Response(JSON.stringify({ok:true,submissionId:param.submissionId}));
  }};
  vm.createContext(context);vm.runInContext(read('services/cloudflare/chat-worker/src/index.js').replace('export default {','const worker = {'),context);
  const env={APP_SCRIPT_URL:'https://example.invalid',CHAT_ADMIN_TOKEN:'synthetic',CHAT_DB:{prepare:sql=>({args:[],bind(...args){this.args=args;return this},all:async function(){return {results:db.prepare(sql).all(...this.args)}},run:async function(){return {meta:{changes:db.prepare(sql).run(...this.args).changes}}}})}};
  try{
    const first=context.drainReportQueue(env);await firstStarted;
    await context.drainReportQueue(env);
    assert.deepEqual(calls,['report_first']);
    release();await first;
    assert.deepEqual(calls,['report_first','report_second']);
    assert.equal(db.prepare("SELECT count(*) AS n FROM report_submission_queue WHERE status='completed'").get().n,2);
  }finally{release();db.close();}
});
test('new Cloudflare identity grammar matches Apps Script before sheet synchronization',()=>{
  const x=apps(), context={Response,AbortSignal,console};
  vm.createContext(context);vm.runInContext(read('services/cloudflare/chat-worker/src/index.js').replace('export default {','const worker = {'),context);
  for(const name of ['Никита Иванов','Лиза Иванова','Саша Иванова','Артём Крылов','Незнакомое Имя']) assert.equal(context.parentChildGenitive_(name),x.parentChildGenitive_(name));
  for(const name of ['Анна','Андрей','Саша','Неизвестное']) assert.equal(context.defaultParentRelationship_(name),x.defaultParentRelationship_(name));
  assert.equal(context.inheritedChildFamily_('Никита','Иванова'),'Иванов');
});
test('website acknowledges Cloudflare acceptance without waiting for Apps Script',async()=>{
  const source=read('tutors/full-web.js');
  const fn=source.slice(source.indexOf('  async function submitReportPayload('),source.indexOf('  async function sendReport('));
  const context={tutorToken:'synthetic',d1Session:{token:'synthetic'},window:{MedsiOverlayTransport:true},MedsiOverlayTransport:{reportSubmit:async()=>({accepted:true})},callApi:()=>{throw new Error('Must not wait for Apps Script')},waitForReportAcceptance:()=>{throw new Error('Must not poll acceptance')}};
  vm.createContext(context);vm.runInContext(fn,context);
  assert.equal((await context.submitReportPayload('morning','Synthetic','report_synthetic')).accepted,true);
});
test('surname and relationship corrections preserve the chat and legacy login identity',async()=>{
  const {DatabaseSync}=require('node:sqlite'),db=new DatabaseSync(':memory:');
  db.exec("CREATE TABLE chat_profiles(phone10 TEXT PRIMARY KEY,parent_name TEXT,child_name TEXT,relationship TEXT,child_genitive TEXT); CREATE TABLE legacy_parent_access(phone10 TEXT PRIMARY KEY); CREATE TABLE chat_messages(phone10 TEXT,message TEXT);");
  db.prepare('INSERT INTO chat_profiles VALUES(?,?,?,?,?)').run('9990000001','Анна','Никита Иванова','Мама','');
  db.prepare('INSERT INTO legacy_parent_access VALUES(?)').run('9990000001');
  db.prepare('INSERT INTO chat_messages VALUES(?,?)').run('9990000001','Synthetic history');
  const wrap=sql=>({args:[],bind(...args){this.args=args;return this},run:async function(){return {meta:{changes:db.prepare(sql).run(...this.args).changes}}}});
  const context={Response,console};vm.createContext(context);vm.runInContext(read('services/cloudflare/chat-worker/src/index.js').replace('export default {','const worker = {'),context);
  try{
    const env={CHAT_DB:{prepare:wrap,batch:async statements=>Promise.all(statements.map(s=>s.run()))}};
    const response=await context.reconcileProfiles(new Request('https://example.invalid',{method:'POST',body:JSON.stringify({profiles:[{phone:'9990000001',parentName:'Анна',childName:'Никита Иванов',relationship:'Бабушка',childGenitive:'Никиты Иванова'}],full:false})}),env);
    assert.equal((await response.json()).ok,true);
    assert.equal(db.prepare('SELECT count(*) AS n FROM legacy_parent_access').get().n,1);
    assert.equal(db.prepare('SELECT count(*) AS n FROM chat_messages').get().n,1);
    assert.equal(db.prepare('SELECT relationship FROM chat_profiles').get().relationship,'Бабушка');
  }finally{db.close();}
});
test('missing initial is inferred only when exactly one distinct child remains',()=>{
  const cases=[
    {names:['Артем К.','Артем И.'],families:['Крылов','Иванов'],text:'Артем: Bare synthetic.\nАртем И.: Explicit synthetic.',infer:true},
    {names:['Артем К.','Артем И.','Артем К.'],families:['Крылов','Иванов','Крылов'],text:'Артем И.: Explicit synthetic.\nАртем: Bare synthetic.',infer:true},
    {names:['Артем К.','Артем И.','Артем С.'],families:['Крылов','Иванов','Смирнов'],text:'Артем: Bare synthetic.\nАртем И.: Explicit synthetic.',infer:false},
    {names:['Артем К.','Артем И.'],families:['Крылов','Иванов'],text:'Артем: Bare synthetic.\nАртем: Another bare.\nАртем И.: Explicit synthetic.',infer:false},
    {names:['Артем К.','Артем И.'],families:['Крылов','Иванов'],text:'Артем: Bare synthetic.\nАртем И.: Explicit synthetic.\nАртем И.: Duplicate.',infer:false},
    {names:['Артем К.','Артем И.'],families:['Крылов','Иванов'],text:'Артем: Bare synthetic.\nАртем И.: Explicit synthetic.\nАртем П.: Unknown initial.',infer:false},
    {names:['Артем К.','Артем И.','Артем С.','Артем П.','Артем Б.'],families:['Крылов','Иванов','Смирнов','Петров','Белов'],text:'Артем: Bare synthetic.\nАртем И.: Synthetic.\nАртем С.: Synthetic.\nАртем П.: Synthetic.\nАртем Б.: Synthetic.',infer:true}
  ];
  for(const item of cases){
    const x=apps(),children=x.buildReportChildren_(item.names,item.families);
    x.buildReportValidationChildren_=()=>children;
    const ctx=x.buildDistributionContext_(children,[]);
    const parsed=x.parseReportBlocks_(item.text,x.buildKnownBaseKeys_(children),ctx);
    const resolutions=x.resolveReportBlocksByExclusion_(parsed.blocks,ctx);
    const bare=resolutions[parsed.blocks.findIndex(b=>!b.hasSuffix)];
    assert.equal(bare.status==='ok',item.infer,item.text);
    const canonical=x.canonicalizeRawChildReport_(item.text);
    assert.equal(canonical.text.includes('Артем К. — Bare synthetic.'),item.infer,item.text);
    const distribution=x.buildSafeDistribution_('morning',parsed,ctx);
    assert.equal(Boolean(distribution.byRow[0]),item.infer,item.text);
    if(item.infer){
      assert.equal(x.validateChildReportFormat_('morning',item.text).ok,true);
      assert.equal(x.validateChildReportFormat_('morning',item.text).ambiguousNames.length,0);
    }
  }
});
test('older background submission cannot overwrite a newer manual publication',()=>{
  const x=apps();let value='';const cell={setValue:text=>{value=text}};
  assert.equal(x.saveRawReportPublication_('morning',cell,'New synthetic',200),true);
  assert.equal(x.saveRawReportPublication_('morning',cell,'Old retry synthetic',100),false);
  assert.equal(value,'New synthetic');
  assert.equal(x.saveRawReportPublication_('morning',cell,'Current retry synthetic',200),true);
  assert.equal(x.saveRawReportPublication_('evening',cell,'Independent evening synthetic',100),true);
});
test('parent deletion revokes D1 even if S3 purge credentials are missing',()=>{
  const x=apps(),properties=new Map(),calls=[];
  x.PropertiesService={getScriptProperties:()=>({getProperty:key=>properties.get(key),setProperty:(key,value)=>properties.set(key,value)})};
  vm.runInContext(read('apps-script/medsi-bot/chat-d1-migration.js'),x);
  x.getProfileByPhone_=()=>null;
  x.d1AdminRequest_=(path)=>{calls.push(path);return path.endsWith('profile-s3-keys')?{s3Keys:['synthetic.jpg']}:{ok:true}};
  const result=x.deleteD1ProfileWithS3Purge_('9990000001');
  assert.equal(result.ok,true);
  assert.ok(calls.includes('/admin/delete-profile-phone'));
  assert.equal(result.purge.ok,false);
  assert.equal(x.reportsS3PurgeQueue_()['9990000001'].phase,'d1-deleted');
  x.timewebReportsSyncRequest_=()=>({ok:true});
  assert.equal(x.flushReportsS3PurgeQueue_().ok,true);
  assert.equal(calls.filter(p=>p==='/admin/delete-profile-phone').length,1);
});
test('deletion without S3 attachments does not require Timeweb cleanup',()=>{
  const x=apps(),properties=new Map();
  x.PropertiesService={getScriptProperties:()=>({getProperty:key=>properties.get(key),setProperty:(key,value)=>properties.set(key,value)})};
  vm.runInContext(read('apps-script/medsi-bot/chat-d1-migration.js'),x);
  x.getProfileByPhone_=()=>null;x.d1AdminRequest_=()=>({ok:true,s3Keys:[]});
  assert.equal(x.deleteD1ProfileWithS3Purge_('9990000001').purge.ok,true);
  assert.deepEqual(Object.keys(x.reportsS3PurgeQueue_()),[]);
});
test('a delayed manual edit does not replace a cell that was edited again',()=>{
  const x=apps();let value='New manual synthetic';
  const cell={getValue:()=>value,setValue:text=>{value=text}};
  assert.equal(x.saveRawReportPublication_('morning',cell,'Old normalized synthetic',200,'Old manual synthetic'),false);
  assert.equal(value,'New manual synthetic');
});
test('expired educator caches fetch the current list and cannot resurrect a removed chat',async()=>{
  let now=0,calls=0;
  const transport={chats:async()=>({chats:++calls===1?[{phone:'9990000001'}]:[]}),thread:async()=>({messages:[]})};
  for(const key of ['sendMessage','markRead','markUnread','remove','pin'])transport[key]=async()=>({ok:true});
  const context={window:{MedsiOverlayTransport:transport},localStorage:{getItem:()=>null,setItem(){}},navigator:{},document:{hidden:false,addEventListener(){}},Date:{now:()=>now},setTimeout:()=>0,setInterval:()=>0,clearInterval(){}};
  vm.createContext(context);vm.runInContext(read('tutors/chat-prewarm.js'),context);
  const session={token:'synthetic'};
  assert.equal((await transport.chats(session,'read')).chats.length,1);
  now=1000;assert.equal((await transport.chats(session,'read')).chats.length,1);
  assert.equal(calls,1);
  now=4000;assert.equal((await transport.chats(session,'read')).chats.length,0);
  assert.equal(calls,2);
});

test('stale D1 profile cannot veto deletion after its REPORTS row was removed',()=>{
  const x=apps();vm.runInContext(read('apps-script/medsi-bot/chat-d1-migration.js'),x);
  x.getProfileByPhone_=()=>{throw new Error('Generic D1 fallback must not be used');};
  x.reportsD1ProfilesSnapshot_=()=>({});
  x.d1AdminRequest_=()=>({registrations:[]});
  assert.equal(x.reportsProfileDeletionProtected_('9990000001'),false);
  x.reportsD1ProfilesSnapshot_=()=>({'9990000001':{}});
  assert.equal(x.reportsProfileDeletionProtected_('9990000001'),true);
  x.reportsD1ProfilesSnapshot_=()=>({});
  x.d1AdminRequest_=()=>({registrations:[{phone10:'9990000001'}]});
  assert.equal(x.reportsProfileDeletionProtected_('9990000001'),true);
  const source=read('apps-script/medsi-bot/chat-d1-migration.js');
  assert.ok(source.includes('if (reportsProfileDeletionProtected_(phone)) return;'));
});
