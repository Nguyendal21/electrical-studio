import test from 'node:test';
import assert from 'node:assert/strict';
import { createDevice } from './catalog';
import { createInitialState, stepSimulation } from './simulation';
import { parseProject, serializeProject } from './persistence';
import type { Device, DeviceKind, Project, Wire } from './types';
import { expandedExamples } from './expandedExamples';
const d=(kind:DeviceKind,id:string,name=id):Device=>({...createDevice(kind,id,0,0),name});
const w=(id:string,from:string,fromPort:string,to:string,toPort:string):Wire=>({id,from,fromPort,to,toPort,length:1,section:2.5});
const p=(devices:Device[],wires:Wire[]):Project=>({version:2,name:'Expanded components',devices,wires});
const run=(project:Project)=>stepSimulation(project,createInitialState(project),.1);
const inputPorts={transformer1:['P1','P2'],power_supply:['L','N'],rectifier1:['~1','~2']} as const;
function converted(kind:keyof typeof inputPorts){
  const [a,b]=inputPorts[kind],out=kind==='transformer1'?['S1','S2']:['+','-'];
  return p([d('ac1','s'),d(kind,'c'),d('lamp','l')],[w('in1','s','L','c',a),w('in2','s','N','c',b),w('out1','c',out[0],'l','1'),w('out2','l','2','c',out[1])]);
}
for(const kind of ['transformer1','power_supply','rectifier1'] as const)test(`${kind}: output needs an AC input loop and its own output return`,()=>{
  const project=converted(kind);assert.equal(run(project).devices.l.energized,true);
  for(const id of ['in1','in2','out1','out2']){const cut=structuredClone(project);cut.wires=cut.wires.filter(wire=>wire.id!==id);assert.equal(run(cut).devices.l.energized,false,id);}
  project.devices[0]=d('dc','s');project.wires[0].fromPort='+';project.wires[1].fromPort='-';assert.equal(run(project).devices.l.energized,false,'DC cannot drive the AC input');
});
test('converted DC excites a field but transformer AC does not',()=>{
  for(const kind of ['transformer1','power_supply','rectifier1'] as const){const project=converted(kind);project.devices[2]=d('field_winding','l');project.wires[2].toPort='F1';project.wires[3].fromPort='F2';assert.equal(run(project).devices.l.energized,kind!=='transformer1');}
});
test('a transformer and rectifier cascade drops its output immediately after input is lost',()=>{
  const project=converted('transformer1');project.devices.push(d('rectifier1','rect'));project.wires[2].from='rect';project.wires[2].fromPort='+';project.wires[3].to='rect';project.wires[3].toPort='-';
  project.wires.push(w('chain1','c','S1','rect','~1'),w('chain2','c','S2','rect','~2'));
  const live=run(project);assert.equal(live.devices.l.energized,true);
  project.wires=project.wires.filter(wire=>wire.id!=='in2');const off=stepSimulation(project,live,.1);assert.equal(off.devices.l.energized,false);assert.equal(off.devices.rect.energized,false);
});
test('a floating output cannot use the primary return or bootstrap its own input',()=>{
  const project=converted('transformer1');project.wires[3].to='s';project.wires[3].toPort='N';assert.equal(run(project).devices.l.energized,false);
  const loop=p([d('transformer1','t'),d('lamp','l')],[w('a','t','S1','t','P1'),w('b','t','S2','t','P2'),w('c','t','S1','l','1'),w('d','l','2','t','S2')]);
  assert.equal(run(loop).devices.l.energized,false);
});
for(const kind of ['transformer3','rectifier3'] as const)test(`${kind}: all three distinct phases are required`,()=>{
  const project=p([d('ac3','s'),d(kind,'c'),d('lamp','l')],[]);
  for(let i=1;i<=3;i++)project.wires.push(w(`in${i}`,'s',`L${i}`,'c',kind==='transformer3'?`P${i}`:`L${i}`));
  project.wires.push(w('o1','c',kind==='transformer3'?'S1':'+','l','1'),w('o2','l','2','c',kind==='transformer3'?'SN':'-'));
  assert.equal(run(project).devices.l.energized,true);
  for(let i=1;i<=3;i++){const cut=structuredClone(project);cut.wires=cut.wires.filter(wire=>wire.id!==`in${i}`);assert.equal(run(cut).devices.l.energized,false);}
});
test('separate selector contacts follow their chosen detent, including the centre position',()=>{
  const owner=d('selector3','s','SA1'),left=d('contact_no','left','sa1'),right=d('contact_no','right','SA1'),centre=d('contact_no','centre','SA1'),nc=d('contact_nc','nc','SA1'),co=d('contact_co','co','SA1');
  left.params.actuationPosition=-1;centre.params.actuationPosition=0;
  const project=p([owner,left,right,centre,nc,co],[]);
  for(const position of [-1,0,1]){owner.params.position=position;const state=run(project);assert.equal(state.devices.left.contactClosed,position===-1);assert.equal(state.devices.right.contactClosed,position===1);assert.equal(state.devices.centre.contactClosed,position===0);assert.equal(state.devices.nc.contactClosed,position!==1);assert.equal(state.devices.co.coilEnergized,position===1);}
});
for(const kind of ['switch','emergency_stop','limit_switch'] as const)test(`${kind}: same-name contacts follow the actuator without a fictitious coil supply`,()=>{
  const owner=d(kind,'owner','S1'),no=d('contact_no','no','S1'),nc=d('contact_nc','nc','S1'),unrelated=d('contact_no','other','S2');const project=p([owner,no,nc,unrelated],[]);
  assert.equal(run(project).devices.nc.contactClosed,true);owner.enabled=true;const state=run(project);assert.equal(state.devices.no.contactClosed,true);assert.equal(state.devices.nc.contactClosed,false);assert.equal(state.devices.other.contactClosed,false);
});
test('diode orientation controls a DC load and reverse-biased wire does not animate',()=>{
  const project=p([d('dc','s'),d('diode','v'),d('lamp','l')],[w('a','s','+','v','A'),w('b','v','K','l','1'),w('c','l','2','s','-')]);
  assert.equal(run(project).devices.l.energized,true);project.wires[0].toPort='K';project.wires[1].fromPort='A';const state=run(project);assert.equal(state.devices.l.energized,false);assert.ok(Object.values(state.wires).every(wire=>!wire.energized));
});
test('capacitor passes AC continuity but blocks steady DC',()=>{
  for(const source of ['dc','ac1'] as const){const project=p([d(source,'s'),d('capacitor','c'),d('lamp','l')],[w('a','s',source==='dc'?'+':'L','c','1'),w('b','c','2','l','1'),w('c','l','2','s',source==='dc'?'-':'N')]);assert.equal(run(project).devices.l.energized,source==='ac1');}
});
test('single-phase motor requires an AC main winding and a capacitor in the auxiliary winding path',()=>{
  const project=p([d('ac1','s'),d('induction1','m'),d('capacitor','c')],[w('a','s','L','m','U1'),w('b','m','U2','s','N'),w('c','s','L','c','1'),w('d','c','2','m','Z1'),w('e','m','Z2','s','N')]);
  assert.equal(run(project).devices.m.energized,true);
  const cut=structuredClone(project);cut.wires=cut.wires.filter(wire=>wire.id!=='d');assert.equal(run(cut).devices.m.energized,false);
  project.wires.push(w('bypass','s','L','m','Z1'));assert.equal(run(project).devices.m.energized,false,'bypassed capacitor cannot start the motor');
});
test('matching net labels connect remote branches while PE, N and generic labels remain separate',()=>{
  const a=d('net_label','a','LIVE'),b=d('offpage','b',' live '),project=p([d('dc','s'),a,b,d('lamp','l')],[w('a','s','+','a','P'),w('b','b','P','l','1'),w('c','l','2','s','-')]);
  assert.equal(run(project).devices.l.energized,true);b.name='OTHER';assert.equal(run(project).devices.l.energized,false);
  project.devices[1]=d('earth','a','N');project.devices[2]=d('neutral','b','N');project.wires[0].toPort='PE';project.wires[1].fromPort='N';assert.equal(run(project).devices.l.energized,false);
  project.devices[2]=d('earth','b','N');project.wires[1].fromPort='PE';assert.equal(run(project).devices.l.energized,true,'explicit matching PE wires are one net, but not an independent supply');
});
test('connector channels are independent and passive actuators need both terminals',()=>{
  for(const kind of ['solenoid','brake','clutch','buzzer','resistor','rheostat','resistor_bank','inductor'] as const){
    const actuator=['solenoid','brake','clutch'].includes(kind),a=actuator?'A1':'1',b=actuator?'A2':'2';
    const project=p([d('dc','s'),d('connector','x'),d(kind,'l')],[w('a','s','+','x','1'),w('b','x','2','l',a),w('c','l',b,'s','-')]);project.devices[2].enabled=false;
    assert.equal(run(project).devices.l.energized,true,kind);project.wires[1].fromPort='4';assert.equal(run(project).devices.l.energized,false,kind);
  }
});
test('single-phase generator needs field excitation and a mechanical drive',()=>{
  const generator=d('ac_generator1','g','G1'),field=d('field_winding','f','G1'),diesel=d('diesel','d');diesel.enabled=true;
  const project=p([generator,field,diesel,d('dc','s'),d('lamp','l')],[w('shaft','d','shaft','g','shaft'),w('f1','s','+','f','F1'),w('f2','f','F2','s','-'),w('o1','g','L','l','1'),w('o2','l','2','g','N')]);
  assert.equal(run(project).devices.l.energized,true);diesel.enabled=false;assert.equal(run(project).devices.l.energized,false);diesel.enabled=true;field.name='G2';assert.equal(run(project).devices.l.energized,false);
});
test('new control settings round-trip and fractional switch detents are rejected',()=>{
  const selector=d('selector3','s','SA1'),contact=d('contact_no','c','SA1');selector.params.position=-1;contact.params.actuationPosition=-1;
  const project=p([selector,contact],[]);assert.deepEqual(parseProject(serializeProject(project)),project);
  selector.params.position=.5;assert.throws(()=>serializeProject(project),/nấc nguyên/);selector.params.position=0;contact.params.actuationPosition=.5;assert.throws(()=>serializeProject(project),/nấc nguyên/);
});
test('new bundled demonstrations run and save without losing their control settings',()=>{
  const loads:Record<string,string>={'converted-dc':'converted-motor','selector-control':'right-lamp','single-phase-motor':'single-motor','remote-actuators':'remote-valve'};
  for(const example of expandedExamples){assert.equal(run(example.project).devices[loads[example.id]].energized,true,example.id);assert.deepEqual(parseProject(serializeProject(example.project)),example.project);}
});
