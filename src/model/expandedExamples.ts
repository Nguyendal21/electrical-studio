import { createDevice } from './catalog';
import type { Device, DeviceKind, Point, Project, Wire } from './types';
const d=(kind:DeviceKind,id:string,name:string,x:number,y:number,rotation:Device['rotation']=0):Device=>({...createDevice(kind,id,x,y),name,rotation});
const w=(id:string,from:string,fromPort:string,to:string,toPort:string,waypoints?:Point[],color='#455566'):Wire=>({id,from,fromPort,to,toPort,length:1,section:2.5,...(waypoints?{waypoints}:{}),color});
const example=(id:string,name:string,description:string,devices:Device[],wires:Wire[])=>({id,name,description,project:{version:2 as const,name,devices,wires} satisfies Project});
const live='#c05c4b',neutral='#4275aa';

const converted=example('converted-dc','Biến áp → chỉnh lưu → động cơ DC','Nguồn AC qua biến áp cách ly và cầu chỉnh lưu cấp phần ứng, cuộn kích từ song song M1. Ngắt một dây đầu vào để mất nguồn đầu ra.',[
  d('ac1','ac-supply','G1',30,180),d('transformer1','transformer','T1',300,180),d('rectifier1','rectifier','VC1',560,180),{...d('dc_motor','converted-motor','M1',860,160),fieldMode:'shunt'},d('field_winding','converted-field','M1',1080,160),
],[
  w('ac-l','ac-supply','L','transformer','P1',[{x:70,y:340},{x:240,y:340},{x:240,y:210}],live),w('ac-n','ac-supply','N','transformer','P2',[{x:110,y:370},{x:270,y:370},{x:270,y:270}],neutral),
  w('secondary-1','transformer','S1','rectifier','~1'),w('secondary-2','transformer','S2','rectifier','~2'),
  w('armature-feed','rectifier','+','converted-motor','+',[{x:740,y:210},{x:740,y:100},{x:910,y:100}],live),w('armature-return','converted-motor','-','rectifier','-',[{x:910,y:370},{x:740,y:370},{x:740,y:270}],neutral),
  w('shunt-feed','converted-motor','+','converted-field','F1',[{x:910,y:100},{x:1130,y:100}],live),w('shunt-return','converted-field','F2','converted-motor','-',[{x:1130,y:420},{x:910,y:420}],neutral),
]);

const selectorDevices=[d('dc','selector-source','G1',60,140),{...d('selector3','selector','SA1',500,80),params:{position:1}},d('emergency_stop','emergency','SE1',300,20),d('contact_nc','emergency-contact','SE1',300,140),{...d('contact_no','selector-left','SA1',500,370),params:{actuationPosition:-1}},d('contact_no','selector-right','SA1',720,370),d('lamp','left-lamp','H1',510,550),d('lamp','right-lamp','H2',730,550)];
const selector=example('selector-control','Công tắc −1 / 0 / 1 và dừng khẩn','Nhấn SA1 để đổi vị trí; các tiếp điểm rời SA1 chọn đèn H1 hoặc H2. Nhấn SE1 để giữ dừng khẩn, nhấn lại để nhả.',selectorDevices,[
  w('selector-feed','selector-source','+','emergency-contact','21',[{x:110,y:80},{x:340,y:80}],live),
  w('left-feed','emergency-contact','22','selector-left','13',[{x:340,y:300},{x:540,y:300}],live),w('right-feed','selector-left','13','selector-right','13',[{x:540,y:300},{x:760,y:300}],live),
  w('left-output','selector-left','14','left-lamp','1'),w('right-output','selector-right','14','right-lamp','1'),
  w('left-return','left-lamp','2','selector-source','-',[{x:540,y:680},{x:110,y:680}],neutral),w('right-return','right-lamp','2','left-lamp','2',[{x:760,y:680},{x:540,y:680}],neutral),
]);

const singlePhase=example('single-phase-motor','Động cơ một pha · tụ cuộn phụ','CB cấp cuộn chính U1–U2; tụ C1 nối tiếp cuộn phụ Z1–Z2. Bỏ tụ hoặc ngắt đường về thì động cơ không khởi động.',[
  d('ac1','single-source','G1',50,20),{...d('breaker1','single-breaker','QF1',250,230,270),enabled:true},d('capacitor','run-capacitor','C1',480,180,270),d('induction1','single-motor','M1',700,270),
],[
  w('single-live','single-source','L','single-breaker','1',[{x:90,y:270}],live),w('main-feed','single-breaker','2','single-motor','U1',[{x:420,y:270},{x:420,y:160},{x:740,y:160}],live),
  w('capacitor-feed','single-breaker','2','run-capacitor','1',[{x:400,y:270},{x:400,y:220}],live),w('auxiliary-feed','run-capacitor','2','single-motor','Z1',[{x:780,y:220}],live),
  w('main-return','single-motor','U2','single-source','N',[{x:740,y:520},{x:130,y:520}],neutral),w('auxiliary-return','single-motor','Z2','single-motor','U2',[{x:780,y:460},{x:740,y:460}],neutral),
]);

const remote=example('remote-actuators','Cầu đấu · nhãn mạng · van và còi','CTRL+ nối hai phần sơ đồ bằng tên mạng. Hai ký hiệu N mang tên RETURN nối đường về; đổi tên một nhãn để ngắt nhánh.',[
  d('dc','remote-source','G1',50,120),d('terminal_block','terminal','X1',220,60),d('net_label','net-feed','CTRL+',380,40),d('offpage','net-load','CTRL+',650,40),d('solenoid','remote-valve','YV1',800,160),d('buzzer','remote-buzzer','HA1',1000,160),d('neutral','return-source','RETURN',220,360),d('neutral','return-load','RETURN',800,360),
],[
  w('terminal-feed','remote-source','+','terminal','1',[{x:100,y:20},{x:250,y:20}],live),w('net-terminal','terminal','2','net-feed','P',[{x:250,y:140},{x:340,y:140},{x:340,y:60}],live),
  w('valve-feed','net-load','P','remote-valve','A1',[{x:610,y:60},{x:610,y:120},{x:840,y:120}],live),w('buzzer-feed','remote-valve','A1','remote-buzzer','1',[{x:840,y:120},{x:1030,y:120}],live),
  w('source-return','remote-source','-','return-source','N',[{x:100,y:320},{x:250,y:320}],neutral),w('valve-return','remote-valve','A2','return-load','N',[{x:840,y:310},{x:830,y:310}],neutral),w('buzzer-return','remote-buzzer','2','return-load','N',[{x:1030,y:310},{x:830,y:310}],neutral),
]);

export const expandedExamples=[converted,selector,singlePhase,remote];
