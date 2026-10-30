import { createDevice, getDefinition } from './catalog';
import { nearestPointOnWire, terminalPosition, wirePoints } from './geometry';
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

const duplicateConnection=(a:Wire,b:Wire)=>(a.from===b.from&&a.fromPort===b.fromPort&&a.to===b.to&&a.toPort===b.toPort)||(a.from===b.to&&a.fromPort===b.toPort&&a.to===b.from&&a.toPort===b.fromPort);

/** An explicitly placed dot joins the conductors through its centre. Mere wire
 * crossings never join. Returns an immutable, atomic edit (also used for old drafts).
 * Only a deliberate placement/drag may snap a dot to a nearby conductor. */
export function attachJunctions(project:Project,options:{junctionIds?:string[];snapDistance?:number;makeId?:(prefix:string)=>string}={}):Project{
  const {junctionIds=project.devices.filter(device=>device.kind==='junction').map(device=>device.id),snapDistance=0,makeId=(prefix:string)=>`${prefix}-${crypto.randomUUID().slice(0,8)}`}=options;
  let next=project;
  const usedIds=new Set([...project.devices,...project.wires].map(item=>item.id));
  const nextId=()=>{const id=makeId('w');if(!id||usedIds.has(id))throw new Error('Mã phần tử hoặc dây nối đã tồn tại.');usedIds.add(id);return id;};
  const powerWire=(wire:Wire)=>{const device=next.devices.find(item=>item.id===wire.from);return device&&getDefinition(device.kind).ports.find(port=>port.id===wire.fromPort)?.type==='power';};
  const addWire=(wire:Wire)=>{
    if(next.wires.some(existing=>duplicateConnection(existing,wire)))return;
    const error=validateConnection(next,wire);if(error)throw new Error(error);
    if(next.wires.length>=750)throw new Error('Tối đa 750 đoạn dây; chưa thể nối thêm nút vào dây.');
    next={...next,wires:[...next.wires,wire]};
  };
  for(const id of junctionIds){
    let junction=next.devices.find(device=>device.id===id&&device.kind==='junction');
    if(!junction)continue;
    let at=terminalPosition(junction,'J');
    if(snapDistance>0){
      const hit=next.wires.filter(wire=>wire.from!==id&&wire.to!==id&&powerWire(wire)).map(wire=>nearestPointOnWire(wirePoints(next,wire),at)).filter(hit=>hit.distance<=snapDistance).sort((a,b)=>a.distance-b.distance)[0];
      if(hit&&!samePoint(at,hit.point)){
        junction={...junction,x:hit.point.x-6,y:hit.point.y-6};at=hit.point;
        if(Math.abs(junction.x)>10000||Math.abs(junction.y)>10000)throw new Error('Nút nối nằm ngoài giới hạn bản vẽ.');
        next={...next,devices:next.devices.map(device=>device.id===id?junction!:device)};
      }
    }
    // Reuse one dot at an existing junction instead of overlapping two dots and
    // inventing a zero-length connecting wire. Keep the actively placed dot ID.
    const coincident=new Set(next.devices.filter(device=>device.kind==='junction'&&device.id!==id&&samePoint(terminalPosition(device,'J'),at)).map(device=>device.id));
    if(coincident.size){
      const wires:Wire[]=[];
      for(const wire of next.wires){
        const changed=coincident.has(wire.from)||coincident.has(wire.to)?{...wire,from:coincident.has(wire.from)?id:wire.from,to:coincident.has(wire.to)?id:wire.to}:wire;
        if(changed.from===changed.to&&changed.fromPort===changed.toPort||wires.some(existing=>duplicateConnection(existing,changed)))continue;
        wires.push(changed);
      }
      next={...next,devices:next.devices.filter(device=>!coincident.has(device.id)),wires};
    }
    for(const wire of [...next.wires]){
      if(wire.from===id||wire.to===id||!powerWire(wire))continue;
      const route=wirePoints(next,wire);if(!route.length)continue;
      const hit=nearestPointOnWire(route,at);
      const atStart=samePoint(route[0],at),atEnd=samePoint(route.at(-1)!,at);
      if(!atStart&&!atEnd&&hit.distance>epsilon)continue;
      if(atStart||atEnd){
        const endpoint=atStart?{device:wire.from,port:wire.fromPort}:{device:wire.to,port:wire.toPort};
        // At a real component pin a coincident link is needed electrically.
        if(!next.wires.some(item=>duplicateConnection(item,{from:id,fromPort:'J',to:endpoint.device,toPort:endpoint.port} as Wire)))addWire({...wire,id:nextId(),from:id,fromPort:'J',to:endpoint.device,toPort:endpoint.port,length:.001,waypoints:[]});
        continue;
      }
      const firstPoints=[...route.slice(0,hit.segment+1),hit.point],secondPoints=[hit.point,...route.slice(hit.segment+1)];
      const length=(points:Point[])=>points.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p.x-points[i].x,p.y-points[i].y),0);
      const fraction=length(firstPoints)/(length(firstPoints)+length(secondPoints)||1);
      const first:Wire={...wire,to:id,toPort:'J',length:Math.max(.001,wire.length*fraction),waypoints:savedRoute(firstPoints)};
      const second:Wire={...wire,id:nextId(),from:id,fromPort:'J',length:Math.max(.001,wire.length*(1-fraction)),waypoints:savedRoute(secondPoints)};
      next={...next,wires:next.wires.filter(item=>item.id!==wire.id)};
      addWire(first);addWire(second);
    }
  }
  return next;
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
