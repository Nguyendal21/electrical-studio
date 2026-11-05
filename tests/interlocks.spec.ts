import { expect, test, type Locator, type Page } from '@playwright/test';
import { createDevice } from '../src/model/catalog';
import type { DeviceKind, Project, Wire } from '../src/model/types';

const key='electrical-studio.project.v2';
const part=(kind:DeviceKind,id:string,name:string,x:number,y:number)=>({...createDevice(kind,id,x,y),name});
const wire=(id:string,from:string,fromPort:string,to:string,toPort:string):Wire=>({id,from,fromPort,to,toPort,length:1,section:2.5});
const node=(page:Page,id:string)=>page.locator(`.react-flow__node[data-id="${id}"] .equipment-node`);
const pin=(page:Page,id:string,port:string)=>node(page,id).locator(`.react-flow__handle[data-handleid="${port}"]`);
const button=(page:Page,name:string)=>page.getByRole('button',{name,exact:true});
const saved=(page:Page):Promise<Project>=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),key);
function fixture(linked=false):Project{
  return {version:2,name:'Mechanical exclusion',devices:[
    part('dc','source','G1',60,250),part('switch','command-a','K1',320,60),part('switch','command-b','K2',700,60),
    part('interlocked_contact','a','K1',300,230),part('interlocked_contact','b','K2',680,230),
    part('lamp','lamp-a','H1',310,440),part('lamp','lamp-b','H2',690,440),
  ],wires:[
    wire('feed-a','source','+','a','13'),wire('out-a','a','14','lamp-a','1'),wire('return-a','lamp-a','2','source','-'),
    wire('feed-b','source','+','b','13'),wire('out-b','b','14','lamp-b','1'),wire('return-b','lamp-b','2','source','-'),
    ...(linked?[wire('lock','a','lock','b','lock')]:[]),
  ]};
}
async function open(page:Page,project:Project){
  await page.addInitScript(({key,project})=>localStorage.setItem(key,JSON.stringify(project)),{key,project});
  await page.goto('/');await expect(page.locator('.react-flow__node')).toHaveCount(project.devices.length);
}
async function drag(page:Page,from:Locator,to:Locator){
  const a=await from.boundingBox(),b=await to.boundingBox();expect(a&&b).toBeTruthy();
  await page.mouse.move(a!.x+a!.width/2,a!.y+a!.height/2);await page.mouse.down();
  await page.mouse.move(b!.x+b!.width/2,b!.y+b!.height/2,{steps:10});await page.mouse.up();
}
async function closed(page:Page,a:boolean,b:boolean){
  for(const [id,value] of [['a',a],['b',b]] as const)await expect(node(page,id).locator('.interlocked-contact')).toHaveAttribute('data-closed',String(value));
}
async function clickControl(page:Page,id:string,double=false){
  const box=await node(page,id).locator('.schematic-body circle').boundingBox();expect(box).not.toBeNull();
  // Pick the filled side of the circle, away from its moving handle.
  const x=box!.x+box!.width*.25,y=box!.y+box!.height*.5;
  if(double)await page.mouse.dblclick(x,y);else await page.mouse.click(x,y);
}

test('drawn mechanical link rejects electrical endpoints and prevents opposing contacts from closing together',async({page})=>{
  await open(page,fixture());
  await drag(page,pin(page,'a','lock'),pin(page,'b','13'));
  await expect.poll(async()=>(await saved(page)).wires.length).toBe(6);
  await expect(page.locator('.toast')).toContainText('các loại kết nối riêng');
  await drag(page,pin(page,'a','lock'),pin(page,'b','lock'));
  await expect.poll(async()=>(await saved(page)).wires.length).toBe(7);
  const link=page.locator('.mechanical-interlock');await expect(link).toHaveCount(1);
  await expect(link.locator('.react-flow__edge-path')).toHaveCSS('stroke-dasharray','4px, 4px');
  const middle=await link.locator('.wire-hit').evaluate(element=>{const path=element as SVGPathElement,p=path.getPointAtLength(path.getTotalLength()/2),matrix=path.getScreenCTM()!;return {x:p.x*matrix.a+p.y*matrix.c+matrix.e,y:p.x*matrix.b+p.y*matrix.d+matrix.f};});
  await page.mouse.dblclick(middle.x,middle.y);
  await expect(page.locator('.react-flow__node')).toHaveCount(7);
  await button(page,'Chạy mô phỏng').click();await closed(page,false,false);
  await clickControl(page,'command-a');await closed(page,true,false);
  await clickControl(page,'command-b');await closed(page,true,false);
  await expect(node(page,'b').locator('.interlocked-contact')).toHaveAttribute('data-blocked','true');
  await expect(node(page,'lamp-a')).toHaveClass(/\blive\b/);await expect(node(page,'lamp-b')).not.toHaveClass(/\blive\b/);
  await expect(link.locator('.current-flow')).toHaveCount(0);await expect(button(page,'Tạm dừng')).toBeVisible();
  await clickControl(page,'command-a');await closed(page,false,true);
  await expect(node(page,'lamp-b')).toHaveClass(/\blive\b/);
  await page.screenshot({path:test.info().outputPath('mechanical-interlock-handover.png')});
});

test('simultaneous held commands remain blocked and the palette/owner can add the new contact at rest',async({page})=>{
  const project=fixture(true);project.devices.filter(device=>device.kind==='switch').forEach(device=>device.enabled=true);
  await open(page,project);await button(page,'Chạy mô phỏng').click();await closed(page,false,false);
  for(const id of ['a','b'])await expect(node(page,id).locator('.interlocked-contact')).toHaveAttribute('data-blocked','true');
  await page.waitForTimeout(350);await closed(page,false,false);await expect(button(page,'Tạm dừng')).toBeVisible();
  await clickControl(page,'command-b');await closed(page,true,false);
  await button(page,'Đặt lại mô phỏng').click();
  await button(page,'Nhóm Cuộn hút & tiếp điểm').click();
  const palette=page.locator('.palette-expanded').getByRole('button',{name:'Thêm Tiếp điểm khóa chéo cơ khí',exact:true});
  await expect(palette.locator('.interlocked-contact')).toHaveAttribute('data-closed','false');
  await clickControl(page,'command-a',true);
  await page.getByTitle('Thêm tiếp điểm khóa chéo cơ khí cùng tên',{exact:true}).click();
  const added=(await saved(page)).devices.filter(device=>device.kind==='interlocked_contact');
  expect(added).toHaveLength(3);expect(added.at(-1)!.name).toBe('K1');
});
