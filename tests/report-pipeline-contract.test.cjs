const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const directory=path.join(__dirname,'..','apps-script','medsi-bot');
const missing='Пока ещё нет отчёта 🙏';
function fixture(children){
  const properties=new Map([['MEDSI_SPREADSHEET_ID','synthetic']]);
  const writes=[],effects=[];
  function sheet(name,rows){const notes=new Map();return {name,rows,notes,getName:()=>name,getLastRow:()=>rows.length,getDataRange:()=>({getValues:()=>rows.map(row=>row.slice())}),getRange(r,c,n=1,m=1){const get=()=>Array.from({length:n},(_,i)=>Array.from({length:m},(_,j)=>rows[r+i-1]?.[c+j-1]??''));return {getValues:get,getValue:()=>get()[0][0],setValues(value){writes.push({name,r,c,n,m});value.forEach((row,i)=>row.forEach((v,j)=>{rows[r+i-1]||=[];rows[r+i-1][c+j-1]=v}));},setValue(value){this.setValues(Array.from({length:n},()=>Array(m).fill(value)))},setNote(value){notes.set(r+':'+c,value)},clearNote(){notes.delete(r+':'+c)}}}};}
  const reports=sheet('REPORTS',[['phone','parent','child','family','morning','evening'],...children.map((child,i)=>[child.phone||('8999000000'+(i+1)),'Synthetic',child.name,child.family,'','','',''])]);
  const morning=sheet('MORNING',[['']]),evening=sheet('EVENING',[['']]);
  const variants=sheet('NAME_VARIANTS',[['base','aliases'],['Катя','Екатерина'],['Саша','Александр, Александра'],['Тая','Таисия, Тася']]);
  const sheets={REPORTS:reports,MORNING:morning,EVENING:evening,NAME_VARIANTS:variants};
  const lock={waitLock(){effects.push('lock')},releaseLock(){effects.push('unlock')}};
  const context={Logger:{log(){}},SpreadsheetApp:{openById:()=>({getSheetByName:name=>sheets[name]||null})},PropertiesService:{getScriptProperties:()=>({getProperty:key=>properties.get(key)||'',getProperties:()=>Object.fromEntries(properties),setProperty:(key,value)=>properties.set(key,value)})},Utilities:{DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:(_,s)=>Array.from(crypto.createHash('sha256').update(s).digest()),base64EncodeWebSafe:bytes=>Buffer.from(bytes).toString('base64url'),formatDate:()=> '2026-10-22'},LockService:{getUserLock:()=>lock}};
  vm.createContext(context);
  for(const file of ['report-rules.js','report-names.js','report-parser.js','report-distribution.js','report-history.js','Медси бот.js'])vm.runInContext(fs.readFileSync(path.join(directory,file),'utf8'),context);
  Object.assign(context,{removeLegacyDistributionLogSheet_(){},syncReportHistoryPublicationFromSource_(kind){effects.push('history:'+kind)},syncReportNotificationState_(){effects.push('notifications')},syncReportInactivityState_(){effects.push('inactivity')},syncD1CurrentReportsToWorker_(){effects.push('d1')}});
  function publish(kind,text){sheets[kind==='morning'?'MORNING':'EVENING'].rows[0][0]=text;context.rememberRawReportPublicationOwnership_(kind,text,text);}
  function output(){return reports.rows.slice(1).map(row=>[row[0],row[4],row[5]])}
  return {context,reports,sheets,properties,writes,effects,publish,output};
}
const cases=[
  {name:'aliases and two parents of one child',children:[{name:'Екатерина Г',family:'Громова'},{name:'Екатерина Г',family:'Громова'},{name:'Таисия Т',family:'Тестовая'}],raw:'Катя Г: Синтетический блок К.\nТася Т: Синтетический блок Т.',expected:['Екатерина: Синтетический блок К.','Екатерина: Синтетический блок К.','Таисия: Синтетический блок Т.']},
  {name:'explicit opposite forms and equal surname initials',children:[{name:'Александра Б',family:'Бурова'},{name:'Александр Б',family:'Березкин'}],raw:'Александра Б: Синтетический блок девочки.\nАлександр Б: Синтетический блок мальчика.',expected:['Александра: Синтетический блок девочки.','Александр: Синтетический блок мальчика.']},
  {name:'ambiguous short name stays unassigned',children:[{name:'Саша Б',family:'Бурова'},{name:'Саша Б',family:'Березкин'},{name:'Таисия Т',family:'Тестовая'}],raw:'Саша Б: Неоднозначный синтетический блок.\nТася Т: Однозначный синтетический блок.',expected:[missing,missing,'Таисия: Однозначный синтетический блок.']}
];
for(const item of cases)for(const kind of ['morning','evening'])test(`both report writers agree: ${item.name}, ${kind}`,()=>{
  const normal=fixture(item.children),maintenance=fixture(item.children);
  for(const f of [normal,maintenance])f.publish(kind,item.raw);
  normal.context.distributeChildReports(kind);
  const result=maintenance.context.redistributeChildReportKindMaintenanceCore_(kind);
  assert.equal(result.ok,true);
  const column=kind==='morning'?1:2;
  assert.deepEqual(normal.output().map(row=>row[column]),item.expected);
  assert.deepEqual(maintenance.output().map(row=>row[column]),item.expected);
  assert.ok(!maintenance.writes.some(w=>w.name==='REPORTS'&&(kind==='morning'?w.c===6:w.c===5)));
});
test('roster permutations cannot redirect reports or grow ownership on a repeated minute tick',()=>{
  const children=[{name:'Саша Б',family:'Бурова',phone:'89990000001'},{name:'Саша Б',family:'Березкин',phone:'89990000002'},{name:'Екатерина Г',family:'Громова',phone:'89990000003'}];
  const raw='Саша Бу: Девочка, синтетический блок.\nСаша Бе: Мальчик, синтетический блок.\nКатя Г: Екатерина, синтетический блок.';
  const permutations=[[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
  const expected=new Map();
  for(const order of permutations){
    const f=fixture(order.map(i=>children[i]));f.publish('evening',raw);f.context.distributeChildReports('evening');
    const ownersBefore=[...f.properties].filter(([key])=>key.startsWith('RAW_REPORT_OWNER_'));
    const first=f.output();f.context.distributeChildReports('evening');
    assert.deepEqual(f.output(),first);
    assert.deepEqual([...f.properties].filter(([key])=>key.startsWith('RAW_REPORT_OWNER_')),ownersBefore);
    first.forEach(([phone,,text])=>{assert.notEqual(text,missing);if(expected.has(phone))assert.equal(text,expected.get(phone));else expected.set(phone,text)});
  }
});
test('shared kind planner is repeatable and has no Sheets or ownership side effects',()=>{
  const f=fixture([{name:'Екатерина Г',family:'Громова',phone:'89990000001'}]);
  const children=f.context.buildReportValidationChildren_();
  const contextByBase=f.context.buildDistributionContext_(children,[]);
  const before=[...f.properties];
  const first=f.context.computeReportKindPlan_('morning','Катя Г: Синтетический текст.',children,contextByBase);
  const second=f.context.computeReportKindPlan_('morning','Катя Г: Синтетический текст.',children,contextByBase);
  assert.equal(first.ok,true);
  assert.deepEqual(JSON.parse(JSON.stringify(first.distribution)),JSON.parse(JSON.stringify(second.distribution)));
  assert.deepEqual([...f.properties],before);
  assert.deepEqual(f.writes,[]);
  assert.equal(f.context.computeReportKindPlan_('night','',children,contextByBase).ok,false);
});
test('a raw edit during distribution cancels stale sheet writes and ownership records',()=>{
  for(const maintenance of [false,true]){
    const f=fixture([{name:'Екатерина Г',family:'Громова',phone:'89990000001'}]);
    const sheet=f.sheets.MORNING;
    const original='Катя Г: Старый синтетический текст.';
    f.publish('morning',original);
    const ownersBefore=[...f.properties].filter(([key])=>key.startsWith('RAW_REPORT_OWNER_'));
    const plan=f.context.planRawReportOwnershipGuard_.bind(f.context);
    let changed=false;
    f.context.planRawReportOwnershipGuard_=function(...args){
      const result=plan(...args);
      if(!changed){sheet.rows[0][0]='Катя Г: Новый синтетический текст.';changed=true;}
      return result;
    };
    if(maintenance){
      assert.throws(()=>f.context.redistributeChildReportKindMaintenanceCore_('morning'),/исходный отчёт изменился/i);
    }else{
      assert.throws(()=>f.context.distributeChildReports('morning'),/исходный отчёт изменился/i);
    }
    assert.deepEqual(f.writes.filter(write=>write.name==='REPORTS'&&(write.c===5||write.c===6)),[]);
    assert.deepEqual([...f.properties].filter(([key])=>key.startsWith('RAW_REPORT_OWNER_')),ownersBefore);
    assert.deepEqual(f.effects.filter(effect=>effect.startsWith('history:')),[]);
  }
});
test('discharge followed by a namesake arrival stays blocked through both complete writers',()=>{
  const old={name:'Саша Б',family:'Бурова',phone:'89990000001'};
  for(const maintenance of [false,true]){
    const f=fixture([old]);f.publish('evening','Саша Б: Старый синтетический текст.');f.context.distributeChildReports('evening');
    assert.notEqual(f.output()[0][2],missing);
    f.reports.rows[1]=['89990000002','Synthetic','Саша Б','Березкин','','','',''];
    if(maintenance)f.context.redistributeChildReportKindMaintenanceCore_('evening');else f.context.distributeChildReports('evening');
    assert.equal(f.output()[0][2],missing);
    assert.equal(f.context.buildParentReportSnapshot_('89990000002','evening',false).hasReport,false);
  }
});

test('roster maintenance keeps the ownership warning when a namesake admission is blocked',()=>{
  const f=fixture([{name:'Екатерина Г',family:'Громова',phone:'89990000001'}]);
  f.publish('evening','Катя Г: Старый синтетический текст.');
  f.context.distributeChildReports('evening');
  f.reports.rows[1]=['89990000002','Synthetic','Екатерина Г','Громова','','','',''];
  const previous={'9990000001':{phone:'9990000001',reportChildName:'Екатерина Г',familyName:'Громова',childName:'Екатерина Громова'}};
  const result=f.context.maintainRawReportsAfterProfilesChangeCore_(previous,'synthetic');
  assert.equal(f.output()[0][2],missing);
  assert.match(f.sheets.EVENING.notes.get('1:1')||'',/сохранённый владелец/);
  assert.equal(result.blocked,1);
});
test('a valid new publication clears the old ownership warning and remains readable',()=>{
  const f=fixture([{name:'Екатерина Г',family:'Громова',phone:'89990000001'}]);
  f.publish('evening','Катя Г: Старый синтетический текст.');f.context.distributeChildReports('evening');
  f.reports.rows[1]=['89990000002','Synthetic','Екатерина Г','Громова','','','',''];
  f.context.maintainRawReportsAfterProfilesChangeCore_({},'synthetic');
  assert.match(f.sheets.EVENING.notes.get('1:1')||'',/сохранённый владелец/);
  f.publish('evening','Катя Г: Новый синтетический текст.');
  const result=f.context.maintainRawReportsAfterProfilesChangeCore_({},'synthetic');
  assert.equal(result.blocked,0);
  assert.equal(f.sheets.EVENING.notes.get('1:1')||'','');
  assert.equal(f.context.buildParentReportSnapshot_('89990000002','evening',false).hasReport,true);
  assert.match(f.output()[0][2],/Новый синтетический текст/);
});
