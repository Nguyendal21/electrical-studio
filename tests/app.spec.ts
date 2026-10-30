import { readFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { catalog, createDevice, getDefinition } from '../src/model/catalog';
import { examples } from '../src/model/examples';
import { terminalPosition } from '../src/model/geometry';
import type { Device, Project, Wire } from '../src/model/types';

// Browser inventory: compact workspace; direct controls and momentary buttons;
// automatic machines; linked excitation, relay and timer contacts; editable
// labels, wire routes and branches; file round trips; mobile drawers.
const storageKey='electrical-studio.project.v2';
const initial=examples[0].project;
const equipment=(page:Page,id:string)=>page.locator(`.react-flow__node[data-id="${id}"]`);
const state=(page:Page,id:string)=>equipment(page,id).locator('.equipment-node');
const edge=(page:Page,id:string)=>page.locator(`.react-flow__edge[data-id="${id}"]`);
const button=(page:Page,name:string)=>page.getByRole('button',{name,exact:true});
const saved=(page:Page):Promise<Project>=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)||'null'),storageKey);
const savedDevice=async(page:Page,id:string)=>(await saved(page)).devices.find(device=>device.id===id)!;
const savedWire=async(page:Page,id:string)=>(await saved(page)).wires.find(wire=>wire.id===id)!;

async function start(page:Page){
  await expect(button(page,'Chạy mô phỏng')).toBeEnabled();await button(page,'Chạy mô phỏng').click();
  await expect(button(page,'Tạm dừng')).toBeVisible();
}
async function select(page:Page,id:string){
  await clickDevice(page,id);
  if(!await page.getByRole('textbox',{name:'Tên thiết bị',exact:true}).isVisible())await button(page,'Thuộc tính').click();
  await expect(page.getByRole('textbox',{name:'Tên thiết bị',exact:true})).toBeVisible();
}
async function closeInspector(page:Page){const close=button(page,'Đóng thuộc tính');if(await close.isVisible())await close.click();}
async function loadExample(page:Page,id:string){
  const item=examples.find(example=>example.id===id)!;
  await button(page,'Mạch mẫu').click();await page.getByRole('dialog').getByRole('heading',{name:item.name,exact:true}).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.locator('.react-flow__node')).toHaveCount(item.project.devices.length);
  await expect(page.locator('.react-flow__edge')).toHaveCount(item.project.wires.length);
}
async function importProject(page:Page,project:Project){
  await page.locator('input[type="file"]').setInputFiles({name:'fixture.electrical.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});
  await expect(page.locator('.react-flow__node')).toHaveCount(project.devices.length);
}
async function drag(page:Page,locator:Locator,dx:number,dy:number){
  const box=await locator.boundingBox();expect(box).not.toBeNull();
  const point=await locator.evaluate(element=>element.classList.contains('equipment-node'))?await paintedPoint(locator):{x:box!.x+box!.width/2,y:box!.y+box!.height/2};
  const {x,y}=point;
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+dx,y+dy,{steps:12});await page.mouse.up();
}
// The blank rectangle surrounding a symbol is deliberately not interactive.
// Operate a visible stroke or filled part, including narrow open contacts.
async function paintedPoint(locator:Locator){
  return locator.evaluate(async element=>{
    // A diagram import animates fit-to-view. Wait for geometry, not a fixed
    // simulation delay, before targeting a thin schematic stroke.
    await new Promise<void>(resolve=>{let previous='',stable=0;const frame=()=>{const rect=element.getBoundingClientRect(),next=[rect.x,rect.y,rect.width,rect.height].map(value=>value.toFixed(3)).join(',');stable=next===previous?stable+1:0;previous=next;if(stable>=3)resolve();else requestAnimationFrame(frame);};requestAnimationFrame(frame);});
    const box=element.getBoundingClientRect(),center={x:box.x+box.width/2,y:box.y+box.height/2};
    const candidates:{x:number;y:number}[]=[];
    for(const geometry of element.querySelectorAll<SVGGeometryElement>('.schematic-body path,.schematic-body circle,.schematic-body rect')){
      const matrix=geometry.getScreenCTM();if(!matrix)continue;
      const bounds=geometry.getBBox();candidates.push(new DOMPoint(bounds.x+bounds.width/2,bounds.y+bounds.height/2).matrixTransform(matrix));
      const length=geometry.getTotalLength();
      for(const fraction of [.5,.25,.75]){const point=geometry.getPointAtLength(length*fraction);candidates.push(new DOMPoint(point.x,point.y).matrixTransform(matrix));}
    }
    candidates.sort((a,b)=>Math.hypot(a.x-center.x,a.y-center.y)-Math.hypot(b.x-center.x,b.y-center.y));
    const point=candidates.find(candidate=>{const hit=document.elementFromPoint(candidate.x,candidate.y);return hit&&element.contains(hit)&&!hit.closest('.react-flow__handle,.node-reference');});
    if(!point)throw new Error('No visible symbol surface is available for interaction.');
    return {x:point.x,y:point.y};
  });
}
async function clickDevice(page:Page,id:string){const point=await paintedPoint(state(page,id));await page.mouse.click(point.x,point.y);}
async function hold(page:Page,id:string){
  const point=await paintedPoint(state(page,id));await page.mouse.move(point.x,point.y);await page.mouse.down();
}
async function release(page:Page){await page.mouse.up();}
async function wirePoint(page:Page,id:string,fraction=.5){
  return edge(page,id).locator('.wire-hit').evaluate((element,position)=>{
    const path=element as SVGPathElement,local=path.getPointAtLength(path.getTotalLength()*position);
    const point=new DOMPoint(local.x,local.y).matrixTransform(path.getScreenCTM()!);
    return {x:point.x,y:point.y};
  },fraction);
}
async function wireVertices(page:Page,id:string){
  const path=(await edge(page,id).locator('.wire-hit').getAttribute('d'))!;
  return [...path.matchAll(/[ML]\s*(-?[\d.]+)\s+(-?[\d.]+)/g)].map(match=>({x:Number(match[1]),y:Number(match[2])}));
}
async function deleteWire(page:Page,id:string,fraction=.5){
  await closeInspector(page);const point=await wirePoint(page,id,fraction);
  await page.mouse.click(point.x,point.y);await page.keyboard.press('Delete');
  await expect(edge(page,id)).toHaveCount(0);
}
function testDevice(kind:Device['kind'],id:string,name:string,x:number,y:number):Device{return {...createDevice(kind,id,x,y),name};}
function testWire(id:string,from:string,fromPort:string,to:string,toPort:string):Wire{return {id,from,fromPort,to,toPort,length:1,section:2.5};}
async function openPalette(page:Page,kind:Device['kind']){
  const group=button(page,`Nhóm ${getDefinition(kind).category}`);if(await group.getAttribute('aria-expanded')!=='true')await group.click();
  return page.locator('.palette-expanded').getByRole('button',{name:`Thêm ${getDefinition(kind).name}`,exact:true});
}
async function flowPoint(page:Page,x:number,y:number){
  return page.locator('.react-flow__viewport').evaluate((element,point)=>{
    const canvas=element.closest('.react-flow')!.getBoundingClientRect(),matrix=new DOMMatrix(getComputedStyle(element).transform);
    const result=new DOMPoint(point.x,point.y).matrixTransform(matrix);return {x:canvas.x+result.x,y:canvas.y+result.y};
  },{x,y});
}
async function viewportTransform(page:Page){return page.locator('.react-flow__viewport').evaluate(element=>{const matrix=new DOMMatrix(getComputedStyle(element).transform);return {x:matrix.e,y:matrix.f,zoom:matrix.a};});}

function marqueeProject():Project{
  const devices=[testDevice('lamp','first','H1',200,200),testDevice('lamp','second','H2',450,200),testDevice('lamp','outside','H3',800,200)];
  const first=terminalPosition(devices[0],'1'),second=terminalPosition(devices[1],'1'),outside=terminalPosition(devices[2],'2');
  return {version:2,name:'Marquee selection',devices,wires:[
    {...testWire('inside-wire','first','1','second','1'),waypoints:[{x:first.x,y:140},{x:second.x,y:140}]},
    {...testWire('outside-wire','second','2','outside','2'),waypoints:[{x:second.x,y:360},{x:outside.x,y:360}]},
  ]};
}
async function selectFirstTwoByMarquee(page:Page){
  await importProject(page,marqueeProject());await page.waitForTimeout(500);await paintedPoint(state(page,'first'));
  const from=await flowPoint(page,180,180),to=await flowPoint(page,560,330),viewport=await viewportTransform(page);
  await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:16});
  await expect(page.locator('.react-flow__selection')).toBeVisible();await page.mouse.up();
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(2);
  await expect(equipment(page,'first')).toHaveClass(/\bselected\b/);await expect(equipment(page,'second')).toHaveClass(/\bselected\b/);
  await expect(equipment(page,'outside')).not.toHaveClass(/\bselected\b/);expect(await viewportTransform(page)).toEqual(viewport);
}

test.beforeEach(async({page})=>{
  await page.goto('/');await expect(page.locator('.react-flow__node')).toHaveCount(initial.devices.length);
  await expect(button(page,'Chạy mô phỏng')).toBeEnabled();
});
test.afterEach(async({page},testInfo)=>{
  if(testInfo.status===testInfo.expectedStatus||page.isClosed())return;
  const project=await saved(page).catch(()=>null);
  await testInfo.attach('saved-diagram',{body:JSON.stringify(project,null,2),contentType:'application/json'});
});

test('closed drawers give the drawing at least eighty percent of desktop width and height',async({page},testInfo)=>{
  await expect(page.getByRole('textbox',{name:'Tìm thiết bị',exact:true})).not.toBeVisible();
  await expect(page.getByRole('textbox',{name:'Tên thiết bị',exact:true})).not.toBeVisible();
  const canvas=await page.locator('.react-flow').boundingBox(),viewport=page.viewportSize()!;expect(canvas).not.toBeNull();
  expect(canvas!.width/viewport.width).toBeGreaterThanOrEqual(.8);expect(canvas!.height/viewport.height).toBeGreaterThanOrEqual(.8);
  expect(canvas!.x).toBeGreaterThanOrEqual(0);expect(canvas!.y+canvas!.height).toBeLessThanOrEqual(viewport.height);
  await expect(page.locator('.react-flow__viewport')).not.toContainText('Chưa chạy');
  await expect(page.getByRole('switch',{name:'Cho phép thiết bị hoạt động'})).toHaveCount(0);
  await page.screenshot({path:testInfo.outputPath('desktop-workspace.png'),scale:'css'});
});

test('DC motor runs only with its powered same-name field and has no manual on-off control',async({page})=>{
  await start(page);await expect(state(page,'motor-dc')).toHaveClass(/\blive\b/);await expect(state(page,'field-motor')).toHaveClass(/\blive\b/);
  const before=await savedDevice(page,'motor-dc');await clickDevice(page,'motor-dc');await expect(state(page,'motor-dc')).toHaveClass(/\blive\b/);
  expect((await savedDevice(page,'motor-dc')).enabled).toBe(before.enabled);
  await select(page,'motor-dc');await expect(page.getByRole('switch')).toHaveCount(0);
  await select(page,'field-motor');const name=page.getByRole('textbox',{name:'Tên thiết bị',exact:true});
  await name.fill('M2');await name.press('Enter');await expect(state(page,'motor-dc')).not.toHaveClass(/\blive\b/);await expect(state(page,'lamp-dc')).toHaveClass(/\blive\b/);
  await name.fill('m1');await name.press('Enter');await expect(state(page,'motor-dc')).toHaveClass(/\blive\b/);
  await button(page,'Tạm dừng').click();await expect(page.locator('.current-flow').first()).toHaveCSS('animation-play-state','paused');
  await start(page);await expect(page.locator('.current-flow').first()).toHaveCSS('animation-play-state','running');
  await button(page,'Đặt lại mô phỏng').click();await expect(state(page,'motor-dc')).not.toHaveClass(/\blive\b/);
});

test('opening the field return stops a DC motor and reconnecting its terminals restores it',async({page})=>{
  await start(page);await deleteWire(page,'w-field-return',.04);
  await expect(page.locator('.react-flow__edge')).toHaveCount(initial.wires.length-1);await expect(state(page,'motor-dc')).not.toHaveClass(/\blive\b/);
  await button(page,'Chế độ nối dây').click();
  const from=await equipment(page,'field-motor').locator('[data-handleid="F2"]').boundingBox(),to=await equipment(page,'dc-source').locator('[data-handleid="-"]').boundingBox();
  expect(from).not.toBeNull();expect(to).not.toBeNull();
  await page.mouse.move(from!.x+from!.width/2,from!.y+from!.height/2);await page.mouse.down();
  await page.mouse.move(to!.x+to!.width/2,to!.y+to!.height/2,{steps:20});await page.mouse.up();
  await expect(page.locator('.react-flow__edge')).toHaveCount(initial.wires.length);await expect(state(page,'motor-dc')).toHaveClass(/\blive\b/);
  await button(page,'Hoàn tác').click();await start(page);await expect(state(page,'motor-dc')).not.toHaveClass(/\blive\b/);
  await equipment(page,'field-motor').locator('[data-handleid="F2"]').click();await equipment(page,'dc-source').locator('[data-handleid="-"]').click();
  await expect(page.locator('.react-flow__edge')).toHaveCount(initial.wires.length);await expect(state(page,'motor-dc')).toHaveClass(/\blive\b/);
});

test('clicking a three-pole breaker closes and opens it without a separate enable switch',async({page})=>{
  await loadExample(page,'motor-star');await expect(equipment(page,'breaker-main').locator('.react-flow__handle')).toHaveCount(6);
  await start(page);await expect(state(page,'motor-main')).toHaveClass(/\blive\b/);
  await clickDevice(page,'breaker-main');await expect(state(page,'motor-main')).not.toHaveClass(/\blive\b/);
  await clickDevice(page,'breaker-main');await expect(state(page,'motor-main')).toHaveClass(/\blive\b/);
  await expect(page.getByRole('switch')).toHaveCount(0);
});

test('single-pole breaker starts open and supports the same direct switching action',async({page})=>{
  const project:Project={version:2,name:'CB một pha',devices:[testDevice('dc','source','G1',40,200),testDevice('breaker1','cb','QF1',350,80),testDevice('lamp','lamp','H1',350,300)],wires:[testWire('feed','source','+','cb','1'),testWire('load','cb','2','lamp','1'),testWire('return','lamp','2','source','-')]};
  await importProject(page,project);await expect(equipment(page,'cb').locator('.react-flow__handle')).toHaveCount(2);
  await start(page);await expect(state(page,'lamp')).not.toHaveClass(/\blive\b/);
  await clickDevice(page,'cb');await expect(state(page,'lamp')).toHaveClass(/\blive\b/);
  await clickDevice(page,'cb');await expect(state(page,'lamp')).not.toHaveClass(/\blive\b/);
});

test('dragging a manual control edits its position without operating it',async({page})=>{
  await loadExample(page,'motor-star');await start(page);const before=await savedDevice(page,'breaker-main');
  await drag(page,state(page,'breaker-main'),60,0);await expect.poll(async()=>(await savedDevice(page,'breaker-main')).x).not.toBe(before.x);
  expect((await savedDevice(page,'breaker-main')).enabled).toBe(before.enabled);await expect(state(page,'motor-main')).toHaveClass(/\blive\b/);
  await clickDevice(page,'breaker-main');await expect(state(page,'motor-main')).not.toHaveClass(/\blive\b/);
});

test('momentary Start and Stop buttons control separate KM1 contacts with self-hold',async({page},testInfo)=>{
  await loadExample(page,'contactor-starter');await start(page);
  await expect(state(page,'motor-main')).not.toHaveClass(/\blive\b/);
  await hold(page,'start');await expect(state(page,'km')).toHaveClass(/\blive\b/);await expect(state(page,'motor-main')).toHaveClass(/\blive\b/);
  await release(page);await expect.poll(async()=>(await savedDevice(page,'start')).enabled).toBe(false);await expect(state(page,'km')).toHaveClass(/\blive\b/);
  for(const id of ['km-main-1','km-main-2','km-main-3','km-hold'])await expect(state(page,id)).toHaveClass(/\blive\b/);
  await page.screenshot({path:testInfo.outputPath('starter-running.png'),scale:'css'});
  await hold(page,'stop');await expect(state(page,'km')).not.toHaveClass(/\blive\b/);await expect(state(page,'motor-main')).not.toHaveClass(/\blive\b/);
  await release(page);await expect.poll(async()=>(await savedDevice(page,'stop')).enabled).toBe(true);await expect(state(page,'km')).not.toHaveClass(/\blive\b/);
});

test('a normal quick Start click is not lost between simulation ticks',async({page})=>{
  await loadExample(page,'contactor-starter');await start(page);
  await clickDevice(page,'start');await expect(state(page,'motor-main')).toHaveClass(/\blive\b/);
  await expect.poll(async()=>(await savedDevice(page,'start')).enabled).toBe(false);
  await clickDevice(page,'stop');await expect(state(page,'motor-main')).not.toHaveClass(/\blive\b/);
  await expect.poll(async()=>(await savedDevice(page,'stop')).enabled).toBe(true);
  await state(page,'start').focus();await page.keyboard.down('Enter');await expect.poll(async()=>(await savedDevice(page,'start')).enabled).toBe(true);
  await button(page,'Mạch mẫu').focus();await expect.poll(async()=>(await savedDevice(page,'start')).enabled).toBe(false);
  await page.keyboard.up('Enter');
});

test('on-delay contacts transfer while the pushbutton is held and reset on release',async({page})=>{
  await loadExample(page,'timer-relay');await select(page,'timer');
  const delay=page.getByRole('spinbutton',{name:'Thời gian trễ',exact:true});await delay.fill('0.8');await delay.press('Enter');await closeInspector(page);
  await start(page);await expect(state(page,'timer-lamp-nc')).toHaveClass(/\blive\b/);
  await hold(page,'timer-start');await expect(state(page,'timer')).toHaveClass(/\blive\b/);await expect(state(page,'timer-lamp-no')).not.toHaveClass(/\blive\b/);
  await expect(state(page,'timer-lamp-no')).toHaveClass(/\blive\b/);await expect(state(page,'timer-lamp-nc')).not.toHaveClass(/\blive\b/);
  await release(page);await expect(state(page,'timer-lamp-no')).not.toHaveClass(/\blive\b/);await expect(state(page,'timer-lamp-nc')).toHaveClass(/\blive\b/);
});

test('off-delay contacts hold briefly after releasing the pushbutton',async({page})=>{
  await loadExample(page,'timer-relay');await select(page,'timer');await page.getByRole('combobox',{name:'Chức năng thời gian'}).selectOption('1');
  const delay=page.getByRole('spinbutton',{name:'Thời gian trễ',exact:true});await delay.fill('1');await delay.press('Enter');await closeInspector(page);
  await start(page);await hold(page,'timer-start');await expect(state(page,'timer-lamp-no')).toHaveClass(/\blive\b/);
  await release(page);await expect(state(page,'timer')).not.toHaveClass(/\blive\b/);await expect(state(page,'timer-lamp-no')).toHaveClass(/\blive\b/);
  await expect(state(page,'timer-lamp-no')).not.toHaveClass(/\blive\b/);await expect(state(page,'timer-lamp-nc')).toHaveClass(/\blive\b/);
});

test('thermal relay directly trips and resets its same-name NO, NC and changeover contacts',async({page})=>{
  const devices=[testDevice('dc','source','G1',40,250),testDevice('thermal','thermal','FR1',40,40),testDevice('contact_co','co','FR1',300,140),testDevice('lamp','co-nc-lamp','H1',230,400),testDevice('lamp','co-no-lamp','H2',390,400),testDevice('contact_no','no','FR1',570,140),testDevice('lamp','no-lamp','H3',570,400),testDevice('contact_nc','nc','FR1',780,140),testDevice('lamp','nc-lamp','H4',780,400)];
  const wires=[testWire('co-feed','source','+','co','11'),testWire('co-nc','co','12','co-nc-lamp','1'),testWire('co-no','co','14','co-no-lamp','1'),testWire('no-feed','source','+','no','13'),testWire('no-load','no','14','no-lamp','1'),testWire('nc-feed','source','+','nc','21'),testWire('nc-load','nc','22','nc-lamp','1'),...['co-nc-lamp','co-no-lamp','no-lamp','nc-lamp'].map(id=>testWire(`${id}-return`,id,'2','source','-'))];
  await importProject(page,{version:2,name:'Tiếp điểm rơle nhiệt',devices,wires});await start(page);
  for(const id of ['co-nc-lamp','nc-lamp'])await expect(state(page,id)).toHaveClass(/\blive\b/);
  for(const id of ['co-no-lamp','no-lamp'])await expect(state(page,id)).not.toHaveClass(/\blive\b/);
  await clickDevice(page,'thermal');await expect(state(page,'thermal')).toHaveClass(/\btripped\b/);
  for(const id of ['co-nc-lamp','nc-lamp'])await expect(state(page,id)).not.toHaveClass(/\blive\b/);
  for(const id of ['co-no-lamp','no-lamp'])await expect(state(page,id)).toHaveClass(/\blive\b/);
  await clickDevice(page,'thermal');await expect(state(page,'thermal')).not.toHaveClass(/\btripped\b/);
  for(const id of ['co-nc-lamp','nc-lamp'])await expect(state(page,id)).toHaveClass(/\blive\b/);
});

test('curated examples run after their manual breakers or prime movers are operated',async({page})=>{
  test.setTimeout(60000);
  const representative:Record<string,string>={'dc-loop':'motor-dc','dc-independent':'motor-dc','dc-series':'motor-dc','dc-compound':'motor-dc','motor-star':'motor-main','motor-delta':'motor-main','contactor-starter':'grid','timer-relay':'timer-lamp-nc','dc-generator':'generator-load','diesel-generator':'motor-sync','emy-drive':'motor-dc','stepper-drive':'motor-stepper','converted-dc':'converted-motor','selector-control':'right-lamp','single-phase-motor':'single-motor','remote-actuators':'remote-valve'};
  for(const item of examples){
    await loadExample(page,item.id);await start(page);
    for(const device of item.project.devices.filter(device=>['breaker','breaker1','diesel'].includes(device.kind)&&!device.enabled))await clickDevice(page,device.id);
    await expect(state(page,representative[item.id])).toHaveClass(/\blive\b/);await button(page,'Tạm dừng').click();
  }
});

test('generator output needs both an intact field circuit and a driven shaft',async({page})=>{
  await loadExample(page,'dc-generator');await start(page);await expect(state(page,'generator-load')).toHaveClass(/\blive\b/);
  await deleteWire(page,'generator-field-minus',.5);await expect(state(page,'generator-load')).not.toHaveClass(/\blive\b/);
  await button(page,'Hoàn tác').click();await start(page);await expect(state(page,'generator-load')).toHaveClass(/\blive\b/);
  await deleteWire(page,'shaft-drive',.5);await expect(state(page,'generator-load')).not.toHaveClass(/\blive\b/);
  await button(page,'Hoàn tác').click();await start(page);await expect(state(page,'generator-load')).toHaveClass(/\blive\b/);
  await clickDevice(page,'diesel-dc');await expect(state(page,'generator-load')).not.toHaveClass(/\blive\b/);
});

test('labels move independently, support undo and hiding, and survive reload',async({page})=>{
  await select(page,'motor-dc');const original=await savedDevice(page,'motor-dc');await closeInspector(page);
  await drag(page,equipment(page,'motor-dc').locator('.node-reference'),30,36);await expect.poll(async()=>(await savedDevice(page,'motor-dc')).labelOffset).toBeTruthy();
  const moved=(await savedDevice(page,'motor-dc')).labelOffset;
  expect((await savedDevice(page,'motor-dc')).x).toBe(original.x);expect((await savedDevice(page,'motor-dc')).y).toBe(original.y);
  await button(page,'Hoàn tác').click();await expect.poll(async()=>(await savedDevice(page,'motor-dc')).labelOffset).toEqual(original.labelOffset);
  await button(page,'Làm lại').click();await expect.poll(async()=>(await savedDevice(page,'motor-dc')).labelOffset).toEqual(moved);
  await select(page,'motor-dc');await button(page,'Ẩn tên phần tử').click();await expect(equipment(page,'motor-dc').locator('.node-reference')).toHaveCount(0);
  await page.reload();await expect(equipment(page,'motor-dc').locator('.node-reference')).toHaveCount(0);
  await select(page,'motor-dc');await button(page,'Hiện tên phần tử').click();await expect(equipment(page,'motor-dc').locator('.node-reference')).toBeVisible();
  await button(page,'Đặt lại vị trí tên').click();await expect.poll(async()=>(await savedDevice(page,'motor-dc')).labelOffset).toBeUndefined();
});

test('equipment dragging and rotating preserve terminal connections and support undo',async({page})=>{
  const original=await savedDevice(page,'motor-dc');await drag(page,state(page,'motor-dc'),45,40);
  await expect.poll(async()=>(await savedDevice(page,'motor-dc')).x).not.toBe(original.x);
  await button(page,'Hoàn tác').click();await expect.poll(async()=>(await savedDevice(page,'motor-dc')).x).toBe(original.x);
  await button(page,'Làm lại').click();await clickDevice(page,'motor-dc');await button(page,'Xoay phần tử').click();
  await expect.poll(async()=>(await savedDevice(page,'motor-dc')).rotation).toBe(90);
  await expect(equipment(page,'motor-dc').locator('.react-flow__handle')).toHaveCount(3);await expect(page.locator('.react-flow__edge')).toHaveCount(initial.wires.length);
  await start(page);await expect(state(page,'motor-dc')).toHaveClass(/\blive\b/);
});

test('wire segments can be dragged and undo restores their route',async({page})=>{
  const before=(await savedWire(page,'w-fuse-lamp')).waypoints,point=await wirePoint(page,'w-fuse-lamp',.55);await page.mouse.click(point.x,point.y);
  const handle=edge(page,'w-fuse-lamp').locator('.wire-bend-handle[style*="ns-resize"]').first();await expect(handle).toBeVisible();
  await drag(page,handle,0,-35);await expect.poll(async()=>(await savedWire(page,'w-fuse-lamp')).waypoints).not.toEqual(before);
  await button(page,'Hoàn tác').click();await expect.poll(async()=>(await savedWire(page,'w-fuse-lamp')).waypoints).toEqual(before);
});

test('double-clicking a wire creates a real junction and preserves closed current paths',async({page})=>{
  const point=await wirePoint(page,'w-fuse-lamp',.55);await page.mouse.dblclick(point.x,point.y);
  await expect(page.locator('.junction-node')).toHaveCount(1);await expect(page.locator('.react-flow__edge')).toHaveCount(initial.wires.length+1);
  await start(page);await expect(state(page,'lamp-dc')).toHaveClass(/\blive\b/);await expect(state(page,'motor-dc')).toHaveClass(/\blive\b/);
});

test('right-button dragging pans the paper, the wheel zooms, and left dragging leaves the viewport fixed',async({page})=>{
  await importProject(page,{version:2,name:'Điều hướng bản vẽ',devices:[testDevice('lamp','navigation-lamp','H1',400,300)],wires:[]});
  // Import fits the new drawing after its terminals have been measured.
  await page.waitForTimeout(500);
  const canvas=(await page.locator('.react-flow').boundingBox())!,x=canvas.x+55,y=canvas.y+90;
  const initialViewport=await viewportTransform(page);
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+100,y+70,{steps:12});await page.mouse.up();
  expect(await viewportTransform(page)).toEqual(initialViewport);
  await page.mouse.move(x,y);await page.mouse.down({button:'right'});await page.mouse.move(x+100,y+70,{steps:12});await page.mouse.up({button:'right'});
  await expect.poll(async()=>Math.round((await viewportTransform(page)).x-initialViewport.x)).toBe(100);
  expect(Math.round((await viewportTransform(page)).y-initialViewport.y)).toBe(70);
  const beforeSymbolPan=await viewportTransform(page),symbol=await paintedPoint(state(page,'navigation-lamp'));
  await page.mouse.move(symbol.x,symbol.y);await page.mouse.down({button:'right'});await page.mouse.move(symbol.x+70,symbol.y+40,{steps:10});await page.mouse.up({button:'right'});
  await expect.poll(async()=>Math.round((await viewportTransform(page)).x-beforeSymbolPan.x)).toBe(70);
  expect((await savedDevice(page,'navigation-lamp')).x).toBe(400);expect((await savedDevice(page,'navigation-lamp')).y).toBe(300);
  const beforePinPan=await viewportTransform(page),pin=(await equipment(page,'navigation-lamp').locator('[data-handleid="1"]').boundingBox())!;
  await page.mouse.move(pin.x+pin.width/2,pin.y+pin.height/2);await page.mouse.down({button:'right'});await page.mouse.move(pin.x+pin.width/2-50,pin.y+pin.height/2+30,{steps:10});await page.mouse.up({button:'right'});
  await expect.poll(async()=>Math.round((await viewportTransform(page)).x-beforePinPan.x)).toBe(-50);
  expect((await savedDevice(page,'navigation-lamp')).x).toBe(400);expect((await saved(page)).wires).toHaveLength(0);
  const beforeZoom=await viewportTransform(page);
  await page.mouse.move(canvas.x+canvas.width/2,canvas.y+canvas.height/2);await page.mouse.wheel(0,350);
  await expect.poll(async()=>(await viewportTransform(page)).zoom).toBeLessThan(beforeZoom.zoom);
  const afterZoom=(await viewportTransform(page)).zoom;await page.mouse.wheel(0,-350);
  await expect.poll(async()=>(await viewportTransform(page)).zoom).toBeGreaterThan(afterZoom);
});

test('left-drag marquee selects a group that moves together, supports undo, and stays selected while right-panning',async({page})=>{
  await selectFirstTwoByMarquee(page);
  const before=await saved(page),point=await paintedPoint(state(page,'first')),viewport=await viewportTransform(page);
  await page.mouse.move(point.x,point.y);await page.mouse.down();await page.mouse.move(point.x+80*viewport.zoom,point.y+50*viewport.zoom,{steps:16});await page.mouse.up();
  await expect.poll(async()=>(await savedDevice(page,'first')).x).toBe(280);
  const moved=await saved(page);
  for(const id of ['first','second']){
    const original=before.devices.find(device=>device.id===id)!,changed=moved.devices.find(device=>device.id===id)!;
    expect(changed.x-original.x).toBe(80);expect(changed.y-original.y).toBe(50);
  }
  expect(moved.devices.find(device=>device.id==='outside')).toEqual(before.devices.find(device=>device.id==='outside'));
  expect(moved.wires.map(({id,from,fromPort,to,toPort})=>({id,from,fromPort,to,toPort}))).toEqual(before.wires.map(({id,from,fromPort,to,toPort})=>({id,from,fromPort,to,toPort})));
  expect(moved.wires.find(wire=>wire.id==='inside-wire')!.waypoints).toEqual(before.wires.find(wire=>wire.id==='inside-wire')!.waypoints!.map(point=>({x:point.x+80,y:point.y+50})));
  expect(moved.wires.find(wire=>wire.id==='outside-wire')!.waypoints).toEqual(before.wires.find(wire=>wire.id==='outside-wire')!.waypoints);
  expect(await viewportTransform(page)).toEqual(viewport);
  await page.keyboard.press('Control+z');await expect.poll(()=>saved(page)).toEqual(before);
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(2);
  const panStart=await paintedPoint(state(page,'first')),beforePan=await viewportTransform(page);
  await page.mouse.move(panStart.x,panStart.y);await page.mouse.down({button:'right'});await page.mouse.move(panStart.x+90,panStart.y+40,{steps:12});await page.mouse.up({button:'right'});
  await expect.poll(async()=>Math.round((await viewportTransform(page)).x-beforePan.x)).toBe(90);
  expect(Math.round((await viewportTransform(page)).y-beforePan.y)).toBe(40);
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(2);expect(await saved(page)).toEqual(before);
});

test('Delete removes a marquee group and its connected wires in one undoable action',async({page})=>{
  await selectFirstTwoByMarquee(page);const before=await saved(page);
  await page.keyboard.press('Delete');await expect(page.locator('.react-flow__node')).toHaveCount(1);
  await expect(equipment(page,'outside')).toHaveCount(1);await expect(page.locator('.react-flow__edge')).toHaveCount(0);
  await page.keyboard.press('Control+z');await expect.poll(()=>saved(page)).toEqual(before);
  await expect(page.locator('.react-flow__node')).toHaveCount(3);await expect(page.locator('.react-flow__edge')).toHaveCount(2);
});

test('Ctrl+C and Ctrl+V copy a selected group with new names and only its internal wires, as one undoable action',async({page})=>{
  await selectFirstTwoByMarquee(page);const before=await saved(page);
  await page.keyboard.press('Control+c');expect(await saved(page)).toEqual(before);
  await page.keyboard.press('Control+v');await expect(page.locator('.react-flow__node')).toHaveCount(5);await expect(page.locator('.react-flow__edge')).toHaveCount(3);
  const pasted=await saved(page),copies=pasted.devices.filter(device=>!before.devices.some(original=>original.id===device.id));
  expect(copies).toHaveLength(2);expect(new Set(pasted.devices.map(device=>device.id)).size).toBe(5);expect(new Set(pasted.devices.map(device=>device.name)).size).toBe(5);
  const [firstCopy,secondCopy]=[...copies].sort((a,b)=>a.x-b.x),first=before.devices.find(device=>device.id==='first')!,second=before.devices.find(device=>device.id==='second')!;
  const offset={x:firstCopy.x-first.x,y:firstCopy.y-first.y};expect(Math.hypot(offset.x,offset.y)).toBeGreaterThan(0);
  expect({x:secondCopy.x-second.x,y:secondCopy.y-second.y}).toEqual(offset);
  for(const original of before.devices)expect(pasted.devices.find(device=>device.id===original.id)).toEqual(original);
  for(const original of before.wires)expect(pasted.wires.find(wire=>wire.id===original.id)).toEqual(original);
  const copiedWire=pasted.wires.find(wire=>!before.wires.some(original=>original.id===wire.id))!;
  expect({from:copiedWire.from,fromPort:copiedWire.fromPort,to:copiedWire.to,toPort:copiedWire.toPort}).toEqual({from:firstCopy.id,fromPort:'1',to:secondCopy.id,toPort:'1'});
  expect(copiedWire.waypoints).toEqual(before.wires.find(wire=>wire.id==='inside-wire')!.waypoints!.map(point=>({x:point.x+offset.x,y:point.y+offset.y})));
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(2);
  await page.keyboard.press('Control+z');await expect.poll(()=>saved(page)).toEqual(before);
});

test('Ctrl+C and Ctrl+V in a text field retain native text editing without pasting equipment',async({page,context})=>{
  await context.grantPermissions(['clipboard-read','clipboard-write']);await selectFirstTwoByMarquee(page);
  await page.keyboard.press('Control+c');const projectName=page.getByRole('textbox',{name:'Tên dự án',exact:true}),name=await projectName.inputValue();
  await projectName.focus();await page.keyboard.press('Control+a');await page.keyboard.press('Control+c');await page.keyboard.press('End');await page.keyboard.press('Control+v');
  await expect(projectName).toHaveValue(name+name);await expect(page.locator('.react-flow__node')).toHaveCount(3);await expect(page.locator('.react-flow__edge')).toHaveCount(2);
});

test('terminal labels can be hidden and shown without hiding pins and the preference survives reload',async({page})=>{
  const labels=page.locator('.terminal-label:visible'),pins=page.locator('.terminal-handle'),names=page.locator('.node-reference');
  const labelCount=await labels.count(),pinCount=await pins.count(),nameCount=await names.count();expect(labelCount).toBeGreaterThan(0);
  await button(page,'Ẩn số đầu cực').click();await expect(labels).toHaveCount(0);await expect(pins).toHaveCount(pinCount);await expect(names).toHaveCount(nameCount);
  await page.reload();await expect(button(page,'Hiện số đầu cực')).toBeVisible();await expect(labels).toHaveCount(0);await expect(pins).toHaveCount(pinCount);
  await button(page,'Hiện số đầu cực').click();await expect(labels).toHaveCount(labelCount);
  await page.reload();await expect(button(page,'Ẩn số đầu cực')).toBeVisible();await expect(labels).toHaveCount(labelCount);
});

test('a wire remains selectable beneath an empty corner of a symbol bounding rectangle',async({page})=>{
  const devices=[testDevice('dc','source','G1',50,450),testDevice('dc_motor','occluder','M1',400,300),testDevice('lamp','load','H1',700,450)];
  const source=terminalPosition(devices[0],'+'),load=terminalPosition(devices[2],'1');
  const wires=[{...testWire('under-symbol','source','+','load','1'),waypoints:[{x:source.x,y:310},{x:load.x,y:310}]},testWire('return','load','2','source','-')];
  await importProject(page,{version:2,name:'Dây dưới vùng trống của ký hiệu',devices,wires});await page.waitForTimeout(500);
  const point=await flowPoint(page,410,310),box=(await state(page,'occluder').boundingBox())!;
  expect(point.x).toBeGreaterThan(box.x);expect(point.x).toBeLessThan(box.x+box.width);expect(point.y).toBeGreaterThan(box.y);expect(point.y).toBeLessThan(box.y+box.height);
  await page.mouse.click(point.x,point.y);await expect(edge(page,'under-symbol')).toHaveClass(/\bselected\b/);
  await expect(state(page,'occluder')).not.toHaveClass(/\bselected\b/);
  await page.keyboard.press('Delete');await expect(edge(page,'under-symbol')).toHaveCount(0);await expect(equipment(page,'occluder')).toHaveCount(1);
});

test('a terminal branches onto an existing wire by dragging or by clicking',async({page})=>{
  const devices=[testDevice('dc','source','G1',50,250),testDevice('lamp','main-lamp','H1',400,250),testDevice('lamp','branch-lamp','H2',250,450)];
  const source=terminalPosition(devices[0],'+'),main=terminalPosition(devices[1],'1'),branch=terminalPosition(devices[2],'2');
  const wires=[{...testWire('existing-feed','source','+','main-lamp','1'),waypoints:[{x:source.x,y:180},{x:main.x,y:180}]},{...testWire('main-return','main-lamp','2','source','-'),waypoints:[{x:main.x,y:420},{x:source.x,y:420}]},{...testWire('branch-return','branch-lamp','2','source','-'),waypoints:[{x:branch.x,y:600},{x:source.x,y:600}]}];
  const project:Project={version:2,name:'Rẽ nhánh trực tiếp vào dây',devices,wires};
  await importProject(page,project);await page.waitForTimeout(500);await start(page);
  await expect(state(page,'main-lamp')).toHaveClass(/\blive\b/);await expect(state(page,'branch-lamp')).not.toHaveClass(/\blive\b/);
  const originalRoute=await wireVertices(page,'existing-feed');
  const terminal=(await equipment(page,'branch-lamp').locator('[data-handleid="1"]').boundingBox())!,target=await flowPoint(page,100,210);
  await page.mouse.move(terminal.x+terminal.width/2,terminal.y+terminal.height/2);await page.mouse.down();await page.mouse.move(target.x,target.y,{steps:24});await page.mouse.up();
  await expect(page.locator('.junction-node')).toHaveCount(1);await expect(page.locator('.react-flow__edge')).toHaveCount(wires.length+2);
  await expect(edge(page,'existing-feed')).toHaveCount(0);await expect(state(page,'main-lamp')).toHaveClass(/\blive\b/);await expect(state(page,'branch-lamp')).toHaveClass(/\blive\b/);
  const changed=await saved(page),junction=changed.devices.find(device=>device.kind==='junction')!;
  expect(changed.wires.filter(wire=>wire.from===junction.id||wire.to===junction.id)).toHaveLength(3);
  expect(changed.wires.some(wire=>(wire.from==='branch-lamp'&&wire.fromPort==='1'&&wire.to===junction.id)||(wire.to==='branch-lamp'&&wire.toPort==='1'&&wire.from===junction.id))).toBe(true);
  const splitWires=changed.wires.filter(wire=>(wire.from===junction.id||wire.to===junction.id)&&wire.from!=='branch-lamp'&&wire.to!=='branch-lamp');
  for(const wire of splitWires)for(const point of await wireVertices(page,wire.id)){
    const distance=Math.min(...originalRoute.slice(0,-1).map((a,index)=>{const b=originalRoute[index+1],dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/(dx*dx+dy*dy||1)));return Math.hypot(point.x-a.x-dx*t,point.y-a.y-dy*t);}));
    expect(distance,'Splitting a wire must preserve the drawn conductor route').toBeLessThan(.01);
  }
  const straightHalf=splitWires.find(wire=>wire.from==='source'||wire.to==='source')!,beforeEdit=await wireVertices(page,straightHalf.id),halfPoint=await wirePoint(page,straightHalf.id);
  await page.mouse.click(halfPoint.x,halfPoint.y);const segmentGrip=edge(page,straightHalf.id).locator('.wire-bend-handle[style*="ew-resize"]').first();await expect(segmentGrip).toBeVisible();
  await drag(page,segmentGrip,35,0);await expect.poll(async()=>(await savedWire(page,straightHalf.id)).waypoints).not.toEqual(straightHalf.waypoints);
  const editedRoute=await wireVertices(page,straightHalf.id);expect(editedRoute[0]).toEqual(beforeEdit[0]);expect(editedRoute.at(-1)).toEqual(beforeEdit.at(-1));
  await button(page,'Hoàn tác').click();await expect.poll(()=>saved(page)).toEqual(changed);
  await button(page,'Hoàn tác').click();await expect(page.locator('.junction-node')).toHaveCount(0);await expect.poll(()=>saved(page)).toEqual(project);
  await start(page);await expect(state(page,'main-lamp')).toHaveClass(/\blive\b/);await expect(state(page,'branch-lamp')).not.toHaveClass(/\blive\b/);
  await equipment(page,'branch-lamp').locator('[data-handleid="1"]').click();
  const clickTarget=await flowPoint(page,300,180);await page.mouse.click(clickTarget.x,clickTarget.y);
  await expect(page.locator('.junction-node')).toHaveCount(1);await expect(page.locator('.react-flow__edge')).toHaveCount(wires.length+2);
  await expect(state(page,'main-lamp')).toHaveClass(/\blive\b/);await expect(state(page,'branch-lamp')).toHaveClass(/\blive\b/);
});

test('branching follows an off-grid wire at maximum zoom',async({page})=>{
  const devices=[testDevice('junction','top','J1',99,204),testDevice('junction','bottom','J2',99,384),testDevice('lamp','branch','H1',250,250)];
  const wires=[{...testWire('off-grid','top','J','bottom','J'),waypoints:[]}];
  await importProject(page,{version:2,name:'Off-grid branch',devices,wires});await page.waitForTimeout(500);
  for(let i=0;i<5;i++)await button(page,'Phóng to').click();
  await expect.poll(async()=>(await viewportTransform(page)).zoom).toBe(2.5);
  const pin=(await equipment(page,'branch').locator('[data-handleid="1"]').boundingBox())!,target=await flowPoint(page,105,300);
  await page.mouse.move(pin.x+pin.width/2,pin.y+pin.height/2);await page.mouse.down();await page.mouse.move(target.x,target.y,{steps:15});await page.mouse.up();
  await expect(page.locator('.junction-node')).toHaveCount(3);await expect(page.locator('.react-flow__edge')).toHaveCount(3);
  const junction=(await saved(page)).devices.find(device=>device.kind==='junction'&&!['top','bottom'].includes(device.id))!;
  expect(junction.x+6).toBeCloseTo(105,4);
});

function manualJunctionProject(withJunction=false):Project{
  const devices=[testDevice('dc','manual-source','G1',50,250),testDevice('lamp','manual-main','H1',400,250),testDevice('lamp','manual-branch','H2',250,450)];
  const source=terminalPosition(devices[0],'+'),main=terminalPosition(devices[1],'1'),branch=terminalPosition(devices[2],'2');
  const wires=[{...testWire('manual-feed','manual-source','+','manual-main','1'),waypoints:[{x:source.x,y:180},{x:main.x,y:180}]},{...testWire('manual-return','manual-main','2','manual-source','-'),waypoints:[{x:main.x,y:420},{x:source.x,y:420}]},{...testWire('manual-branch-return','manual-branch','2','manual-source','-'),waypoints:[{x:branch.x,y:600},{x:source.x,y:600}]}];
  if(withJunction){devices.push(testDevice('junction','manual-dot','J1',244,294));wires.push({...testWire('manual-tap','manual-dot','J','manual-branch','1'),waypoints:[]});}
  return {version:2,name:'Nút nối đặt thủ công',devices,wires};
}

test('dropping a palette junction on a wire creates a real tap in one undoable edit',async({page})=>{
  const project=manualJunctionProject();await importProject(page,project);await page.waitForTimeout(450);await paintedPoint(state(page,'manual-main'));
  const tool=await openPalette(page,'junction'),target=await flowPoint(page,250,180),canvas=(await page.locator('.canvas-container').boundingBox())!;
  await tool.dragTo(page.locator('.canvas-container'),{targetPosition:{x:target.x-canvas.x,y:target.y-canvas.y}});
  await expect(page.locator('.junction-node')).toHaveCount(1);await expect(page.locator('.react-flow__edge')).toHaveCount(project.wires.length+1);
  const placed=await saved(page),dot=placed.devices.find(device=>device.kind==='junction')!;
  expect(terminalPosition(dot,'J')).toEqual({x:250,y:180});expect(placed.wires.filter(wire=>wire.from===dot.id||wire.to===dot.id)).toHaveLength(2);
  await button(page,'Hoàn tác').click();await expect.poll(()=>saved(page)).toEqual(project);
  await button(page,'Làm lại').click();await expect.poll(()=>saved(page)).toEqual(placed);
  await equipment(page,'manual-branch').locator('[data-handleid="1"]').click();await equipment(page,dot.id).locator('[data-handleid="J"]').click();
  await start(page);await expect(state(page,'manual-main')).toHaveClass(/\blive\b/);await expect(state(page,'manual-branch')).toHaveClass(/\blive\b/);
  const connected=await saved(page);await page.reload();await expect.poll(()=>saved(page)).toEqual(connected);
  await start(page);await expect(state(page,'manual-branch')).toHaveClass(/\blive\b/);
});

test('dragging a manual dot with a branch onto a conductor joins it and undo restores the unconnected branch',async({page})=>{
  const project=manualJunctionProject(true);await importProject(page,project);await page.waitForTimeout(450);await paintedPoint(state(page,'manual-main'));
  const from=await flowPoint(page,258,300),to=await flowPoint(page,258,180);
  await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(from.x+2,from.y-2);await page.mouse.move(to.x,to.y,{steps:20});await page.mouse.up();
  await expect.poll(async()=>terminalPosition(await savedDevice(page,'manual-dot'),'J')).toEqual({x:250,y:180});
  await expect(page.locator('.react-flow__edge')).toHaveCount(project.wires.length+1);
  const moved=await saved(page);expect(moved.wires.filter(wire=>wire.from==='manual-dot'||wire.to==='manual-dot')).toHaveLength(3);
  await start(page);await expect(state(page,'manual-branch')).toHaveClass(/\blive\b/);
  await button(page,'Hoàn tác').click();await expect.poll(()=>saved(page)).toEqual(project);
  await start(page);await expect(state(page,'manual-branch')).not.toHaveClass(/\blive\b/);
});

test('opening an old draft repairs explicit dots already sitting on wires and preserves its original branch',async({page})=>{
  const project=manualJunctionProject(true);project.devices.find(device=>device.id==='manual-dot')!.y=174;
  await importProject(page,project);await expect(page.locator('.react-flow__edge')).toHaveCount(project.wires.length+1);
  const repaired=await saved(page);expect(repaired.wires.filter(wire=>wire.from==='manual-dot'||wire.to==='manual-dot')).toHaveLength(3);
  expect(repaired.wires.find(wire=>wire.id==='manual-tap')).toEqual(project.wires.find(wire=>wire.id==='manual-tap'));
  await start(page);await expect(state(page,'manual-branch')).toHaveClass(/\blive\b/);
  await page.reload();await expect.poll(()=>saved(page)).toEqual(repaired);await start(page);await expect(state(page,'manual-branch')).toHaveClass(/\blive\b/);
});

for(const junctionFirst of [false,true])test(`junctions snap by their centre while moving a selected group (junction first: ${junctionFirst})`,async({page})=>{
  const devices=[testDevice('lamp','grid-lamp','H1',200,200),testDevice('junction','grid-junction','J1',594,194)];
  if(junctionFirst)devices.reverse();
  const project:Project={version:2,name:'Junction grid',devices,wires:[testWire('grid-wire','grid-lamp','1','grid-junction','J')]};
  await importProject(page,project);await page.waitForTimeout(500);
  await (await openPalette(page,'junction')).click();
  await button(page,'Thu gọn nhóm linh kiện').click();
  await expect(page.locator('.junction-node')).toHaveCount(2);
  const added=(await saved(page)).devices.find(device=>!devices.some(original=>original.id===device.id))!;
  const centre=terminalPosition(added,'J');expect(centre.x%10).toBe(0);expect(centre.y%10).toBe(0);
  await page.keyboard.press('Control+z');await expect.poll(()=>saved(page)).toEqual(project);
  const from=await flowPoint(page,180,180),to=await flowPoint(page,630,290);
  await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:16});await page.mouse.up();
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(2);
  const point=await paintedPoint(state(page,'grid-lamp')),viewport=await viewportTransform(page);
  await page.mouse.move(point.x,point.y);await page.mouse.down();
  // Cross the drag threshold with a small movement before the requested delta.
  await page.mouse.move(point.x+2*viewport.zoom,point.y+2*viewport.zoom);
  await page.mouse.move(point.x+80*viewport.zoom,point.y+50*viewport.zoom,{steps:16});await page.mouse.up();
  await expect.poll(async()=>(await savedDevice(page,'grid-lamp')).x).toBe(280);
  const junction=await savedDevice(page,'grid-junction'),lamp=await savedDevice(page,'grid-lamp');
  expect({x:junction.x,y:junction.y}).toEqual({x:674,y:244});
  const vertices=await wireVertices(page,'grid-wire');
  expect(vertices[0]).toEqual(terminalPosition(lamp,'1'));expect(vertices.at(-1)).toEqual(terminalPosition(junction,'J'));
  const pin=(await equipment(page,'grid-junction').locator('[data-handleid="J"]').boundingBox())!;
  const expected=await flowPoint(page,junction.x+6,junction.y+6);
  expect(pin.x+pin.width/2).toBeCloseTo(expected.x,2);expect(pin.y+pin.height/2).toBeCloseTo(expected.y,2);
});

test('library opens on demand, searches symbols, and adds linked parts',async({page})=>{
  await page.keyboard.press('/');const search=page.getByRole('textbox',{name:'Tìm thiết bị',exact:true});await expect(search).toBeFocused();
  await search.fill('EMY');await expect(page.locator('.library-item')).toHaveCount(1);await page.locator('.library-item').click();
  await expect(page.locator('.react-flow__node')).toHaveCount(initial.devices.length+1);await button(page,'Hoàn tác').click();await expect(page.locator('.react-flow__node')).toHaveCount(initial.devices.length);
  const close=button(page,'Thu gọn thư viện');if(await close.isVisible())await close.click();
  await select(page,'motor-dc');await button(page,'Thêm cuộn kích từ M1').click();
  await expect(page.getByRole('textbox',{name:'Tên thiết bị',exact:true})).toHaveValue('M1');
  await expect.poll(async()=>(await saved(page)).devices.filter(device=>device.kind==='field_winding'&&device.name==='M1').length).toBe(2);
});

test('thermal inspector adds same-name NO and changeover contacts',async({page})=>{
  await importProject(page,{version:2,name:'Rơle nhiệt FR1',devices:[testDevice('thermal','thermal','FR1',200,200)],wires:[]});
  await select(page,'thermal');await button(page,'NO').click();
  await expect.poll(async()=>(await saved(page)).devices.filter(device=>device.kind==='contact_no'&&device.name==='FR1').length).toBe(1);
  await select(page,'thermal');await button(page,'CO').click();
  await expect.poll(async()=>(await saved(page)).devices.filter(device=>device.kind==='contact_co'&&device.name==='FR1').length).toBe(1);
});

test('JSON export restores labels and invalid import preserves the current drawing',async({page})=>{
  await select(page,'motor-dc');await button(page,'Ẩn tên phần tử').click();
  const wait=page.waitForEvent('download');await button(page,'Lưu tệp').click();const download=await wait;
  expect(download.suggestedFilename()).toMatch(/\.electrical\.json$/);const path=await download.path();expect(path).not.toBeNull();
  const exported=JSON.parse(await readFile(path!,'utf8')) as Project;expect(exported.version).toBe(2);expect(exported.devices.find(device=>device.id==='motor-dc')!.hiddenLabel).toBe(true);
  await button(page,'Tạo mới').click();await expect(page.locator('.react-flow__node')).toHaveCount(0);
  await page.locator('input[type="file"]').setInputFiles(path!);await expect(page.locator('.react-flow__node')).toHaveCount(exported.devices.length);await expect(equipment(page,'motor-dc').locator('.node-reference')).toHaveCount(0);
  await page.locator('input[type="file"]').setInputFiles({name:'broken.json',mimeType:'application/json',buffer:Buffer.from('{broken')});
  await expect(page.getByRole('status')).toContainText('JSON');await expect(page.locator('.react-flow__node')).toHaveCount(exported.devices.length);await expect.poll(()=>saved(page)).toEqual(exported);
});

test('mobile canvas and icon controls fit the viewport and drawers are dismissible',async({page},testInfo)=>{
  await page.setViewportSize({width:390,height:844});await button(page,'Vừa màn hình').click();
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight)).toBe(true);
  await expect(button(page,'Chạy mô phỏng')).toBeInViewport();await start(page);
  await page.keyboard.press('/');await expect(page.getByRole('textbox',{name:'Tìm thiết bị',exact:true})).toBeVisible();
  await button(page,'Thu gọn thư viện').click();await expect(button(page,'Tạm dừng')).toBeInViewport();
  await select(page,'motor-dc');await expect(button(page,'Đóng thuộc tính')).toBeInViewport();await button(page,'Đóng thuộc tính').click();
  await expect(page.getByRole('textbox',{name:'Tên thiết bị',exact:true})).not.toBeVisible();await expect(button(page,'Tạm dừng')).toBeInViewport();
  await page.screenshot({path:testInfo.outputPath('mobile-workspace.png'),scale:'css'});
});

test('one icon represents each group and expands only that group directly underneath',async({page},testInfo)=>{
  const groups=[...new Set(catalog.filter(part=>part.kind!=='contactor').map(part=>part.category))];
  await expect(page.locator('.palette-group-button')).toHaveCount(groups.length);
  await expect(page.locator('.palette-expanded')).toHaveCount(0);
  for(const category of groups){
    const group=button(page,`Nhóm ${category}`);await group.click();await expect(group).toHaveAttribute('aria-expanded','true');
    const definitions=catalog.filter(part=>part.category===category&&part.kind!=='contactor');
    await expect(page.locator('.palette-expanded .symbol-tool')).toHaveCount(definitions.length);
    for(const part of definitions){const item=page.locator('.palette-expanded').getByRole('button',{name:`Thêm ${part.name}`,exact:true});await expect(item).toBeVisible();expect(await item.locator('svg path,svg circle,svg rect,svg text').count(),part.kind).toBeGreaterThan(0);}
    const row=(await page.locator('.group-toolbar').boundingBox())!,panel=(await page.locator('.palette-expanded').boundingBox())!;
    expect(panel.y).toBeCloseTo(row.y+row.height,0);expect(panel.height).toBeLessThan(150);
  }
  await (await openPalette(page,'transformer1')).focus();await page.screenshot({path:testInfo.outputPath('expanded-palette.png'),scale:'css'});
  await page.keyboard.press('Escape');await expect(page.locator('.palette-expanded')).toHaveCount(0);
  const first=page.locator('.palette-group-button').first();await first.focus();await page.keyboard.press('ArrowRight');await expect(page.locator('.palette-group-button').nth(1)).toBeFocused();
  await page.keyboard.press('ArrowDown');await expect(page.locator('.palette-expanded .symbol-tool').first()).toBeFocused();
});

test('a grouped symbol can be dragged into the drawing on the grid',async({page})=>{
  const item=await openPalette(page,'transformer1');
  await item.dragTo(page.locator('.react-flow__pane'),{targetPosition:{x:500,y:300}});
  await expect(page.locator('.react-flow__node')).toHaveCount(initial.devices.length+1);
  const added=(await saved(page)).devices.find(device=>device.kind==='transformer1')!;
  expect(added).toBeDefined();expect(added.x%10).toBe(0);expect(added.y%10).toBe(0);
  await expect(equipment(page,added.id).locator('.terminal-handle')).toHaveCount(4);
  await page.keyboard.press('Control+z');await expect(page.locator('.react-flow__node')).toHaveCount(initial.devices.length);
});

test('a selector exposes linked contacts and each contact can choose its actuation position',async({page})=>{
  await (await openPalette(page,'selector3')).click();
  const selector=(await saved(page)).devices.find(device=>device.kind==='selector3')!;
  await expect(page.getByRole('textbox',{name:'Tên thiết bị',exact:true})).toHaveValue(selector.name);
  await expect(equipment(page,selector.id).locator('.terminal-handle')).toHaveCount(0);
  await button(page,'NO').click();
  const contact=(await saved(page)).devices.find(device=>device.kind==='contact_no'&&device.name===selector.name)!;
  const detent=page.getByRole('combobox',{name:'Vị trí tác động',exact:true});await expect(detent).toBeVisible();await detent.selectOption('-1');
  await expect.poll(async()=>(await savedDevice(page,contact.id)).params.actuationPosition).toBe(-1);
  await page.reload();expect((await savedDevice(page,contact.id)).params.actuationPosition).toBe(-1);
});

test('selector detents and a latching emergency stop operate their separate contacts',async({page})=>{
  await loadExample(page,'selector-control');await start(page);
  await expect(state(page,'right-lamp')).toHaveClass(/\blive\b/);await expect(state(page,'left-lamp')).not.toHaveClass(/\blive\b/);
  await clickDevice(page,'selector');await expect(state(page,'left-lamp')).toHaveClass(/\blive\b/);await expect(state(page,'right-lamp')).not.toHaveClass(/\blive\b/);
  await clickDevice(page,'selector');for(const id of ['left-lamp','right-lamp'])await expect(state(page,id)).not.toHaveClass(/\blive\b/);
  await clickDevice(page,'selector');await expect(state(page,'right-lamp')).toHaveClass(/\blive\b/);
  await clickDevice(page,'emergency');await expect(state(page,'right-lamp')).not.toHaveClass(/\blive\b/);expect((await savedDevice(page,'emergency')).enabled).toBe(true);
  await clickDevice(page,'emergency');await expect(state(page,'right-lamp')).toHaveClass(/\blive\b/);
});

test('limit switch remains actuated only while held and releases outside its symbol',async({page})=>{
  const devices=[testDevice('dc','s','G1',100,200),testDevice('limit_switch','limit','SQ1',300,100),testDevice('contact_no','c','SQ1',500,200),testDevice('lamp','l','H1',700,400)];
  const project:Project={version:2,name:'Limit switch',devices,wires:[testWire('wire-a','s','+','c','13'),testWire('wire-b','c','14','l','1'),testWire('wire-c','l','2','s','-')]};
  await importProject(page,project);await start(page);await expect(state(page,'l')).not.toHaveClass(/\blive\b/);
  await hold(page,'limit');await expect(state(page,'l')).toHaveClass(/\blive\b/);await page.mouse.move(1000,800);await release(page);await expect(state(page,'l')).not.toHaveClass(/\blive\b/);
  expect((await savedDevice(page,'limit')).enabled).toBe(false);
});

test('expanded groups stay usable on a narrow screen',async({page})=>{
  await page.setViewportSize({width:390,height:844});await openPalette(page,'capacitor');
  await expect(page.locator('.palette-expanded')).toBeInViewport();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await expect(button(page,'Chạy mô phỏng')).toBeInViewport();await button(page,'Thu gọn nhóm linh kiện').click();await expect(page.locator('.palette-expanded')).toHaveCount(0);
});
