import test from 'node:test';
import assert from 'node:assert/strict';
import { examples } from './examples';
import { createInitialState, stepSimulation } from './simulation';
import type { DeviceKind } from './types';

const externalSources=new Set<DeviceKind>(['ac1','ac3','dc']);
const electricalLoads=new Set<DeviceKind>(['lamp','coil','timer_coil','contactor','field_winding','dc_motor','induction','synchronous','induction1','stepper','solenoid','brake','clutch','buzzer','hydraulic_solenoid']);

for(const example of examples)test(`${example.id}: removing every external supply releases loads and motion`,()=>{
  const project=structuredClone(example.project);
  // Exercise the working circuit before removing energy; a cold-start-only
  // check would miss held coils or stale converter/generator output states.
  project.devices.forEach(device=>{
    if(['breaker','breaker1','diesel','push_no','linked_push'].includes(device.kind))device.enabled=true;
  });
  let state=createInitialState(project);
  for(let i=0;i<3;i++)state=stepSimulation(project,state,.1);
  assert.ok(!state.events.some(event=>event.level==='error'),example.id);
  const sources=new Set(project.devices.filter(device=>externalSources.has(device.kind)).map(device=>device.id));
  project.wires=project.wires.filter(wire=>!sources.has(wire.from)&&!sources.has(wire.to));
  project.devices.forEach(device=>{if(device.kind==='diesel')device.enabled=false;});
  const off=stepSimulation(project,state,.1);
  assert.ok(!off.events.some(event=>event.level==='error'),example.id);
  for(const device of project.devices.filter(device=>electricalLoads.has(device.kind))){
    assert.equal(off.devices[device.id].energized,false,`${device.name} remains powered without a supply`);
    assert.equal(off.devices[device.id].rpm,0,`${device.name} remains rotating`);
  }
  assert.ok(Object.values(off.wires).every(wire=>!wire.energized),'no wire or shaft may retain fictitious flow');
});
