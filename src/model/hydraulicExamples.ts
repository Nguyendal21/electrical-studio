import { createDevice, getDefinition } from './catalog';
import { terminalPosition } from './geometry';
import type { Device, DeviceKind, Point, Project, Wire } from './types';

const d=(kind:DeviceKind,id:string,name:string,x:number,y:number,params:Record<string,number>={}):Device=>{
  const device=createDevice(kind,id,x,y);
  const labelOffset=['hydraulic_pump','water_tank','hydraulic_valve','hydraulic_filter','pressure_sensor','flow_sensor','level_sensor'].includes(kind)?{x:getDefinition(kind).size.width/2-12,y:-24}:undefined;
  return {...device,name,params:{...device.params,...params},...(labelOffset?{labelOffset}:{})};
};
const pipe='#137fbb',live='#c05c4b',neutral='#4275aa',shaft='#9369ad';
const w=(id:string,from:string,fromPort:string,to:string,toPort:string,color:string,waypoints?:Point[]):Wire=>({id,from,fromPort,to,toPort,length:1,section:2.5,color,...(waypoints?{waypoints}:{})});
const rail=(devices:Device[],id:string,from:string,fromPort:string,to:string,toPort:string,y:number,color:string)=>{
  const a=terminalPosition(devices.find(device=>device.id===from)!,fromPort),b=terminalPosition(devices.find(device=>device.id===to)!,toPort);
  return w(id,from,fromPort,to,toPort,color,[{x:a.x,y},{x:b.x,y}]);
};

const transferDevices:Device[]=[
  d('water_tank','transfer-source-tank','TK1',40,200,{capacityL:100,initialLevel:80}),
  d('hydraulic_filter','transfer-filter','F1',300,280),
  d('hydraulic_pump','transfer-pump','P1',560,260,{flowRate:60,pressureBar:3}),
  d('flow_sensor','transfer-flow','FS1',730,280,{threshold:10}),
  d('water_tank','transfer-target-tank','TK2',940,200,{capacityL:40,initialLevel:10}),
  {...d('level_sensor','transfer-level','LS1',1100,220,{threshold:70,hysteresis:5}),tankId:'transfer-target-tank'},
  d('dc','transfer-supply','G1',40,470),
  {...d('dc_motor','transfer-motor','M1',420,460),fieldMode:'shunt'},
  {...d('field_winding','transfer-field','M1',260,470),windingRole:'shunt'},
  d('contact_no','transfer-level-contact','LS1',940,460),
  d('lamp','transfer-level-lamp','H1',950,620),
];
const transfer:Project={version:2,name:'Thủy lực · bơm chuyển nước giữa hai bồn',devices:transferDevices,wires:[
  w('transfer-suction','transfer-source-tank','OUT','transfer-filter','IN',pipe),
  w('transfer-filter-pump','transfer-filter','OUT','transfer-pump','IN',pipe),
  w('transfer-pump-flow','transfer-pump','OUT','transfer-flow','IN',pipe),
  w('transfer-fill','transfer-flow','OUT','transfer-target-tank','IN',pipe,[{x:900,y:320},{x:900,y:240}]),
  w('transfer-shaft','transfer-motor','shaft','transfer-pump','shaft',shaft,[{x:620,y:530}]),
  rail(transferDevices,'transfer-armature-feed','transfer-supply','+','transfer-motor','+',420,live),
  rail(transferDevices,'transfer-armature-return','transfer-motor','-','transfer-supply','-',700,neutral),
  rail(transferDevices,'transfer-field-feed','transfer-supply','+','transfer-field','F1',420,live),
  rail(transferDevices,'transfer-field-return','transfer-field','F2','transfer-supply','-',700,neutral),
  rail(transferDevices,'transfer-level-feed','transfer-supply','+','transfer-level-contact','13',420,live),
  w('transfer-lamp-feed','transfer-level-contact','14','transfer-level-lamp','1',live),
  rail(transferDevices,'transfer-lamp-return','transfer-level-lamp','2','transfer-supply','-',700,neutral),
]};

const primingDevices:Device[]=[
  d('dc','priming-pilot-supply','G1',0,140),
  {...d('field_winding','priming-pilot-field','M1',140,140),windingRole:'shunt'},
  {...d('dc_motor','priming-pilot-motor','M1',300,140),fieldMode:'shunt'},
  d('push_no','priming-start','S1',310,10),
  d('dc','priming-main-supply','G2',0,590),
  {...d('field_winding','priming-main-field','M2',140,590),windingRole:'shunt'},
  {...d('dc_motor','priming-main-motor','M2',300,590),fieldMode:'shunt'},
  {...d('contact_no','priming-pressure-contact','PS1',240,460),labelOffset:{x:-20,y:30}},
  d('water_tank','priming-sea','Biển',340,350,{infinite:1,initialLevel:100}),
  d('pipe_junction','priming-suction-junction','J1',474,464),
  d('hydraulic_pump','priming-pilot-pump','P1',500,150,{flowRate:20,pressureBar:2}),
  d('hydraulic_pump','priming-main-pump','P2',500,600,{flowRate:80,pressureBar:4}),
  d('hydraulic_valve','priming-pilot-check','CV1',680,170,{valveMode:1}),
  d('hydraulic_valve','priming-main-check','CV2',680,620,{valveMode:1}),
  d('pipe_junction','priming-header-top','J2',824,204),
  d('pipe_junction','priming-header-bottom','J3',824,654),
  d('pressure_sensor','priming-pressure','PS1',790,30,{threshold:.6,hysteresis:.1}),
  d('hydraulic_valve','priming-load','V1',900,620,{valveMode:2,resistance:.06}),
  d('water_tank','priming-discharge','Xả biển',1100,620,{infinite:1,initialLevel:100}),
];
const priming:Project={version:2,name:'Thủy lực · bơm mồi và liên động áp suất',devices:primingDevices,wires:[
  rail(primingDevices,'priming-pilot-start-feed','priming-pilot-supply','+','priming-start','1',-30,live),
  w('priming-pilot-armature-feed','priming-start','2','priming-pilot-motor','+',live),
  rail(primingDevices,'priming-pilot-field-feed','priming-pilot-supply','+','priming-pilot-field','F1',100,live),
  rail(primingDevices,'priming-pilot-field-return','priming-pilot-field','F2','priming-pilot-supply','-',320,neutral),
  rail(primingDevices,'priming-pilot-armature-return','priming-pilot-motor','-','priming-pilot-supply','-',320,neutral),
  rail(primingDevices,'priming-main-control-feed','priming-main-supply','+','priming-pressure-contact','13',420,live),
  w('priming-main-armature-feed','priming-pressure-contact','14','priming-main-motor','+',live),
  rail(primingDevices,'priming-main-field-feed','priming-main-supply','+','priming-main-field','F1',550,live),
  rail(primingDevices,'priming-main-field-return','priming-main-field','F2','priming-main-supply','-',770,neutral),
  rail(primingDevices,'priming-main-armature-return','priming-main-motor','-','priming-main-supply','-',770,neutral),
  w('priming-pilot-shaft','priming-pilot-motor','shaft','priming-pilot-pump','shaft',shaft,[{x:440,y:210},{x:440,y:300},{x:560,y:300}]),
  w('priming-main-shaft','priming-main-motor','shaft','priming-main-pump','shaft',shaft,[{x:440,y:660},{x:440,y:750},{x:560,y:750}]),
  w('priming-sea-outlet','priming-sea','OUT','priming-suction-junction','J',pipe),
  w('priming-pilot-suction','priming-suction-junction','J','priming-pilot-pump','IN',pipe,[{x:480,y:210}]),
  w('priming-main-suction','priming-suction-junction','J','priming-main-pump','IN',pipe,[{x:480,y:660}]),
  w('priming-pilot-outlet','priming-pilot-pump','OUT','priming-pilot-check','IN',pipe),
  w('priming-main-outlet','priming-main-pump','OUT','priming-main-check','IN',pipe),
  w('priming-pilot-header','priming-pilot-check','OUT','priming-header-top','J',pipe),
  w('priming-main-header','priming-main-check','OUT','priming-header-bottom','J',pipe),
  w('priming-header','priming-header-top','J','priming-header-bottom','J',pipe,[]),
  w('priming-pressure-tap','priming-header-top','J','priming-pressure','P',pipe),
  w('priming-outlet-load','priming-header-bottom','J','priming-load','IN',pipe),
  w('priming-discharge-pipe','priming-load','OUT','priming-discharge','IN',pipe),
]};

export const hydraulicExamples=[
  {id:'hydraulic-transfer',name:transfer.name,description:'M1 lai bơm P1 qua bộ lọc và cảm biến lưu lượng. TK1 giảm, TK2 tăng; đạt 70% thì LS1 đóng tiếp điểm bật H1. Khi bồn đầy hoặc nguồn cạn, dòng nước dừng.',project:transfer},
  {id:'hydraulic-priming',name:priming.name,description:'Giữ S1 chạy bơm mồi P1. Áp suất đạt 0,6 bar thì PS1 đóng, M2 lai bơm chính P2. Thả S1: P2 tiếp tục duy trì áp; các van một chiều ngăn nước chảy ngược qua bơm mồi.',project:priming},
];
