const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const crypto=require('node:crypto');
const path=require('node:path');
const dir=path.join(__dirname,'..','apps-script','medsi-bot');
function fixture(hour=12){
  const props=new Map(),calls=[];let sequence=0;
  const rows=[['9990000011','Synthetic','Катя','Громова','','','','admission-one','']];
  const sheet={getLastRow:()=>rows.length+1,getRange:()=>({getValues:()=>rows,getValue:()=> 'Synthetic group report'}),getDataRange:()=>({getValues:()=>[['base','alias']]})};
  const lock={waitLock(){},tryLock:()=>true,releaseLock(){}};
  const context={SHEET_MORNING:'MORNING',SHEET_EVENING:'EVENING',SHEET_PSYCHOLOGY:'PSYCHOLOGY',Logger:{log(){}},PropertiesService:{getScriptProperties:()=>({getProperty:key=>props.get(key)||null,getProperties:()=>Object.fromEntries(props),setProperty:(key,value)=>props.set(key,value)})},LockService:{getUserLock:()=>lock},Utilities:{getUuid:()=>String(++sequence),formatDate:()=>String(hour)},getDataSheet_:()=>sheet,getSheet_:()=>sheet,getLatestReport:()=> 'Synthetic',reportFingerprint_:value=>crypto.createHash('sha256').update(value).digest('hex'),last10_:value=>String(value).slice(-10),reportHistoryDate_:()=> '2026-10-22',reportHistoryPublicationMatches_:()=>false,reportsD1ProfilesSnapshot_:()=>({synthetic:{childAdmissionId:'admission-one'}}),syncReportHistoryPublicationFromSource_(){},syncReportInactivityState_:updates=>calls.push({kind:'inactivity',updates}),syncD1CurrentReportsToWorker_:(kind,publication)=>calls.push({kind:'delivery',reportKind:kind,publication})};
  vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(dir,'report-scheduler.js'),'utf8'),context);
  context.syncD1ProfilesFromReports=()=>{calls.push({kind:'profiles'});return {ok:true}};
  context.distributeChildReports=()=>{calls.push({kind:'distribution'});return {ok:true,skipped:true}};
  return {context,props,rows,calls};
}
test('daytime fallback is disabled 00:00–06:59 Moscow without touching sheets or Cloudflare',()=>{
  for(const hour of [0,1,6]){const f=fixture(hour);assert.equal(f.context.runScheduledMedsiMaintenance().reason,'night');assert.equal(f.calls.length,0);}
  for(const hour of [7,12,23])assert.equal(fixture(hour).context.reportMaintenanceDaytime_(),true);
});
test('daytime fallback coordinates profile recovery, report check and group delivery',()=>{
  const f=fixture();assert.equal(f.context.runScheduledMedsiMaintenance().ok,true);
  assert.equal(f.calls.filter(x=>x.kind==='profiles').length,1);assert.equal(f.calls.filter(x=>x.kind==='distribution').length,1);
  assert.equal(f.calls.filter(x=>x.kind==='delivery').length,1);
  assert.equal(f.calls.find(x=>x.kind==='delivery').reportKind,'psychology');
  f.context.runScheduledMedsiMaintenance();assert.equal(f.calls.filter(x=>x.kind==='delivery').length,1);
});
test('a late completion cannot acknowledge a newer delivery request',()=>{
  const f=fixture();f.context.queueReportPostCommitSync_([],[],['morning']);
  f.context.syncD1CurrentReportsToWorker_=()=>f.context.queueReportPostCommitSync_([],[],['evening']);
  f.context.flushPendingReportPostCommitSync_();
  assert.notEqual(JSON.parse(f.props.get('REPORT_POST_COMMIT_REQUEST')).token,f.props.get('REPORT_POST_COMMIT_COMPLETED'));
});
test('delivery failures keep the durable request pending and require no new report submission',()=>{
  const f=fixture();f.context.queueReportPostCommitSync_([],[],['morning']);
  f.context.syncD1CurrentReportsToWorker_=()=>{throw new Error('offline')};assert.equal(f.context.flushPendingReportPostCommitSync_().pending,true);
  const requested=JSON.parse(f.props.get('REPORT_POST_COMMIT_REQUEST')).token;
  assert.notEqual(requested,f.props.get('REPORT_POST_COMMIT_COMPLETED'));
  f.context.syncD1CurrentReportsToWorker_=()=>{};assert.equal(f.context.flushPendingReportPostCommitSync_().ok,true);
  assert.equal(requested,f.props.get('REPORT_POST_COMMIT_COMPLETED'));
});
test('a deferred reminder cannot be transferred to a new admission reusing the phone',()=>{
  const f=fixture();f.context.queueReportPostCommitSync_([{phone:'9990000011',hasNewReport:true}],[],['morning']);
  f.rows[0][7]='admission-two';f.context.flushPendingReportPostCommitSync_();
  assert.equal(f.calls.filter(x=>x.kind==='inactivity').length,0);
});
test('merging a new request does not carry old admission reminder flags into a new family',()=>{
  const f=fixture();f.context.queueReportPostCommitSync_([{phone:'9990000011',hasNewReport:true}],[],['morning']);
  f.rows[0][7]='admission-two';f.context.queueReportPostCommitSync_([],[],['evening']);f.context.flushPendingReportPostCommitSync_();
  assert.equal(f.calls.filter(x=>x.kind==='inactivity').length,0);
});
test('an active delivery lease prevents parallel network snapshots',()=>{
  const f=fixture();f.context.queueReportPostCommitSync_([],[],['morning']);
  f.props.set('REPORT_POST_COMMIT_LEASE',JSON.stringify({token:'other',until:Date.now()+60000}));
  assert.equal(f.context.flushPendingReportPostCommitSync_().pending,true);assert.equal(f.calls.length,0);
});
test('timer migration removes old distribution clocks, keeps actual retry jobs and installs one 10-minute fallback',()=>{
  const f=fixture(),triggers=[],created=[];
  for(const handler of ['distributeChildReports','distributeChildReports','syncD1ProfilesFromReports','retryPendingReportsD1ProfileSync','syncMedsiParentContacts'])triggers.push({getHandlerFunction:()=>handler});
  f.context.ScriptApp={getProjectTriggers:()=>[...triggers],deleteTrigger:t=>triggers.splice(triggers.indexOf(t),1),newTrigger(handler){const b={timeBased:()=>b,everyMinutes:n=>{b.minutes=n;return b},create:()=>{created.push({handler,minutes:b.minutes});triggers.push({getHandlerFunction:()=>handler})}};return b}};
  f.context.ensureReportMaintenanceClock_();f.context.ensureReportMaintenanceClock_();
  assert.equal(created.length,1);assert.equal(created[0].minutes,10);
  assert.deepEqual(triggers.map(t=>t.getHandlerFunction()).sort(),['retryPendingReportsD1ProfileSync','runScheduledMedsiMaintenance','syncMedsiParentContacts'].sort());
});
test('manual alias edits request distribution without pretending to be a new publication',()=>{
  const f=fixture();vm.runInContext(fs.readFileSync(path.join(dir,'chat-d1-migration.js'),'utf8'),f.context);
  const args=[];f.context.distributeChildReports=(...values)=>args.push(values);
  f.context.onReportsD1Edit({range:{getSheet:()=>({getName:()=> 'NAME_VARIANTS'}),getRow:()=>2,getColumn:()=>1}});
  assert.equal(args.length,1);assert.equal(args[0].length,0);
});

test('a failing profile service cannot prevent the independent report safety check',()=>{
  const f=fixture();f.context.syncD1ProfilesFromReports=()=>{throw new Error('profiles offline')};
  assert.equal(f.context.runScheduledMedsiMaintenance().ok,false);
  assert.equal(f.calls.filter(x=>x.kind==='distribution').length,1);
});
test('an unchanged completed request performs no lease writes or network operations',()=>{
  const f=fixture();f.context.queueReportPostCommitSync_([],[],['morning']);f.context.flushPendingReportPostCommitSync_();
  const before=JSON.stringify([...f.props]);const calls=f.calls.length;
  assert.equal(f.context.flushPendingReportPostCommitSync_().skipped,true);
  assert.equal(JSON.stringify([...f.props]),before);assert.equal(f.calls.length,calls);
});
