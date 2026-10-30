import test from 'node:test';
import assert from 'node:assert/strict';
import { catalog, createDevice } from './catalog';
import { examples } from './examples';
import { parseProject, serializeProject, STORAGE_KEY } from './persistence';
import type { Project } from './types';
const sample=()=>structuredClone(examples[0].project);
test('all terminal examples round-trip without data loss',()=>{for(const example of examples){const result=parseProject(serializeProject(example.project));assert.deepEqual(result,JSON.parse(JSON.stringify(example.project)));}});
test('all library devices can be saved as an unfinished draft',()=>{const p:Project={version:2,name:'Draft',devices:catalog.map((d,i)=>createDevice(d.kind,`d${i}`,i*100,0)),wires:[]};assert.deepEqual(parseProject(serializeProject(p)),p);});
test('rotation, route and wire color persist',()=>{const p=sample();p.devices[0].rotation=90;p.wires[0].color='#dd3344';p.wires[0].waypoints=[{x:100,y:25}];assert.deepEqual(parseProject(serializeProject(p)),JSON.parse(JSON.stringify(p)));});
test('movable and hidden labels and excitation roles round-trip',()=>{
  const p=sample(),motor=p.devices.find(device=>device.kind==='dc_motor')!,field=p.devices.find(device=>device.kind==='field_winding')!;
  motor.labelOffset={x:-85,y:23};motor.hiddenLabel=true;motor.fieldMode='compound';field.windingRole='series';
  assert.deepEqual(parseProject(serializeProject(p)),JSON.parse(JSON.stringify(p)));
});
test('old v2 drafts remain readable without inventing an excitation circuit',()=>{
  const p=sample();p.devices=p.devices.filter(device=>device.kind!=='field_winding');p.wires=p.wires.filter(wire=>p.devices.some(device=>device.id===wire.from)&&p.devices.some(device=>device.id===wire.to));
  for(const device of p.devices){delete device.fieldMode;delete device.windingRole;delete device.hiddenLabel;delete device.labelOffset;}
  assert.deepEqual(parseProject(serializeProject(p)),JSON.parse(JSON.stringify(p)));
});
test('shared apparatus designations are allowed and preserved verbatim',()=>{
  const p:Project={version:2,name:'Linked devices',devices:[createDevice('coil','k',0,0),createDevice('contact_no','no',200,0),createDevice('contact_nc','nc',400,0)],wires:[]};
  for(const device of p.devices)device.name=' KM1 ';
  const result=parseProject(serializeProject(p));assert.ok(result.devices.every(device=>device.name===' KM1 '));
});
test('malformed labels and excitation settings are rejected',()=>{
  for(const mutate of [(p:any)=>p.devices[0].hiddenLabel='yes',(p:any)=>p.devices[0].labelOffset={x:NaN,y:0},(p:any)=>p.devices[0].labelOffset={x:0,y:20000},(p:any)=>p.devices[0].fieldMode='permanent',(p:any)=>p.devices[0].windingRole='unknown']){const p=sample();mutate(p);assert.throws(()=>parseProject(JSON.stringify(p)));}
});
test('timer mode and delay survive export and invalid modes fail import',()=>{
  const p:Project={version:2,name:'Off delay',devices:[createDevice('timer_coil','timer',0,0)],wires:[]};
  p.devices[0].params.timerMode=1;p.devices[0].params.delaySeconds=2.5;
  assert.deepEqual(parseProject(serializeProject(p)),p);
  p.devices[0].params.timerMode=.5;assert.throws(()=>parseProject(JSON.stringify(p)),/rơle thời gian/);
});
test('legacy one-line projects are rejected clearly and use a separate key',()=>{assert.match(STORAGE_KEY,/v2$/);assert.throws(()=>parseProject(JSON.stringify({...sample(),version:1})),/phiên bản 1/);});
test('invalid and unknown fields are rejected',()=>{assert.throws(()=>parseProject('{'));for(const mutate of [(p:any)=>p.devices[0].kind='unknown',(p:any)=>p.devices[0].rotation=45,(p:any)=>p.devices[0].x=null,(p:any)=>p.wires[0].fromPort='out',(p:any)=>p.wires[0].color='red',(p:any)=>p.wires[0].waypoints=[{x:Infinity,y:0}],(p:any)=>p.devices[0].params.hack=1]){const p=sample();mutate(p);assert.throws(()=>parseProject(JSON.stringify(p)));}});
test('duplicate IDs, duplicate reversed wires and dangerous IDs fail validation',()=>{for(const mutate of [(p:any)=>p.devices[1].id=p.devices[0].id,(p:any)=>p.devices[0].id='__proto__',(p:any)=>{const w=p.wires[0];p.wires.push({...w,id:'reverse',from:w.to,to:w.from,fromPort:w.toPort,toPort:w.fromPort});}]){const p=sample();mutate(p);assert.throws(()=>parseProject(JSON.stringify(p)));}});
test('invalid import does not mutate the current project',()=>{const p=sample(),before=JSON.stringify(p);assert.throws(()=>parseProject('{'));assert.equal(JSON.stringify(p),before);});
