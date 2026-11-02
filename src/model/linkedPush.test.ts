import test from 'node:test';
import assert from 'node:assert/strict';
import { canActuate, createDevice, getDefinition, isMomentaryControl } from './catalog';
import { copySelection, pasteSelection } from './clipboard';
import { parseProject, serializeProject } from './persistence';
import { createInitialState, stepSimulation } from './simulation';
import type { DeviceKind, Project } from './types';

const d=(kind:DeviceKind,id:string,name='SB1')=>({...createDevice(kind,id,0,0),name});
const project=(kind:DeviceKind='linked_push'):Project=>({version:2,name:'Linked pushbutton',devices:[d(kind,'button'),d('contact_no','no',' sb1 '),d('contact_nc','nc'),d('contact_co','co'),d('contact_no','other','SB2')],wires:[]});
const run=(p:Project)=>stepSimulation(p,createInitialState(p),.1);

test('linked pushbutton starts released and has only separately placed contacts',()=>{
  const button=d('linked_push','button');
  assert.equal(button.enabled,false);
  assert.equal(canActuate(button.kind),true);
  assert.equal(isMomentaryControl(button.kind),true);
  assert.deepEqual(getDefinition(button.kind).ports,[]);
});

test('holding a linked pushbutton switches every matching NO, NC and CO and releasing restores them',()=>{
  const p=project();
  let previous=createInitialState(p);
  for(const pressed of [false,true,true,false,true,false]){
    p.devices[0].enabled=pressed;
    previous=stepSimulation(p,previous,.1);
    assert.equal(previous.devices.no.contactClosed,pressed);
    assert.equal(previous.devices.nc.contactClosed,!pressed);
    assert.equal(previous.devices.co.coilEnergized,pressed);
    assert.equal(previous.devices.other.contactClosed,false,'other names are independent');
    assert.equal(previous.events.some(event=>event.level==='error'),false);
  }
});

test('ordinary inline pushbuttons never operate same-name auxiliary contacts',()=>{
  for(const kind of ['push_no','push_nc'] as const){
    const p=project(kind);
    for(const enabled of [false,true]){
      p.devices[0].enabled=enabled;
      const state=run(p);
      assert.equal(state.devices.no.contactClosed,false,kind);
      assert.equal(state.devices.nc.contactClosed,true,kind);
      assert.equal(state.devices.co.coilEnergized,false,kind);
    }
  }
});

test('copying a held linked pushbutton and its contacts creates an independent released group',()=>{
  const p=project();p.devices[0].enabled=true;
  const pasted=pasteSelection(p,copySelection(p,['button','no','nc','co']),{x:100,y:100});
  const copies=pasted.project.devices.slice(p.devices.length);
  assert.ok(copies.every(device=>device.name===copies[0].name));
  assert.notEqual(copies[0].name,'SB1');
  assert.equal(copies[0].enabled,false);
  const state=run(pasted.project);
  assert.equal(state.devices.no.contactClosed,true);
  assert.equal(state.devices[copies[1].id].contactClosed,false);
  const contactOnly=pasteSelection(p,copySelection(p,['no']),{x:100,y:100});
  assert.equal(contactOnly.project.devices.at(-1)!.name,' sb1 ');
});

test('loading a saved held momentary control releases it without changing other control states',()=>{
  const p=project();p.devices[0].enabled=true;
  p.devices.push({...d('push_no','inline-no'),enabled:true},{...d('push_nc','inline-nc'),enabled:false},{...d('limit_switch','limit'),enabled:true},{...d('switch','switch','S2'),enabled:true});
  const loaded=parseProject(serializeProject(p));
  for(const id of ['button','inline-no','limit'])assert.equal(loaded.devices.find(device=>device.id===id)!.enabled,false);
  assert.equal(loaded.devices.find(device=>device.id==='inline-nc')!.enabled,true);
  assert.equal(loaded.devices.find(device=>device.id==='switch')!.enabled,true);
  assert.equal(p.devices[0].enabled,true,'saving/loading does not mutate the running drawing');
  assert.equal(run(loaded).devices.no.contactClosed,false);
});
