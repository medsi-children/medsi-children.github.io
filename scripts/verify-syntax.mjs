import {execFileSync, spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';

// Parse every versioned executable source, including inline HTML scripts.
// No application code is executed and no production service is contacted.
const files=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
let checked=0;
for(const file of files){
  if(file.startsWith('archive/'))continue;
  const units=[];
  if(/\.(?:js|cjs|mjs)$/.test(file))units.push({label:file,code:readFileSync(file,'utf8')});
  if(file.endsWith('.html')){
    const html=readFileSync(file,'utf8');
    for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)){
      if(/\bsrc\s*=|application\/(?:json|ld\+json)/i.test(match[1])||!match[2].trim())continue;
      units.push({label:file+':'+html.slice(0,match.index).split('\n').length,code:match[2]});
    }
  }
  for(const unit of units){
    const result=spawnSync(process.execPath,['--check','--input-type=module'],{input:unit.code,encoding:'utf8'});
    if(result.status!==0)throw new Error(unit.label+'\n'+(result.stderr||result.error||'Syntax check failed'));
    checked++;
  }
}
console.log('Syntax OK: '+checked+' executable sources (archive preserved and excluded).');
