import test from 'node:test';
import assert from 'node:assert/strict';
import { createDevice } from './catalog';
import { copySelection, pasteSelection } from './clipboard';
import { sensorExamples } from './sensorExamples';
import { createInitialState, stepSimulation, validateProject } from './simulation';
import type { DeviceKind, Project, Wire } from './types';

const device=(kind:DeviceKind,id:string,name=id)=>({...createDevice(kind,id,0,0),name});
const wire=(id:string,from:string,fromPort:string,to:string,toPort:string):Wire=>({id,from,fromPort,to,toPort,length:1,section:2.5});
const tick=(project:Project,previous=createInitialState(project))=>stepSimulation(project,previous,.1);

test('sensor examples produce the stated readings and threshold behaviour',()=>{
  const electrical=structuredClone(sensorExamples[0].project);
  let state=tick(electrical);
  assert.deepEqual(state.events,[]);
  assert.equal(state.devices['meter-voltage'].measurement?.value,24);
  assert.equal(state.devices['meter-current'].measurement?.value,2);
  assert.equal(state.devices['meter-power'].measurement?.value,48);
  const process=structuredClone(sensorExamples[1].project);
  state=tick(process);assert.equal(state.devices['level-lamp'].energized,false);
  process.devices.find(d=>d.id==='level-sensor')!.params.inputValue=70;
  state=tick(process,state);assert.equal(state.devices['level-lamp'].energized,true);
  process.devices.find(d=>d.id==='level-sensor')!.params.inputValue=65;
  state=tick(process,state);assert.equal(state.devices['level-lamp'].energized,true);
  process.devices.find(d=>d.id==='level-sensor')!.params.inputValue=64;
  state=tick(process,state);assert.equal(state.devices['level-lamp'].energized,false);
  assert.deepEqual(state.events,[]);
});

test('parallel voltage probes never provide a return path for a floating coil',()=>{
  const project:Project={version:2,name:'High impedance probes',devices:[device('dc','source'),device('coil','coil'),device('voltage_sensor','meter')],wires:[
    wire('a','source','+','coil','A1'),wire('b','coil','A2','meter','V+'),wire('c','meter','V-','source','-'),
  ]};
  const state=tick(project);
  assert.equal(state.devices.coil.coilEnergized,false);
  assert.ok(Object.values(state.wires).every(value=>!value.energized));
  assert.deepEqual(state.events,[]);
});

test('inline ammeters preserve a closed circuit, while an ammeter across source poles is a real short',()=>{
  const project:Project={version:2,name:'Inline current sensor',devices:[device('dc','source'),device('current_sensor','meter'),device('coil','coil')],wires:[
    wire('a','source','+','meter','1'),wire('b','meter','2','coil','A1'),wire('c','coil','A2','source','-'),
  ]};
  let state=tick(project);
  assert.equal(state.devices.coil.coilEnergized,true);
  assert.equal(state.wires.a.energized,true);
  assert.equal(state.devices.meter.measurement?.value,null,'coil current requires an actual coil impedance model');
  assert.deepEqual(state.events,[]);
  project.wires.push(wire('short','meter','2','source','-'));
  state=tick(project,state);
  assert.ok(state.events.some(event=>event.message.includes('nối tắt')));
  assert.equal(state.devices.meter.measurement,undefined,'fault must clear old readings');
});

test('power meter voltage terminals are isolated from its series current channel',()=>{
  const project:Project={version:2,name:'Separate meter channels',devices:[device('dc','source'),device('power_sensor','meter'),device('lamp','lamp')],wires:[
    wire('u1','source','+','meter','U1'),wire('u2','source','-','meter','U2'),
    wire('i1','meter','I1','lamp','1'),wire('i2','lamp','2','meter','I2'),
  ]};
  const state=tick(project);
  assert.equal(state.devices.lamp.energized,false);
  assert.deepEqual(state.events,[]);
});

function processFixture(){
  const sensor=device('process_sensor','sensor','BT1');
  Object.assign(sensor.params,{inputValue:0,threshold:50,hysteresis:5,comparison:0});
  const project:Project={version:2,name:'Threshold contact test',devices:[device('dc','source'),sensor,device('contact_no','no','BT1'),device('contact_nc','nc','BT1'),device('contact_co','co','BT1'),device('lamp','lamp')],wires:[
    wire('supply','source','+','sensor','A1'),wire('return','sensor','A2','source','-'),
    wire('feed','source','+','no','13'),wire('output','no','14','lamp','1'),wire('load-return','lamp','2','source','-'),
  ]};
  return {project,sensor};
}

test('a process sensor changes named NO/NC/CO with hysteresis and releases on power loss',()=>{
  const {project,sensor}=processFixture();
  assert.ok(!validateProject(project).some(issue=>issue.message.includes('cơ cấu điều khiển')));
  let state=tick(project);
  assert.equal(state.devices.sensor.sensorOutput,false);
  assert.equal(state.devices.no.contactClosed,false);
  assert.equal(state.devices.nc.contactClosed,true);
  sensor.params.inputValue=55;
  state=tick(project,state);
  assert.equal(state.devices.sensor.sensorOutput,true);
  assert.equal(state.devices.sensor.measurement?.quality,'simulated');
  assert.equal(state.devices.sensor.measurement?.value,55);
  assert.equal(state.devices.no.contactClosed,true);
  assert.equal(state.devices.nc.contactClosed,false);
  assert.equal(state.devices.co.coilEnergized,true);
  assert.equal(state.devices.lamp.energized,true);
  sensor.params.inputValue=48;state=tick(project,state);
  assert.equal(state.devices.sensor.sensorOutput,true,'retain output inside hysteresis band');
  sensor.params.inputValue=44;state=tick(project,state);
  assert.equal(state.devices.sensor.sensorOutput,false);
  assert.equal(state.devices.lamp.energized,false);
  sensor.params.inputValue=60;state=tick(project,state);
  assert.equal(state.devices.sensor.sensorOutput,true);
  project.wires=project.wires.filter(w=>w.id!=='supply');state=tick(project,state);
  assert.equal(state.devices.sensor.sensorOutput,false);
  assert.equal(state.devices.no.contactClosed,false);
  assert.equal(state.devices.nc.contactClosed,true);
});

test('process sensor controls survive a grouped copy without controlling the original circuit',()=>{
  const {project}=processFixture();
  let index=0;
  const pasted=pasteSelection(project,copySelection(project,['sensor','no','nc','co']),{x:200,y:0},()=>`new-${++index}`);
  const added=pasted.project.devices.filter(d=>pasted.deviceIds.includes(d.id));
  assert.equal(new Set(added.map(d=>d.name)).size,1);
  assert.notEqual(added[0].name,'BT1');
  assert.equal(project.devices.find(d=>d.id==='sensor')?.name,'BT1');
});

test('changing a process measurement function resets the previous hysteresis latch',()=>{
  const {project,sensor}=processFixture();
  sensor.params.inputValue=55;
  let state=tick(project);
  assert.equal(state.devices.sensor.sensorOutput,true);
  sensor.params.sensorFunction=1;
  sensor.params.inputValue=48;
  state=tick(project,state);
  assert.equal(state.devices.sensor.measurement?.unit,'bar');
  assert.equal(state.devices.sensor.sensorOutput,false,'the new pressure function has not crossed its threshold');
  assert.equal(state.devices.lamp.energized,false);
});

test('changing high and low comparator modes cannot inherit the opposite hysteresis latch',()=>{
  const {project,sensor}=processFixture();
  sensor.params.inputValue=55;
  let state=tick(project);
  assert.equal(state.devices.sensor.sensorOutput,true);
  sensor.params.comparison=1;
  sensor.params.inputValue=53;
  state=tick(project,state);
  assert.equal(state.devices.sensor.sensorOutput,false,'53 has not reached the new low threshold of 50');
  sensor.params.inputValue=48;
  state=tick(project,state);
  assert.equal(state.devices.sensor.sensorOutput,true);
  sensor.params.comparison=0;
  state=tick(project,state);
  assert.equal(state.devices.sensor.sensorOutput,false,'48 has not reached the new high threshold of 50');
});

test('new process threshold and hysteresis settings start a fresh comparator decision',()=>{
  const {project,sensor}=processFixture();
  sensor.params.inputValue=55;
  let state=tick(project);
  assert.equal(state.devices.sensor.sensorOutput,true);
  sensor.params.threshold=100;
  sensor.params.inputValue=98;
  state=tick(project,state);
  assert.equal(state.devices.sensor.sensorOutput,false,'an old latch cannot activate below a newly raised threshold');
  sensor.params.inputValue=105;
  state=tick(project,state);
  assert.equal(state.devices.sensor.sensorOutput,true);
  sensor.params.hysteresis=10;
  sensor.params.inputValue=98;
  state=tick(project,state);
  assert.equal(state.devices.sensor.sensorOutput,false,'changing the hysteresis width resets its stored decision');
});
