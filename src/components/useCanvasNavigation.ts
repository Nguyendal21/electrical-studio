import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { useReactFlow, type Viewport } from '@xyflow/react';

/** Capture right-button drags even over pins and draggable nodes (React Flow's
 * built-in nopan regions otherwise swallow those gestures). */
export function useCanvasNavigation(){
  const flow=useReactFlow();
  const drag=useRef<{pointerId:number;x:number;y:number;viewport:Viewport;element:HTMLElement}|null>(null);
  const [panning,setPanning]=useState(false);
  const finish=()=>{
    const current=drag.current;drag.current=null;setPanning(false);
    if(current?.element.hasPointerCapture(current.pointerId))current.element.releasePointerCapture(current.pointerId);
  };
  useEffect(()=>{window.addEventListener('blur',finish);return()=>{window.removeEventListener('blur',finish);};},[]);
  return {panning,handlers:{
    onPointerDownCapture:(event:PointerEvent<HTMLElement>)=>{
      if(event.button!==2)return;
      event.preventDefault();event.stopPropagation();
      drag.current={pointerId:event.pointerId,x:event.clientX,y:event.clientY,viewport:flow.getViewport(),element:event.currentTarget};
      event.currentTarget.setPointerCapture(event.pointerId);setPanning(true);
    },
    onPointerMoveCapture:(event:PointerEvent<HTMLElement>)=>{
      const current=drag.current;if(!current||event.pointerId!==current.pointerId)return;
      event.preventDefault();event.stopPropagation();
      void flow.setViewport({...current.viewport,x:current.viewport.x+event.clientX-current.x,y:current.viewport.y+event.clientY-current.y});
    },
    onPointerUpCapture:(event:PointerEvent<HTMLElement>)=>{
      if(!drag.current||event.pointerId!==drag.current.pointerId)return;
      event.preventDefault();event.stopPropagation();finish();
    },
    onPointerCancelCapture:finish,
    onLostPointerCapture:()=>{if(drag.current)finish();},
  }};
}
