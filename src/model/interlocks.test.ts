import test from 'node:test';
import assert from 'node:assert/strict';
import { createDevice } from './catalog';
import { copySelection, pasteSelection } from './clipboard';
import { terminalPosition } from './geometry';
import { parseProject, serializeProject } from './persistence';
import { createInitialState, stepSimulation, validateConnection } from './simulation';
import { branchOnWire } from './wiring';
import type { DeviceKind, Project, SimulationState, Wire } from './types';

const part=(kind:DeviceKind,id:string,name=id)=>({...createDevice(kind,id,0,0),name});
const wire=(id:string,from:string,fromPort:string,to:string,toPort:string):Wire=>({id,from,fromPort,to,toPort,length:1,section:2.5});
const link=(a:string,b:string)=>wire(`lock-${a}-${b}`,a,'lock',b,'lock');
function fixture(count=2):Project{
  const devices=[part('dc','supply')],wires:Wire[]=[];
  for(let index=0;index<count;index++){
    const id=String.fromCharCode(97+index),name=`K${index+1}`;
    devices.push(part('switch',`command-${id}`,name),part('interlocked_contact',id,name),part('lamp',`load-${id}`));
    wires.push(wire(`feed-${id}`,'supply','+',id,'13'),wire(`load-feed-${id}`,id,'14',`load-${id}`,'1'),wire(`return-${id}`,`load-${id}`,'2','supply','-'));
  }
  for(let index=0;index<count-1;index++)wires.push(link(String.fromCharCode(97+index),String.fromCharCode(98+index)));
  return {version:2,name:'Mechanical cross-interlock',devices,wires};
}
function command(project:Project,id:string,on:boolean){project.devices.find(device=>device.id===`command-${id}`)!.enabled=on;}
function tick(project:Project,state=createInitialState(project),count=1){for(let index=0;index<count;index++)state=stepSimulation(project,state,.1);assert.ok(!state.events.some(event=>event.level==='error'),JSON.stringify(state.events));return state;}
function closed(state:SimulationState,...ids:string[]){return ids.map(id=>!!state.devices[id].contactClosed);}

test('first commanded contact wins, the opposing command waits, and release hands over without turning off controls',()=>{
  const project=fixture();let state=tick(project);
  command(project,'a',true);state=tick(project,state);assert.deepEqual(closed(state,'a','b'),[true,false]);
  command(project,'b',true);state=tick(project,state,8);
  assert.deepEqual(closed(state,'a','b'),[true,false]);assert.equal(state.devices.b.interlockBlocked,true);
  assert.equal(state.devices['load-a'].energized,true);assert.equal(state.devices['load-b'].energized,false);
  assert.equal(state.devices['command-b'].energized,true,'the mechanical link does not turn off its controller');
  assert.equal(state.wires['lock-a-b'].energized,false);assert.equal(state.wires['lock-a-b'].powered,false);
  assert.equal(state.events.filter(event=>event.level==='warning').length,1,'a sustained blocked request emits only one warning');
  command(project,'a',false);state=tick(project,state,8);
  assert.deepEqual(closed(state,'a','b'),[false,true]);assert.equal(state.devices.b.interlockBlocked,false);
  assert.equal(state.devices['load-b'].energized,true);
});

test('simultaneous commands from rest block both stably and either can close after its opponent releases',()=>{
  for(const remaining of ['a','b']){
    const project=fixture();command(project,'a',true);command(project,'b',true);
    let state=tick(project,undefined,12);
    assert.deepEqual(closed(state,'a','b'),[false,false]);
    assert.equal(state.devices.a.interlockBlocked,true);assert.equal(state.devices.b.interlockBlocked,true);
    command(project,remaining==='a'?'b':'a',false);state=tick(project,state,5);
    assert.deepEqual(closed(state,'a','b'),remaining==='a'?[true,false]:[false,true]);
  }
});

test('pairwise chains allow nonadjacent contacts without turning the whole chain into a global lock',()=>{
  const project=fixture(3);command(project,'a',true);let state=tick(project);
  command(project,'b',true);command(project,'c',true);state=tick(project,state,6);
  assert.deepEqual(closed(state,'a','b','c'),[true,false,true]);assert.equal(state.devices.b.interlockBlocked,true);
  command(project,'a',false);state=tick(project,state);assert.deepEqual(closed(state,'a','b','c'),[false,false,true]);
  command(project,'c',false);state=tick(project,state);assert.deepEqual(closed(state,'a','b','c'),[false,true,false]);
  const simultaneous=fixture(3);for(const id of ['a','b','c'])command(simultaneous,id,true);
  assert.deepEqual(closed(tick(simultaneous,undefined,6),'a','b','c'),[false,false,false]);
});

test('wire direction and device order cannot change the winner or simultaneous conflict result',()=>{
  for(const reversed of [false,true]){
    const project=fixture();if(reversed){project.devices.reverse();project.wires.reverse();project.wires=project.wires.map(item=>item.fromPort==='lock'?{...item,from:item.to,to:item.from}:item);}
    command(project,'b',true);let state=tick(project);command(project,'a',true);state=tick(project,state,4);
    assert.deepEqual(closed(state,'a','b'),[false,true]);
    assert.deepEqual(closed(tick(project,createInitialState(project),4),'a','b'),[false,false]);
  }
});

test('adding a mechanical link between already closed contacts releases the invalid double closure safely',()=>{
  const project=fixture();project.wires=project.wires.filter(item=>item.fromPort!=='lock');
  command(project,'a',true);command(project,'b',true);let state=tick(project);
  assert.deepEqual(closed(state,'a','b'),[true,true]);project.wires.push(link('a','b'));state=tick(project,state,5);
  assert.deepEqual(closed(state,'a','b'),[false,false]);
  command(project,'b',false);state=tick(project,state);assert.deepEqual(closed(state,'a','b'),[true,false]);
});

test('electrically powered coils remain energized while mechanical exclusion blocks their contact; normal NO is unaffected',()=>{
  const project=fixture();
  project.devices=project.devices.filter(device=>!device.id.startsWith('command-'));
  for(const id of ['a','b']){
    project.devices.push(part('coil',`coil-${id}`,id==='a'?'K1':'K2'),{...part('breaker1',`breaker-${id}`),enabled:id==='a'});
    project.wires.push(wire(`coil-feed-${id}`,'supply','+',`breaker-${id}`,'1'),wire(`coil-control-${id}`,`breaker-${id}`,'2',`coil-${id}`,'A1'),wire(`coil-return-${id}`,`coil-${id}`,'A2','supply','-'));
  }
  project.devices.push(part('contact_no','regular','K2'));
  let state=tick(project);project.devices.find(device=>device.id==='breaker-b')!.enabled=true;state=tick(project,state,6);
  assert.equal(state.devices['coil-a'].coilEnergized,true);assert.equal(state.devices['coil-b'].coilEnergized,true);
  assert.deepEqual(closed(state,'a','b','regular'),[true,false,true]);
  const reset=tick(project,createInitialState(project),6);assert.deepEqual(closed(reset,'a','b','regular'),[false,false,true]);
});

test('mechanical links survive save and group copy with new linked designations and never connect to other port types',()=>{
  const project=fixture();assert.deepEqual(parseProject(serializeProject(project)),project);
  let n=0;const copied=pasteSelection(project,copySelection(project,project.devices.map(device=>device.id)),{x:40,y:40},()=>`copy-${++n}`);
  const devices=copied.project.devices.slice(project.devices.length),contacts=devices.filter(device=>device.kind==='interlocked_contact');
  for(const contact of contacts)assert.ok(devices.some(device=>device.kind==='switch'&&device.name===contact.name));
  const copiedLink=copied.project.wires.find(item=>contacts.some(device=>device.id===item.from)&&item.fromPort==='lock')!;
  assert.ok(contacts.some(device=>device.id===copiedLink.to));assert.deepEqual(parseProject(serializeProject(copied.project)),copied.project);
  for(const [kind,port] of [['dc','+'],['diesel','shaft'],['water_tank','OUT']] as const){
    const other=part(kind,`other-${kind}`),p={...project,devices:[...project.devices,other]};
    const invalid=wire('invalid','a','lock',other.id,port);
    assert.ok(validateConnection(p,invalid));assert.throws(()=>parseProject(JSON.stringify({...p,wires:[invalid]})));
  }
  assert.ok(validateConnection(project,link('a','a')));
  assert.throws(()=>branchOnWire(project,'lock-a-b',{x:100,y:50}),/Chỉ rẽ nhánh/);
  for(const rotation of [0,90,180,270] as const){const at=terminalPosition({...part('interlocked_contact','geometry'),rotation},'lock');assert.equal(at.x%10,0);assert.equal(at.y%10,0);}
});
