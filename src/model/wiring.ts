import { createDevice, getDefinition } from './catalog';
import { nearestPointOnWire, wirePoints } from './geometry';
import { validateConnection } from './simulation';
import type { Point, Project, Wire } from './types';

export type Terminal={deviceId:string;portId:string};
const epsilon=1e-7;
const samePoint=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y)<epsilon;

/** Remove redundant points without removing a turn or a reversed segment. */
function simplify(points:Point[]):Point[]{
  const result:Point[]=[];
  for(const point of points){
    if(result.length&&samePoint(result[result.length-1],point))continue;
    while(result.length>1){
      const a=result[result.length-2],b=result[result.length-1];
      const vertical=Math.abs(a.x-b.x)<epsilon&&Math.abs(b.x-point.x)<epsilon;
      const horizontal=Math.abs(a.y-b.y)<epsilon&&Math.abs(b.y-point.y)<epsilon;
      const forward=(b.x-a.x)*(point.x-b.x)+(b.y-a.y)*(point.y-b.y)>=0;
      if(!(vertical||horizontal)||!forward)break;
      result.pop();
    }
    result.push({...point});
  }
  return result;
}

function savedRoute(points:Point[]):Point[]{
  const waypoints=simplify(points).slice(1,-1);
  if(waypoints.length>64)throw new Error('Đường dây quá phức tạp: tối đa 64 điểm bẻ góc trên mỗi đoạn dây.');
  if(waypoints.some(point=>!Number.isFinite(point.x)||!Number.isFinite(point.y)||Math.abs(point.x)>10000||Math.abs(point.y)>10000))throw new Error('Điểm bẻ góc nằm ngoài giới hạn bản vẽ.');
  return waypoints;
}

/** Split and attach as one transaction, preserving the existing polyline. */
export function branchOnWire(project:Project,wireId:string,point:Point,terminal?:Terminal,makeId=(prefix:string)=>`${prefix}-${crypto.randomUUID().slice(0,8)}`):{project:Project;junctionId?:string}{
  if(!Number.isFinite(point.x)||!Number.isFinite(point.y))throw new Error('Vị trí nối dây không hợp lệ.');
  const wire=project.wires.find(item=>item.id===wireId);
  if(!wire)throw new Error('Không tìm thấy dây nối.');
  const source=project.devices.find(device=>device.id===wire.from);
  const port=source&&getDefinition(source.kind).ports.find(item=>item.id===wire.fromPort);
  if(port?.type!=='power')throw new Error('Chỉ rẽ nhánh trên dây điện.');
  if(terminal){
    const device=project.devices.find(item=>item.id===terminal.deviceId),pin=device&&getDefinition(device.kind).ports.find(item=>item.id===terminal.portId);
    if(!pin)throw new Error('Đầu cực không tồn tại trên bản vẽ.');
    if(pin.type!=='power')throw new Error('Trục cơ khí không thể nối vào dây điện.');
  }
  const route=wirePoints(project,wire);
  if(route.length<2)throw new Error('Không thể rẽ nhánh trên đường dây không có chiều dài.');
  const nearest=nearestPointOnWire(route,point),at=nearest.point;
  const close=(p:Point)=>Math.hypot(at.x-p.x,at.y-p.y)<1;
  const usedIds=new Set([...project.devices,...project.wires].map(item=>item.id));
  const nextId=(prefix:string)=>{
    const id=makeId(prefix);
    if(!id||usedIds.has(id))throw new Error('Mã phần tử hoặc dây nối đã tồn tại.');
    usedIds.add(id);return id;
  };
  const connectedWire=(target:Terminal):Wire=>({id:nextId('w'),from:terminal!.deviceId,fromPort:terminal!.portId,to:target.deviceId,toPort:target.portId,length:1,section:wire.section,color:wire.color});
  let endpoint:Terminal|undefined;
  if(close(route[0]))endpoint={deviceId:wire.from,portId:wire.fromPort};
  else if(close(route[route.length-1]))endpoint={deviceId:wire.to,portId:wire.toPort};
  if(endpoint){
    const junctionId=project.devices.find(device=>device.id===endpoint.deviceId)?.kind==='junction'?endpoint.deviceId:undefined;
    if(!terminal)return {project,junctionId};
    if(project.wires.length>=750)throw new Error('Tối đa 750 đoạn dây.');
    const added=connectedWire(endpoint),error=validateConnection(project,added);if(error)throw new Error(error);
    return {project:{...project,wires:[...project.wires,added]},junctionId};
  }
  if(project.devices.length>=250||project.wires.length+(terminal?2:1)>750)throw new Error('Sơ đồ đã đạt giới hạn phần tử hoặc dây.');
  if(Math.abs(at.x-6)>10000||Math.abs(at.y-6)>10000)throw new Error('Nút nối nằm ngoài giới hạn bản vẽ.');
  const firstPoints=[...route.slice(0,nearest.segment+1),at],secondPoints=[at,...route.slice(nearest.segment+1)];
  const firstRoute=savedRoute(firstPoints),secondRoute=savedRoute(secondPoints);
  const length=(points:Point[])=>points.slice(1).reduce((total,p,i)=>total+Math.hypot(p.x-points[i].x,p.y-points[i].y),0);
  const fraction=length(firstPoints)/(length(firstPoints)+length(secondPoints)||1);
  const junction=createDevice('junction',nextId('j'),at.x-6,at.y-6);
  const first:Wire={...wire,id:nextId('w'),to:junction.id,toPort:'J',length:Math.max(.001,wire.length*fraction),waypoints:firstRoute};
  const second:Wire={...wire,id:nextId('w'),from:junction.id,fromPort:'J',length:Math.max(.001,wire.length*(1-fraction)),waypoints:secondRoute};
  const next:Project={...project,devices:[...project.devices,junction],wires:project.wires.filter(item=>item.id!==wireId)};
  // Validate against each previous addition; no project arrays are mutated.
  for(const added of [first,second,...(terminal?[connectedWire({deviceId:junction.id,portId:'J'})]:[])]){
    const error=validateConnection(next,added);if(error)throw new Error(error);
    next.wires.push(added);
  }
  return {project:next,junctionId:junction.id};
}
