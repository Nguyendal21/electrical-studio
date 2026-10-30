import test from 'node:test';
import assert from 'node:assert/strict';
import { canActuate, createDevice } from './catalog';
import { examples } from './examples';
import { createInitialState, stepSimulation, validateConnection, validateProject } from './simulation';
import type { DeviceKind, Project, Wire } from './types';
const clone=<T,>(value:T):T=>structuredClone(value);
const sample=(id:string)=>clone(examples.find(example=>example.id===id)!.project);
const run=(p:Project)=>stepSimulation(p,createInitialState(p),.1);
const wire=(id:string,from:string,fromPort:string,to:string,toPort:string):Wire=>({id,from,fromPort,to,toPort,length:1,section:2.5});
const simple=(kind:DeviceKind='dc'):Project=>({version:2,name:'Test',devices:[createDevice(kind,'s',0,0),createDevice('lamp','l',200,0)],wires:[wire('a','s',kind==='dc'?'+':'L','l','1'),wire('b','l','2','s',kind==='dc'?'-':'N')]});

test('all examples have valid terminal connections',()=>{for(const example of examples)assert.deepEqual(validateProject(example.project).filter(issue=>issue.level==='error'),[],example.id);});
test('DC lamp needs both supply and return; a dangling supply wire has no flow',()=>{const p=simple();assert.equal(run(p).devices.l.energized,true);p.wires.pop();const s=run(p);assert.equal(s.devices.l.energized,false);assert.equal(s.wires.a.energized,false);});
test('single-phase AC requires L and N',()=>{const p=simple('ac1');assert.equal(run(p).devices.l.energized,true);p.wires.pop();assert.equal(run(p).devices.l.energized,false);});
test('parallel DC branches remain independent when the armature return is open',()=>{const p=sample('dc-loop');p.wires=p.wires.filter(w=>w.id!=='w-motor-return');const s=run(p);assert.equal(s.devices['lamp-dc'].energized,true);assert.equal(s.devices['motor-dc'].energized,false);assert.equal(s.wires['w-fuse-motor'].energized,true);assert.equal(s.wires['w-lamp-return'].energized,true);});
test('opening the fuse removes flow from all downstream DC loads',()=>{const p=sample('dc-loop');p.devices.find(d=>d.kind==='fuse')!.enabled=false;const s=run(p);assert.equal(s.devices['motor-dc'].energized,false);assert.equal(s.devices['lamp-dc'].energized,false);assert.ok(Object.values(s.wires).every(w=>!w.energized));});
test('reversing only the armature reverses DC rotation; reversing both armature and shunt field does not',()=>{
  const independent=sample('dc-independent');for(const w of independent.wires){if(w.from==='dc-source')w.fromPort=w.fromPort==='+'?'-':'+';if(w.to==='dc-source')w.toPort=w.toPort==='+'?'-':'+';}assert.equal(run(independent).devices['motor-dc'].rpm,-1);
  const shunt=sample('dc-loop');for(const w of shunt.wires){if(w.from==='dc-source')w.fromPort=w.fromPort==='+'?'-':'+';if(w.to==='dc-source')w.toPort=w.toPort==='+'?'-':'+';}assert.equal(run(shunt).devices['motor-dc'].rpm,1);
});
test('star and delta bridges energize three motor windings',()=>{for(const id of ['motor-star','motor-delta']){const s=run(sample(id));assert.equal(s.devices['motor-main'].energized,true,id);assert.match(s.devices['motor-main'].connection!,id==='motor-star'?/Y/:/Δ/);}});
test('six-terminal motor with no winding bridges stays off',()=>{const p=sample('motor-star');p.wires=p.wires.filter(w=>w.from!==w.to);const s=run(p);assert.equal(s.devices['motor-main'].energized,false);assert.ok(Object.values(s.wires).every(w=>!w.energized));});
test('missing phase does not report a running three-phase motor',()=>{const p=sample('motor-star');p.wires=p.wires.filter(w=>w.id!=='feed-1');assert.equal(run(p).devices['motor-main'].energized,false);});
test('contactor Start / release / Stop behaves as a self-holding circuit',()=>{
  const p=sample('contactor-starter');let s=run(p);assert.equal(s.devices.km.coilEnergized,false);assert.equal(s.devices['motor-main'].energized,false);
  p.devices.find(d=>d.id==='start')!.enabled=true;s=stepSimulation(p,s,.1);assert.equal(s.devices.km.coilEnergized,true);assert.equal(s.devices['motor-main'].energized,true);
  p.devices.find(d=>d.id==='start')!.enabled=false;s=stepSimulation(p,s,.1);assert.equal(s.devices.km.coilEnergized,true);assert.equal(s.devices['lamp-run'].energized,true);
  p.devices.find(d=>d.id==='stop')!.enabled=false;s=stepSimulation(p,s,.1);assert.equal(s.devices.km.coilEnergized,false);assert.equal(s.devices['motor-main'].energized,false);
  p.devices.find(d=>d.id==='stop')!.enabled=true;s=stepSimulation(p,s,.1);assert.equal(s.devices.km.coilEnergized,false);
});
test('contactor A2 return is necessary',()=>{const p=sample('contactor-starter');p.devices.find(d=>d.id==='start')!.enabled=true;p.wires=p.wires.filter(w=>w.id!=='coil-neutral');assert.equal(run(p).devices.km.coilEnergized,false);});
test('generator requires mechanical drive',()=>{const p=sample('diesel-generator');assert.equal(run(p).devices['motor-sync'].energized,true);p.devices.find(d=>d.kind==='diesel')!.enabled=false;assert.equal(run(p).devices['motor-sync'].energized,false);});
test('EMY requires both field return and shaft drive',()=>{const p=sample('emy-drive');assert.equal(run(p).devices['motor-dc'].energized,true);p.wires=p.wires.filter(w=>w.id!=='field-minus');assert.equal(run(p).devices['motor-dc'].energized,false);});
test('stepper needs driver supply and both windings',()=>{const p=sample('stepper-drive');assert.equal(run(p).devices['motor-stepper'].energized,true);p.wires=p.wires.filter(w=>w.id!=='phase-b-minus');assert.equal(run(p).devices['motor-stepper'].energized,false);});
test('zero pulse frequency holds the stepper without rotation',()=>{const p=sample('stepper-drive');p.devices.find(d=>d.kind==='step_driver')!.params.pulseRate=0;const s=run(p);assert.equal(s.devices['motor-stepper'].rpm,0);assert.ok(s.wires['phase-a-plus'].energized);});
test('a direct short is reported and cannot animate as a normal load',()=>{const p=simple();p.wires.push(wire('short','s','+','s','-'));const s=run(p);assert.ok(s.events.some(e=>e.level==='error'));assert.ok(Object.values(s.wires).every(w=>!w.energized));});
test('electrical wires have no source/target restrictions; duplicate reverse links are refused',()=>{const p=simple();assert.match(validateConnection(p,wire('c','l','1','s','+'))!,/đã có/);p.wires=[];assert.equal(validateConnection(p,wire('c','l','1','s','+')),null);});
test('shaft terminals cannot connect to electrical terminals',()=>{const p=sample('diesel-generator');assert.match(validateConnection(p,wire('bad','diesel-ac','shaft','generator-ac','L1'))!,/hai loại/);});
test('adding a junction preserves circuit continuity',()=>{const p=simple();p.devices.push(createDevice('junction','j',100,100));p.wires=[wire('a','s','+','j','J'),wire('c','j','J','l','1'),p.wires[1]];assert.equal(run(p).devices.l.energized,true);});
test('a load fed by only one pole of each independent source has no closed return',()=>{const p=simple();p.devices.push(createDevice('dc','s2',400,0));p.wires[1].to='s2';assert.equal(run(p).devices.l.energized,false);});
test('public states contain no fabricated electrical measurements',()=>{const s=run(sample('dc-loop'));for(const d of Object.values(s.devices)){assert.equal(d.current,0);assert.equal(d.voltage,0);assert.equal(d.power,0);}});

test('DC independent, shunt, series and compound examples require valid excitation paths',()=>{
  for(const id of ['dc-independent','dc-loop','dc-series','dc-compound']){
    const p=sample(id),s=run(p);assert.equal(s.devices['motor-dc'].energized,true,id);assert.equal(s.devices['motor-dc'].fieldEnergized,true,id);
    const fields=p.devices.filter(d=>d.kind==='field_winding');
    for(const field of fields){const cut=clone(p);cut.wires=cut.wires.filter(w=>!(w.to===field.id&&w.toPort==='F1')&&!(w.from===field.id&&w.fromPort==='F1'));assert.equal(run(cut).devices['motor-dc'].energized,false,`${id}: ${field.id} open`);}
  }
});
test('closed DC armature without a matching excitation winding carries current but cannot rotate',()=>{
  const p=sample('dc-independent');p.devices=p.devices.filter(d=>d.kind!=='field_winding');p.wires=p.wires.filter(w=>p.devices.some(d=>d.id===w.from)&&p.devices.some(d=>d.id===w.to));
  const s=run(p);assert.equal(s.devices['motor-dc'].energized,false);assert.equal(s.devices['motor-dc'].rpm,0);assert.equal(s.wires['w-motor-return'].energized,true);assert.ok(validateProject(p).some(issue=>issue.message.includes('kích từ')));
});
test('excitation designations normalize whitespace and case, but do not link a different machine',()=>{
  const p=sample('dc-independent'),field=p.devices.find(d=>d.kind==='field_winding')!;field.name='  m1  ';assert.equal(run(p).devices['motor-dc'].energized,true);
  field.name='M2';assert.equal(run(p).devices['motor-dc'].energized,false);assert.equal(run(p).devices[field.id].energized,true);
});
test('shunt and series modes verify topology instead of merely accepting a live field',()=>{
  const independent=sample('dc-independent');independent.devices.find(d=>d.id==='motor-dc')!.fieldMode='shunt';assert.equal(run(independent).devices['motor-dc'].energized,false);
  const shunt=sample('dc-loop');shunt.devices.find(d=>d.id==='motor-dc')!.fieldMode='series';assert.equal(run(shunt).devices['motor-dc'].energized,false);
  const series=sample('dc-series');series.devices.find(d=>d.id==='motor-dc')!.fieldMode='shunt';assert.equal(run(series).devices['motor-dc'].energized,false);
  shunt.devices.find(d=>d.id==='motor-dc')!.fieldMode='independent';assert.equal(run(shunt).devices['motor-dc'].energized,false);
});
test('compound excitation needs both winding roles and supports short-shunt wiring',()=>{
  const p=sample('dc-compound');p.devices.find(d=>d.id==='field-series')!.windingRole='shunt';assert.equal(run(p).devices['motor-dc'].energized,false);
  p.devices.find(d=>d.id==='field-series')!.windingRole='series';const feed=p.wires.find(w=>w.id==='w-field-feed')!;feed.from='motor-dc';feed.fromPort='+';assert.equal(run(p).devices['motor-dc'].energized,true);
});
test('an AC-fed field does not excite a DC machine',()=>{
  const p=sample('dc-independent'),source=p.devices.find(d=>d.id==='field-source')!;source.kind='ac1';
  for(const w of p.wires){if(w.from===source.id)w.fromPort=w.fromPort==='+'?'L':'N';if(w.to===source.id)w.toPort=w.toPort==='+'?'L':'N';}
  const s=run(p);assert.equal(s.devices['field-motor'].energized,false);assert.equal(s.devices['motor-dc'].energized,false);
});
test('sharing a single AC neutral with a DC field supply does not invalidate that DC supply',()=>{
  const p=sample('dc-independent');p.devices.push(createDevice('ac1','ac-control',0,0),createDevice('lamp','ac-lamp',0,0));
  p.wires.push(wire('ac-feed','ac-control','L','ac-lamp','1'),wire('ac-return','ac-lamp','2','ac-control','N'),wire('common-reference','field-source','-','ac-control','N'));
  const s=run(p);assert.equal(s.devices['motor-dc'].energized,true);assert.equal(s.devices['ac-lamp'].energized,true);
});
test('AC and DC generators require both shaft drive and a powered matching field',()=>{
  for(const id of ['dc-generator','diesel-generator']){
    const p=sample(id),generator=p.devices.find(d=>d.kind==='dc_generator'||d.kind==='ac_generator')!;let s=run(p);assert.equal(s.devices[generator.id].energized,true,id);
    const wires=p.wires;p.wires=p.wires.filter(w=>!(w.to==='field-generator'&&w.toPort==='F1')&&!(w.from==='field-generator'&&w.fromPort==='F1'));s=stepSimulation(p,s,.1);assert.equal(s.devices[generator.id].energized,false,id);
    p.wires=wires;p.devices.find(d=>d.kind==='diesel')!.enabled=false;assert.equal(run(p).devices[generator.id].energized,false,id);
  }
});
test('synchronous machine requires its own field as well as three-phase stator power',()=>{
  const p=sample('motor-star'),motor=p.devices.find(d=>d.id==='motor-main')!;motor.kind='synchronous';assert.equal(run(p).devices[motor.id].energized,false);
  const source=createDevice('dc','field-supply',0,0),field=createDevice('field_winding','field',0,0);field.name=motor.name;p.devices.push(source,field);p.wires.push(wire('field-feed',source.id,'+',field.id,'F1'),wire('field-return',field.id,'F2',source.id,'-'));
  assert.equal(run(p).devices[motor.id].energized,true);
});
test('an excited DC motor can drive an independently excited DC generator in the same tick',()=>{
  const p=sample('dc-independent'),gen=createDevice('dc_generator','gen',0,0),field=createDevice('field_winding','gen-field',0,0);gen.name=field.name='G3';p.devices.push(gen,field,createDevice('lamp','gen-lamp',0,0));
  p.wires.push(wire('shaft','motor-dc','shaft','gen','shaft'),wire('gen-field-feed','field-source','+','gen-field','F1'),wire('gen-field-return','gen-field','F2','field-source','-'),wire('gen-feed','gen','+','gen-lamp','1'),wire('gen-return','gen-lamp','2','gen','-'));
  let s=run(p);assert.equal(s.devices.gen.energized,true);assert.equal(s.devices['gen-lamp'].energized,true);
  p.wires=p.wires.filter(w=>w.id!=='w-field-feed');s=stepSimulation(p,s,.1);assert.equal(s.devices.gen.energized,false);assert.equal(s.devices['gen-lamp'].energized,false);assert.equal(s.wires.shaft.energized,false);
});
test('separate contacts use their coil designation and require a closed coil return',()=>{
  const p=sample('contactor-starter');p.devices.find(d=>d.id==='start')!.enabled=true;const contact=p.devices.find(d=>d.id==='km-main-1')!;contact.name=' km1 ';let s=run(p);assert.equal(s.devices[contact.id].contactClosed,true);
  contact.name='KM2';s=run(p);assert.equal(s.devices[contact.id].contactClosed,false);assert.equal(s.devices['motor-main'].energized,false);
  contact.name='KM1';p.wires=p.wires.filter(w=>w.id!=='coil-neutral');s=run(p);assert.equal(s.devices[contact.id].contactClosed,false);
});
test('on-delay NO and NC contacts switch together only after the delay',()=>{
  const p=sample('timer-relay'),timer=p.devices.find(d=>d.id==='timer')!,button=p.devices.find(d=>d.id==='timer-start')!;timer.params.delaySeconds=.5;
  let s=run(p);assert.equal(s.devices['timer-lamp-no'].energized,false);assert.equal(s.devices['timer-lamp-nc'].energized,true);
  button.enabled=true;s=stepSimulation(p,s,.1);assert.equal(s.devices.timer.coilEnergized,true);assert.equal(s.devices.timer.timerPending,true);assert.equal(s.devices['timer-no'].contactClosed,false);
  for(let i=0;i<4;i++)s=stepSimulation(p,s,.1);assert.equal(s.devices.timer.timerElapsed,.5);assert.equal(s.devices['timer-no'].contactClosed,true);assert.equal(s.devices['timer-nc'].contactClosed,false);assert.equal(s.devices['timer-lamp-no'].energized,true);assert.equal(s.devices['timer-lamp-nc'].energized,false);
  button.enabled=false;s=stepSimulation(p,s,.1);assert.equal(s.devices.timer.timerElapsed,0);assert.equal(s.devices['timer-no'].contactClosed,false);assert.equal(s.devices['timer-nc'].contactClosed,true);
});
test('on-delay resets when coil power is interrupted before completion',()=>{
  const p=sample('timer-relay'),timer=p.devices.find(d=>d.id==='timer')!,button=p.devices.find(d=>d.id==='timer-start')!;timer.params.delaySeconds=.3;button.enabled=true;let s=run(p);s=stepSimulation(p,s,.1);button.enabled=false;s=stepSimulation(p,s,.1);button.enabled=true;s=stepSimulation(p,s,.1);assert.equal(s.devices.timer.timerOutput,false);assert.equal(s.devices.timer.timerElapsed,.1);
});
test('off-delay holds contacts after coil loss, releases after delay and resets on retrigger',()=>{
  const p=sample('timer-relay'),timer=p.devices.find(d=>d.id==='timer')!,button=p.devices.find(d=>d.id==='timer-start')!;timer.params.delaySeconds=.3;timer.params.timerMode=1;button.enabled=true;
  let s=run(p);assert.equal(s.devices['timer-no'].contactClosed,true);button.enabled=false;s=stepSimulation(p,s,.1);assert.equal(s.devices.timer.coilEnergized,false);assert.equal(s.devices.timer.timerPending,true);assert.equal(s.devices['timer-no'].contactClosed,true);
  button.enabled=true;s=stepSimulation(p,s,.1);assert.equal(s.devices.timer.timerElapsed,0);assert.equal(s.devices.timer.timerPending,false);
  button.enabled=false;for(let i=0;i<3;i++)s=stepSimulation(p,s,.1);assert.equal(s.devices.timer.timerOutput,false);assert.equal(s.devices['timer-no'].contactClosed,false);assert.equal(s.devices['timer-nc'].contactClosed,true);
});
test('ordinary contacts on a timer follow coil immediately while timed contacts wait',()=>{
  const p=sample('timer-relay'),contact=createDevice('contact_no','instant-contact',0,0);contact.name='KT1';p.devices.push(contact);p.devices.find(d=>d.id==='timer-start')!.enabled=true;
  const s=run(p);assert.equal(s.devices['instant-contact'].contactClosed,true);assert.equal(s.devices['timer-no'].contactClosed,false);
});

test('new hand controls start at their normal unactuated position',()=>{
  for(const kind of ['breaker','breaker1','diesel','push_no'] as const)assert.equal(createDevice(kind,kind,0,0).enabled,false,kind);
  for(const kind of ['thermal','push_nc'] as const)assert.equal(createDevice(kind,kind,0,0).enabled,true,kind);
  for(const kind of ['breaker','breaker1','diesel','push_no','push_nc','thermal'] as const)assert.equal(canActuate(kind),true,kind);
  for(const kind of ['dc','ac1','ac3','induction','synchronous','dc_motor','dc_generator','ac_generator','coil','timer_coil','contact_no','contact_co','field_winding','lamp','fuse'] as const)assert.equal(canActuate(kind),false,kind);
});

test('single-pole breaker opens and closes a complete circuit',()=>{
  const p=simple('ac1'),cb=createDevice('breaker1','cb',100,0);p.devices.push(cb);p.wires[0]=wire('a','s','L','cb','1');p.wires.push(wire('out','cb','2','l','1'));
  let s=run(p);assert.equal(s.devices.l.energized,false);assert.equal(s.devices.cb.contactClosed,false);
  cb.enabled=true;s=stepSimulation(p,s,.1);assert.equal(s.devices.l.energized,true);assert.equal(s.devices.cb.contactClosed,true);assert.ok(Object.values(s.wires).every(w=>w.energized));
  cb.enabled=false;s=stepSimulation(p,s,.1);assert.equal(s.devices.l.energized,false);assert.ok(Object.values(s.wires).every(w=>!w.energized));
});

test('passive and automatic devices cannot be stopped by an old enabled flag',()=>{
  for(const id of ['dc-loop','dc-generator','diesel-generator','stepper-drive','emy-drive']){
    const p=sample(id),expected=run(p);
    for(const device of p.devices)if(!canActuate(device.kind)&&device.kind!=='fuse')device.enabled=false;
    const s=run(p);for(const device of p.devices){assert.equal(s.devices[device.id].energized,expected.devices[device.id].energized,`${id}: ${device.kind}`);assert.equal(s.devices[device.id].rpm,expected.devices[device.id].rpm);}
  }
  const p=sample('contactor-starter');p.devices.find(d=>d.id==='start')!.enabled=true;for(const device of p.devices)if(['coil','contact_no','contact_nc'].includes(device.kind))device.enabled=false;
  assert.equal(run(p).devices['motor-main'].energized,true);
});

test('thermal NO, NC and CO contacts follow trip and reset without interrupting the heater path',()=>{
  const p:Project={version:2,name:'Thermal contacts',devices:[createDevice('dc','s',0,0),createDevice('thermal','fr',0,0)],wires:[]};
  const thermal=p.devices[1];thermal.name='FR1';
  for(const [kind,id] of [['contact_no','no'],['contact_nc','nc'],['contact_co','co']] as const){const contact=createDevice(kind,id,0,0);contact.name=' fr1 ';p.devices.push(contact);}
  for(const [id,input,output] of [['no','13','14'],['nc','21','22'],['co','11','12'],['co','11','14'],['fr','1','2']] as const){
    const lamp=`lamp-${id}-${output}`;p.devices.push(createDevice('lamp',lamp,0,0));
    if(!p.wires.some(w=>w.to===id&&w.toPort===input))p.wires.push(wire(`feed-${id}`,'s','+',id,input));
    p.wires.push(wire(`out-${lamp}`,id,output,lamp,'1'),wire(`return-${lamp}`,lamp,'2','s','-'));
  }
  assert.ok(!validateProject(p).some(issue=>issue.message.includes('cùng tên')));
  let s=run(p);assert.equal(s.devices.fr.tripped,false);assert.equal(s.devices['lamp-no-14'].energized,false);assert.equal(s.devices['lamp-nc-22'].energized,true);assert.equal(s.devices['lamp-co-12'].energized,true);assert.equal(s.devices['lamp-co-14'].energized,false);assert.equal(s.devices['lamp-fr-2'].energized,true);
  thermal.enabled=false;s=stepSimulation(p,s,.1);assert.equal(s.devices.fr.tripped,true);assert.equal(s.devices['lamp-no-14'].energized,true);assert.equal(s.devices['lamp-nc-22'].energized,false);assert.equal(s.devices['lamp-co-12'].energized,false);assert.equal(s.devices['lamp-co-14'].energized,true);assert.equal(s.devices['lamp-fr-2'].energized,true);
  thermal.enabled=true;s=stepSimulation(p,s,.1);assert.equal(s.devices.fr.tripped,false);assert.equal(s.devices['lamp-no-14'].energized,false);assert.equal(s.devices['lamp-nc-22'].energized,true);assert.equal(s.devices['lamp-co-12'].energized,true);assert.equal(s.devices['lamp-co-14'].energized,false);
});

test('changeover contacts use their coil designation and select exactly one throw',()=>{
  const p=simple(),coil=createDevice('coil','k',0,0),co=createDevice('contact_co','co',0,0);coil.name=co.name='K';p.devices.push(coil,co,createDevice('lamp','nc-load',0,0));
  p.wires=[wire('feed','s','+','co','11'),wire('no','co','14','l','1'),wire('no-return','l','2','s','-'),wire('nc','co','12','nc-load','1'),wire('nc-return','nc-load','2','s','-')];
  let s=run(p);assert.equal(s.devices.l.energized,false);assert.equal(s.devices['nc-load'].energized,true);
  p.wires.push(wire('coil-feed','s','+','k','A1'),wire('coil-return','k','A2','s','-'));s=stepSimulation(p,s,.1);assert.equal(s.devices.l.energized,true);assert.equal(s.devices['nc-load'].energized,false);assert.equal(s.devices.co.coilEnergized,true);
  co.name='K2';s=stepSimulation(p,s,.1);assert.equal(s.devices.l.energized,false);assert.equal(s.devices['nc-load'].energized,true);
});

test('legacy thermal NC ports reset immediately and remain readable',()=>{
  const p=simple(),thermal=createDevice('thermal','fr',0,0);p.devices.push(thermal);p.wires[0]=wire('a','s','+','fr','95');p.wires.push(wire('out','fr','96','l','1'));
  let s=run(p);assert.equal(s.devices.l.energized,true);thermal.enabled=false;s=stepSimulation(p,s,.1);assert.equal(s.devices.l.energized,false);
  thermal.enabled=true;s=stepSimulation(p,s,.1);assert.equal(s.devices.l.energized,true);
});
