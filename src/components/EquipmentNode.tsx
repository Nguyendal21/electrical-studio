import { useEffect, useRef, useState } from 'react';
import { Handle, Position, useReactFlow, useUpdateNodeInternals, type NodeProps, type Node } from '@xyflow/react';
import { canActuate, getDefinition } from '../model/catalog';
import { getDeviceSize, getPortGeometry } from '../model/geometry';
import type { Device, DeviceState, Point } from '../model/types';
import { SchematicSymbol, SymbolHitArea } from './SchematicSymbol';

export type EquipmentNodeData = { device: Device; state?: DeviceState; running: boolean; timingMode?:number; legacyThermal?:boolean; onToggle: (id: string) => void; onPress:(id:string,pressed:boolean)=>void; onTerminalClick: (id: string, port: string) => void; onLabelMove:(id:string,point:Point)=>void };
export type EquipmentFlowNode = Node<EquipmentNodeData, 'equipment'>;
// Keep the persisted 12 px junction geometry, but give React Flow a 20 px
// frame. Its top-left grid snap then also aligns the visible centre, including
// when this junction is the first item in a dragged group.
export const JUNCTION_CANVAS_PADDING=4;
const positions={top:Position.Top,right:Position.Right,bottom:Position.Bottom,left:Position.Left};

export function EquipmentNode({ data, selected }: NodeProps<EquipmentFlowNode>) {
  const { device, state }=data;
  const definition=getDefinition(device.kind);
  const size=getDeviceSize(device);
  const update=useUpdateNodeInternals();
  const {screenToFlowPosition}=useReactFlow();
  const labelDrag=useRef<{start:Point;offset:Point;latest:Point}|null>(null);
  const [labelPreview,setLabelPreview]=useState<Point|null>(null);
  const pressed=useRef(false);
  const keyboardHeld=useRef(false);
  const momentary=['push_no','push_nc','limit_switch'].includes(device.kind);
  useEffect(()=>{update(device.id);},[device.id,device.rotation,data.legacyThermal,update]);
  useEffect(()=>{if(!data.running&&pressed.current){pressed.current=false;data.onPress(device.id,false);}},[data.running,data.onPress,device.id]);
  useEffect(()=>{const release=()=>{if(pressed.current){pressed.current=false;data.onPress(device.id,false);}};window.addEventListener('blur',release);return()=>window.removeEventListener('blur',release);},[data.onPress,device.id]);
  const live=!!state?.energized;
  const junction=device.kind==='junction';
  const padding=junction?JUNCTION_CANVAS_PADDING:0;
  const linkedContact=['contact_no','contact_nc','contact_co','timer_no','timer_nc'].includes(device.kind);
  const closed=linkedContact?(state?.contactClosed??device.kind.endsWith('_nc')):device.kind==='contactor'?!!state?.coilEnergized:device.enabled&&!state?.tripped;
  const label=labelPreview??device.labelOffset??((device.rotation??0)%180?{x:size.width/2-12,y:-28}:{x:size.width+14,y:25});
  const rotation=device.rotation??0;
  const transform=rotation===90?`translate(${definition.size.height} 0) rotate(90)`:rotation===180?`translate(${definition.size.width} ${definition.size.height}) rotate(180)`:rotation===270?`translate(0 ${definition.size.width}) rotate(270)`:undefined;
  return <div style={{width:size.width+2*padding,height:size.height+2*padding}} className={`equipment-node schematic-node ${data.running&&canActuate(device.kind)?'actuatable':''} ${junction?'junction-node':''} ${selected?'selected':''} ${live?'live':''} ${device.kind==='thermal'&&!device.enabled?'tripped':''}`} tabIndex={canActuate(device.kind)?0:undefined} aria-label={canActuate(device.kind)?`Thao tác ${device.name}`:undefined} onPointerDown={event=>{
    if(!data.running||!momentary||event.button!==0||(event.target as HTMLElement).closest('.react-flow__handle,.node-reference'))return;
    event.stopPropagation();event.preventDefault();keyboardHeld.current=false;pressed.current=true;data.onPress(device.id,true);event.currentTarget.setPointerCapture(event.pointerId);
  }} onPointerUp={event=>{if(pressed.current){event.stopPropagation();pressed.current=false;data.onPress(device.id,false);event.currentTarget.releasePointerCapture(event.pointerId);}}} onPointerCancel={()=>{if(pressed.current){pressed.current=false;data.onPress(device.id,false);}}} onLostPointerCapture={()=>{if(pressed.current&&!keyboardHeld.current){pressed.current=false;data.onPress(device.id,false);}}} onBlur={()=>{if(pressed.current&&keyboardHeld.current){keyboardHeld.current=false;pressed.current=false;data.onPress(device.id,false);}}} onKeyDown={event=>{
    if(!data.running||!canActuate(device.kind)||![' ','Enter'].includes(event.key)||event.target!==event.currentTarget)return;
    event.preventDefault();event.stopPropagation();if(event.repeat)return;if(momentary){keyboardHeld.current=true;pressed.current=true;data.onPress(device.id,true);}else data.onToggle(device.id);
  }} onKeyUp={event=>{if(momentary&&pressed.current&&[' ','Enter'].includes(event.key)){event.preventDefault();event.stopPropagation();keyboardHeld.current=false;pressed.current=false;data.onPress(device.id,false);}}}>
    {!junction&&<>
      {!device.hiddenLabel&&<span className="node-reference nodrag" style={{left:label.x,top:label.y}} title="Kéo để di chuyển tên; ẩn tên trong Thuộc tính" onDoubleClick={event=>event.stopPropagation()} onPointerDown={event=>{
        if(event.button!==0)return;event.stopPropagation();event.preventDefault();
        const start=screenToFlowPosition({x:event.clientX,y:event.clientY});labelDrag.current={start,offset:label,latest:label};event.currentTarget.setPointerCapture(event.pointerId);
      }} onPointerMove={event=>{
        if(!labelDrag.current)return;event.stopPropagation();const point=screenToFlowPosition({x:event.clientX,y:event.clientY}),drag=labelDrag.current;
        const next={x:Math.round((drag.offset.x+point.x-drag.start.x)/5)*5,y:Math.round((drag.offset.y+point.y-drag.start.y)/5)*5};drag.latest=next;setLabelPreview(next);
      }} onPointerUp={event=>{
        if(!labelDrag.current)return;event.stopPropagation();const drag=labelDrag.current;if(drag.latest.x!==drag.offset.x||drag.latest.y!==drag.offset.y)data.onLabelMove(device.id,drag.latest);
        labelDrag.current=null;setLabelPreview(null);event.currentTarget.releasePointerCapture(event.pointerId);
      }} onPointerCancel={()=>{labelDrag.current=null;setLabelPreview(null);}}>{device.name}</span>}
      <svg className="schematic-body" width={size.width} height={size.height} viewBox={`0 0 ${size.width} ${size.height}`} aria-label={definition.name}><g transform={transform}><SymbolHitArea kind={device.kind}/><SchematicSymbol kind={device.kind} closed={closed} active={live} actuated={device.kind==='thermal'?!device.enabled:['switch','emergency_stop','limit_switch'].includes(device.kind)?device.enabled:!!state?.coilEnergized} position={device.params.position??device.params.stage??0} legacyThermal={data.legacyThermal} moving={live&&data.running} rotationDirection={state?.rpm??0} timingMode={data.timingMode}/></g></svg>
    </>}
    {definition.ports.filter(port=>device.kind!=='thermal'||data.legacyThermal||!['95','96'].includes(port.id)).map(port=>{
      const p=getPortGeometry(device,port);
      return <div key={port.id}>
        <Handle type={port.type==='shaft'&&port.direction==='in'?'target':'source'} position={positions[p.side]} id={port.id} style={{left:p.x+padding,top:p.y+padding,right:'auto',bottom:'auto',transform:'translate(-50%, -50%)'}} className={`terminal-handle port-${port.type}`} title={`${device.name}: ${port.label}`} aria-label={`${device.name}: ${port.label}`} role="button" tabIndex={0} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();event.stopPropagation();data.onTerminalClick(device.id,port.id);}}}/>
        {!junction&&<span className={`terminal-label ${p.side}`} style={{left:p.x,top:p.y}}>{port.label}</span>}
      </div>;
    })}
  </div>;
}
