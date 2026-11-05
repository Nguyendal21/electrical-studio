import { expect, test, type Page } from '@playwright/test';

const blank={version:2,name:'Drawing A',devices:[],wires:[]};
const button=(page:Page,name:string)=>page.getByRole('button',{name,exact:true});
const auto=(page:Page)=>page.getByRole('switch',{name:'Tự động lưu vào tệp'});
const status=(page:Page)=>page.locator('.save-indicator');
const rename=async(page:Page,name:string)=>{await page.getByRole('textbox',{name:'Tên dự án'}).fill(name);};
const requests=(page:Page)=>page.evaluate(()=>((window as any).fileTest.requests as any[]));

async function native(page:Page){
  await page.addInitScript(project=>{
    localStorage.setItem('electrical-studio.project.v2',JSON.stringify(project));
    const state=(window as any).fileTest={requests:[],writes:[],cancel:false,delay:false,fail:false,releases:[],active:0,maxActive:0};
    (window as any).electricalFiles={
      open:async()=>({documentId:'opened',fileName:'opened.electrical.json',path:'D:\\opened.electrical.json',content:JSON.stringify(project)}),
      save:async(request:any)=>{
        state.requests.push(request);state.active++;state.maxActive=Math.max(state.maxActive,state.active);
        if(state.delay)await new Promise(resolve=>state.releases.push(resolve));
        state.active--;
        if(state.fail)throw new Error('Đĩa đang chỉ đọc');
        if(state.cancel)return null;
        state.writes.push(request);
        const documentId=request.saveAs?'copy':request.documentId??'new';
        return {documentId,fileName:`${documentId}.electrical.json`,path:`D:\\${documentId}.electrical.json`};
      },
    };
  },blank);
  await page.goto('/');
}

async function browser(page:Page){
  await page.addInitScript(project=>{
    localStorage.setItem('electrical-studio.project.v2',JSON.stringify(project));
    const state=(window as any).fileTest={requests:[],writes:[],pickers:0,cancel:false,delayPicker:false,releasePicker:null,fail:false,permission:'granted',permissionResult:'granted',permissionRequests:[]};
    const handle=(name:string)=>({name,getFile:async()=>new File([JSON.stringify(project)],name,{type:'application/json'}),queryPermission:async()=>state.permission,requestPermission:async(options:any)=>{
      state.permissionRequests.push({...options,userActivation:navigator.userActivation.isActive});state.permission=state.permissionResult;return state.permission;
    },createWritable:async()=>{
      if(state.permission!=='granted')throw new Error('Không có quyền ghi');
      let content='';return {write:async(value:string)=>{if(state.fail)throw new Error('Không có quyền ghi');content=value;},close:async()=>state.writes.push({name,content}),abort:async()=>{}};
    }});
    Object.defineProperty(window,'showOpenFilePicker',{configurable:true,value:async()=>[handle('opened.electrical.json')]});
    Object.defineProperty(window,'showSaveFilePicker',{configurable:true,value:async()=>{
      state.pickers++;if(state.delayPicker)await new Promise(resolve=>state.releasePicker=resolve);
      if(state.cancel)throw new DOMException('Cancelled','AbortError');return handle(`copy${state.pickers}.electrical.json`);
    }});
  },blank);
  await page.goto('/');
}

test('native open stays read-only until save; Ctrl+S reuses its target from an input and Save As replaces it',async({page})=>{
  await native(page);await button(page,'Mở').click();
  await expect(auto(page)).not.toBeChecked();await expect(status(page)).toHaveAttribute('data-save-state','saved');
  expect(await requests(page)).toHaveLength(0);
  await rename(page,'Edited in input');await page.keyboard.press('Control+s');
  await expect.poll(async()=> (await requests(page)).length).toBe(1);
  expect((await requests(page))[0]).toMatchObject({documentId:'opened',automatic:false});
  expect(JSON.parse((await requests(page))[0].content).name).toBe('Edited in input');
  await expect(status(page)).toHaveAttribute('data-save-state','saved');
  await page.keyboard.press('Control+Shift+s');await expect(status(page)).toHaveAttribute('title',/copy\.electrical\.json/);
  await rename(page,'Copy edit');await page.keyboard.press('Control+s');
  await expect.poll(async()=> (await requests(page)).length).toBe(3);
  expect((await requests(page))[2].documentId).toBe('copy');
});

test('AutoSave debounces, serializes writes, keeps later edits dirty and stops when disabled',async({page})=>{
  await native(page);await button(page,'Mở').click();await auto(page).click();
  await page.evaluate(()=>{(window as any).fileTest.delay=true;});
  await rename(page,'First edit');await expect.poll(async()=> (await requests(page)).length).toBe(1);
  await rename(page,'Second edit');await page.waitForTimeout(1100);
  expect(await requests(page)).toHaveLength(1);
  await page.evaluate(()=>{const state=(window as any).fileTest;state.releases.shift()();});
  await expect.poll(async()=> (await requests(page)).length).toBe(2);
  await expect(status(page)).toHaveAttribute('data-save-state','saving');
  await page.evaluate(()=>{const state=(window as any).fileTest;state.delay=false;state.releases.shift()();});
  await expect(status(page)).toHaveAttribute('data-save-state','saved');
  expect(await page.evaluate(()=>(window as any).fileTest.maxActive)).toBe(1);
  expect(JSON.parse((await requests(page))[1].content).name).toBe('Second edit');
  await auto(page).click();const before=(await requests(page)).length;
  await rename(page,'Unwritten edit');await page.waitForTimeout(1150);
  expect(await requests(page)).toHaveLength(before);await expect(status(page)).toHaveAttribute('data-save-state','dirty');
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('electrical-studio.project.v2')!).name)).toBe('Unwritten edit');
});

test('cancel first save leaves AutoSave off; new and imported drawings never reuse an old target',async({page})=>{
  await native(page);await page.evaluate(()=>{(window as any).fileTest.cancel=true;});
  await auto(page).click();await expect.poll(async()=> (await requests(page)).length).toBe(1);await expect(auto(page)).not.toBeChecked();
  await page.evaluate(()=>{(window as any).fileTest.cancel=false;});await auto(page).click();await expect(auto(page)).toBeChecked();
  await button(page,'Tạo mới').click();await expect(auto(page)).not.toBeChecked();await expect(status(page)).toHaveAttribute('title','Chưa lưu vào tệp');
  await page.keyboard.press('Control+s');await expect.poll(async()=> (await requests(page)).length).toBe(3);
  expect((await requests(page))[2].documentId).toBeUndefined();
  await page.locator('input[type=file]').setInputFiles({name:'import.electrical.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(blank))});
  await page.keyboard.press('Control+s');await expect.poll(async()=> (await requests(page)).length).toBe(4);
  expect((await requests(page))[3].documentId).toBeUndefined();
});

test('an AutoSave queued behind Save As follows the new target instead of writing the original',async({page})=>{
  await native(page);await button(page,'Mở').click();await auto(page).click();
  await page.evaluate(()=>{(window as any).fileTest.delay=true;});
  await rename(page,'Save As snapshot');await page.keyboard.press('Control+Shift+s');
  await expect.poll(async()=> (await requests(page)).length).toBe(1);
  await rename(page,'New target edit');await page.waitForTimeout(1100);
  await page.evaluate(()=>{const state=(window as any).fileTest;state.delay=false;state.releases.shift()();});
  await expect.poll(async()=> (await requests(page)).length).toBe(2);
  expect((await requests(page))[1]).toMatchObject({documentId:'copy',automatic:true});
  expect(JSON.parse((await requests(page))[1].content).name).toBe('New target edit');
  await expect(status(page)).toHaveAttribute('title',/Đã lưu:.*copy\.electrical\.json/);
});

test('late native save result cannot mark a new document saved or keep its old target',async({page})=>{
  await native(page);await button(page,'Mở').click();await page.evaluate(()=>{(window as any).fileTest.delay=true;});
  await rename(page,'Old document');await page.keyboard.press('Control+s');await expect.poll(async()=> (await requests(page)).length).toBe(1);
  await button(page,'Tạo mới').click();await page.evaluate(()=>{const state=(window as any).fileTest;state.delay=false;state.releases.shift()();});
  await expect(status(page)).toHaveAttribute('title','Chưa lưu vào tệp');
  await page.keyboard.press('Control+s');await expect.poll(async()=> (await requests(page)).length).toBe(2);
  expect((await requests(page))[1].documentId).toBeUndefined();
  expect(JSON.parse((await requests(page))[1].content).name).toBe('Sơ đồ mới');
});

test('browser file handle supports overwrite, AutoSave and Save As without repeated pickers',async({page})=>{
  await browser(page);await button(page,'Mở').click();await rename(page,'Browser edit');await page.keyboard.press('Control+s');
  await expect.poll(()=>page.evaluate(()=>(window as any).fileTest.writes.length)).toBe(1);
  expect(await page.evaluate(()=>(window as any).fileTest.pickers)).toBe(0);
  expect(await page.evaluate(()=>(window as any).fileTest.writes[0].name)).toBe('opened.electrical.json');
  await auto(page).click();await rename(page,'Auto edit');await expect.poll(()=>page.evaluate(()=>(window as any).fileTest.writes.length)).toBe(2);
  await auto(page).click();await page.keyboard.press('Control+Shift+s');await expect(status(page)).toHaveAttribute('title',/copy1\.electrical\.json/);
  await rename(page,'Saved copy');await page.keyboard.press('Control+s');await expect.poll(()=>page.evaluate(()=>(window as any).fileTest.writes.length)).toBe(4);
  expect(await page.evaluate(()=>(window as any).fileTest.pickers)).toBe(1);
  expect(await page.evaluate(()=>(window as any).fileTest.writes[3].name)).toBe('copy1.electrical.json');
});

test('browser cancelled Save As and write errors preserve the file target and dirty contents',async({page})=>{
  await browser(page);await button(page,'Mở').click();await rename(page,'Keep this edit');
  await page.evaluate(()=>{(window as any).fileTest.cancel=true;});await page.keyboard.press('Control+Shift+s');
  await expect(status(page)).toHaveAttribute('data-save-state','dirty');await expect(status(page)).toHaveAttribute('title',/opened\.electrical\.json/);
  await page.evaluate(()=>{(window as any).fileTest.fail=true;});await page.keyboard.press('Control+s');await expect(status(page)).toHaveAttribute('data-save-state','error');
  await page.evaluate(()=>{(window as any).fileTest.fail=false;});await page.keyboard.press('Control+s');await expect(status(page)).toHaveAttribute('data-save-state','saved');
  expect(await page.evaluate(()=>(window as any).fileTest.writes[0].name)).toBe('opened.electrical.json');
});

test('browser AutoSave requests write access in the toggle gesture before saving an opened file',async({page})=>{
  await browser(page);await page.evaluate(()=>{(window as any).fileTest.permission='prompt';});
  await button(page,'Mở').click();await expect(auto(page)).not.toBeChecked();
  expect(await page.evaluate(()=>(window as any).fileTest.permissionRequests)).toHaveLength(0);
  await auto(page).click();await expect(auto(page)).toBeChecked();
  expect(await page.evaluate(()=>(window as any).fileTest.permissionRequests)).toEqual([{mode:'readwrite',userActivation:true}]);
  await rename(page,'Writable browser document');
  await expect.poll(()=>page.evaluate(()=>(window as any).fileTest.writes.length)).toBe(1);
  await expect(status(page)).toHaveAttribute('data-save-state','saved');await expect(auto(page)).toBeChecked();
});

test('denied browser write permission leaves AutoSave off without writing and can be retried',async({page})=>{
  await browser(page);await page.evaluate(()=>{const state=(window as any).fileTest;state.permission='prompt';state.permissionResult='denied';});
  await button(page,'Mở').click();await auto(page).click();await expect(auto(page)).not.toBeChecked();
  await expect(page.getByRole('status')).toContainText('Chưa có quyền ghi tệp');
  await rename(page,'Still recoverable');await page.waitForTimeout(1100);
  expect(await page.evaluate(()=>(window as any).fileTest.writes)).toHaveLength(0);
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('electrical-studio.project.v2')!).name)).toBe('Still recoverable');
  await page.evaluate(()=>{(window as any).fileTest.permissionResult='granted';});await auto(page).click();await expect(auto(page)).toBeChecked();
  await expect.poll(()=>page.evaluate(()=>(window as any).fileTest.writes.length)).toBe(1);
  await expect(status(page)).toHaveAttribute('data-save-state','saved');
});

test('a pending browser Save picker cannot write after switching to a new drawing',async({page})=>{
  await browser(page);await page.evaluate(()=>{(window as any).fileTest.delayPicker=true;});
  await button(page,'Lưu tệp').click();await button(page,'Tạo mới').click();
  await page.evaluate(()=>{const state=(window as any).fileTest;state.releasePicker();});
  await expect(status(page)).toHaveAttribute('title','Chưa lưu vào tệp');
  expect(await page.evaluate(()=>(window as any).fileTest.writes)).toHaveLength(0);
});

test('unsupported browsers download a copy and explain why file AutoSave cannot be enabled',async({page})=>{
  await page.addInitScript(project=>{
    localStorage.setItem('electrical-studio.project.v2',JSON.stringify(project));
    Object.defineProperty(window,'showSaveFilePicker',{value:undefined,configurable:true});
    Object.defineProperty(window,'showOpenFilePicker',{value:undefined,configurable:true});
  },blank);await page.goto('/');
  const download=page.waitForEvent('download');await page.keyboard.press('Control+s');expect((await download).suggestedFilename()).toBe('Drawing A.electrical.json');
  await expect(status(page)).toHaveAttribute('title',/chưa có vị trí để ghi đè/);await auto(page).click();
  await expect(auto(page)).not.toBeChecked();await expect(page.getByRole('status')).toContainText('chưa hỗ trợ tự lưu');
});
