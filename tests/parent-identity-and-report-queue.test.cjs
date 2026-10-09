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
  const children=x.buildReportChildren_(['Артем К.','Артем И.','Лиза П.'],['Крылов','Иванов','Петрова']);
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
