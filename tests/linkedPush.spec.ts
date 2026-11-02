import { expect, test, type Page } from '@playwright/test';
import { createDevice } from '../src/model/catalog';
import type { DeviceKind, Project, Wire } from '../src/model/types';

const key='electrical-studio.project.v2';
const node=(page:Page,id:string)=>page.locator(`.react-flow__node[data-id="${id}"] .equipment-node`);
const button=(page:Page,name:string)=>page.getByRole('button',{name,exact:true});
const saved=(page:Page):Promise<Project>=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),key);
const device=(kind:DeviceKind,id:string,name:string,x:number,y:number)=>({...createDevice(kind,id,x,y),name});
const wire=(id:string,from:string,fromPort:string,to:string,toPort:string):Wire=>({id,from,fromPort,to,toPort,length:1,section:2.5});

function fixture():Project{
  return {version:2,name:'Nút nhấn liên động',devices:[
    device('linked_push','button','SB1',140,60),device('dc','source','G1',80,240),
    device('contact_no','no','SB1',340,230),device('contact_nc','nc','SB1',540,230),device('contact_co','co','SB1',780,230),
    device('lamp','no-lamp','H1',350,450),device('lamp','nc-lamp','H2',550,450),device('lamp','co-rest','H3',740,450),device('lamp','co-held','H4',900,450),
  ],wires:[
    wire('no-feed','source','+','no','13'),wire('no-out','no','14','no-lamp','1'),wire('no-return','no-lamp','2','source','-'),
    wire('nc-feed','source','+','nc','21'),wire('nc-out','nc','22','nc-lamp','1'),wire('nc-return','nc-lamp','2','source','-'),
    wire('co-feed','source','+','co','11'),wire('co-rest-out','co','12','co-rest','1'),wire('co-rest-return','co-rest','2','source','-'),
    wire('co-held-out','co','14','co-held','1'),wire('co-held-return','co-held','2','source','-'),
  ]};
}

async function open(page:Page,project:Project){
  await page.addInitScript(({key,project})=>localStorage.setItem(key,JSON.stringify(project)),{key,project});
  await page.goto('/');
  await expect(page.locator('.react-flow__node')).toHaveCount(project.devices.length);
}
async function expectHeld(page:Page,held:boolean){
  await expect(node(page,'button').locator('.linked-push')).toHaveAttribute('data-actuated',String(held));
  for(const [id,on] of [['no-lamp',held],['nc-lamp',!held],['co-rest',!held],['co-held',held]] as const){
    if(on)await expect(node(page,id)).toHaveClass(/\blive\b/);
    else await expect(node(page,id)).not.toHaveClass(/\blive\b/);
  }
}

test('linked pushbutton is available with separate NO, NC and CO insertion',async({page})=>{
  await open(page,{version:2,name:'Blank',devices:[],wires:[]});
  await button(page,'Nhóm Điều khiển').click();
  const palette=button(page,'Thêm Nút nhấn liên động');
  await expect(palette.locator('.linked-push')).toHaveAttribute('data-actuated','false');
  await palette.click();
  const owner=(await saved(page)).devices.find(device=>device.kind==='linked_push')!;
  expect(owner.name).toBe('SB1');expect(owner.enabled).toBe(false);
  await expect(node(page,owner.id).locator('.react-flow__handle')).toHaveCount(0);
  for(const label of ['NO','NC','CO']){
    await node(page,owner.id).locator('.linked-push rect').dblclick();
    await button(page,label).click();
  }
  const project=await saved(page);
  expect(project.devices.map(device=>device.kind).sort()).toEqual(['linked_push','contact_no','contact_nc','contact_co'].sort());
  expect(project.devices.every(device=>device.name==='SB1')).toBe(true);
});

test('held mouse and keyboard operate linked contacts and release on outside, blur and pause',async({page})=>{
  await open(page,fixture());await button(page,'Chạy mô phỏng').click();await expectHeld(page,false);
  const head=node(page,'button').locator('.linked-push rect');
  await head.hover();await page.mouse.down();await expectHeld(page,true);
  await page.mouse.move(1350,900);await page.mouse.up();await expectHeld(page,false);
  // A completed click must not be followed by a second, latched onNodeClick toggle.
  await head.click();await expectHeld(page,false);
  await node(page,'button').focus();await page.keyboard.down('Space');await expectHeld(page,true);
  await page.keyboard.up('Space');await expectHeld(page,false);
  await page.keyboard.down('Enter');await expectHeld(page,true);
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await expectHeld(page,false);
  await page.keyboard.up('Enter');
  await node(page,'button').focus();await page.keyboard.down('Space');await expectHeld(page,true);
  await button(page,'Tạm dừng').click();await page.keyboard.up('Space');await expectHeld(page,false);
  await button(page,'Chạy mô phỏng').click();await expectHeld(page,false);
  await node(page,'button').focus();await page.keyboard.down('Enter');await expectHeld(page,true);
  await button(page,'Đặt lại mô phỏng').click();await page.keyboard.up('Enter');
  await expect(node(page,'button').locator('.linked-push')).toHaveAttribute('data-actuated','false');
  await button(page,'Chạy mô phỏng').click();await expectHeld(page,false);
});

test('opening a file saved during a press restores the linked button released',async({page})=>{
  const project=fixture();project.devices[0].enabled=true;
  await open(page,project);
  await expect(node(page,'button').locator('.linked-push')).toHaveAttribute('data-actuated','false');
  await button(page,'Chạy mô phỏng').click();await expectHeld(page,false);
});
