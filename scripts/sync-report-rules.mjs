import { readFileSync, writeFileSync } from 'node:fs';
const source = new URL('../tutors/report-validation.js', import.meta.url);
const target = new URL('../apps-script/medsi-bot/report-rules.js', import.meta.url);
writeFileSync(target, readFileSync(source));
console.log('Report rules synchronized for Apps Script.');
