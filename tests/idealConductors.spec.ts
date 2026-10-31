import { test, expect, type Page } from '@playwright/test';
import { createDevice } from '../src/model/catalog';
import type { DeviceKind, Project, Wire } from '../src/model/types';

const device=(kind:DeviceKind,id:string,name:string,x:number,y:number)=>({...createDevice(kind,id,x,y),name});
const wire=(id:string,from:string,fromPort:string,to:string,toPort:string):Wire=>({id,from,fromPort,to,toPort,length:1,section:2.5});
const node=(page:Page,id:string)=>page.locator(`.react-flow__node[data-id="${id}"] .equipment-node`);
const edge=(page:Page,id:string)=>page.locator(`.react-flow__edge[data-id="${id}"] .schematic-wire`);

test('pressing Start cannot pick up unfed relays through a shared return and create a false source short',async({page},info)=>{
  const project:Project={version:2,name:'Cuộn hút hở đầu cấp · Dây về chung',devices:[
    device('ac1','source','G1',80,160),device('push_no','start','S1',330,160),device('lamp','load','H1',340,340),
    device('terminal_block','return-a','X1',340,550),device('terminal_block','return-b','X2',700,550),
    device('coil','a','K1',540,340),device('coil','b','K2',720,340),device('contact_no','contact','K1',990,160),
  ],wires:[
    wire('feed','source','L','start','1'),wire('switched','start','2','load','1'),wire('load-return','load','2','return-a','1'),
    wire('bus','return-a','2','return-b','1'),wire('return','return-b','2','source','N'),
    wire('floating-feed','a','A1','b','A1'),wire('a-return','a','A2','return-a','1'),wire('b-return','b','A2','return-b','1'),
    wire('contact-feed','source','L','contact','13'),wire('contact-return','contact','14','source','N'),
  ]};
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles({name:'unfed-relays.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});
  await expect(page.locator('.react-flow__node')).toHaveCount(project.devices.length);
  await page.getByRole('button',{name:'Chạy mô phỏng',exact:true}).click();
  await node(page,'start').focus();await page.keyboard.down('Enter');
  await expect(node(page,'load')).toHaveClass(/\blive\b/);
  await page.waitForTimeout(500);
  for(const id of ['a','b'])await expect(node(page,id)).not.toHaveClass(/\blive\b/);
  for(const id of ['feed','switched','load-return','bus','return'])await expect(edge(page,id).locator('.current-flow')).toHaveCount(1);
  for(const id of ['floating-feed','a-return','b-return','contact-return'])await expect(edge(page,id).locator('.current-flow')).toHaveCount(0);
  await page.screenshot({path:info.outputPath('no-phantom-relay-pickup.png')});
  await page.keyboard.up('Enter');await expect(node(page,'load')).not.toHaveClass(/\blive\b/);
  await page.getByRole('button',{name:'Trạng thái và nhật ký',exact:true}).click();
  await expect(page.getByText('Phát hiện nối tắt giữa các cực nguồn.',{exact:false})).toHaveCount(0);
});
