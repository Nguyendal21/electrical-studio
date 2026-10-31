import test from 'node:test';
import assert from 'node:assert/strict';
import { canActuate, createDevice, nextSelectorPosition, normalizeSelectorConfiguration, selectorAngle, selectorPositionLabel, selectorPositions } from './catalog';
import { copySelection, pasteSelection } from './clipboard';
import { parseProject, serializeProject } from './persistence';
import { createInitialState, stepSimulation, validateProject } from './simulation';
import type { Device, DeviceKind, Project, Wire } from './types';

const d=(kind:DeviceKind,id:string,name=id):Device=>({...createDevice(kind,id,0,0),name});
const w=(id:string,from:string,fromPort:string,to:string,toPort:string):Wire=>({id,from,fromPort,to,toPort,length:1,section:2.5});
const p=(devices:Device[],wires:Wire[]=[]):Project=>({version:2,name:'Configurable selector',devices,wires});
const run=(project:Project)=>stepSimulation(project,createInitialState(project),.1);

test('seven-position selector starts at zero and cycles through all detents without changing older selectors',()=>{
  assert.deepEqual(selectorPositions('selector7'),[-3,-2,-1,0,1,2,3]);
  assert.deepEqual(selectorPositions('selector3'),[-1,0,1]);
  assert.deepEqual(selectorPositions('selector2'),[0,1]);
  assert.deepEqual(selectorPositions('switch'),[]);
  for(const [kind,expected] of [
    ['selector7',[0,1,2,3,-3,-2,-1,0]],
    ['selector3',[0,1,-1,0]],
    ['selector2',[0,1,0]],
  ] as const){
    const selector=d(kind,'selector');assert.equal(selector.params.position,0);assert.equal(selector.enabled,false);assert.equal(canActuate(kind),true);
    const positions=[selector.params.position];
    for(let index=1;index<expected.length;index++)positions.push(nextSelectorPosition(kind,positions.at(-1)!));
    assert.deepEqual(positions,expected);
    assert.equal(nextSelectorPosition(kind,99),0,'an invalid detent recovers to zero');
  }
});

test('one selector model supports every count with distinct evenly spaced detents and bounded arcs',()=>{
  const selector=d('selector','selector');
  assert.equal(selector.params.positions,3);assert.equal(selector.params.position,0);assert.equal(selector.enabled,false);assert.equal(canActuate('selector'),true);
  for(let count=2;count<=13;count++){
    const params={positions:count},positions=selectorPositions('selector',params),angles=positions.map(position=>selectorAngle('selector',position,params));
    assert.equal(positions.length,count);assert.equal(new Set(positions).size,count);
    assert.equal(positions.includes(0),true);
    assert.equal(positions[0],count%2?-(count-1)/2:0);
    assert.equal(positions.at(-1),count%2?(count-1)/2:count-1);
    assert.ok(angles.every(angle=>angle>=-135&&angle<=135));
    const pitch=angles[1]-angles[0];
    for(let index=1;index<count;index++)assert.ok(Math.abs(angles[index]-angles[index-1]-pitch)<1e-8);
    let position=0;const visited=new Set<number>();
    for(let index=0;index<count;index++){visited.add(position);position=nextSelectorPosition('selector',position,params);}
    assert.equal(position,0);assert.equal(visited.size,count);
  }
  assert.deepEqual(selectorPositions('selector',{positions:7}).map(position=>selectorAngle('selector',position,{positions:7})),[-135,-90,-45,0,45,90,135]);
  assert.deepEqual(selectorPositions('selector',{positions:4}).map(position=>selectorAngle('selector',position,{positions:4})),[-135,-45,45,135]);
  assert.equal(selectorPositionLabel('selector',-3,{positions:7}),'−3 · Trái');
  assert.equal(selectorPositionLabel('selector',3,{positions:4}),'Mức 3');
});

test('NO, NC and CO contacts route current correctly at every selectable seven-position detent',()=>{
  const selector=d('selector','selector',' CM1 '),no=d('contact_no','no','cm1'),nc=d('contact_nc','nc','CM1'),co=d('contact_co','co','CM1');
  selector.params.positions=7;
  const project=p([selector,no,nc,co,d('dc','source'),d('lamp','no-load'),d('lamp','nc-load'),d('lamp','co-no-load'),d('lamp','co-nc-load')],[
    w('no-feed','source','+','no','13'),w('no-output','no','14','no-load','1'),w('no-return','no-load','2','source','-'),
    w('nc-feed','source','+','nc','21'),w('nc-output','nc','22','nc-load','1'),w('nc-return','nc-load','2','source','-'),
    w('co-feed','source','+','co','11'),w('co-no-output','co','14','co-no-load','1'),w('co-no-return','co-no-load','2','source','-'),
    w('co-nc-output','co','12','co-nc-load','1'),w('co-nc-return','co-nc-load','2','source','-'),
  ]);
  assert.deepEqual(validateProject(project),[]);
  for(const target of selectorPositions('selector7')){
    for(const contact of [no,nc,co])contact.params.actuationPosition=target;
    for(const position of selectorPositions('selector7')){
      selector.params.position=position;
      const state=run(project),actuated=target===position,context=`target ${target}, position ${position}`;
      assert.equal(state.devices.no.contactClosed,actuated,context);
      assert.equal(state.devices.nc.contactClosed,!actuated,context);
      assert.equal(state.devices.co.coilEnergized,actuated,context);
      assert.equal(state.devices['no-load'].energized,actuated,context);
      assert.equal(state.devices['nc-load'].energized,!actuated,context);
      assert.equal(state.devices['co-no-load'].energized,actuated,context);
      assert.equal(state.devices['co-nc-load'].energized,!actuated,context);
      assert.equal(state.devices.selector.status,`Vị trí ${position}`);
      assert.equal(state.events.length,0);
    }
  }
  selector.params.position=3;no.params.actuationPosition=3;no.name='OTHER';
  assert.equal(run(project).devices['no-load'].energized,false,'an unrelated designation is not operated');
});

test('seven-position detents and extended contact targets round-trip while fractions and out-of-range values fail',()=>{
  const selector=d('selector7','selector','CM1'),contact=d('contact_no','contact','CM1'),project=p([selector,contact]);
  for(const position of selectorPositions('selector7')){
    selector.params.position=position;contact.params.actuationPosition=position;
    assert.deepEqual(parseProject(serializeProject(project)),project);
  }
  for(const invalid of [-4,4,-3.5,1.5]){
    selector.params.position=invalid;contact.params.actuationPosition=1;
    assert.throws(()=>parseProject(JSON.stringify(project)),/Vị trí công tắc/);
  }
  for(const invalid of [-7,13,-3.5,1.5]){
    selector.params.position=0;contact.params.actuationPosition=invalid;
    assert.throws(()=>parseProject(JSON.stringify(project)),/Vị trí tác động/);
  }
  for(const kind of ['selector2','selector3'] as const){
    const older=d(kind,'older');
    for(const position of selectorPositions(kind)){older.params.position=position;assert.deepEqual(parseProject(serializeProject(p([older]))),p([older]));}
    older.params.position=2;assert.throws(()=>parseProject(JSON.stringify(p([older]))),/Vị trí công tắc/);
  }
});

test('configured selector counts and detents round-trip; invalid counts and impossible positions fail import',()=>{
  const selector=d('selector','selector','SA1'),contact=d('contact_no','contact','SA1'),project=p([selector,contact]);
  for(let count=2;count<=13;count++){
    selector.params.positions=count;
    for(const position of selectorPositions(selector.kind,selector.params)){
      selector.params.position=position;contact.params.actuationPosition=position;
      assert.deepEqual(parseProject(serializeProject(project)),project);
    }
  }
  for(const count of [1,14,2.5]){
    selector.params.positions=count;selector.params.position=0;contact.params.actuationPosition=1;
    assert.throws(()=>parseProject(JSON.stringify(project)),/Số mức/);
  }
  selector.params.positions=3;
  for(const position of [-2,2,.5]){selector.params.position=position;assert.throws(()=>parseProject(JSON.stringify(project)),/Vị trí công tắc/);}
});

test('reducing selector count adjusts only invalid matching targets in a single immutable edit',()=>{
  const selector=d('selector','selector',' SA1 '),no=d('contact_no','no','sa1'),nc=d('contact_nc','nc','SA1'),co=d('contact_co','co','SA1'),unrelated=d('contact_no','unrelated','SA2');
  selector.params={positions:3,position:3};no.params.actuationPosition=3;nc.params.actuationPosition=-3;co.params.actuationPosition=0;unrelated.params.actuationPosition=3;
  const project=p([selector,no,nc,co,unrelated]),before=structuredClone(project),normalized=normalizeSelectorConfiguration(project);
  assert.deepEqual(project,before,'normalization cannot mutate undo history');
  assert.equal(normalized.devices[0].params.position,1);
  assert.deepEqual(normalized.devices.slice(1).map(device=>device.params.actuationPosition),[1,-1,0,3]);
  assert.equal(normalized.devices[3],co,'valid contact keeps its identity');
  assert.equal(normalized.devices[4],unrelated,'unrelated apparatus is unchanged');
  assert.equal(normalizeSelectorConfiguration(normalized),normalized,'repeated normalization is a no-op');
  const loaded=parseProject(JSON.stringify({...project,devices:[{...selector,params:{positions:3,position:0}},no,nc,co,unrelated]}));
  assert.deepEqual(loaded.devices.slice(1).map(device=>device.params.actuationPosition),[1,-1,0,3]);
});

test('shared-name selectors preserve targets supported by either owner across normalization and saving',()=>{
  const first=d('selector','first',' SA1 '),second=d('selector','second','sa1'),contact=d('contact_no','contact','SA1');
  first.params={positions:3,position:0};second.params={positions:7,position:3};contact.params.actuationPosition=3;
  const project=p([first,second,contact,d('dc','source'),d('lamp','load')],[w('feed','source','+','contact','13'),w('output','contact','14','load','1'),w('return','load','2','source','-')]);
  assert.equal(normalizeSelectorConfiguration(project),project,'the first owner cannot invalidate another owner’s supported target');
  const loaded=parseProject(serializeProject(project));
  assert.equal(loaded.devices[2].params.actuationPosition,3);
  assert.equal(run(loaded).devices.load.energized,true,'the seven-position owner can actuate the shared contact');
  second.params.position=0;assert.equal(run(project).devices.load.energized,false);
  contact.params.actuationPosition=1;first.params.position=1;assert.equal(run(project).devices.load.energized,true,'the three-position owner can also actuate it');
  first.params.position=0;second.params.position=1;assert.equal(run(project).devices.load.energized,true);
  second.params={positions:2,position:1};contact.params.actuationPosition=3;
  assert.equal(normalizeSelectorConfiguration(project).devices[2].params.actuationPosition,1,'a target is clamped only when every same-name owner loses it');
});

test('copying a seven-position selector with its contacts renames the apparatus together and preserves each target',()=>{
  const selector=d('selector','selector','CM1'),no=d('contact_no','no','cm1'),nc=d('contact_nc','nc',' CM1 '),co=d('contact_co','co','CM1');
  selector.params.positions=7;
  selector.params.position=-3;no.params.actuationPosition=-3;nc.params.actuationPosition=2;co.params.actuationPosition=3;
  const project=p([selector,no,nc,co]),fragment=copySelection(project,project.devices.map(device=>device.id));
  let sequence=0;
  const pasted=pasteSelection(project,fragment,{x:200,y:200},()=>`copied-${++sequence}`);
  const copies=pasted.project.devices.filter(device=>pasted.deviceIds.includes(device.id));
  assert.equal(new Set(copies.map(device=>device.name)).size,1);
  assert.equal(copies[0].name,'CM2');
  assert.equal(copies[0].params.position,-3);
  assert.deepEqual(copies.slice(1).map(device=>device.params.actuationPosition),[-3,2,3]);
  assert.deepEqual(parseProject(serializeProject(pasted.project)),pasted.project);
  copies[0].params.position=3;
  const state=run(pasted.project);
  assert.equal(state.devices.no.contactClosed,true,'original selector remains at -3');
  assert.equal(state.devices[copies[1].id].contactClosed,false,'copied NO belongs to the copied selector');
  assert.equal(state.devices[copies[3].id].coilEnergized,true,'copied CO selects its target at +3');
});
