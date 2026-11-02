import { createDevice } from './catalog';
import type { Device, DeviceKind, Point, Project, Wire } from './types';

const d=(kind:DeviceKind,id:string,name:string,x:number,y:number,params:Record<string,number>={},rotation:Device['rotation']=0):Device=>{
  const device=createDevice(kind,id,x,y);
  return {...device,name,rotation,params:{...device.params,...params}};
};
const w=(id:string,from:string,fromPort:string,to:string,toPort:string,waypoints?:Point[]):Wire=>({id,from,fromPort,to,toPort,length:1,section:2.5,...(waypoints?{waypoints}:{})});
const electrical:Project={version:2,name:'Đo điện · U, I và công suất',devices:[
  d('dc','meter-source','G1',40,200,{voltage:24}),
  d('current_sensor','meter-current','PA1',300,60,{},270),
  d('power_sensor','meter-power','PW1',600,140),
  d('resistor','meter-resistor','R1',400,280,{resistance:12}),
  d('voltage_sensor','meter-voltage','PV1',760,270),
],wires:[
  w('source-current','meter-source','+','meter-current','1',[{x:90,y:100}]),
  w('current-power','meter-current','2','meter-power','I1',[{x:520,y:100},{x:520,y:160}]),
  w('power-load','meter-power','I2','meter-resistor','1',[{x:520,y:220},{x:520,y:260},{x:440,y:260}]),
  w('load-return','meter-resistor','2','meter-source','-',[{x:440,y:420},{x:90,y:420}]),
  w('power-u1','meter-resistor','1','meter-power','U1',[{x:440,y:260},{x:740,y:260},{x:740,y:160}]),
  w('power-u2','meter-resistor','2','meter-power','U2',[{x:440,y:420},{x:720,y:420},{x:720,y:220}]),
  w('voltage-positive','meter-resistor','1','meter-voltage','V+',[{x:440,y:260},{x:800,y:260}]),
  w('voltage-negative','meter-resistor','2','meter-voltage','V-',[{x:440,y:420},{x:800,y:420}]),
]};

const process:Project={version:2,name:'Cảm biến mức · điều khiển tiếp điểm',devices:[
  d('dc','level-source','G1',40,220),
  d('process_sensor','level-sensor','BL1',300,220,{sensorFunction:2,inputValue:30,threshold:70,hysteresis:5}),
  d('contact_no','level-contact','BL1',550,120),
  d('lamp','level-lamp','H1',560,330),
],wires:[
  w('sensor-positive','level-source','+','level-sensor','A1',[{x:90,y:80},{x:340,y:80}]),
  w('sensor-negative','level-sensor','A2','level-source','-',[{x:340,y:470},{x:90,y:470}]),
  w('contact-positive','level-source','+','level-contact','13',[{x:90,y:80},{x:590,y:80}]),
  w('contact-lamp','level-contact','14','level-lamp','1'),
  w('lamp-return','level-lamp','2','level-source','-',[{x:590,y:470},{x:90,y:470}]),
]};

export const sensorExamples=[
  {id:'sensor-electrical',name:electrical.name,description:'Nguồn 24 V và điện trở 12 Ω: đo 24 V, 2 A, 48 W. Chọn PW1 để đổi sang công suất biểu kiến, hệ số công suất hoặc điện năng.',project:electrical},
  {id:'sensor-process',name:process.name,description:'Chọn BL1 và thay giá trị mức: đạt 70% thì NO cùng tên đóng, H1 sáng; xuống dưới 65% thì nhả. Đây là giá trị nhập để thử mạch.',project:process},
];
