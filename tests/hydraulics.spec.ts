import { expect, test, type Page } from '@playwright/test';
import { createDevice, getDefinition } from '../src/model/catalog';
import type { Device, DeviceKind, Project, Wire } from '../src/model/types';

const storageKey='electrical-studio.project.v2';
const node=(page:Page,id:string)=>page.locator(`.react-flow__node[data-id="${id}"]`);
const button=(page:Page,name:string)=>page.getByRole('button',{name,exact:true});
const saved=(page:Page):Promise<Project>=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),storageKey);
const device=(kind:DeviceKind,id:string,x:number,y:number,params:Record<string,number>={}):Device=>{const item=createDevice(kind,id,x,y);return {...item,name:id,params:{...item.params,...params}};};
const wire=(id:string,from:string,fromPort:string,to:string,toPort:string):Wire=>({id,from,fromPort,to,toPort,length:1,section:2.5});
async function open(page:Page,project:Project){
  await page.addInitScript(({key,project})=>localStorage.setItem(key,JSON.stringify(project)),{key:storageKey,project});
  await page.goto('/');await expect(page.locator('.react-flow__node')).toHaveCount(project.devices.length);
}
async function properties(page:Page,id:string){
  const close=button(page,'Đóng thuộc tính');if(await close.isVisible())await close.click();
  await node(page,id).locator('.hydraulic-symbol').dblclick();
  await expect(page.getByRole('textbox',{name:'Tên thiết bị',exact:true})).toBeVisible();
}

test('hydraulic group contains configurable components and named sensor contacts',async({page})=>{
  await open(page,{version:2,name:'Hydraulics',devices:[],wires:[]});
  await button(page,`Nhóm ${getDefinition('hydraulic_pump').category}`).click();
  const palette=page.locator('.palette-expanded');await expect(palette.locator('.symbol-tool')).toHaveCount(9);
  for(const kind of ['water_tank','hydraulic_valve','level_sensor'] as const)await palette.getByRole('button',{name:`Thêm ${getDefinition(kind).name}`,exact:true}).click();
  const initial=await saved(page),tank=initial.devices.find(item=>item.kind==='water_tank')!,sensor=initial.devices.find(item=>item.kind==='level_sensor')!,valve=initial.devices.find(item=>item.kind==='hydraulic_valve')!;
  await page.getByRole('combobox',{name:'Bình chứa cần đo',exact:true}).selectOption(tank.id);
  expect((await saved(page)).devices.find(item=>item.id===sensor.id)?.tankId).toBe(tank.id);
  await page.getByTitle('Thêm tiếp điểm thường mở cùng tên',{exact:true}).click();
  const edited=await saved(page);
  expect(edited.devices.find(item=>item.kind==='contact_no')?.name).toBe(sensor.name);
  // Palette insertion places parts near the viewport centre. Spread this fixture
  // before exercising on-canvas clicks, and verify the binding survives import.
  edited.devices=edited.devices.map((part,index)=>({...part,x:120+index*200,y:200}));
  await page.locator('input[type="file"]').setInputFiles({name:'hydraulics.electrical.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(edited))});
  await expect(page.locator('.react-flow__node')).toHaveCount(edited.devices.length);
  await expect.poll(async()=>(await saved(page)).devices.find(item=>item.id===sensor.id)?.tankId).toBe(tank.id);
  await page.waitForTimeout(450); // Import animates fit-to-view.
  await properties(page,valve.id);
  await page.getByRole('combobox',{name:'Loại van',exact:true}).selectOption('2');
  await expect(node(page,valve.id).locator('.hydraulic-valve')).toHaveAttribute('data-valve-mode','2');
  await button(page,'Chạy mô phỏng').click();
  await expect(node(page,valve.id).locator('.equipment-node')).not.toHaveClass(/\bactuatable\b/);
  await page.getByRole('combobox',{name:'Loại van',exact:true}).selectOption('0');
  await expect(node(page,valve.id).locator('.equipment-node')).toHaveClass(/\bactuatable\b/);
  await node(page,valve.id).locator('.equipment-node').focus();await page.keyboard.press('Enter');
  expect((await saved(page)).devices.find(item=>item.id===valve.id)?.enabled).toBe(!valve.enabled);
});

test('shaft-driven pump animates pipes and transfers actual tank volume',async({page})=>{
  const driver={...device('diesel','D1',390,510),enabled:true};
  const tankIn=device('water_tank','T1',100,220,{capacityL:1000,initialLevel:80});
  const tankOut=device('water_tank','T2',900,220,{capacityL:1000,initialLevel:10,pressureBar:1});
  const level={...device('level_sensor','LS1',1000,430,{threshold:5}),tankId:'T2'};
  const project:Project={version:2,name:'Water transfer',devices:[tankIn,device('hydraulic_pump','P1',400,280,{flowRate:600,pressureBar:3}),driver,device('flow_sensor','FS1',650,300),tankOut,device('pressure_sensor','PS1',650,100,{threshold:.5}),level],wires:[
    wire('suction','T1','OUT','P1','IN'),wire('drive','D1','shaft','P1','shaft'),wire('outlet','P1','OUT','FS1','IN'),wire('delivery','FS1','OUT','T2','IN'),wire('pressure','PS1','P','P1','OUT'),
  ]};
  await open(page,project);await button(page,'Chạy mô phỏng').click();
  await expect(page.locator('.hydraulic-pipe.conducting')).toHaveCount(3);
  await expect(node(page,'PS1').locator('.hydraulic-sensor')).toHaveAttribute('data-sensor-output','true');
  await expect(node(page,'LS1').locator('.hydraulic-sensor')).toHaveAttribute('data-sensor-output','true');
  await expect.poll(async()=>Number(await node(page,'T1').locator('.water-tank').getAttribute('data-level-percent'))).toBeLessThan(80);
  await expect.poll(async()=>Number(await node(page,'T2').locator('.water-tank').getAttribute('data-level-percent'))).toBeGreaterThan(10);
  await expect(node(page,'FS1').locator('.hydraulic-reading').last()).toContainText('L/min');
  await page.screenshot({path:test.info().outputPath('hydraulic-transfer.png')});
  await button(page,'Đặt lại mô phỏng').click();
  await expect(node(page,'T1').locator('.water-tank')).toHaveAttribute('data-level-percent','80');
  await expect(node(page,'T2').locator('.water-tank')).toHaveAttribute('data-level-percent','10');
  await expect(page.locator('.water-flow')).toHaveCount(0);
});
