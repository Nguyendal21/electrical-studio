import test from 'node:test';
import assert from 'node:assert/strict';
import { createDevice } from './catalog';
import { createInitialState, stepSimulation } from './simulation';
import type { Device, DeviceKind, Project, Wire } from './types';

const d=(kind:DeviceKind,id:string,name=id):Device=>({...createDevice(kind,id,0,0),name});
const w=(id:string,from:string,fromPort:string,to:string,toPort:string):Wire=>({id,from,fromPort,to,toPort,length:1,section:2.5});
const run=(project:Project)=>stepSimulation(project,createInitialState(project),.1);

// Generic long-shunt motor with two starting resistor stages in the return.
// No private drawing identifiers, positions or control circuit are reproduced.
function compound():Project {
  const motor={...d('dc_motor','motor','M1'),fieldMode:'compound' as const};
  const series={...d('field_winding','series','M1'),windingRole:'series' as const};
  const shunt={...d('field_winding','shunt','M1'),windingRole:'shunt' as const};
  return {version:2,name:'Compound starting resistor test',devices:[d('dc','source'),motor,series,shunt,d('resistor','R1'),d('resistor','R2')],wires:[
    w('armature+','source','+','motor','+'),w('armature-','motor','-','series','F1'),
    w('series-resistor','series','F2','R1','1'),w('resistors','R1','2','R2','1'),w('return','R2','2','source','-'),
    w('shunt+','source','+','shunt','F1'),w('shunt-','shunt','F2','source','-'),
  ]};
}

test('compound DC excitation spans starting resistors, including bypassed stages and reversed armature',()=>{
  for(const bypass of [[],['R1'],['R2'],['R1','R2']])for(const reversed of [false,true]){
    const project=compound();
    for(const resistor of bypass)project.wires.push(w('bypass-'+resistor,resistor,'1',resistor,'2'));
    if(reversed)for(const wire of project.wires){if(wire.from==='motor')wire.fromPort=wire.fromPort==='+'?'-':'+';if(wire.to==='motor')wire.toPort=wire.toPort==='+'?'-':'+';}
    const state=run(project);
    assert.equal(state.devices.series.energized,true);
    assert.equal(state.devices.shunt.energized,true);
    assert.equal(state.devices.motor.fieldEnergized,true);
    assert.equal(state.devices.motor.energized,true);
    assert.equal(state.devices.motor.rpm,reversed?-1:1);
    assert.deepEqual(state.events.filter(e=>e.level==='error'),[]);
  }
});

test('compound winding recognition includes field rheostats and keeps rotation independent of device ordering',()=>{
  const project=compound();
  project.devices.push(d('rheostat','field-rheostat'));
  project.wires=project.wires.filter(wire=>wire.id!=='shunt+');
  project.wires.push(w('regulator-in','source','+','field-rheostat','1'),w('regulator-out','field-rheostat','2','shunt','F1'));
  assert.equal(run(project).devices.motor.energized,true);
  // Reversing the reference orientation of the series winding must not make
  // the direction jump merely because the series part precedes the shunt part.
  for(const wire of project.wires){if(wire.from==='series')wire.fromPort=wire.fromPort==='F1'?'F2':'F1';if(wire.to==='series')wire.toPort=wire.toPort==='F1'?'F2':'F1';}
  const direction=run(project).devices.motor.rpm;
  project.devices.reverse();
  assert.equal(run(project).devices.motor.rpm,direction);
});

test('compound excitation still rejects open, bypassed or mislabeled field windings',()=>{
  for(const fault of ['open-series','open-shunt','bypass-series','wrong-role','wrong-name']){
    const project=compound();
    if(fault==='open-series')project.wires=project.wires.filter(wire=>wire.id!=='series-resistor');
    if(fault==='open-shunt')project.wires=project.wires.filter(wire=>wire.id!=='shunt+');
    if(fault==='bypass-series')project.wires.push(w('short-field','series','F1','series','F2'));
    if(fault==='wrong-role')project.devices.find(d=>d.id==='series')!.windingRole='shunt';
    if(fault==='wrong-name')project.devices.find(d=>d.id==='shunt')!.name='M2';
    assert.equal(run(project).devices.motor.energized,false,fault);
  }
});

test('sharing only a return with an independent field supply is not compound shunt excitation',()=>{
  const project=compound();project.devices.push(d('dc','separate-source'));
  project.wires=project.wires.filter(wire=>wire.id!=='shunt+');
  project.wires.push(w('separate-field','separate-source','+','shunt','F1'),w('common-return','separate-source','-','source','-'));
  const state=run(project);
  assert.equal(state.devices.shunt.energized,true);
  assert.equal(state.devices.series.energized,true);
  assert.equal(state.devices.motor.energized,false);
});

test('shunt and independent modes recognize a series field rheostat without confusing their supplies',()=>{
  const project=compound();project.devices=project.devices.filter(d=>d.id!=='series');
  project.wires=project.wires.filter(w=>w.from!=='series'&&w.to!=='series');
  project.wires.push(w('armature-return','motor','-','R1','1'));
  project.devices.find(d=>d.id==='motor')!.fieldMode='shunt';
  project.devices.push(d('rheostat','adjustment'));
  project.wires.find(w=>w.id==='shunt+')!.to='adjustment';project.wires.find(w=>w.id==='shunt+')!.toPort='1';
  project.wires.push(w('adjusted-field','adjustment','2','shunt','F1'));
  assert.equal(run(project).devices.motor.energized,true);
  project.devices.find(d=>d.id==='motor')!.fieldMode='independent';
  assert.equal(run(project).devices.motor.energized,false,'a field supplied from the same rails is shunt, even through a rheostat');
});
