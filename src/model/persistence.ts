import { getDefinition, normalizeSelectorConfiguration, selectorPositions } from './catalog';
import { validateConnection } from './simulation';
import type { Device, DeviceKind, Point, Project, Wire } from './types';

export const STORAGE_KEY='electrical-studio.project.v2';
function invalid(message:string):never{throw new Error(`Dự án không hợp lệ: ${message}`);}
function record(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))invalid('Cần một đối tượng JSON.');return value as Record<string,unknown>;}
function text(value:unknown,label:string):string{if(typeof value!=='string'||!value.trim()||value.length>120)invalid(`${label} cần từ 1 đến 120 ký tự.`);return value;}
function id(value:unknown):string{const result=text(value,'Mã phần tử');if(['__proto__','constructor','prototype'].includes(result)||result.includes('\u0000'))invalid('Mã phần tử chứa tên hoặc ký tự dành riêng.');return result;}
function number(value:unknown,label:string,min:number,max:number):number{if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)invalid(`${label} phải là số trong khoảng ${min}–${max}.`);return value;}
function point(value:unknown):Point{const p=record(value);return {x:number(p.x,'Tọa độ X',-10000,10000),y:number(p.y,'Tọa độ Y',-10000,10000)};}

function readProject(value:unknown):Project{
  const raw=record(value);
  if(raw.version===1)invalid('Tệp phiên bản 1 dùng sơ đồ một sợi. Hãy tạo sơ đồ đầu cực phiên bản 2; dữ liệu cũ vẫn được giữ riêng trong trình duyệt.');
  if(raw.version!==2)invalid('Chỉ hỗ trợ định dạng đầu cực phiên bản 2.');
  if(!Array.isArray(raw.devices)||raw.devices.length>250)invalid('Tối đa 250 phần tử.');
  if(!Array.isArray(raw.wires)||raw.wires.length>750)invalid('Tối đa 750 đoạn dây.');
  const used=new Set<string>();
  const unique=(value:unknown)=>{const result=id(value);if(used.has(result))invalid(`Trùng mã ${result}.`);used.add(result);return result;};
  const devices:Device[]=raw.devices.map(value=>{
    const item=record(value),deviceId=unique(item.id);
    const kind=text(item.kind,'Loại phần tử') as DeviceKind;
    let definition;try{definition=getDefinition(kind);}catch{invalid(`Không hỗ trợ loại phần tử ${kind}.`);}
    const paramsRaw=item.params===undefined?{}:record(item.params);
    for(const key of Object.keys(paramsRaw))if(!definition.parameters.some(parameter=>parameter.key===key))invalid(`Thông số ${key} không được hỗ trợ.`);
    const params=Object.fromEntries(definition.parameters.map(parameter=>[parameter.key,Object.hasOwn(paramsRaw,parameter.key)?number(paramsRaw[parameter.key],parameter.label,parameter.min,parameter.max):parameter.default]));
    if(kind==='timer_coil'&&![0,1].includes(params.timerMode))invalid('Chế độ rơle thời gian phải là trễ đóng (0) hoặc trễ nhả (1).');
    if(kind==='protection_relay'&&!Number.isInteger(params.protectionFunction))invalid('Chức năng bảo vệ phải là một lựa chọn nguyên từ 0 đến 9.');
    if(kind==='selector'&&!Number.isInteger(params.positions))invalid('Số mức công tắc phải là số nguyên từ 2 đến 13.');
    if(kind.startsWith('selector')&&!selectorPositions(kind,params).includes(params.position))invalid('Vị trí công tắc phải là một nấc nguyên hợp lệ của núm xoay.');
    if(['contact_no','contact_nc','contact_co'].includes(kind)&&!Number.isInteger(params.actuationPosition))invalid('Vị trí tác động của tiếp điểm phải là một nấc nguyên.');
    if(kind==='resistor_bank'&&!Number.isInteger(params.stage))invalid('Cấp điện trở phải là số nguyên.');
    if(typeof item.enabled!=='boolean')invalid('Trạng thái enabled phải là boolean.');
    const rotation=item.rotation??0;if(![0,90,180,270].includes(rotation as number))invalid('Góc xoay phải là 0, 90, 180 hoặc 270.');
    const device:Device={id:deviceId,kind,name:text(item.name,'Tên phần tử'),...point(item),rotation:rotation as Device['rotation'],enabled:item.enabled,params};
    // Optional presentation and excitation properties keep existing v2 drafts readable.
    // Do not invent missing field windings or change how an older drawing is connected.
    if(item.hiddenLabel!==undefined){if(typeof item.hiddenLabel!=='boolean')invalid('Trạng thái ẩn tên phải là boolean.');device.hiddenLabel=item.hiddenLabel;}
    if(item.labelOffset!==undefined)device.labelOffset=point(item.labelOffset);
    if(item.fieldMode!==undefined){if(!['independent','shunt','series','compound'].includes(item.fieldMode as string))invalid('Kiểu kích từ không được hỗ trợ.');device.fieldMode=item.fieldMode as Device['fieldMode'];}
    if(item.windingRole!==undefined){if(!['shunt','series'].includes(item.windingRole as string))invalid('Vai trò cuộn kích từ không được hỗ trợ.');device.windingRole=item.windingRole as Device['windingRole'];}
    return device;
  });
  const project:Project={version:2,name:text(raw.name,'Tên dự án'),devices,wires:[]};
  for(const value of raw.wires){
    const item=record(value);
    const wire:Wire={id:unique(item.id),from:id(item.from),to:id(item.to),fromPort:text(item.fromPort,'Đầu cực'),toPort:text(item.toPort,'Đầu cực'),length:number(item.length,'Chiều dài dây',.001,10000),section:number(item.section,'Tiết diện dây',.1,1000)};
    if(item.color!==undefined){if(typeof item.color!=='string'||!/^#[0-9a-f]{6}$/i.test(item.color))invalid('Màu dây phải có định dạng #RRGGBB.');wire.color=item.color;}
    if(item.waypoints!==undefined){if(!Array.isArray(item.waypoints)||item.waypoints.length>64)invalid('Tối đa 64 điểm bẻ góc trên mỗi dây.');wire.waypoints=item.waypoints.map(point);}
    const error=validateConnection(project,wire);if(error)invalid(error);
    project.wires.push(wire);
  }
  return normalizeSelectorConfiguration(project);
}
export function serializeProject(project:Project):string{return JSON.stringify(readProject(project),null,2);}
export function parseProject(source:string):Project{let raw:unknown;try{raw=JSON.parse(source);}catch{invalid('Không đọc được nội dung JSON.');}return readProject(raw);}
