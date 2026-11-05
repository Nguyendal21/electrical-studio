import test from 'node:test';
import assert from 'node:assert/strict';
import { createDevice } from './catalog';
import { copySelection, pasteSelection } from './clipboard';
import { terminalPosition, wirePoints } from './geometry';
import { parseProject, serializeProject } from './persistence';
import { validateConnection } from './simulation';
import type { DeviceKind, Project, Wire } from './types';
import { attachJunctions, branchOnWire } from './wiring';

const dot=(kind:'junction'|'pipe_junction',id:string,x:number,y:number)=>createDevice(kind,id,x-6,y-6);
const wire=(id:string,from:string,to:string):Wire=>({id,from,fromPort:'J',to,toPort:'J',length:10,section:2.5,waypoints:[]});
function ids(){let n=0;return (prefix='copy')=>`${prefix}-${++n}`;}
function crossing():Project{
  return {version:2,name:'Independent pipe and wire networks',devices:[
    dot('pipe_junction','in',0,200),dot('pipe_junction','out',400,200),
    dot('junction','top',200,0),dot('junction','bottom',200,400),
    dot('pipe_junction','branch',300,400),
  ],wires:[wire('pipe','in','out'),wire('electrical','top','bottom')]};
}

test('pipe branches retain their drawn route, use a fluid junction and survive save/load',()=>{
  const project=crossing(),snapshot=structuredClone(project);
  const result=branchOnWire(project,'pipe',{x:200,y:205},{deviceId:'branch',portId:'J'},ids());
  const junction=result.project.devices.find(device=>device.id===result.junctionId)!;
  assert.equal(junction.kind,'pipe_junction');
  assert.deepEqual(terminalPosition(junction,'J'),{x:200,y:200});
  assert.equal(result.project.wires.length,4);
  assert.deepEqual(result.project.wires.find(item=>item.id==='electrical'),project.wires[1]);
  const first=result.project.wires.find(item=>item.from==='in')!,second=result.project.wires.find(item=>item.to==='out')!;
  assert.deepEqual(wirePoints(result.project,first),[{x:0,y:200},{x:200,y:200}]);
  assert.deepEqual(wirePoints(result.project,second),[{x:200,y:200},{x:400,y:200}]);
  assert.equal(first.length+second.length,10);
  assert.deepEqual(parseProject(serializeProject(result.project)),result.project);
  assert.deepEqual(project,snapshot);
});

test('manual pipe junctions attach only to pipes, even on a crossing electrical junction',()=>{
  const project=crossing();
  project.devices.push(dot('junction','electrical-dot',200,200),dot('pipe_junction','pipe-dot',200,200));
  const result=attachJunctions(project,{makeId:ids()});
  for(const [junction,expected] of [['pipe-dot',['in','out']],['electrical-dot',['top','bottom']]] as const){
    const connected=result.wires.filter(item=>item.from===junction||item.to===junction).map(item=>item.from===junction?item.to:item.from).sort();
    assert.deepEqual(connected,[...expected].sort());
    assert.ok(result.devices.some(item=>item.id===junction));
  }
  assert.strictEqual(attachJunctions(result),result,'repair is idempotent');
  assert.deepEqual(parseProject(serializeProject(result)),result);
});

test('pipe junction snapping ignores nearby electrical wires and keeps a centered terminal after rotation',()=>{
  const project=crossing();
  project.devices.push(dot('pipe_junction','manual',201,206));
  const result=attachJunctions(project,{junctionIds:['manual'],snapDistance:10,makeId:ids()});
  const placed=result.devices.find(item=>item.id==='manual')!;
  assert.deepEqual(terminalPosition(placed,'J'),{x:201,y:200});
  for(const rotation of [0,90,180,270] as const)assert.deepEqual(terminalPosition({...placed,rotation},'J'),{x:201,y:200});
  assert.deepEqual(result.wires.find(item=>item.id==='electrical'),project.wires[1]);
});

test('coincident pipe junctions merge only their own network and subsequent branches reuse the same dot',()=>{
  const project=crossing(),makeId=ids();
  const split=branchOnWire(project,'pipe',{x:200,y:200},undefined,makeId);
  const existing=split.project.devices.find(item=>item.id===split.junctionId)!;
  const placed:Project={...split.project,devices:[...split.project.devices,dot('pipe_junction','manual',200,200),dot('junction','electric-dot',200,200)],wires:[...split.project.wires,wire('tap','manual','branch')]};
  const merged=attachJunctions(placed,{junctionIds:['manual'],makeId});
  assert.ok(!merged.devices.some(item=>item.id===existing.id));
  assert.ok(merged.devices.some(item=>item.id==='electric-dot'));
  assert.equal(merged.wires.filter(item=>item.from==='manual'||item.to==='manual').length,3);
  const endpointWire=merged.wires.find(item=>item.to==='manual')!;
  const result=branchOnWire(merged,endpointWire.id,{x:200,y:200},undefined,makeId);
  assert.equal(result.junctionId,'manual');assert.strictEqual(result.project,merged);
  assert.deepEqual(parseProject(serializeProject(merged)),merged);
});

test('electrical/shaft terminals cannot branch into pipes, and pipes cannot branch into electrical wires',()=>{
  const project=crossing();project.devices.push(createDevice('diesel','driver',0,0));
  const before=structuredClone(project);
  assert.throws(()=>branchOnWire(project,'pipe',{x:100,y:200},{deviceId:'top',portId:'J'},ids()),/cùng loại/);
  assert.throws(()=>branchOnWire(project,'pipe',{x:100,y:200},{deviceId:'driver',portId:'shaft'},ids()),/Trục cơ khí/);
  assert.throws(()=>branchOnWire(project,'electrical',{x:200,y:100},{deviceId:'in',portId:'J'},ids()),/cùng loại/);
  assert.ok(validateConnection(project,wire('bad','in','top')));
  assert.throws(()=>parseProject(JSON.stringify({...project,wires:[wire('bad','in','top')]})));
  assert.deepEqual(project,before);
});

test('copied hydraulic networks retain internal pipes and level sensor tank links, separate from the original',()=>{
  const project=crossing(),tank=createDevice('water_tank','tank',0,500),sensor=createDevice('level_sensor','level',200,500);
  sensor.tankId=tank.id;sensor.name='LS1';
  const contact=createDevice('contact_no','contact',300,500);contact.name='LS1';
  project.devices.push(tank,sensor,contact);
  const result=pasteSelection(project,copySelection(project,['in','out','tank','level','contact']),{x:40,y:40},ids());
  const copies=result.project.devices.slice(project.devices.length),copiedTank=copies.find(device=>device.kind==='water_tank')!,copiedSensor=copies.find(device=>device.kind==='level_sensor')!;
  assert.equal(copiedSensor.tankId,copiedTank.id);assert.notEqual(copiedSensor.tankId,tank.id);
  assert.equal(copiedSensor.name,copies.find(device=>device.kind==='contact_no')!.name);
  const copiedPipe=result.project.wires.at(-1)!;
  assert.equal(copiedPipe.from,copies[0].id);assert.equal(copiedPipe.to,copies[1].id);
  assert.deepEqual(parseProject(serializeProject(result.project)),result.project);
  const sensorOnly=pasteSelection(project,copySelection(project,['level']),{x:40,y:40},ids());
  assert.equal(sensorOnly.project.devices.at(-1)!.tankId,tank.id,'a sensor copied alone continues to observe the original tank');
});

test('hydraulic sensor/contact copies keep their association and tank bindings are validated as IDs',()=>{
  for(const kind of ['pressure_sensor','flow_sensor','level_sensor'] satisfies DeviceKind[]){
    const sensor=createDevice(kind,'sensor',0,0),contact=createDevice('contact_nc','contact',100,0);
    sensor.name=contact.name='HS1';
    const project:Project={version:2,name:'Sensor copies',devices:[sensor,contact],wires:[]};
    const copies=pasteSelection(project,copySelection(project,['sensor','contact']),{x:40,y:40},ids()).project.devices.slice(2);
    assert.equal(copies[0].name,copies[1].name);assert.notEqual(copies[0].name,'HS1');
  }
  const level=createDevice('level_sensor','level',0,0),project:Project={version:2,name:'Binding validation',devices:[level],wires:[]};
  for(const invalid of ['',42,'__proto__','bad\u0000id'])assert.throws(()=>parseProject(JSON.stringify({...project,devices:[{...level,tankId:invalid}]})));
  const dangling={...project,devices:[{...level,tankId:'deleted-tank'}]};
  assert.equal(parseProject(serializeProject(dangling)).devices[0].tankId,'deleted-tank','missing tank remains detectable instead of silently binding another tank');
});

test('hydraulic mode selectors reject fractional values rather than loading ambiguous states',()=>{
  for(const [kind,key] of [['water_tank','infinite'],['hydraulic_valve','valveMode'],['pressure_sensor','comparison'],['flow_sensor','comparison'],['level_sensor','comparison']] as const){
    const device=createDevice(kind,'device',0,0);device.params[key]=.5;
    assert.throws(()=>parseProject(JSON.stringify({version:2,name:'Invalid mode',devices:[device],wires:[]})));
  }
});
