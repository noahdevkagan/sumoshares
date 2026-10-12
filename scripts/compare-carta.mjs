// Compare the app's own cap table math against Carta's Cap Table and Options Outstanding exports, holder by holder and grant by grant.
// Usage: node --experimental-strip-types scripts/compare-carta.mjs <folder-with-carta-exports> [--remote]
import { buildCapTable, optionBalance } from '../src/logic.ts';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module'; const XLSX = createRequire(import.meta.url)('xlsx');
import * as fs from 'node:fs';

const q = (s) => { const o = execSync(`npx wrangler d1 execute sumoshares ${process.argv.includes('--remote') ? '--remote' : '--local'} --json --command "${s}"`, { encoding: 'utf8', stdio: ['ignore','pipe','ignore'] }); return JSON.parse(o.slice(o.indexOf('[')))[0].results; };
const H=q('SELECT * FROM stakeholders'),C=q('SELECT * FROM stock_classes'),P=q('SELECT * FROM plans'),S=q('SELECT * FROM securities'),T=q('SELECT * FROM transactions');
const cap=buildCapTable(H,C,P,S,T,new Date().toISOString().slice(0,10));
console.log('APP FD',cap.fullyDiluted,'plans',cap.plans.map(p=>[p.outstanding,p.available]));
const DIR = process.argv[2] || '.'; const pick = (re) => fs.readdirSync(DIR).find((f) => re.test(f) && f.endsWith('.xlsx')); const wb=XLSX.readFile(DIR + '/' + pick(/cap.?table/i));
const r=XLSX.utils.sheet_to_json(wb.Sheets['Detailed Cap Table'],{header:1,raw:false,defval:''});const h=r.findIndex(x=>x.includes('Stakeholder ID'));
const hdr=r[h];const fdI=hdr.findIndex(x=>/^Fully Diluted Shares/.test(x));
let diffs=0;for(const row of r.slice(h+1)){const id=row[0];if(!id||!/^[0-9a-f]{32}$/.test(id))continue;const want=Math.round(+String(row[fdI]).replace(/,/g,''));const sh=H.find(x=>x.external_id==='carta:'+id);const got=cap.byHolder.find(x=>x.holder.id===sh?.id)?.fd||0;if(got!==want){diffs++;console.log('HOLDER DIFF',row[1],'app',got,'carta',want)}}
console.log('holder diffs',diffs);
const wb2=XLSX.readFile(DIR + '/' + pick(/options.?outstanding/i));
const r2=XLSX.utils.sheet_to_json(wb2.Sheets['Options Outstanding Report'],{raw:false,defval:''});
let gd=0;for(const g of r2){const s=S.find(x=>x.label===g['Security ID']);if(!s)continue;const h=H.find(x=>x.id===s.stakeholder_id);const b=optionBalance(s,T,new Date().toISOString().slice(0,10),h.termination_date);const want=Math.round(+String(g['Quantity Exercisable']).replace(/,/g,''));const wo=Math.round(+String(g['Quantity Outstanding']).replace(/,/g,''));if(b.exercisable!==want||b.outstanding!==wo){gd++;console.log('GRANT DIFF',g['Security ID'],g['Stakeholder Name'],'app exer',b.exercisable,'carta',want,'| out',b.outstanding,wo,'| term',h.termination_date,'| sched',g['Vesting Schedule'])}}
console.log('grants checked',r2.length,'diffs',gd);
