// 真实调用本机 javac/java/python3 执行参考代码；不使用客户端预填的 actual。
import fs from 'node:fs';
import { loadContent } from './validate-schema.mjs';
import { runExample } from '../src/services/runner.js';
const {hot100,solutions}=loadContent();
const ids=process.argv.find(arg=>arg.startsWith('--ids='))?.slice(6).split(',');
const results=[];
const ordered=solutions.filter(s=>!ids||ids.includes(s.id)).sort((a,b)=>hot100.questions.find(q=>q.id===a.id).studyOrder-hot100.questions.find(q=>q.id===b.id).studyOrder);
for(const solution of ordered)for(const language of ['java','python']){
  const result=await runExample({questionId:solution.id,language,mode:'function',func:solution.func,code:solution[language],cases:solution.cases});
  results.push({id:solution.id,language,...result});
  if(result.status!=='passed')console.error(`${solution.id} ${language}: ${JSON.stringify(result)}`);
}
const passed=results.filter(r=>r.status==='passed').length;
const report=process.env.HOT100_REFERENCE_REPORT || '/tmp/hot100-reference-verification.json';
fs.writeFileSync(report,JSON.stringify({total:results.length,passed,results},null,2)+'\n');
console.log(`${passed}/${results.length} 组参考代码通过，${results.reduce((sum,r)=>sum+(r.cases?.length||0),0)} 个真实执行用例；报告：${report}`);
process.exitCode=passed===results.length?0:1;
