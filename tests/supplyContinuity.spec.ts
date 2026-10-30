import { test, expect, type Page } from '@playwright/test';
import { createDevice } from '../src/model/catalog';
import type { DeviceKind, Project, Wire } from '../src/model/types';

const device=(kind:DeviceKind,id:string,name:string,x:number,y:number)=>({...createDevice(kind,id,x,y),name});
const wire=(id:string,from:string,fromPort:string,to:string,toPort:string):Wire=>({id,from,fromPort,to,toPort,length:1,section:2.5});
const node=(page:Page,id:string)=>page.locator(`.react-flow__node[data-id="${id}"] .equipment-node`);
const edge=(page:Page,id:string)=>page.locator(`.react-flow__edge[data-id="${id}"] .schematic-wire`);
async function open(page:Page,project:Project){
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles({name:'continuity.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});
  await expect(page.locator('.react-flow__node')).toHaveCount(project.devices.length);
  await page.getByRole('button',{name:'Chạy mô phỏng',exact:true}).click();
}

test('line-to-line transformer and named nets retain both coils after Start is released',async({page},info)=>{
  const breaker=device('breaker1','breaker','Q1',220,50);breaker.enabled=true;
  const project:Project={version:2,name:'Biến áp cách ly · Tự giữ',devices:[
    device('ac3','source','G1',40,70),breaker,device('transformer1','transformer','T1',330,150),
    device('net_label','live-in','L220V',520,160),device('net_label','return-in','N220V',520,310),
    device('offpage','live-out','L220V',700,80),device('offpage','return-out','N220V',700,640),
    device('push_nc','stop','D1',820,100),device('push_no','start','S1',820,280),
    device('contact_no','hold','AUX3',1010,280),device('coil','aux','AUX3',820,470),device('coil','main','MC3',1010,470),
  ],wires:[
    wire('primary1','source','L1','breaker','1'),wire('primary-through','breaker','2','transformer','P1'),wire('primary2','source','L2','transformer','P2'),
    wire('secondary1','transformer','S1','live-in','P'),wire('secondary2','transformer','S2','return-in','P'),
    wire('feed','live-out','P','stop','1'),wire('start-feed','stop','2','start','1'),wire('start-out','start','2','aux','A1'),
    wire('hold-feed','stop','2','hold','13'),wire('hold-out','hold','14','aux','A1'),
    wire('return','aux','A2','return-out','P'),wire('main-feed','aux','A1','main','A1'),wire('main-return','main','A2','aux','A2'),
  ]};
  await open(page,project);
  await expect(node(page,'aux')).not.toHaveClass(/\blive\b/);
  await expect(edge(page,'feed')).toHaveClass(/\bpowered\b/);
  await expect(edge(page,'feed').locator('.current-flow')).toHaveCount(0);
  await node(page,'start').focus();await page.keyboard.down('Enter');
  await expect(node(page,'aux')).toHaveClass(/\blive\b/);await expect(node(page,'main')).toHaveClass(/\blive\b/);
  await page.keyboard.up('Enter');
  // Wait across many simulation ticks; a transient green frame is not a latch.
  await page.waitForTimeout(1100);
  for(const id of ['aux','main','hold'])await expect(node(page,id)).toHaveClass(/\blive\b/);
  await expect(edge(page,'hold-out').locator('.current-flow')).toHaveCount(1);
  await page.screenshot({path:info.outputPath('transformer-self-hold.png')});
  await node(page,'stop').focus();await page.keyboard.down('Enter');
  await expect(node(page,'aux')).not.toHaveClass(/\blive\b/);await page.keyboard.up('Enter');
  await page.waitForTimeout(300);await expect(node(page,'main')).not.toHaveClass(/\blive\b/);
  await node(page,'start').focus();await page.keyboard.down('Enter');await expect(node(page,'aux')).toHaveClass(/\blive\b/);await page.keyboard.up('Enter');
  await node(page,'breaker').focus();await page.keyboard.press('Enter');
  for(const id of ['transformer','aux','main'])await expect(node(page,id)).not.toHaveClass(/\blive\b/);
  await page.keyboard.press('Enter');await expect(node(page,'transformer')).toHaveClass(/\blive\b/);
  await page.waitForTimeout(300);await expect(node(page,'aux')).not.toHaveClass(/\blive\b/);
});

test('closed contacts power all three unloaded busbars without animating load current',async({page},info)=>{
  const breaker=device('breaker','breaker','Q1',100,220);breaker.enabled=true;
  const owner=device('switch','owner','MC0',660,80);owner.enabled=true;
  const project:Project={version:2,name:'Ba thanh cái · Có điện tới tiếp điểm mở',devices:[device('ac3','source','G1',80,30),breaker,owner],wires:[]};
  for(let phase=1;phase<=3;phase++){
    const x=100+(phase-1)*180;
    project.devices.push(device('contact_no',`closed-${phase}`,'MC0',x,420),device('junction',`tap-${phase}`,`J${phase}`,x+34,574+phase*40),device('contact_no',`open-${phase}`,'MC1',x+460,560),device('lamp',`lamp-${phase}`,`H${phase}`,x+470,770));
    project.wires.push(wire(`source-${phase}`,'source',`L${phase}`,'breaker',String(phase*2-1)),wire(`cb-${phase}`,'breaker',String(phase*2),`closed-${phase}`,'13'),wire(`link-${phase}`,`closed-${phase}`,'14',`tap-${phase}`,'J'),wire(`bus-${phase}`,`tap-${phase}`,'J',`open-${phase}`,'13'),wire(`output-${phase}`,`open-${phase}`,'14',`lamp-${phase}`,'1'));
  }
  await open(page,project);
  for(let phase=1;phase<=3;phase++){
    for(const prefix of ['source','cb','link','bus'])await expect(edge(page,`${prefix}-${phase}`)).toHaveClass(/\bpowered\b/);
    await expect(node(page,`closed-${phase}`)).toHaveClass(/\blive\b/);
    await expect(edge(page,`output-${phase}`)).not.toHaveClass(/\bpowered\b/);
    await expect(node(page,`lamp-${phase}`)).not.toHaveClass(/\blive\b/);
  }
  await expect(page.locator('.current-flow')).toHaveCount(0);
  await page.screenshot({path:info.outputPath('unloaded-busbars.png')});
  await node(page,'owner').focus();await page.keyboard.press('Enter');
  for(let phase=1;phase<=3;phase++){
    await expect(edge(page,`cb-${phase}`)).toHaveClass(/\bpowered\b/);
    await expect(edge(page,`bus-${phase}`)).not.toHaveClass(/\bpowered\b/);
  }
  await node(page,'breaker').focus();await page.keyboard.press('Enter');
  for(let phase=1;phase<=3;phase++)await expect(edge(page,`cb-${phase}`)).not.toHaveClass(/\bpowered\b/);
});
