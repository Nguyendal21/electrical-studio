import test from 'node:test';
import assert from 'node:assert/strict';
import { canActuate, createDevice, getDefinition } from './catalog';
import { copySelection, pasteSelection } from './clipboard';
import { getPortGeometry } from './geometry';
import { parseProject, serializeProject } from './persistence';
import { createInitialState, stepSimulation } from './simulation';
import type { DeviceKind, Project, Wire } from './types';

test('single-pole thermal relay persists, trips named contacts without opening its main path, resets and copies as one apparatus',()=>{
  const device=(kind:DeviceKind,id:string,name=id)=>({...createDevice(kind,id,0,0),name});
  const wire=(id:string,from:string,fromPort:string,to:string,toPort:string):Wire=>({id,from,fromPort,to,toPort,length:1,section:2.5});
  const relay=device('thermal1','relay','OL1'),definition=getDefinition('thermal1');
  assert.equal(canActuate(relay.kind),true);
  assert.deepEqual(definition.size,{width:80,height:100});
  assert.deepEqual(definition.ports.map(port=>port.id),['1','2']);
  for(const rotation of [0,90,180,270] as const)for(const port of definition.ports){
    const point=getPortGeometry({...relay,rotation},port);
    assert.equal(point.x%10,0);assert.equal(point.y%10,0);
  }
  const project:Project={version:2,name:'Single-pole thermal relay',devices:[device('dc','source'),relay,device('lamp','main-load'),device('contact_no','no','OL1'),device('contact_nc','nc','OL1'),device('contact_co','co','OL1'),device('lamp','alarm')],wires:[
    wire('feed','source','+','relay','1'),wire('main','relay','2','main-load','1'),wire('return','main-load','2','source','-'),
    wire('alarm-feed','source','+','no','13'),wire('alarm-output','no','14','alarm','1'),wire('alarm-return','alarm','2','source','-'),
  ]};
  assert.deepEqual(parseProject(serializeProject(project)),project);
  let state=createInitialState(project);
  for(const tripped of [false,true,false]){
    relay.enabled=!tripped;
    state=stepSimulation(project,state,.1);
    assert.equal(state.devices.relay.tripped,tripped);
    assert.equal(state.devices['main-load'].energized,true,'overload actuation controls auxiliaries; its heater remains conductive');
    assert.equal(state.devices.no.contactClosed,tripped);
    assert.equal(state.devices.nc.contactClosed,!tripped);
    assert.equal(state.devices.co.coilEnergized,tripped);
    assert.equal(state.devices.alarm.energized,tripped);
    assert.deepEqual(state.events,[]);
  }
  let sequence=0;
  const copied=pasteSelection(project,copySelection(project,['relay','no','nc','co']),{x:200,y:0},()=>`copy-${++sequence}`);
  const additions=copied.project.devices.filter(item=>copied.deviceIds.includes(item.id));
  assert.equal(new Set(additions.map(item=>item.name)).size,1);
  assert.notEqual(additions[0].name,'OL1');
  assert.deepEqual(parseProject(serializeProject(copied.project)),copied.project);
});
