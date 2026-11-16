import test from 'node:test';
import assert from 'node:assert/strict';
import { createDevice } from './catalog';
import { createInitialState, stepSimulation } from './simulation';
import type { DeviceKind, Project, Wire } from './types';

const d=(kind:DeviceKind,id:string)=>createDevice(kind,id,0,0);
const w=(id:string,from:string,fromPort:string,to:string,toPort:string):Wire=>({id,from,fromPort,to,toPort,length:1,section:2.5});
function annunciator(source:'ac1'|'dc'):Project {
  const devices=[d(source,'source'),d('push_no','test'),d('junction','test-bus')];
  const live=source==='dc'?'+':'L',neutral=source==='dc'?'-':'N';
  const wires=[w('test-live','source',live,'test','1'),w('test-bus','test','2','test-bus','J')];
  for(let i=0;i<3;i++){
    devices.push(d('diode',`diode${i}`),d('lamp',`lamp${i}`),d('breaker1',`switch${i}`));
    wires.push(w(`anode${i}`,'test-bus','J',`diode${i}`,'A'),w(`cathode${i}`,`diode${i}`,'K',`lamp${i}`,'1'),w(`return${i}`,`lamp${i}`,'2','source',neutral),w(`feed${i}`,'source',live,`switch${i}`,'1'),w(`switched${i}`,`switch${i}`,'2',`lamp${i}`,'1'));
  }
  return {version:2,name:'Diode-isolated lamp test',devices,wires};
}
for(const source of ['ac1','dc'] as const)test(`${source}: lamp-test diodes isolate every independently fed lamp`,()=>{
  const project=annunciator(source);
  for(let selected=0;selected<3;selected++){
    project.devices.filter(device=>device.kind==='breaker1').forEach(device=>{device.enabled=device.id===`switch${selected}`;});
    const state=stepSimulation(project,createInitialState(project),.1);
    assert.ok(!state.events.some(event=>event.level==='error'));
    for(let i=0;i<3;i++){
      assert.equal(state.devices[`lamp${i}`].energized,i===selected,`only lamp ${selected} may light`);
      assert.equal(state.wires[`cathode${i}`].energized,false,'no backfeed through shared anodes');
    }
    project.devices.find(device=>device.id==='test')!.enabled=true;
    const pressed=stepSimulation(project,state,0);
    for(let i=0;i<3;i++)assert.equal(pressed.devices[`lamp${i}`].energized,true,'test button lights all lamps');
    project.devices.find(device=>device.id==='test')!.enabled=false;
    const released=stepSimulation(project,pressed,0);
    for(let i=0;i<3;i++)assert.equal(released.devices[`lamp${i}`].energized,i===selected,'release restores independent indication');
  }
});

test('a single series diode passes either AC half-wave but opposed series diodes block AC',()=>{
  const project:Project={version:2,name:'AC diode paths',devices:[d('ac1','source'),d('diode','a'),d('diode','b'),d('lamp','lamp')],wires:[w('a','source','L','a','A'),w('b','a','K','b','K'),w('c','b','A','lamp','1'),w('return','lamp','2','source','N')]};
  assert.equal(stepSimulation(project,createInitialState(project),.1).devices.lamp.energized,false);
  project.wires[1].toPort='A';project.wires[2].fromPort='K';
  assert.equal(stepSimulation(project,createInitialState(project),.1).devices.lamp.energized,true);
  project.wires[0].toPort='K';project.wires[1].fromPort='A';project.wires[1].toPort='K';project.wires[2].fromPort='A';
  assert.equal(stepSimulation(project,createInitialState(project),.1).devices.lamp.energized,true,'reversing both passes the other half-wave');
});
