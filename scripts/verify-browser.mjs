// 用法：HOT100_PLAYWRIGHT_MODULE=/绝对路径/playwright/index.mjs node scripts/verify-browser.mjs
// Playwright 仅用于验收，不加入应用依赖；先分别启动 npm run dev 与 npm run preview。
import assert from 'node:assert/strict';
import fs from 'node:fs';
const {chromium}=await import(process.env.HOT100_PLAYWRIGHT_MODULE || 'playwright');
const base=process.env.HOT100_DEV_URL || 'http://127.0.0.1:5173';
const production=process.env.HOT100_PREVIEW_URL || 'http://127.0.0.1:4173';
const output=process.env.HOT100_BROWSER_REPORT || '/tmp/hot100-browser-verification.json';
const modifier=process.platform === 'darwin' ? 'Meta' : 'Control';
const documentStart=process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home';
const documentEnd=process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End';
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1440,height:900},permissions:['clipboard-read','clipboard-write']});
const page=await context.newPage();const checks=[];const errors=[];const knownMonacoCancellations=[];
page.on('pageerror',e=>{
  const stack=e.stack||'';
  if(e.message==='Canceled' && /monaco|editor\.api/.test(stack) && /cancel/.test(stack) && /dispose|setModel/.test(stack)) knownMonacoCancellations.push({message:e.message,stack});
  else errors.push({message:e.message,stack});
});
async function check(name,fn){try{const detail=await fn();checks.push({name,passed:true,detail});}catch(e){checks.push({name,passed:false,error:e.stack});}}
const waitEditor=()=>page.locator('.monaco-editor').waitFor({timeout:60000});
const language=label=>page.locator('.editorControls .languageTabs').getByRole('tab',{name:label,exact:true}).click();
const mode=label=>page.locator('.editorControls .modeTabs').getByRole('button',{name:label,exact:true}).click();
const saved=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('hot100-study-planner-v3') || '{}'));
async function paste(code){
  await page.evaluate(text=>navigator.clipboard.writeText(text),code);
  await page.locator('.monaco-editor').click({position:{x:110,y:30}});
  await page.keyboard.press(`${modifier}+A`);await page.keyboard.press(`${modifier}+V`);
  await page.waitForFunction(text=>Object.values(JSON.parse(localStorage.getItem('hot100-study-planner-v3')||'{}').drafts||{}).some(q=>Object.values(q).some(l=>Object.values(l).some(m=>m.code===text))),code);
}
async function run(){const response=page.waitForResponse(r=>r.url().endsWith('/__runner')&&r.request().method()==='POST',{timeout:60000});await page.getByRole('button',{name:'运行公开示例',exact:true}).click();const result=await(await response).json();await page.getByRole('button',{name:'运行公开示例',exact:true}).waitFor();return result;}
async function open(id){await page.goto(`${base}/?question=${id}`);await waitEditor();}
async function newState(progress={}){await page.goto(base);await page.evaluate(progress=>{localStorage.clear();localStorage.setItem('hot100-study-planner-v3',JSON.stringify({version:3,progress}));},progress);await page.reload();}
try {
  await newState();
  await check('桌面七阶段四项横向对齐',async()=>{
    const boxes=await page.locator('.stageCounts').first().locator('div').evaluateAll(es=>es.map(e=>({x:e.getBoundingClientRect().x,y:e.getBoundingClientRect().y})));
    assert.equal(new Set(boxes.map(b=>Math.round(b.y))).size,1);assert.equal(new Set(boxes.map(b=>Math.round(b.x))).size,4);return boxes;
  });
  await check('新用户开始今日练习进入283且显示阶段和顺序',async()=>{
    await page.getByRole('button',{name:'开始今日练习',exact:true}).click();await waitEditor();assert.match(page.url(),/question=283/);assert.match(await page.locator('.practiceIdentity').innerText(),/阶段一.*学习顺序 1/);assert.match(await page.locator('.practiceIdentity').innerText(),/下一题：两数之和.*学习顺序 2/);
  });
  await check('第一题题面不生成空白段落',async()=>{
    const paragraphs=await page.locator('.statementText p').allTextContents();assert.ok(paragraphs.length);assert.ok(paragraphs.every(p=>p.trim()));assert.ok(paragraphs.every(p=>!/[\\$]|\n{3,}/.test(p)));
  });
  await check('四级提示有具体思路和保留缩进的伪代码',async()=>{
    await page.locator('.editorExtras summary').click();
    for(let level=1;level<=4;level++)await page.getByRole('button',{name:`我要提示（第 ${level} 级）`,exact:true}).click();
    const text=await page.locator('.hintList').innerText();assert.doesNotMatch(text,/\$|\\textit|先按输入顺序推进指针或状态|逐项读取输入并更新状态/);assert.match(text,/非零|零/);assert.ok((await page.locator('.hintPseudocode code').textContent()).split('\n').length>=4);
  });
  await check('下一题按studyOrder推进为1',async()=>{await page.getByRole('button',{name:'下一题 →',exact:true}).click();await waitEditor();assert.match(page.url(),/question=1$/);});
  for(const id of ['283','1','206','146'])for(const lang of ['Java','Python']){
    await check(`复制${id} ${lang}页面参考代码到函数模式通过`,async()=>{
      await open(id);await language(lang);await page.getByRole('tab',{name:'题解',exact:true}).click();
      const details=page.locator('.progressiveSolution details');for(let i=1;i<5;i++)await details.nth(i).locator('summary').click();
      const text=await page.locator('.solutionText,.solutionComplexity').allTextContents();assert.ok(text.every(t=>!/[\\$]|。{2}|\n{3,}/.test(t)));
      const code=await page.locator('.solutionLargeCode code').textContent();assert.ok(code);await paste(code);
      const r=await run();assert.equal(r.status,'passed',JSON.stringify(r));assert.match(await page.locator('.runPanel').innerText(),/示例通过/);return r.cases.map(c=>({id:c.caseId,status:c.status}));
    });
  }
  await check('编译错误保留javac具体诊断',async()=>{
    await open('283');await language('Java');await paste('class Solution { public void moveZeroes(int[] nums) { missingSymbol(); } }');const r=await run();assert.equal(r.cases[0].status,'compile_error');const text=await page.locator('.runPanel').innerText();assert.match(text,/编译错误/);assert.match(text,/Main.java:\d+/);assert.match(text,/missingSymbol/);
  });
  await check('结果不匹配单独显示',async()=>{
    await language('Python');await paste('class Solution:\n    def moveZeroes(self, nums):\n        pass\n');const r=await run();assert.equal(r.cases[0].status,'mismatch');assert.match(await page.locator('.runPanel').innerText(),/结果不匹配/);
  });
  await check('运行错误单独显示',async()=>{
    await paste('class Solution:\n    def moveZeroes(self, nums):\n        raise RuntimeError("browser-boom")\n');const r=await run();assert.equal(r.cases[0].status,'runtime_error');assert.match(await page.locator('.runPanel').innerText(),/运行错误.*|browser-boom/s);
  });
  await check('超时单独显示且下次仍可运行',async()=>{
    await paste('class Solution:\n    def moveZeroes(self, nums):\n        while True: pass\n');const r=await run();assert.equal(r.cases[0].status,'timeout');assert.match(await page.locator('.runPanel').innerText(),/运行超时/);await paste('class Solution:\n    def moveZeroes(self, nums):\n        nums[:] = [n for n in nums if n != 0] + [0] * nums.count(0)\n');assert.equal((await run()).status,'passed');
  });
  await check('Java/Python函数与ACM四份草稿刷新后独立恢复',async()=>{
    const records=[['Java','函数','java','function','// JAVA_FUNCTION\nclass Solution {}'],['Python','函数','python','function','# PYTHON_FUNCTION\nclass Solution:\n    pass\n'],['Java','ACM','java','acm','// JAVA_ACM\npublic class Main {}'],['Python','ACM','python','acm','# PYTHON_ACM\nprint("ok")\n']];
    for(const [lang,m,,,code]of records){await language(lang);await mode(m);await paste(code);}
    await page.reload();await waitEditor();
    for(const [lang,m,l,key,code]of records){await language(lang);await mode(m);const state=await saved();assert.equal(state.drafts['283'][l][key].code,code);await page.waitForFunction(marker=>document.querySelector('.monaco-editor .view-lines')?.innerText.includes(marker),code.split('\n')[0].slice(3));}
    return records.map(r=>`${r[2]}/${r[3]}`);
  });
  await check('ACM使用标准输入样例且两语言均可运行',async()=>{
    await mode('ACM');await language('Python');
    await paste('import re, sys\nnums = list(map(int, re.findall(r"-?\\d+", sys.stdin.read())))\nresult = [n for n in nums if n != 0] + [0] * nums.count(0)\nprint("[" + ",".join(map(str, result)) + "]")\n');
    let r=await run();assert.equal(r.status,'passed',JSON.stringify(r));
    await language('Java');await paste('import java.util.*;\npublic class Main { public static void main(String[] args) { Scanner in=new Scanner(System.in).useDelimiter("[^0-9-]+"); List<Integer> values=new ArrayList<>(); int zero=0; while(in.hasNext()){if(in.hasNextInt()){int n=in.nextInt();if(n==0)zero++;else values.add(n);}else in.next();} while(zero-->0)values.add(0); System.out.println(values.toString().replace(" ","")); } }');
    r=await run();assert.equal(r.status,'passed',JSON.stringify(r));
  });
  await check('桌面长代码独立滚动，左侧位置不动',async()=>{
    await language('Java');await mode('函数');await paste(Array.from({length:160},(_,i)=>`// line ${i}`).join('\n'));
    await page.locator('.monaco-editor').click({position:{x:110,y:30}});await page.keyboard.press(documentStart);await page.waitForTimeout(300);
    const left=await page.locator('.statementPane').evaluate(e=>e.scrollTop);
    const before=await page.locator('.view-lines').evaluate(e=>e.getBoundingClientRect().top);
    await page.locator('.monaco-editor').hover();await page.mouse.wheel(0,500);await page.waitForTimeout(300);
    const after=await page.locator('.view-lines').evaluate(e=>e.getBoundingClientRect().top);
    assert.ok(after<before);assert.equal(await page.locator('.statementPane').evaluate(e=>e.scrollTop),left);assert.equal(await page.evaluate(()=>scrollY),0);
  });
  await check('桌面题面和题解独立滚动，右侧始终可见',async()=>{
    for(const tab of ['题目','题解']){
      await page.getByRole('tab',{name:tab,exact:true}).click();const pane=page.locator('.statementPane');
      if(tab==='题解')for(const d of await page.locator('.progressiveSolution details').all())if(await d.getAttribute('open')===null)await d.locator('summary').click();
      await pane.evaluate(e=>{e.scrollTop=0;});await pane.hover();await page.mouse.wheel(0,600);await page.waitForTimeout(300);
      assert.ok(await pane.evaluate(e=>e.scrollTop>0));const right=await page.locator('.editorPane').boundingBox();assert.ok(right.y>=72&&right.y+right.height<=900);assert.equal(await page.evaluate(()=>scrollY),0);
    }
  });
  await check('到期复习不抢占主线；完成第一阶段才进入第二阶段',async()=>{
    const h=JSON.parse(fs.readFileSync(new URL('../src/data/hot100.json',import.meta.url)));const p={'283':{status:'completed'},'146':{status:'completed',reviewAt:'2020-01-01T00:00:00.000Z'}};
    await newState(p);assert.match(await page.locator('.dashboardGrid').innerText(),/今日复习[\s\S]*LRU/);await page.getByRole('button',{name:'开始今日练习',exact:true}).click();await waitEditor();assert.match(page.url(),/question=1$/);
    for(const q of h.questions.filter(q=>q.phase.startsWith('阶段一')))p[q.id]={status:'completed',reviewAt:'2020-01-01T00:00:00.000Z'};
    await newState(p);await page.getByRole('button',{name:'开始今日练习',exact:true}).click();await waitEditor();assert.match(page.url(),/question=11$/);
  });
  await check('阶段跳转和题库顺序练习可用',async()=>{
    await newState();await page.getByRole('button',{name:'查看本阶段题目',exact:true}).nth(0).click();assert.equal(await page.locator('.problemCard').count(),13);await page.getByRole('button',{name:'按顺序练习',exact:true}).click();await waitEditor();assert.match(page.url(),/question=283$/);await page.locator('nav').getByRole('button',{name:'题库',exact:true}).click();assert.equal(await page.locator('.problemCard').count(),100);
  });
  await check('移动端题面、题解、编辑器无横向溢出',async()=>{
    for(const width of [390,320]){await page.setViewportSize({width,height:844});await open('146');for(const tab of ['题目','题解']){await page.getByRole('tab',{name:tab,exact:true}).click();if(tab==='题解')await page.locator('.progressiveSolution details').nth(4).locator('summary').click();const dimensions=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}));assert.ok(dimensions.scroll<=dimensions.client,JSON.stringify(dimensions));}}
  });
  await check('生产静态页面正常阅读，明确提示本地运行且按钮禁用',async()=>{
    await page.goto(`${production}/?question=283`);await waitEditor();assert.match(await page.locator('.runnerNotice').innerText(),/本地开发环境/);assert.ok(await page.getByRole('button',{name:'运行公开示例',exact:true}).isDisabled());
  });
} finally {await browser.close();}
const report={checks,errors,knownMonacoCancellations,passed:checks.filter(c=>c.passed).length,total:checks.length};fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));process.exitCode=errors.length||checks.some(c=>!c.passed)?1:0;
