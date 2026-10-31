import test from 'node:test';
import assert from 'node:assert/strict';
import { createDevice } from './catalog';
import { createInitialState, stepSimulation } from './simulation';
import type { DeviceKind, Project, SimulationState, Wire } from './types';

const device=(kind:DeviceKind,id:string,name=id)=>({...createDevice(kind,id,0,0),name});
const wire=(id:string,from:string,fromPort:string,to:string,toPort:string):Wire=>({id,from,fromPort,to,toPort,length:1,section:2.5});
const tick=(project:Project,previous=createInitialState(project),dt=.1)=>stepSimulation(project,previous,dt);
const noErrors=(state:SimulationState)=>assert.deepEqual(state.events.filter(event=>event.level==='error'),[]);

// Synthetic circuit: two unfed coils bridge two points of a loaded return.
// Their common A1 is floating; splitting a wire cannot supply either coil.
function returnLoop(source:'dc'|'ac1',kind:DeviceKind='coil',segments=1){
  const positive=source==='dc'?'+':'L',negative=source==='dc'?'-':'N';
  const a=device(kind,'a','K1'),b=device(kind,'b','K2');
  if(kind==='protection_relay'){a.enabled=false;b.enabled=false;}
  const project:Project={version:2,name:'Ideal return conductors',devices:[device(source,'source'),device('push_no','start'),device('lamp','load'),a,b,device('junction','return-a'),device('junction','return-b')],wires:[
    wire('feed','source',positive,'start','1'),wire('switched','start','2','load','1'),wire('load-return','load','2','return-a','J'),
    wire('return','return-b','J','source',negative),wire('floating-feed','a','A1','b','A1'),wire('a-return','a','A2','return-a','J'),wire('b-return','b','A2','return-b','J'),
  ]};
  let previous='return-a';
  for(let index=0;index<segments;index++){
    const next=index===segments-1?'return-b':`tap-${index}`;
    if(next!=='return-b')project.devices.push(device('junction',next));
    project.wires.push(wire(`bus-${index}`,previous,'J',next,'J'));previous=next;
  }
  return {project,positive,negative};
}

for(const source of ['dc','ac1'] as const)test(`${source}: a loaded return cannot energize floating coils, timers or protection relays`,()=>{
  for(const kind of ['coil','timer_coil','protection_relay'] as const)for(const segments of [1,12]){
    const {project,positive}=returnLoop(source,kind,segments);
    let state=tick(project);noErrors(state);
    project.devices.find(d=>d.id==='start')!.enabled=true;
    state=tick(project,state);noErrors(state);
    assert.equal(state.devices.load.energized,true);
    for(const id of ['a','b']){
      assert.equal(state.devices[id].energized,false,`${kind} ${id}, ${segments} return segments`);
      assert.equal(state.devices[id].coilEnergized,false);
      assert.equal(state.devices[id].tripped,false);
      if(kind==='timer_coil')assert.equal(state.devices[id].timerPending,false);
    }
    for(const id of ['floating-feed','a-return','b-return'])assert.equal(state.wires[id].energized,false,`${id} must not animate phantom current`);
    for(const id of ['feed','switched','load-return','return',...Array.from({length:segments},(_,index)=>`bus-${index}`)])assert.equal(state.wires[id].energized,true,id);
    project.wires.push(wire('real-feed','source',positive,'a','A1'));
    state=tick(project,state);noErrors(state);
    for(const id of ['a','b'])assert.equal(state.devices[id].coilEnergized,true,'a real supply must still activate both coils');
    project.wires=project.wires.filter(w=>w.id!=='real-feed');
    state=tick(project,state);noErrors(state);
    for(const id of ['a','b'])assert.equal(state.devices[id].coilEnergized,false,'opening the feed must release both coils immediately');
  }
});

test('phantom relay pickup cannot close a shorting contact, while a real energized shorting relay is still rejected',()=>{
  const {project,positive,negative}=returnLoop('ac1');
  project.devices.push(device('contact_no','shorting-contact','K1'));
  project.wires.push(wire('short-feed','source',positive,'shorting-contact','13'),wire('short-return','shorting-contact','14','source',negative));
  let state=tick(project);project.devices.find(d=>d.id==='start')!.enabled=true;
  state=tick(project,state);noErrors(state);
  assert.equal(state.devices.load.energized,true);assert.equal(state.devices['shorting-contact'].contactClosed,false);
  project.wires.push(wire('intentional-feed','source',positive,'a','A1'));
  state=tick(project,state);
  assert.ok(state.events.some(event=>event.level==='error'&&event.message.includes('nối tắt')),'the real source bridge must still trip');
});

test('a timer opens the feed of parallel coils on a loaded return without leaving them falsely held',()=>{
  const {project,positive}=returnLoop('ac1');
  const timer=device('timer_coil','timer','KT1');timer.params.delaySeconds=.3;
  project.devices.push(timer,device('timer_nc','timed-feed','KT1'));
  project.wires.push(wire('timer-live','source',positive,'timer','A1'),wire('timer-return','timer','A2','return-a','J'),wire('timed-live','source',positive,'timed-feed','21'),wire('timed-output','timed-feed','22','a','A1'));
  project.devices.find(d=>d.id==='start')!.enabled=true;
  let state=tick(project);
  assert.equal(state.devices.a.coilEnergized,true);assert.equal(state.devices.b.coilEnergized,true);noErrors(state);
  state=tick(project,state);assert.equal(state.devices.a.coilEnergized,true);
  state=tick(project,state);assert.equal(state.devices.timer.timerOutput,true);noErrors(state);
  for(let count=0;count<4;count++){
    for(const id of ['a','b'])assert.equal(state.devices[id].coilEnergized,false);
    for(const id of ['timed-output','floating-feed','a-return','b-return'])assert.equal(state.wires[id].energized,false);
    assert.equal(state.devices.load.energized,true);state=tick(project,state);noErrors(state);
  }
});

test('actual phase-to-phase and DC pole bridges through closed controls are still short circuits',()=>{
  for(const kind of ['dc','ac3'] as const){
    const breaker=device('breaker1','breaker');
    const project:Project={version:2,name:'Real source bridge',devices:[device(kind,'source'),breaker],wires:[wire('in','source',kind==='dc'?'+':'L1','breaker','1'),wire('out','breaker','2','source',kind==='dc'?'-':'L2')]};
    let state=tick(project);noErrors(state);
    breaker.enabled=true;state=tick(project,state);
    assert.ok(state.events.some(event=>event.level==='error'&&event.message.includes('nối tắt')));
  }
});
