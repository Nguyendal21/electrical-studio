import { getDefinition } from './catalog';
import type { Device, Point, PortDefinition, Project, Wire } from './types';

export function getDeviceSize(device: Device) {
  const size = getDefinition(device.kind).size;
  return (device.rotation ?? 0) % 180 ? {width:size.height,height:size.width} : size;
}

export function getPortGeometry(device: Device, port: PortDefinition): Point & {side:PortDefinition['side']} {
  const {width,height}=getDefinition(device.kind).size;
  if(device.kind==='junction')return {x:width/2,y:height/2,side:'right'};
  const fraction=port.offset/100;
  let x=port.side==='left'?0:port.side==='right'?width:width*fraction;
  let y=port.side==='top'?0:port.side==='bottom'?height:height*fraction;
  const rotation=device.rotation??0;
  if(rotation===90)[x,y]=[height-y,x];
  else if(rotation===180)[x,y]=[width-x,height-y];
  else if(rotation===270)[x,y]=[y,width-x];
  const sides:PortDefinition['side'][]=['top','right','bottom','left'];
  // Catalog offsets are percentages; remove floating point residue from thirds.
  return {x:Math.round(x*1e6)/1e6,y:Math.round(y*1e6)/1e6,side:sides[(sides.indexOf(port.side)+rotation/90)%4]};
}

export function terminalPosition(device:Device,portId:string):Point {
  const port=getDefinition(device.kind).ports.find(item=>item.id===portId);
  if(!port)return {x:device.x,y:device.y};
  const p=getPortGeometry(device,port);
  return {x:device.x+p.x,y:device.y+p.y};
}

const direction=(side:string)=>side==='none'?{x:0,y:0}:side==='top'?{x:0,y:-1}:side==='bottom'?{x:0,y:1}:side==='left'?{x:-1,y:0}:{x:1,y:0};
const samePoint=(a:Point,b:Point)=>a.x===b.x&&a.y===b.y;

/** Keep actual corners, not invisible collinear anchors. Saved routes retain
 * intentional reversals; a segment drag may collapse its own redundant folds. */
function simplifyRoute(points:Point[],collapseReversals=false):Point[]{
  const result:Point[]=[];
  for(const point of points){
    if(result.length&&samePoint(result[result.length-1],point))continue;
    while(result.length>1){
      const a=result[result.length-2],b=result[result.length-1];
      const collinear=(a.x===b.x&&b.x===point.x)||(a.y===b.y&&b.y===point.y);
      const forward=(b.x-a.x)*(point.x-b.x)+(b.y-a.y)*(point.y-b.y)>=0;
      if(!collinear||(!forward&&!collapseReversals))break;
      result.pop();
    }
    if(!result.length||!samePoint(result[result.length-1],point))result.push({...point});
  }
  return result;
}

export function orthogonalPoints(source:Point,target:Point,sourceSide:string,targetSide:string,waypoints?:Point[]):Point[] {
  const a=direction(sourceSide),b=direction(targetSide);
  if(waypoints!==undefined){
    // Edited/split wires store the complete interior route; do not inject leads
    // again, especially when a junction lies within the original terminal lead.
    const points=[source];
    for(const point of waypoints){
      const previous=points[points.length-1];
      if(previous.x!==point.x&&previous.y!==point.y)points.push(points.length===1&&a.y?{x:previous.x,y:point.y}:{x:point.x,y:previous.y});
      points.push(point);
    }
    const previous=points[points.length-1];
    if(previous.x!==target.x&&previous.y!==target.y)points.push(b.x?{x:previous.x,y:target.y}:{x:target.x,y:previous.y});
    points.push(target);return simplifyRoute(points);
  }
  if(samePoint(source,target))return [{...source}];
  // Prefer the shortest clean route, with a small cost per corner. Only add
  // clearance when the pin directions require a detour; there are no fixed
  // terminal stubs to protrude beyond a straight connection or an edited bend.
  const lines=(first:number,last:number)=>[...new Set([first,last,Math.round((first+last)/20)*10,Math.floor(Math.min(first,last)/10)*10-20,Math.ceil(Math.max(first,last)/10)*10+20])];
  const xs=lines(source.x,target.x),ys=lines(source.y,target.y);
  let best:Point[]|undefined,bestScore=Infinity;
  const consider=(candidate:Point[])=>{
    const route=simplifyRoute(candidate);
    if(route.length<2)return;
    const first=route[1],last=route[route.length-2];
    const leaves=(pin:Point,next:Point,side:Point)=>!(side.x||side.y)||(next.x-pin.x)*side.x+(next.y-pin.y)*side.y>0;
    if(!leaves(source,first,a)||!leaves(target,last,b))return;
    let length=0;
    for(let i=1;i<route.length;i++){
      const p=route[i-1],q=route[i];
      if(p.x!==q.x&&p.y!==q.y)return;
      if(i>1){const previous=route[i-2];if((p.x-previous.x)*(q.x-p.x)+(p.y-previous.y)*(q.y-p.y)<0)return;}
      length+=Math.abs(q.x-p.x)+Math.abs(q.y-p.y);
    }
    const score=length+(route.length-2)*10;
    if(score<bestScore){best=route;bestScore=score;}
  };
  consider([source,target]);
  for(const x of xs)consider([source,{x,y:source.y},{x,y:target.y},target]);
  for(const y of ys)consider([source,{x:source.x,y},{x:target.x,y},target]);
  for(const x of xs)for(const y of ys){
    consider([source,{x,y:source.y},{x,y},{x:target.x,y},target]);
    consider([source,{x:source.x,y},{x,y},{x,y:target.y},target]);
  }
  // Opposing outward-facing pins sometimes need two exterior corners.
  const clearance=(coordinate:number,sign:number)=>sign>0?Math.ceil(coordinate/10)*10+20:Math.floor(coordinate/10)*10-20;
  if(a.x&&b.x){
    const fromX=clearance(source.x,a.x),toX=clearance(target.x,b.x);
    for(const y of ys)consider([source,{x:fromX,y:source.y},{x:fromX,y},{x:toX,y},{x:toX,y:target.y},target]);
  }
  if(a.y&&b.y){
    const fromY=clearance(source.y,a.y),toY=clearance(target.y,b.y);
    for(const x of xs)consider([source,{x:source.x,y:fromY},{x,y:fromY},{x,y:toY},{x:target.x,y:toY},target]);
  }
  return best??[source,{x:source.x,y:target.y},target];
}

export const pointsToPath=(points:Point[])=>points.map((point,index)=>`${index?'L':'M'} ${point.x} ${point.y}`).join(' ');

/** Move one straight segment perpendicular to itself, retaining fixed terminals.
 * Endpoint elbows begin at the terminal itself, without invented short leads. */
export function moveWireSegment(points:Point[],index:number,position:Point):Point[]{
  const a=points[index],b=points[index+1];
  if(!a||!b||!Number.isFinite(position.x)||!Number.isFinite(position.y))return points.map(point=>({...point}));
  const vertical=a.x===b.x,horizontal=a.y===b.y,length=Math.hypot(b.x-a.x,b.y-a.y);
  if((!vertical&&!horizontal)||!length)return points.map(point=>({...point}));
  const shifted=(point:Point):Point=>vertical?{x:position.x,y:point.y}:{x:point.x,y:position.y};
  const result=points.slice(0,index).map(point=>({...point}));
  if(index===0){
    result.push({...a},shifted(a));
  }else{
    const previous=result[result.length-1],start=shifted(a);
    if(previous.x!==start.x&&previous.y!==start.y)result.push({...a});
    result.push(start);
  }
  if(index===points.length-2){
    result.push(shifted(b),{...b});
  }else{
    const end=shifted(b),next=points[index+2];
    result.push(end);
    if(end.x!==next.x&&end.y!==next.y)result.push({...b});
    result.push(...points.slice(index+2).map(point=>({...point})));
  }
  return simplifyRoute(result,true);
}

export function wirePoints(project:Project,wire:Wire):Point[]{
  const from=project.devices.find(device=>device.id===wire.from),to=project.devices.find(device=>device.id===wire.to);
  if(!from||!to)return [];
  const a=getDefinition(from.kind).ports.find(port=>port.id===wire.fromPort),b=getDefinition(to.kind).ports.find(port=>port.id===wire.toPort);
  if(!a||!b)return [];
  return orthogonalPoints(terminalPosition(from,a.id),terminalPosition(to,b.id),from.kind==='junction'?'none':getPortGeometry(from,a).side,to.kind==='junction'?'none':getPortGeometry(to,b).side,wire.waypoints);
}

export function nearestPointOnWire(points:Point[],point:Point){
  let nearest=point,distance=Infinity,segment=0;
  for(let i=0;i<points.length-1;i++){
    const a=points[i],b=points[i+1];
    const t=Math.max(0,Math.min(1,((point.x-a.x)*(b.x-a.x)+(point.y-a.y)*(b.y-a.y))/((b.x-a.x)**2+(b.y-a.y)**2||1)));
    const candidate={x:a.x+t*(b.x-a.x),y:a.y+t*(b.y-a.y)},d=Math.hypot(candidate.x-point.x,candidate.y-point.y);
    if(d<distance){distance=d;nearest=candidate;segment=i;}
  }
  return {point:nearest,distance,segment};
}
