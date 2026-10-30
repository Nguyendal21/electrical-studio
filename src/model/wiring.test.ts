import test from 'node:test';
import assert from 'node:assert/strict';
import { createDevice } from './catalog';
import { terminalPosition, wirePoints } from './geometry';
import { parseProject, serializeProject } from './persistence';
import { createInitialState, stepSimulation } from './simulation';
import type { Device, Point, Project, Wire } from './types';
import { branchOnWire } from './wiring';

const wire=(id:string,from:string,fromPort:string,to:string,toPort:string):Wire=>({id,from,fromPort,to,toPort,length:10,section:2.5,color:'#cc4422'});
function ids(){let counter=0;return (prefix:string)=>`${prefix}-test-${++counter}`;}
function fixture(horizontal=false):Project{
  const source=createDevice('fuse','source',0,0),target=createDevice('lamp','target',horizontal?300:0,horizontal?0:300),branch=createDevice('lamp','branch',500,150);
  if(horizontal){source.rotation=90;target.rotation=90;}
  return {version:2,name:'Branch fixture',devices:[source,target,branch],wires:[wire('main','source',horizontal?'1':'2','target',horizontal?'2':'1')]};
}
function canonical(points:Point[]):Point[]{
  const result:Point[]=[];
  for(const p of points){
    if(result.length&&p.x===result.at(-1)!.x&&p.y===result.at(-1)!.y)continue;
    while(result.length>1){
      const a=result.at(-2)!,b=result.at(-1)!;
      if(!((a.x===b.x&&b.x===p.x)||(a.y===b.y&&b.y===p.y))||(b.x-a.x)*(p.x-b.x)+(b.y-a.y)*(p.y-b.y)<0)break;
      result.pop();
    }
    result.push(p);
  }
  return result;
}
function assertPreserved(before:Project,wireId:string,after:Project,junctionId:string){
  const original=before.wires.find(item=>item.id===wireId)!;
  const first=after.wires.find(item=>item.from===original.from&&item.fromPort===original.fromPort&&item.to===junctionId)!;
  const second=after.wires.find(item=>item.from===junctionId&&item.to===original.to&&item.toPort===original.toPort)!;
  assert.ok(first&&second,'both halves retain their original terminal');
  assert.deepEqual(canonical([...wirePoints(after,first),...wirePoints(after,second).slice(1)]),canonical(wirePoints(before,original)),'splitting must not shift or retrace the original route');
  assert.ok(Math.abs(first.length+second.length-original.length)<1e-8);
  for(const part of [first,second]){assert.equal(part.color,original.color);assert.equal(part.section,original.section);assert.ok(part.waypoints!.length<=64);}
}

for(const horizontal of [false,true])test(`${horizontal?'horizontal':'vertical'} wires retain their exact polyline when split on every segment, including terminal leads`,()=>{
  const project=fixture(horizontal),snapshot=structuredClone(project),route=wirePoints(project,project.wires[0]);
  for(let i=0;i<route.length-1;i++)for(const fraction of [.2,.5,.8]){
    const a=route[i],b=route[i+1],point={x:a.x+(b.x-a.x)*fraction,y:a.y+(b.y-a.y)*fraction};
    const result=branchOnWire(project,'main',point,{deviceId:'branch',portId:'1'},ids());
    assert.ok(result.junctionId);assert.equal(result.project.devices.length,4);assert.equal(result.project.wires.length,3);
    assertPreserved(project,'main',result.project,result.junctionId!);
    assert.deepEqual(project,snapshot,'the undo snapshot is never mutated');
    assert.deepEqual(parseProject(serializeProject(result.project)),result.project);
  }
});

test('an offset drop projects onto a bent wire, and repeated splits preserve every bend',()=>{
  let project=fixture(),makeId=ids();
  project.wires[0].waypoints=[{x:40,y:140},{x:180,y:140},{x:180,y:230},{x:40,y:230}];
  const first=branchOnWire(project,'main',{x:115,y:145},undefined,makeId);
  assertPreserved(project,'main',first.project,first.junctionId!);
  const junction=first.project.devices.find(device=>device.id===first.junctionId)!;
  assert.deepEqual({x:junction.x+6,y:junction.y+6},{x:115,y:140});
  project=first.project;
  for(let i=0;i<6;i++){
    const candidate=project.wires.find(item=>item.to==='target')!,route=wirePoints(project,candidate),a=route.at(-2)!,b=route.at(-1)!;
    const result=branchOnWire(project,candidate.id,{x:(a.x+b.x)/2,y:(a.y+b.y)/2},undefined,makeId);
    assertPreserved(project,candidate.id,result.project,result.junctionId!);project=result.project;
  }
  assert.doesNotThrow(()=>serializeProject(project));
});

test('dropping on an endpoint uses that terminal without inserting a junction',()=>{
  const project=fixture(),point=wirePoints(project,project.wires[0])[0];
  const result=branchOnWire(project,'main',point,{deviceId:'branch',portId:'1'},ids());
  assert.equal(result.project.devices.length,project.devices.length);assert.equal(result.project.wires.length,2);
  assert.deepEqual(result.project.wires[0],project.wires[0]);
  assert.equal(result.project.wires[1].to,'source');assert.equal(result.project.wires[1].toPort,'2');
  assert.strictEqual(branchOnWire(project,'main',point).project,project);
});

test('an existing junction is reused for another branch and duplicate attachment is rejected atomically',()=>{
  const project=fixture(),makeId=ids(),split=branchOnWire(project,'main',{x:40,y:200},undefined,makeId);
  const part=split.project.wires.find(item=>item.to===split.junctionId)!,point=wirePoints(split.project,part).at(-1)!;
  const result=branchOnWire(split.project,part.id,point,{deviceId:'branch',portId:'1'},makeId);
  assert.equal(result.junctionId,split.junctionId);assert.equal(result.project.devices.length,split.project.devices.length);assert.equal(result.project.wires.length,3);
  const snapshot=structuredClone(result.project);
  assert.throws(()=>branchOnWire(result.project,part.id,point,{deviceId:'branch',portId:'1'},makeId),/đã có dây/);
  assert.deepEqual(result.project,snapshot);
});

test('shaft terminals and shaft wires cannot create electrical junctions',()=>{
  const project=fixture();project.devices.push(createDevice('diesel','diesel',600,0),createDevice('dc_generator','generator',850,0));
  project.wires.push(wire('shaft','diesel','shaft','generator','shaft'));
  const snapshot=structuredClone(project);
  assert.throws(()=>branchOnWire(project,'main',{x:40,y:200},{deviceId:'diesel',portId:'shaft'},ids()),/Trục cơ khí/);
  assert.throws(()=>branchOnWire(project,'shaft',{x:750,y:55},{deviceId:'branch',portId:'1'},ids()),/Chỉ rẽ nhánh/);
  assert.deepEqual(project,snapshot);
});

test('invalid attachments leave both the original wire and project untouched',()=>{
  const project=fixture(),snapshot=structuredClone(project);
  assert.throws(()=>branchOnWire(project,'main',{x:40,y:200},{deviceId:'absent',portId:'1'},ids()),/Đầu cực/);
  assert.throws(()=>branchOnWire(project,'main',{x:40,y:200},{deviceId:'branch',portId:'absent'},ids()),/Đầu cực/);
  assert.throws(()=>branchOnWire(project,'main',{x:NaN,y:200}),/Vị trí/);
  assert.throws(()=>branchOnWire(project,'main',{x:40,y:200},{deviceId:'source',portId:'2'},ids()),/đã có dây/);
  assert.throws(()=>branchOnWire(project,'main',{x:40,y:200},undefined,()=> 'source'),/Mã/);
  assert.deepEqual(project,snapshot);
});

function withCounts(deviceCount:number,wireCount:number):Project{
  const project=fixture();
  while(project.devices.length<deviceCount)project.devices.push(createDevice('junction',`spare-${project.devices.length}`,1000+project.devices.length*10,1000));
  for(let i=3;i<project.devices.length&&project.wires.length<wireCount;i++)for(let j=i+1;j<project.devices.length&&project.wires.length<wireCount;j++)project.wires.push(wire(`spare-wire-${project.wires.length}`,project.devices[i].id,'J',project.devices[j].id,'J'));
  assert.equal(project.wires.length,wireCount);return project;
}

test('device and wire limits are checked for the whole transaction, but endpoint reuse needs no device slot',()=>{
  const fullDevices=withCounts(250,1),snapshot=structuredClone(fullDevices);
  assert.throws(()=>branchOnWire(fullDevices,'main',{x:40,y:200},{deviceId:'branch',portId:'1'},ids()),/giới hạn/);
  const endpoint=wirePoints(fullDevices,fullDevices.wires[0])[0];
  assert.equal(branchOnWire(fullDevices,'main',endpoint,{deviceId:'branch',portId:'1'},ids()).project.devices.length,250);
  assert.deepEqual(fullDevices,snapshot);
  const nearlyFull=withCounts(50,749);
  assert.throws(()=>branchOnWire(nearlyFull,'main',{x:40,y:200},{deviceId:'branch',portId:'1'},ids()),/giới hạn/);
  assert.equal(branchOnWire(nearlyFull,'main',{x:40,y:200},undefined,ids()).project.wires.length,750);
  const room=withCounts(249,748),result=branchOnWire(room,'main',{x:40,y:200},{deviceId:'branch',portId:'1'},ids());
  assert.equal(result.project.devices.length,250);assert.equal(result.project.wires.length,750);
  const full=withCounts(50,750);
  assert.throws(()=>branchOnWire(full,'main',endpoint,{deviceId:'branch',portId:'1'},ids()),/750/);
});

test('redundant saved points are reduced before persistence while bends remain unchanged',()=>{
  const project=fixture(),source=project.devices[0],target=project.devices[1],x=terminalPosition(source,'2').x;
  target.x+=x-terminalPosition(target,'1').x;
  project.wires[0].waypoints=Array.from({length:64},(_,i)=>({x,y:110+i*2}));
  const result=branchOnWire(project,'main',{x,y:200},undefined,ids());
  assertPreserved(project,'main',result.project,result.junctionId!);
  assert.ok(result.project.wires.every(item=>item.waypoints!.length<=1));assert.doesNotThrow(()=>serializeProject(result.project));
});

test('an over-complex split is rejected instead of silently dropping real corners',()=>{
  const project=fixture();project.wires[0].waypoints=Array.from({length:64},(_,i)=>({x:80+i*10,y:110+i*2}));
  const snapshot=structuredClone(project);
  assert.throws(()=>branchOnWire(project,'main',{x:40,y:105},undefined,ids()),/64 điểm/);
  assert.deepEqual(project,snapshot);
});

test('splitting a closed current path and adding a load preserves both original and new branches',()=>{
  const devices:Device[]=[createDevice('dc','supply',0,0),createDevice('lamp','load',300,0),createDevice('lamp','added-load',500,0)];
  const project:Project={version:2,name:'Parallel lamps',devices,wires:[wire('feed','supply','+','load','1'),wire('return','load','2','supply','-'),wire('branch-return','added-load','2','supply','-')]};
  const snapshot=structuredClone(project);
  const result=branchOnWire(project,'feed',{x:200,y:-24},{deviceId:'added-load',portId:'1'},ids());
  const state=stepSimulation(result.project,createInitialState(result.project),.1);
  assert.equal(state.devices.load.energized,true);assert.equal(state.devices['added-load'].energized,true);
  for(const connection of result.project.wires)assert.equal(state.wires[connection.id].energized,true,connection.id);
  assert.deepEqual(project,snapshot);
});
