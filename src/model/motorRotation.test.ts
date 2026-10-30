import test from 'node:test';
import assert from 'node:assert/strict';
import { examples } from './examples';
import { createInitialState, stepSimulation } from './simulation';
import type { Project } from './types';

const sample=(id:string)=>structuredClone(examples.find(example=>example.id===id)!.project);
const run=(project:Project)=>stepSimulation(project,createInitialState(project),.1);
function remap(project:Project,device:string,ports:Record<string,string>){
  for(const wire of project.wires){
    if(wire.from===device)wire.fromPort=ports[wire.fromPort]??wire.fromPort;
    if(wire.to===device)wire.toPort=ports[wire.toPort]??wire.toPort;
  }
}

for(const id of ['motor-star','motor-delta','diesel-generator'])test(`${id}: phase exchange reverses rotation while cyclic phase permutations preserve it`,()=>{
  const project=sample(id),motor=project.devices.find(device=>['induction','synchronous'].includes(device.kind))!;
  const source=project.devices.find(device=>['ac3','ac_generator'].includes(device.kind))!;
  assert.equal(run(project).devices[motor.id].rpm,1);
  for(const [a,b] of [['L1','L2'],['L1','L3'],['L2','L3']]){
    const reversed=structuredClone(project);remap(reversed,source.id,{[a]:b,[b]:a});
    assert.equal(run(reversed).devices[motor.id].rpm,-1,`${a}/${b}`);
  }
  remap(project,source.id,{L1:'L2',L2:'L3',L3:'L1'});
  assert.equal(run(project).devices[motor.id].rpm,1);
});

test('single-phase motor reverses with either winding reversed, but not with both reversed',()=>{
  const project=sample('single-phase-motor'),motor='single-motor';
  assert.equal(run(project).devices[motor].rpm,1);
  remap(project,motor,{Z1:'Z2',Z2:'Z1'});assert.equal(run(project).devices[motor].rpm,-1);
  remap(project,motor,{U1:'U2',U2:'U1'});assert.equal(run(project).devices[motor].rpm,1);
  remap(project,motor,{Z1:'Z2',Z2:'Z1'});assert.equal(run(project).devices[motor].rpm,-1);
});

test('stepper winding polarity and exchanged driver channels both change direction',()=>{
  const project=sample('stepper-drive'),motor='motor-stepper';
  assert.equal(run(project).devices[motor].rpm,1);
  remap(project,motor,{'A+':'A-','A-':'A+'});assert.equal(run(project).devices[motor].rpm,-1);
  remap(project,motor,{'B+':'B-','B-':'B+'});assert.equal(run(project).devices[motor].rpm,1);
  const exchanged=sample('stepper-drive');remap(exchanged,motor,{'A+':'B+','A-':'B-','B+':'A+','B-':'A-'});
  assert.equal(run(exchanged).devices[motor].rpm,-1);
  remap(exchanged,motor,{'A+':'A-','A-':'A+'});assert.equal(run(exchanged).devices[motor].rpm,1);
});

test('loss of a motor running condition clears direction immediately',()=>{
  for(const id of ['motor-star','motor-delta','diesel-generator','single-phase-motor','stepper-drive','dc-independent']){
    const project=sample(id),motor=project.devices.find(device=>['induction','synchronous','induction1','stepper','dc_motor'].includes(device.kind))!;
    const live=run(project);assert.notEqual(live.devices[motor.id].rpm,0,id);
    project.wires=[];
    const stopped=stepSimulation(project,live,.1);assert.equal(stopped.devices[motor.id].rpm,0,id);
  }
});
