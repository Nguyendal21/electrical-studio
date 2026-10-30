import { useRef, useState } from 'react';
import { BaseEdge, useReactFlow, type Edge, type EdgeProps } from '@xyflow/react';
import type { Point, Wire } from '../model/types';
import { moveWireSegment, orthogonalPoints, pointsToPath } from '../model/geometry';

export type SchematicWireData={wire:Wire;points:Point[];active:boolean;running:boolean;direction?:1|-1;shaft:boolean;sourceJunction?:boolean;targetJunction?:boolean;onRouteChange:(id:string,points:Point[])=>void;onJunction:(id:string,point:Point)=>void};
export type SchematicWire=Edge<SchematicWireData,'wire'>;

export function SchematicEdge({id,sourceX,sourceY,targetX,targetY,sourcePosition,targetPosition,selected,data}:EdgeProps<SchematicWire>){
  const {screenToFlowPosition}=useReactFlow();
  const [preview,setPreview]=useState<Point[]|null>(null);
  const drag=useRef<{index:number;points:Point[];latest?:Point[];position?:Point}|null>(null);
  if(!data)return null;
  const sourceSide=data.sourceJunction?'none':sourcePosition,targetSide=data.targetJunction?'none':targetPosition;
  // Use terminal centers, not React Flow's outer handle edges (a 4px offset).
  const route=data.points.length?data.points:orthogonalPoints({x:sourceX,y:sourceY},{x:targetX,y:targetY},sourceSide,targetSide,data.wire.waypoints);
  const points=preview??route;
  // Keep the captured handle mounted even when a preview adds/removes elbows.
  const handles=drag.current?.points??route;
  const path=pointsToPath(points);
  const color=selected?'#2879c8':data.shaft?'#8b6aa9':data.active?'#15964b':data.wire.color||'#455566';
  return <g className={`schematic-wire ${data.active?'conducting':''}`}>
    <BaseEdge id={id} path={path} interactionWidth={18} style={{stroke:color,strokeWidth:selected?2.5:1.8,strokeDasharray:data.shaft?'7 5':undefined}}/>
    {data.active&&!data.shaft&&<path d={path} className="current-flow" style={{animationDirection:data.direction===-1?'reverse':'normal',animationPlayState:data.running?'running':'paused'}} fill="none" stroke="#83e9a2" strokeWidth="2.5" strokeDasharray="2 13" pointerEvents="none"/>}
    <path d={path} fill="none" stroke="transparent" strokeWidth={16} className="wire-hit" onDoubleClick={event=>{event.stopPropagation();data.onJunction(id,screenToFlowPosition({x:event.clientX,y:event.clientY},{snapToGrid:false}));}}/>
    {selected&&handles.slice(0,-1).map((point,index)=>{
      const next=handles[index+1];
      if(Math.hypot(next.x-point.x,next.y-point.y)<12)return null;
      const vertical=point.x===next.x;
      const center={x:(point.x+next.x)/2,y:(point.y+next.y)/2};
      if(drag.current?.index===index&&drag.current.position){if(vertical)center.x=drag.current.position.x;else center.y=drag.current.position.y;}
      return <rect key={index} className="wire-bend-handle nodrag" x={center.x-5} y={center.y-5} width={10} height={10} rx={2} fill="white" stroke="#2879c8" strokeWidth={1.5} style={{cursor:vertical?'ew-resize':'ns-resize',pointerEvents:'all'}} role="button" aria-label="Kéo chỉnh đoạn dây" onPointerDown={event=>{if(event.button!==0)return;event.stopPropagation();event.preventDefault();drag.current={index,points:route.map(p=>({...p}))};event.currentTarget.setPointerCapture(event.pointerId);}} onPointerMove={event=>{
        if(!drag.current)return;event.stopPropagation();const position=screenToFlowPosition({x:event.clientX,y:event.clientY});
        drag.current.position={x:Math.round(position.x/10)*10,y:Math.round(position.y/10)*10};
        drag.current.latest=moveWireSegment(drag.current.points,drag.current.index,drag.current.position);setPreview(drag.current.latest);
      }} onPointerUp={event=>{if(!drag.current)return;event.stopPropagation();if(drag.current.latest)data.onRouteChange(id,drag.current.latest.slice(1,-1));drag.current=null;setPreview(null);event.currentTarget.releasePointerCapture(event.pointerId);}} onPointerCancel={()=>{drag.current=null;setPreview(null);}}/>;
    })}
  </g>;
}
