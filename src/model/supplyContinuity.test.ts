import test from 'node:test';
import assert from 'node:assert/strict';
import { createDevice } from './catalog';
import { createInitialState, stepSimulation } from './simulation';
import type { Device, DeviceKind, Project, SimulationState, Wire } from './types';

const d=(kind:DeviceKind,id:string,name=id):Device=>({...createDevice(kind,id,0,0),name});
const w=(id:string,from:string,fromPort:string,to:string,toPort:string):Wire=>({id,from,fromPort,to,toPort,length:1,section:2.5});
const p=(devices:Device[],wires:Wire[]):Project=>({version:2,name:'Supply continuity',devices,wires});
const run=(project:Project,previous=createInitialState(project))=>stepSimulation(project,previous,.1);

function holdingCircuit(kind:'transformer1'|'power_supply'|'cascade'){
  const supplyKind=kind==='power_supply'?'power_supply':'transformer1';
  const devices=[d('ac3','source'),d(supplyKind,'supply'),d('push_nc','stop'),d('push_no','start'),d('coil','aux','AUX3'),d('coil','main','MC3'),d('contact_no','hold','AUX3'),d('net_label','live-in','L220V'),d('offpage','live-out',' l220v '),d('net_label','return-in','N220V'),d('offpage','return-out','N220V')];
  const wires=[w('primary1','source','L1','supply',supplyKind==='power_supply'?'L':'P1'),w('primary2','source','L2','supply',supplyKind==='power_supply'?'N':'P2'),w('secondary1','supply',supplyKind==='power_supply'?'+':'S1','live-in','P'),w('secondary2','supply',supplyKind==='power_supply'?'-':'S2','return-in','P'),w('feed','live-out','P','stop','1'),w('start-feed','stop','2','start','1'),w('start-out','start','2','aux','A1'),w('hold-feed','stop','2','hold','13'),w('hold-out','hold','14','aux','A1'),w('aux-return','aux','A2','return-out','P'),w('main-feed','aux','A1','main','A1'),w('main-return','main','A2','aux','A2')];
  if(kind==='cascade'){
    devices.push(d('rectifier1','rectifier'));
    wires.find(wire=>wire.id==='secondary1')!.from='rectifier';wires.find(wire=>wire.id==='secondary1')!.fromPort='+';
    wires.find(wire=>wire.id==='secondary2')!.from='rectifier';wires.find(wire=>wire.id==='secondary2')!.fromPort='-';
    wires.push(w('cascade1','supply','S1','rectifier','~1'),w('cascade2','supply','S2','rectifier','~2'));
  }
  return p(devices,wires);
}

function assertCoils(state:SimulationState,active:boolean){
  assert.equal(state.devices.aux.coilEnergized,active,'holding coil');
  assert.equal(state.devices.main.coilEnergized,active,'parallel contactor coil');
  assert.equal(state.devices.hold.contactClosed,active,'holding contact');
  assert.ok(!state.events.some(event=>event.level==='error'));
}

for(const kind of ['transformer1','power_supply','cascade'] as const)test(`${kind}: a line-to-line supply and remote labels preserve relay self-holding`,()=>{
  const project=holdingCircuit(kind),start=project.devices.find(device=>device.id==='start')!,stop=project.devices.find(device=>device.id==='stop')!;
  let state=run(project);assertCoils(state,false);assert.equal(state.devices.supply.energized,true);
  start.enabled=true;state=run(project,state);assertCoils(state,true);
  start.enabled=false;
  for(let tick=0;tick<6;tick++){state=run(project,state);assertCoils(state,true);}
  stop.enabled=false;state=run(project,state);assertCoils(state,false);
  stop.enabled=true;state=run(project,state);assertCoils(state,false);
  start.enabled=true;state=run(project,state);assertCoils(state,true);start.enabled=false;
  const primary=project.wires.find(wire=>wire.id==='primary2')!;
  project.wires=project.wires.filter(wire=>wire.id!==primary.id);state=run(project,state);assertCoils(state,false);assert.equal(state.devices.supply.energized,false);
  project.wires.push(primary);state=run(project,state);assertCoils(state,false);assert.equal(state.devices.supply.energized,true);
});

test('an energized transformer cannot retain its own supply after external power is removed',()=>{
  const project=holdingCircuit('transformer1');project.devices.find(device=>device.id==='start')!.enabled=true;
  let state=run(project);assertCoils(state,true);
  project.devices.find(device=>device.id==='start')!.enabled=false;
  project.wires=project.wires.filter(wire=>!wire.id.startsWith('primary'));
  project.wires.push(w('feedback1','supply','S1','supply','P1'),w('feedback2','supply','S2','supply','P2'));
  state=run(project,state);assertCoils(state,false);assert.equal(state.devices.supply.energized,false);
  assert.equal(state.wires.secondary1.powered,false);
});

function unloadedBusbars(){
  const cb=d('breaker','cb'),owner=d('switch','owner','MC0');cb.enabled=true;owner.enabled=true;
  const project=p([d('ac3','source'),cb,owner,d('earth','earth')],[w('neutral-earth','source','N','earth','PE')]);
  for(let phase=1;phase<=3;phase++){
    const id=String(phase);
    project.devices.push(d('contact_no',`closed-${id}`,'MC0'),d('busbar',`bus-${id}`),d('junction',`junction-${id}`),d('terminal_block',`terminal-${id}`),d('contact_no',`open-${id}`,'MC1'),d('lamp',`lamp-${id}`));
    project.wires.push(w(`source-${id}`,'source',`L${id}`,'cb',String(phase*2-1)),w(`cb-${id}`,'cb',String(phase*2),`closed-${id}`,'13'),w(`closed-${id}`,`closed-${id}`,'14',`junction-${id}`,'J'),w(`junction-${id}`,`junction-${id}`,'J',`bus-${id}`,'1'),w(`bus-${id}`,`bus-${id}`,'4',`terminal-${id}`,'1'),w(`terminal-${id}`,`terminal-${id}`,'2',`open-${id}`,'13'),w(`open-${id}`,`open-${id}`,'14',`lamp-${id}`,'1'));
  }
  return project;
}

test('source indication reaches closed three-phase contacts and unloaded busbars, stopping at open contacts',()=>{
  const project=unloadedBusbars();let state=run(project);
  assert.ok(!state.events.length);
  assert.ok(Object.values(state.wires).every(wire=>!wire.energized),'no closed load path means no animated current');
  assert.equal(state.wires['neutral-earth'].powered,false,'a reference connection is not a live phase');
  for(let phase=1;phase<=3;phase++){
    for(const prefix of ['source','cb','closed','junction','bus','terminal'])assert.equal(state.wires[`${prefix}-${phase}`].powered,true,`${prefix}, phase ${phase}`);
    for(const prefix of ['closed','junction','bus','terminal'])assert.equal(state.devices[`${prefix}-${phase}`].powered,true,`${prefix} symbol, phase ${phase}`);
    assert.equal(state.wires[`open-${phase}`].powered,false);
    assert.equal(state.devices[`open-${phase}`].powered,false);
    assert.equal(state.devices[`lamp-${phase}`].energized,false);
  }
  project.wires=project.wires.filter(wire=>wire.id!=='source-2');state=run(project,state);
  assert.equal(state.wires['bus-1'].powered,true);assert.equal(state.wires['bus-2'].powered,false);assert.equal(state.wires['bus-3'].powered,true);
  project.devices.find(device=>device.id==='owner')!.enabled=false;state=run(project,state);
  assert.equal(state.wires['cb-1'].powered,true);assert.equal(state.wires['closed-1'].powered,false);assert.equal(state.devices['closed-1'].powered,false);
  project.devices.find(device=>device.id==='cb')!.enabled=false;state=run(project,state);
  assert.equal(state.wires['source-1'].powered,true);assert.equal(state.wires['cb-1'].powered,false);assert.equal(state.devices.cb.powered,false);
});

test('unloaded named nets carry the source indication without energizing a one-terminal load',()=>{
  const project=p([d('dc','source'),d('net_label','label','LIVE'),d('offpage','remote','live'),d('lamp','lamp')],[w('feed','source','+','label','P'),w('remote-feed','remote','P','lamp','1')]);
  let state=run(project);
  assert.equal(state.wires.feed.powered,true);assert.equal(state.wires['remote-feed'].powered,true);
  assert.equal(state.devices.remote.powered,true);assert.equal(state.devices.lamp.energized,false);assert.equal(state.wires['remote-feed'].energized,false);
  project.devices.find(device=>device.id==='remote')!.name='OTHER';state=run(project,state);assert.equal(state.wires['remote-feed'].powered,false);
});

test('closed DC load returns are colored by current; an open return never starts a motor or coil',()=>{
  for(const kind of ['lamp','coil','dc_motor'] as const){
    const [a,b]=kind==='lamp'?['1','2']:kind==='coil'?['A1','A2']:['+','-'];
    const project=p([d('dc','source'),d(kind,'load')],[w('feed','source','+','load',a)]);
    let state=run(project);assert.equal(state.wires.feed.powered,true);assert.equal(state.wires.feed.energized,false);assert.equal(state.devices.load.energized,false);assert.equal(state.devices.load.powered,false);
    project.wires.push(w('return','load',b,'source','-'));state=run(project,state);
    assert.equal(state.wires.return.powered,true);assert.equal(state.wires.return.energized,true);
    assert.equal(state.devices.load.energized,kind!=='dc_motor','a DC motor additionally needs field excitation');
  }
});

test('reset and an invalid short never retain live coloring from the previous step',()=>{
  const project=unloadedBusbars(),live=run(project);
  assert.ok(Object.values(live.wires).some(wire=>wire.powered));
  assert.ok(Object.values(createInitialState(project).wires).every(wire=>!wire.powered));
  project.wires.push(w('short','source','L1','source','L2'));
  const state=run(project,live);assert.ok(state.events.some(event=>event.level==='error'));assert.ok(Object.values(state.wires).every(wire=>!wire.powered&&!wire.energized));
});
