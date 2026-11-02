import { expect, test, type Page } from '@playwright/test';
import { createDevice, getDefinition } from '../src/model/catalog';
import { sensorKinds } from '../src/model/sensors';
import type { Device, DeviceKind, Project, Wire } from '../src/model/types';

const storageKey='electrical-studio.project.v2';
const node=(page:Page,id:string)=>page.locator(`.react-flow__node[data-id="${id}"]`);
const reading=(page:Page,id:string)=>node(page,id).locator('.sensor-reading');
const saved=(page:Page):Promise<Project>=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)||'null'),storageKey);
const device=(kind:DeviceKind,id:string,x:number,y:number,params:Record<string,number>={},name=id):Device=>{const item=createDevice(kind,id,x,y);return {...item,name,params:{...item.params,...params}};};
const wire=(id:string,from:string,fromPort:string,to:string,toPort:string):Wire=>({id,from,fromPort,to,toPort,length:1,section:2.5});
async function load(page:Page,project:Project){
  await page.locator('input[type="file"]').setInputFiles({name:'sensors.electrical.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});
  await expect(page.locator('.react-flow__node')).toHaveCount(project.devices.length);
  await page.waitForTimeout(450); // Import animates fit-to-view.
}
async function number(page:Page,label:string,value:number){await page.getByRole('spinbutton',{name:label,exact:true}).fill(String(value));await page.getByRole('spinbutton',{name:label,exact:true}).press('Enter');}
async function properties(page:Page,id:string){
  const close=page.getByRole('button',{name:'Đóng thuộc tính',exact:true});if(await close.isVisible())await close.click();
  await node(page,id).locator('.sensor-symbol').dblclick();
  await expect(page.getByRole('textbox',{name:'Tên thiết bị',exact:true})).toBeVisible();
}

test('sensor palette, configurable functions and settings survive file reload',async({page})=>{
  await page.goto('/');await load(page,{version:2,name:'Sensor palette',devices:[],wires:[]});
  await page.getByRole('button',{name:'Nhóm Đo lường & cảm biến',exact:true}).click();
  await expect(page.locator('.palette-expanded .symbol-tool')).toHaveCount(6);
  for(const kind of sensorKinds)await page.locator('.palette-expanded').getByRole('button',{name:`Thêm ${getDefinition(kind).name}`,exact:true}).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(6);
  await expect(page.locator('.sensor-reading')).toHaveText(['—','—','—','—','—','—']);
  expect(await page.locator('.react-flow__node .sensor-symbol>path').evaluateAll(paths=>paths.every(path=>getComputedStyle(path).stroke!=='none'))).toBe(true);
  await page.getByRole('combobox',{name:'Đại lượng đo',exact:true}).selectOption('1');
  await number(page,'Giá trị đầu vào',3.5);await number(page,'Ngưỡng tác động',2);await number(page,'Độ trễ hồi phục',.2);
  await number(page,'Giá trị đầu vào',1000001);await expect(page.getByRole('spinbutton',{name:'Giá trị đầu vào',exact:true})).toHaveValue('3.5');
  const project=await saved(page),sensor=project.devices.find(item=>item.kind==='process_sensor')!;
  expect(sensor.params).toMatchObject({sensorFunction:1,inputValue:3.5,threshold:2,hysteresis:.2});
  await page.getByTitle('Thêm tiếp điểm thường mở cùng tên',{exact:true}).click();
  const withContact=await saved(page);expect(withContact.devices.find(item=>item.kind==='contact_no')?.name).toBe(sensor.name);
  await load(page,withContact);await properties(page,sensor.id);
  await expect(page.getByRole('combobox',{name:'Đại lượng đo',exact:true})).toHaveValue('1');
  await expect(page.getByRole('spinbutton',{name:'Giá trị đầu vào',exact:true})).toHaveValue('3.5');
  await expect(page.getByRole('spinbutton',{name:'Ngưỡng tác động',exact:true})).toHaveValue('2');
  await expect(page.getByRole('spinbutton',{name:'Độ trễ hồi phục',exact:true})).toHaveValue('0.2');
});

test('voltage and current readouts measure a resistor circuit without loading it',async({page})=>{
  const project:Project={version:2,name:'24 V measurement',devices:[device('dc','source',100,200,{voltage:24}),device('current_sensor','ammeter',320,200),device('resistor','load',520,200,{resistance:12}),device('voltage_sensor','voltmeter',720,200)],wires:[
    wire('a','source','+','ammeter','1'),wire('b','ammeter','2','load','1'),wire('c','load','2','source','-'),wire('d','source','+','voltmeter','V+'),wire('e','source','-','voltmeter','V-'),
  ]};
  await page.goto('/');await load(page,project);
  await expect(reading(page,'voltmeter')).toHaveText('—');await expect(reading(page,'ammeter')).toHaveText('—');
  await page.getByRole('button',{name:'Chạy mô phỏng',exact:true}).click();
  await expect(reading(page,'voltmeter')).toHaveText('24 V');await expect(reading(page,'ammeter')).toHaveText('2 A');
  await expect(node(page,'load').locator('.equipment-node')).toHaveClass(/\blive\b/);
  await properties(page,'voltmeter');await expect(page.getByLabel('Giá trị đo',{exact:true})).toHaveText('24 V');
  await page.screenshot({path:test.info().outputPath('sensor-readouts.png')});
  await page.getByRole('button',{name:'Đặt lại mô phỏng',exact:true}).click();
  await expect(reading(page,'voltmeter')).toHaveText('—');await expect(reading(page,'ammeter')).toHaveText('—');
});

test('virtual process input operates linked contact with hysteresis and requires auxiliary supply',async({page})=>{
  const project:Project={version:2,name:'Pressure switch',devices:[device('dc','source',100,180),device('process_sensor','sensor',320,180,{sensorFunction:1,inputValue:0,threshold:5,hysteresis:1},'B1'),device('contact_no','contact',520,180,{},'B1'),device('lamp','lamp',700,180)],wires:[
    wire('aux+','source','+','sensor','A1'),wire('aux-','source','-','sensor','A2'),wire('feed','source','+','contact','13'),wire('output','contact','14','lamp','1'),wire('return','lamp','2','source','-'),
  ]};
  await page.goto('/');await load(page,project);await properties(page,'sensor');
  await page.getByRole('button',{name:'Chạy mô phỏng',exact:true}).click();
  await expect(node(page,'lamp').locator('.equipment-node')).not.toHaveClass(/\blive\b/);
  await number(page,'Giá trị đầu vào',6);
  await expect(reading(page,'sensor')).toHaveText('6 bar');await expect(page.getByText('Giá trị nhập để thử mạch',{exact:true})).toBeVisible();
  await expect(node(page,'lamp').locator('.equipment-node')).toHaveClass(/\blive\b/);
  await page.screenshot({path:test.info().outputPath('process-contact.png')});
  await number(page,'Giá trị đầu vào',4.5);await expect(node(page,'lamp').locator('.equipment-node')).toHaveClass(/\blive\b/);
  await number(page,'Giá trị đầu vào',3.9);await expect(node(page,'lamp').locator('.equipment-node')).not.toHaveClass(/\blive\b/);
  await number(page,'Giá trị đầu vào',6);await expect(node(page,'lamp').locator('.equipment-node')).toHaveClass(/\blive\b/);
  const unpowered=await saved(page);unpowered.wires=unpowered.wires.filter(item=>item.id!=='aux-');
  await load(page,unpowered);await page.getByRole('button',{name:'Chạy mô phỏng',exact:true}).click();
  await expect(reading(page,'sensor')).toHaveText('6 bar');await expect(node(page,'lamp').locator('.equipment-node')).not.toHaveClass(/\blive\b/);
});
