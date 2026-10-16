// 先运行 npm run dev；Playwright 作为验收工具，不加入产品依赖。
// HOT100_PLAYWRIGHT_MODULE=/绝对路径/playwright/index.mjs node scripts/verify-practice-layout.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
const { chromium } = await import(process.env.HOT100_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.HOT100_DEV_URL || 'http://127.0.0.1:5173';
const screenshot = process.env.HOT100_LAYOUT_SCREENSHOT || '/tmp/hot100-side-by-side.png';
const browser = await chromium.launch({headless:true});
const context = await browser.newContext({viewport:{width:1440,height:900},permissions:['clipboard-read','clipboard-write']});
const page = await context.newPage();
const checks = [], errors = [], cancellations = [];
page.on('pageerror', error => {
  const stack = error.stack || '';
  if(error.message === 'Canceled' && /monaco|editor\.api/.test(stack) && /cancel/.test(stack) && /dispose|setModel/.test(stack)) cancellations.push(error.message);
  else errors.push({message:error.message,stack});
});
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
const startKey = process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home';
const endKey = process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End';
const pause = () => page.waitForTimeout(300);
const editor = () => page.locator('.monaco-editor');
const language = label => page.locator('.editorControls .languageTabs').getByRole('tab',{name:label,exact:true}).click();
const mode = label => page.locator('.editorControls .modeTabs').getByRole('button',{name:label,exact:true}).click();
async function focusEditor(){await editor().click({position:{x:110,y:30}});}
async function paste(code, lang='java', codeMode='function'){
  await page.evaluate(text=>navigator.clipboard.writeText(text),code);
  await focusEditor();await page.keyboard.press(`${modifier}+A`);await page.keyboard.press(`${modifier}+V`);
  await page.waitForFunction(({code,lang,codeMode})=>JSON.parse(localStorage.getItem('hot100-study-planner-v3')||'{}').drafts?.['283']?.[lang]?.[codeMode]?.code===code,{code,lang,codeMode});
}
async function run(){const response=page.waitForResponse(r=>r.url().endsWith('/__runner')&&r.request().method()==='POST');await page.getByRole('button',{name:'运行公开示例',exact:true}).click();const result=await(await response).json();await page.getByRole('button',{name:'运行公开示例',exact:true}).waitFor();return result;}
async function geometry(){return page.evaluate(()=>{
  const rect=s=>{const e=document.querySelector(s),r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height,width:r.width,scrollTop:e.scrollTop,scrollHeight:e.scrollHeight,clientHeight:e.clientHeight,overflow:getComputedStyle(e).overflowY};};
  return {viewport:innerHeight,pageY:scrollY,pageHeight:document.documentElement.scrollHeight,left:rect('.statementPane'),right:rect('.editorPane'),editor:rect('.monacoHost'),actions:rect('.editorActions'),toolbar:rect('.practiceBar'),backup:rect('.backupPanel')};
});}
async function assertVisible(){const g=await geometry();assert.ok(g.editor.height>=85,JSON.stringify(g));assert.ok(g.editor.top>=g.toolbar.bottom,JSON.stringify(g));assert.ok(g.actions.bottom<=g.right.bottom+1,JSON.stringify(g));assert.ok(g.right.bottom<=g.backup.top+1,JSON.stringify(g));assert.ok(g.right.bottom<=g.viewport,JSON.stringify(g));return g;}
async function reading(){await page.getByRole('tab',{name:'题解',exact:true}).click();for(const d of await page.locator('.progressiveSolution details').all()){if(await d.getAttribute('open')===null)await d.locator('summary').click();}await pause();await page.locator('.statementPane').evaluate(e=>{e.scrollTop=0;});}
async function check(name, fn){if(process.env.HOT100_LAYOUT_CASE && !name.includes(process.env.HOT100_LAYOUT_CASE)) return;try{const details=await fn();checks.push({name,passed:true,details});}catch(error){checks.push({name,passed:false,error:error.stack});}}
try{
  await page.goto(`${base}/?question=283`,{waitUntil:'networkidle'});await editor().locator('.view-line').first().waitFor({timeout:60000});
  const solution=JSON.parse(fs.readFileSync(new URL('../src/data/solutions/283.json',import.meta.url)));
  const userJava='class Solution {\n    public void moveZeroes(int[] nums) {\n        int write = 0;\n        for (int value : nums) {\n            if (value != 0) nums[write++] = value;\n        }\n        while (write < nums.length) nums[write++] = 0;\n    }\n}\n';
  const longCode=userJava+'\n'+Array.from({length:180},(_,i)=>`// 用户练习记录 ${i}`).join('\n');
  await paste(longCode);
  await check('桌面长阅读区滚动到参考代码，右侧完整可见且位置不变',async()=>{
    await reading();const before=await assertVisible();assert.equal(before.left.overflow,'auto');
    await page.locator('.statementPane').hover();await page.mouse.wheel(0,10000);await pause();
    await page.locator('.solutionLargeCode').evaluate(e=>e.scrollIntoView({block:'start'}));await pause();const after=await assertVisible();
    assert.ok(after.left.scrollTop>300);assert.equal(after.pageY,before.pageY);assert.equal(after.right.top,before.right.top);assert.equal(after.right.bottom,before.right.bottom);
    const code=await page.locator('.solutionLargeCode').evaluate(e=>({height:e.clientHeight,scrollHeight:e.scrollHeight,top:e.getBoundingClientRect().top,bottom:e.getBoundingClientRect().bottom,whiteSpace:getComputedStyle(e).whiteSpace}));
    assert.equal(code.height,code.scrollHeight);assert.equal(code.whiteSpace,'pre');assert.ok(code.top>=after.left.top&&code.top<after.left.bottom);return {before,after,code};
  });
  await check('右侧180行代码独立滚动，左侧参考代码位置不动',async()=>{
    await focusEditor();await page.keyboard.press(startKey);await editor().hover();await page.waitForTimeout(650);const before=await page.locator('.view-lines').evaluate(e=>e.getBoundingClientRect().top);const left=(await geometry()).left.scrollTop;
    await page.evaluate(()=>{window.__layoutWheels=[];document.addEventListener('wheel',e=>window.__layoutWheels.push({target:e.target.className,path:e.composedPath().slice(0,7).map(e=>e.className),dy:e.deltaY}),true);});
    const beforeGeometry=await geometry();await page.mouse.wheel(0,700);await pause();const after=await page.locator('.view-lines').evaluate(e=>e.getBoundingClientRect().top);
    const afterGeometry=await geometry(),wheels=await page.evaluate(()=>window.__layoutWheels);
    assert.ok(after<before-20,`${before}->${after}`);assert.equal(afterGeometry.left.scrollTop,left,JSON.stringify({beforeGeometry,afterGeometry,wheels}));return {before,after,left};
  });
  await check('切换题面与题解保留同一Monaco、光标和撤销记录',async()=>{
    await focusEditor();await page.keyboard.press(endKey);await page.keyboard.insertText('\n// undo-marker');await pause();
    await page.evaluate(()=>{window.__layoutEditor=document.querySelector('.monaco-editor');});
    const cursor=await page.evaluate(()=>JSON.parse(localStorage.getItem('hot100-study-planner-v3')).drafts['283'].java.function.cursor);
    await page.getByRole('tab',{name:'题目',exact:true}).click();await page.getByRole('tab',{name:'题解',exact:true}).click();
    assert.equal(await page.evaluate(()=>document.querySelector('.monaco-editor')===window.__layoutEditor),true);
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('hot100-study-planner-v3')).drafts['283'].java.function.cursor),cursor);
    await focusEditor();await page.keyboard.press(`${modifier}+Z`);await pause();
    const code=await page.evaluate(()=>JSON.parse(localStorage.getItem('hot100-study-planner-v3')).drafts['283'].java.function.code);assert.ok(!code.includes('undo-marker'));return {cursor};
  });
  await check('长提示、个人笔记展开后仍有编码空间',async()=>{
    await page.locator('.editorExtras summary').click();for(let n=1;n<=4;n++)await page.getByRole('button',{name:`我要提示（第 ${n} 级）`,exact:true}).click();
    await page.locator('.practiceNote textarea').fill('个人笔记\n'.repeat(80));await pause();const g=await assertVisible();
    const extras=await page.locator('.editorExtrasBody').evaluate(e=>({height:e.clientHeight,scrollHeight:e.scrollHeight}));assert.ok(extras.scrollHeight>extras.height);return {g,extras};
  });
  await check('Java/Python真实示例运行，底部结果可折叠和独立滚动',async()=>{
    await paste(userJava);assert.equal((await run()).status,'passed');await assertVisible();
    await language('Python');await paste(solution.python,'python');assert.equal((await run()).status,'passed');await assertVisible();
    await paste('class Solution:\n    def moveZeroes(self, nums):\n        raise RuntimeError("long-result\\n" * 160)\n','python');const result=await run();assert.equal(result.cases[0].status,'runtime_error');await pause();
    const before=await assertVisible();const body=page.locator('.runPanelBody');assert.ok(await body.evaluate(e=>e.scrollHeight>e.clientHeight));await body.hover();await page.mouse.wheel(0,600);await pause();assert.ok(await body.evaluate(e=>e.scrollTop>0));assert.equal((await geometry()).left.scrollTop,before.left.scrollTop);
    await page.locator('.runPanel summary').click();const collapsed=await assertVisible();assert.ok(collapsed.editor.height>before.editor.height);return {before,collapsed};
  });
  await check('四个语言/模式草稿切换及刷新各自恢复',async()=>{
    for(const [lang,m,key,scope,code]of [['Java','函数','java','function',userJava],['Python','函数','python','function',solution.python],['Java','ACM','java','acm','// Java ACM draft\n'],['Python','ACM','python','acm','# Python ACM draft\n']]){await language(lang);await mode(m);await paste(code,key,scope);await assertVisible();}
    await page.reload();await editor().waitFor();for(const [lang,m,key,scope,expected]of [['Java','函数','java','function',userJava],['Python','函数','python','function',solution.python],['Java','ACM','java','acm','// Java ACM draft\n'],['Python','ACM','python','acm','# Python ACM draft\n']]){await language(lang);await mode(m);await pause();const actual=await page.evaluate(({key,scope})=>JSON.parse(localStorage.getItem('hot100-study-planner-v3')).drafts['283'][key][scope].code,{key,scope});assert.equal(actual,expected);await assertVisible();}
  });
  await check('截图：左侧参考答案和右侧用户代码同时可见',async()=>{
    await language('Java');await mode('函数');await paste(userJava);await reading();await page.locator('.solutionLargeCode').evaluate(e=>e.scrollIntoView({block:'center'}));await focusEditor();await page.keyboard.press(startKey);await pause();await assertVisible();await page.screenshot({path:screenshot});return screenshot;
  });
  await check('较矮桌面窗口展开提示和长结果不遮挡编码区',async()=>{
    const sizes=[];
    for(const [width,height]of [[1366,768],[1366,700],[1280,600],[1024,768]]){
      await page.setViewportSize({width,height});await reading();
      if(await page.locator('.editorExtras').getAttribute('open')===null)await page.locator('.editorExtras summary').click();
      await language('Python');await paste('class Solution:\n    def moveZeroes(self, nums):\n        raise RuntimeError("diagnostic\\n" * 100)\n','python');
      await run();if(await page.locator('.runPanel').getAttribute('open')===null)await page.locator('.runPanel summary').click();await pause();sizes.push(await assertVisible());
    }
    return sizes;
  });
  await check('键盘可退出Monaco并访问运行按钮',async()=>{
    await focusEditor();await page.keyboard.press(process.platform==='darwin'?'Control+Shift+M':'Control+M');await page.keyboard.press('Tab');
    const outside=await page.evaluate(()=>!document.querySelector('.monaco-editor').contains(document.activeElement));assert.ok(outside);return outside;
  });
  await check('手机上下布局无横向溢出，滚轮可离开编辑器',async()=>{
    for(const width of [390,320]){
      await page.setViewportSize({width,height:844});await page.reload();await editor().waitFor();await language('Java');await mode('函数');await paste(userJava);await editor().evaluate(e=>e.scrollIntoView({block:'center'}));await focusEditor();await page.keyboard.press(startKey);await pause();const before=await page.evaluate(()=>scrollY);await editor().hover();await page.mouse.wheel(0,-400);await pause();assert.ok((await page.evaluate(()=>scrollY))<before);
      const g=await page.evaluate(()=>({columns:getComputedStyle(document.querySelector('.workspaceGrid')).gridTemplateColumns,overflow:getComputedStyle(document.querySelector('.statementPane')).overflowY,width:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth}));assert.equal(g.columns.split(' ').length,1);assert.equal(g.overflow,'visible');assert.ok(g.scrollWidth<=g.width,JSON.stringify(g));
    }
  });
  await check('74行LRU参考代码随左栏自然滚动，手机展开长题解无横向溢出',async()=>{
    const sizes=[];
    for(const width of [1366,390,320]){
      await page.setViewportSize({width,height:768});await page.goto(`${base}/?question=146`,{waitUntil:'networkidle'});await editor().waitFor();await reading();
      const data=await page.evaluate(()=>{const pre=document.querySelector('.solutionLargeCode');return{width:innerWidth,scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth,preHeight:pre.clientHeight,preScrollHeight:pre.scrollHeight,lines:pre.textContent.split('\n').length,rightTop:document.querySelector('.editorPane').getBoundingClientRect().top};});
      assert.ok(data.lines>60);assert.equal(data.preHeight,data.preScrollHeight);assert.ok(data.scrollWidth<=data.clientWidth,JSON.stringify(data));
      if(width>800){await page.locator('.statementPane').hover();await page.mouse.wheel(0,15000);await page.waitForTimeout(650);const after=await page.locator('.editorPane').boundingBox();assert.equal(after.y,data.rightTop);assert.ok(after.y+after.height<=768);}
      sizes.push(data);
    }
    return sizes;
  });
}catch(error){errors.push({message:error.message,stack:error.stack});}finally{await browser.close();}
const report={checks,errors,cancellations:cancellations.length,passed:checks.filter(c=>c.passed).length,total:checks.length,screenshot};fs.writeFileSync(process.env.HOT100_LAYOUT_REPORT||'/tmp/hot100-practice-layout-results.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));process.exitCode=errors.length||checks.some(c=>!c.passed)?1:0;
