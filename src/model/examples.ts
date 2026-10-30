import { createDevice, getDefinition } from './catalog';
import { getPortGeometry, terminalPosition } from './geometry';
import { expandedExamples } from './expandedExamples';
import type { Device, DeviceKind, Point, Project, Wire } from './types';

export interface ExampleProject { id:string; name:string; description:string; project:Project }
// Examples show a wired working setup; newly placed controls still start at rest.
const d=(kind:DeviceKind,id:string,name:string,x:number,y:number,rotation:Device['rotation']=0):Device=>({...createDevice(kind,id,Math.round(x/10)*10,Math.round(y/10)*10),...(['breaker','breaker1','diesel'].includes(kind)?{enabled:true}:{}),name,rotation});
const w=(id:string,from:string,fromPort:string,to:string,toPort:string,color='#455566',waypoints?:Point[]):Wire=>({id,from,fromPort,to,toPort,color,waypoints:waypoints?.map(point=>({x:Math.round(point.x/10)*10,y:Math.round(point.y/10)*10})),length:1,section:2.5});
const phases=['#a87927','#344a5d','#7a7e84'];
const live='#c05c4b',neutral='#4275aa';
const example=(id:string,name:string,description:string,devices:Device[],wires:Wire[]):ExampleProject=>({id,name,description,project:{version:2,name,devices,wires}});
const rail=(devices:Device[],id:string,from:string,fromPort:string,to:string,toPort:string,y:number,color=live):Wire=>{
  const source=devices.find(device=>device.id===from)!,target=devices.find(device=>device.id===to)!;
  const a=terminalPosition(source,fromPort),b=terminalPosition(target,toPort);
  const aSide=getPortGeometry(source,getDefinition(source.kind).ports.find(port=>port.id===fromPort)!).side;
  const bSide=getPortGeometry(target,getDefinition(target.kind).ports.find(port=>port.id===toPort)!).side;
  const offset=(side:string)=>side==='left'?-20:side==='right'?20:0;
  return w(id,from,fromPort,to,toPort,color,[{x:a.x+offset(aSide),y},{x:b.x+offset(bSide),y}]);
};
const star=(id:string)=>[w('bridge-star-1',id,'W2',id,'U2'),w('bridge-star-2',id,'U2',id,'V2')];
const phaseWires=(from:string,fromPorts:string[],to:string,toPorts:string[],prefix:string)=>fromPorts.map((port,i)=>w(`${prefix}-${i}`,from,port,to,toPorts[i],phases[i]));
const field=(id:string,name:string,x:number,y:number,role:Device['windingRole']='shunt',rotation:Device['rotation']=0):Device=>({...d('field_winding',id,name,x,y,rotation),windingRole:role});

function dcCircuit(mode:NonNullable<Device['fieldMode']>):ExampleProject {
  const independent=mode==='independent',series=mode==='series',compound=mode==='compound';
  const source=d('dc','dc-source','G1',60,190);
  const motor={...d('dc_motor','motor-dc','M1',500,190),fieldMode:mode};
  const devices=[source,d('fuse','fuse-main','FU1',240,80,270),motor];
  const wires:Wire[]=[rail(devices,'w-source-fuse','dc-source','+','fuse-main','1',120)];
  if(series||compound){
    devices.push(field('field-series','M1',390,80,'series',270));
    wires.push(w('w-fuse-field','fuse-main','2','field-series','F1',live));
    wires.push(rail(devices,'w-fuse-motor','field-series','F2','motor-dc','+',120));
  }else wires.push(rail(devices,'w-fuse-motor','fuse-main','2','motor-dc','+',120));
  wires.push(rail(devices,'w-motor-return','motor-dc','-','dc-source','-',440,neutral));
  if(!series){
    devices.push(field('field-motor','M1',730,190));
    if(independent){
      devices.push(d('dc','field-source','G2',930,190));
      wires.push(rail(devices,'w-field-feed','field-source','+','field-motor','F1',120));
      wires.push(rail(devices,'w-field-return','field-motor','F2','field-source','-',440,neutral));
    }else{
      wires.push(rail(devices,'w-field-feed','fuse-main','2','field-motor','F1',40));
      wires.push(rail(devices,'w-field-return','field-motor','F2','dc-source','-',440,neutral));
    }
  }
  if(mode==='shunt'){
    devices.push(d('lamp','lamp-dc','H1',960,210));
    wires.push(rail(devices,'w-fuse-lamp','motor-dc','+','lamp-dc','1',120));
    wires.push(rail(devices,'w-lamp-return','lamp-dc','2','dc-source','-',490,neutral));
  }
  const names={independent:'kích từ độc lập',shunt:'kích từ song song',series:'kích từ nối tiếp',compound:'kích từ hỗn hợp'};
  const descriptions={
    independent:'Phần ứng và cuộn kích từ M1 được cấp từ hai nguồn riêng. Mở một trong hai mạch thì động cơ dừng.',
    shunt:'Phần ứng và cuộn kích từ cùng tên M1 mắc song song. Ngắt cuộn kích từ hoặc đường về phần ứng để kiểm tra điều kiện chạy.',
    series:'Cuộn kích từ nối tiếp M1 nằm trên cùng vòng dòng điện với phần ứng M1; phải có đủ cả hai để chạy.',
    compound:'Hai cuộn kích từ cùng tên M1: một cuộn nối tiếp phần ứng và một cuộn song song nguồn. Cả hai đều cần có dòng.',
  };
  return example(mode==='shunt'?'dc-loop':`dc-${mode}`,`Động cơ DC · ${names[mode]}`,descriptions[mode],devices,wires);
}

function threePhase(delta=false):ExampleProject {
  const motor='motor-main';
  const devices=[d('ac3','grid','G1',270,40),d('breaker','breaker-main','QF1',260,270),d('induction',motor,'M1',260,500)];
  const wires=[...phaseWires('grid',['L1','L2','L3'],'breaker-main',['1','3','5'],'feed'),...phaseWires('breaker-main',['2','4','6'],motor,['U1','V1','W1'],'motor')];
  if(delta){devices[2].params.voltage=400;for(const [i,a,b] of [[0,'U1','W2'],[1,'V1','U2'],[2,'W1','V2']] as const){const x=460+i*40,from=terminalPosition(devices[2],a),to=terminalPosition(devices[2],b);wires.push(w(`bridge-delta-${i}`,motor,a,motor,b,phases[i],[{x:from.x,y:460-i*20},{x,y:460-i*20},{x,y:740+i*20},{x:to.x,y:740+i*20}]));}}
  else wires.push(...star(motor));
  return example(delta?'motor-delta':'motor-star',delta?'Động cơ 3 pha · đấu tam giác':'Động cơ 3 pha · đấu sao','Sáu đầu U1/V1/W1 và W2/U2/V2. Các cầu nối là dây thật, có thể sửa hoặc xóa.',devices,wires);
}

const starterDevices=[
  d('ac3','grid','G1',510,20),d('breaker','breaker-main','QF1',500,240),
  d('contact_no','km-main-1','KM1',400,470),d('contact_no','km-main-2','KM1',540,470),d('contact_no','km-main-3','KM1',680,470),
  d('induction','motor-main','M1',500,760),d('push_nc','stop','S0',60,240),d('push_no','start','S1',60,450),
  d('contact_no','km-hold','KM1',250,450),d('coil','km','KM1',60,740),d('lamp','lamp-run','H1',900,740),
];
const starterWires:Wire[]=[...phaseWires('grid',['L1','L2','L3'],'breaker-main',['1','3','5'],'feed'),...star('motor-main')];
for(let i=0;i<3;i++){
  starterWires.push(w(`main-${i}`,'breaker-main',['2','4','6'][i],`km-main-${i+1}`,'13',phases[i]));
  starterWires.push(w(`load-${i}`,`km-main-${i+1}`,'14','motor-main',['U1','V1','W1'][i],phases[i]));
}
starterWires.push(
  rail(starterDevices,'control-live','grid','L1','stop','1',180,phases[0]),
  w('stop-start','stop','2','start','1'),
  rail(starterDevices,'start-coil','start','2','km','A1',650),
  rail(starterDevices,'hold-input','stop','2','km-hold','13',400),
  rail(starterDevices,'hold-output','km-hold','14','km','A1',650),
  w('coil-neutral','km','A2','grid','N',neutral,[{x:100,y:1030},{x:1100,y:1030},{x:1100,y:190},{x:terminalPosition(starterDevices[0],'N').x,y:190}]),
  rail(starterDevices,'lamp-live','km','A1','lamp-run','1',650),
  rail(starterDevices,'lamp-neutral','lamp-run','2','km','A2',1030,neutral),
);
const starter=example('contactor-starter','Contactor rời · Start / Stop tự giữ','Cuộn hút và bốn tiếp điểm NO đều mang tên KM1. START cấp cuộn hút; tiếp điểm phụ tự giữ. STOP nhả toàn bộ KM1.',starterDevices,starterWires);

function generatorCircuit(ac:boolean):ExampleProject {
  const generatorId=ac?'generator-ac':'generator-dc';
  const devices=[d('diesel',ac?'diesel-ac':'diesel-dc','D1',50,250),{...d(ac?'ac_generator':'dc_generator',generatorId,'G1',ac?380:370,230),fieldMode:'independent' as const},d('dc','field-source','G2',700,80),field('field-generator','G1',920,80)];
  const wires:Wire[]=[w('shaft-drive',devices[0].id,'shaft',generatorId,'shaft'),rail(devices,'generator-field-plus','field-source','+','field-generator','F1',30),rail(devices,'generator-field-minus','field-generator','F2','field-source','-',310,neutral)];
  if(ac){devices.push(d('induction','motor-sync','M1',370,560));wires.push(...phaseWires(generatorId,['L1','L2','L3'],'motor-sync',['U1','V1','W1'],'gen'),...star('motor-sync'));}
  else{devices.push(d('lamp','generator-load','H1',700,430));wires.push(w('generator-output',generatorId,'+','generator-load','1',live,[{x:terminalPosition(devices[1],'+').x,y:180},{x:640,y:180},{x:640,y:390},{x:terminalPosition(devices[4],'1').x,y:390}]),rail(devices,'generator-return','generator-load','2',generatorId,'-',640,neutral));}
  return example(ac?'diesel-generator':'dc-generator',ac?'Máy phát AC · lai cơ và kích từ':'Máy phát DC · lai cơ và kích từ','Máy phát G1 chỉ có đầu ra khi diesel quay và cuộn kích từ rời G1 có mạch cấp điện kín. Có thể ngắt riêng từng điều kiện.',devices,wires);
}

const emyDevices=[d('diesel','diesel-emy','D1',50,310),d('dc','field-source','G1',50,60),d('emy','amplidyne','EMY1',370,280),{...d('dc_motor','motor-dc','M1',730,280),fieldMode:'shunt' as const},field('field-motor','M1',950,280)];
const emy=example('emy-drive','EMY · điều khiển và kích từ tải','EMY có cuộn điều khiển F1/F2 tích hợp và trục lai. Động cơ DC tải M1 có cuộn kích từ M1 riêng, mắc song song với phần ứng.',emyDevices,[
  w('shaft-emy','diesel-emy','shaft','amplidyne','shaft'),w('field-plus','field-source','+','amplidyne','F1',live,[{x:100,y:20},{x:300,y:20},{x:300,y:310}]),w('field-minus','amplidyne','F2','field-source','-',neutral,[{x:270,y:410},{x:270,y:230},{x:100,y:230}]),
  rail(emyDevices,'emy-plus','amplidyne','+','motor-dc','+',210),rail(emyDevices,'emy-minus','motor-dc','-','amplidyne','-',520,neutral),rail(emyDevices,'motor-field-plus','motor-dc','+','field-motor','F1',210),rail(emyDevices,'motor-field-minus','field-motor','F2','motor-dc','-',520,neutral),
]);

const stepper=example('stepper-drive','Động cơ bước · driver hai pha','Cấp nguồn DC vào driver rồi nối đủ bốn đầu A+/A−/B+/B− ra động cơ bước.',[
  d('dc','dc-stepper','G1',50,200),d('step_driver','driver','DRV1',320,180),d('stepper','motor-stepper','M1',720,190),
],[w('driver-plus','dc-stepper','+','driver','+',live,[{x:100,y:140},{x:270,y:140},{x:270,y:230}]),w('driver-minus','dc-stepper','-','driver','-',neutral,[{x:100,y:400},{x:270,y:400},{x:270,y:310}]),w('phase-a-plus','driver','A+','motor-stepper','A+','#b07926',[{x:540,y:210},{x:540,y:130},{x:770,y:130}]),w('phase-a-minus','driver','A-','motor-stepper','A-','#b07926',[{x:570,y:250},{x:570,y:420},{x:770,y:420}]),w('phase-b-plus','driver','B+','motor-stepper','B+','#795cab',[{x:600,y:290},{x:600,y:100},{x:810,y:100}]),w('phase-b-minus','driver','B-','motor-stepper','B-','#795cab',[{x:630,y:330},{x:630,y:450},{x:810,y:450}])]);

const timerDevices=[d('dc','timer-source','G1',60,230),d('push_no','timer-start','S1',300,100),d('timer_coil','timer','KT1',300,360),d('timer_no','timer-no','KT1',600,140),d('lamp','timer-lamp-no','H1',600,360),d('timer_nc','timer-nc','KT1',850,140),d('lamp','timer-lamp-nc','H2',850,360)];
const timer=example('timer-relay','Rơle thời gian · tiếp điểm rời','KT1 trễ đóng 3 giây: nhấn S1 để cấp cuộn thời gian. H1 sáng khi tiếp điểm NO trễ đóng, H2 tắt khi tiếp điểm NC trễ mở.',timerDevices,[
  rail(timerDevices,'timer-supply','timer-source','+','timer-start','1',50),w('timer-coil-feed','timer-start','2','timer','A1'),rail(timerDevices,'timer-coil-return','timer','A2','timer-source','-',570,neutral),
  rail(timerDevices,'timer-no-feed','timer-source','+','timer-no','13',50),w('timer-no-load','timer-no','14','timer-lamp-no','1'),rail(timerDevices,'timer-no-return','timer-lamp-no','2','timer-source','-',570,neutral),
  rail(timerDevices,'timer-nc-feed','timer-source','+','timer-nc','21',50),w('timer-nc-load','timer-nc','22','timer-lamp-nc','1'),rail(timerDevices,'timer-nc-return','timer-lamp-nc','2','timer-source','-',570,neutral),
]);

export const examples:ExampleProject[]=[dcCircuit('shunt'),dcCircuit('independent'),dcCircuit('series'),dcCircuit('compound'),threePhase(),threePhase(true),starter,timer,generatorCircuit(false),generatorCircuit(true),emy,stepper,...expandedExamples];
export const defaultProject=examples[0].project;
