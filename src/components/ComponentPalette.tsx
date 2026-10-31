import { useEffect, useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import type { DeviceDefinition, DeviceKind } from '../model/types';
import { DeviceSymbol } from './DeviceSymbol';

const representativeKinds:Record<string,DeviceKind>={'Điều khiển':'selector','Linh kiện thụ động':'resistor','Hiển thị & kết nối':'terminal_block'};

export function ComponentPalette({items,onAdd}:{items:DeviceDefinition[];onAdd:(kind:DeviceKind)=>void}){
  const categories=[...new Set(items.map(item=>item.category))];
  const [expanded,setExpanded]=useState<string|null>(null);
  const groupButtons=useRef<(HTMLButtonElement|null)[]>([]);
  const panel=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')setExpanded(null);};
    window.addEventListener('keydown',escape);return()=>window.removeEventListener('keydown',escape);
  },[]);
  const close=()=>{const index=categories.indexOf(expanded??'');setExpanded(null);groupButtons.current[index]?.focus();};
  return <div className="component-palette">
    <div className="symbol-toolbar group-toolbar" role="toolbar" aria-label="Nhóm phần tử điện">
      {categories.map((category,index)=>{
        const representative=items.find(item=>item.category===category&&item.kind===representativeKinds[category])??items.find(item=>item.category===category)!;
        return <button key={category} ref={element=>{groupButtons.current[index]=element;}} className={`palette-group-button ${expanded===category?'active':''}`} title={category} aria-label={`Nhóm ${category}`} aria-expanded={expanded===category} aria-controls="component-palette-panel" onClick={()=>setExpanded(current=>current===category?null:category)} onKeyDown={event=>{
          if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){
            event.preventDefault();const target=event.key==='Home'?0:event.key==='End'?categories.length-1:(index+(event.key==='ArrowRight'?1:-1)+categories.length)%categories.length;groupButtons.current[target]?.focus();
          }else if(event.key==='ArrowDown'){
            event.preventDefault();setExpanded(category);requestAnimationFrame(()=>panel.current?.querySelector<HTMLButtonElement>('.symbol-tool')?.focus());
          }
        }}><DeviceSymbol kind={representative.kind} size={30}/><ChevronDown size={10} className="group-chevron"/></button>;
      })}
    </div>
    {expanded&&<div ref={panel} id="component-palette-panel" className="palette-expanded" role="region" aria-label={`Linh kiện ${expanded}`}>
      <div className="palette-items" role="toolbar" aria-label={`Phần tử ${expanded}`}>
        {items.filter(item=>item.category===expanded).map(item=><button key={item.kind} className="symbol-tool" aria-label={`Thêm ${item.name}`} title={item.name} draggable onDragStart={event=>{event.dataTransfer.setData('application/electrical-device',item.kind);event.dataTransfer.effectAllowed='copy';}} onClick={()=>onAdd(item.kind)}><DeviceSymbol kind={item.kind} size={34}/></button>)}
      </div>
      <button className="tool-button palette-close" onClick={close} aria-label="Thu gọn nhóm linh kiện" title="Thu gọn nhóm linh kiện"><X size={15}/></button>
    </div>}
  </div>;
}
