import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Background, BackgroundVariant, ConnectionMode, Panel, ReactFlow, SelectionMode, useNodesInitialized, useReactFlow, useStoreApi, type Connection, type EdgeChange, type NodeChange, type OnConnectEnd } from '@xyflow/react';
import { Cable, Check, CircleHelp, ClipboardPaste, Copy, CopyPlus, Download, FilePlus2, FolderOpen, Grid2X2, Hash, Maximize, MousePointer2, PanelLeft, Pause, Play, Redo2, RotateCcw, RotateCw, Search, Settings2, ShieldCheck, Square, List, Trash2, Undo2, X, Zap, ZoomIn, ZoomOut } from 'lucide-react';
import { canActuate, catalog, createDevice, getDefinition } from './model/catalog';
import { examples } from './model/examples';
import { createInitialState, stepSimulation, validateConnection, validateProject } from './model/simulation';
import { parseProject, serializeProject, STORAGE_KEY } from './model/persistence';
import { getDeviceSize, nearestPointOnWire, wirePoints } from './model/geometry';
import { attachJunctions, branchOnWire, type Terminal } from './model/wiring';
import { copySelection, pasteSelection, type ClipboardFragment } from './model/clipboard';
import type { Device, DeviceKind, Point, Project, Wire } from './model/types';
import { EquipmentNode, JUNCTION_CANVAS_PADDING, type EquipmentFlowNode } from './components/EquipmentNode';
import { SchematicEdge, type SchematicWire } from './components/SchematicEdge';
import { DeviceSymbol } from './components/DeviceSymbol';
import { CircuitMonitor } from './components/CircuitMonitor';
import { designationKey, LinkedDeviceProperties } from './components/LinkedDeviceProperties';
import { ToolButton } from './components/ToolButton';
import { useCanvasNavigation } from './components/useCanvasNavigation';
import { ComponentPalette } from './components/ComponentPalette';

const nodeTypes={equipment:EquipmentNode};
const edgeTypes={wire:SchematicEdge};
const clone=<T,>(value:T):T=>structuredClone(value);
const uid=(prefix:string)=>`${prefix}-${crypto.randomUUID().slice(0,6)}`;
function projectBounds(project:Project){
  const points=project.devices.flatMap(device=>{const size=getDeviceSize(device);return [{x:device.x-35,y:device.y-40},{x:device.x+size.width+85,y:device.y+size.height+35}];});
  project.wires.forEach(wire=>points.push(...wire.waypoints??[]));
  if(!points.length)return {x:0,y:0,width:800,height:500};
  const x=Math.min(...points.map(p=>p.x)),y=Math.min(...points.map(p=>p.y));
  return {x,y,width:Math.max(...points.map(p=>p.x))-x,height:Math.max(...points.map(p=>p.y))-y};
}
function nextDesignation(kind:DeviceKind,project:Project){
  const prefixes:Partial<Record<DeviceKind,string>>={dc_motor:'M',induction:'M',synchronous:'M',stepper:'M',ac3:'G',ac1:'G',dc:'G',ac_generator:'G',dc_generator:'G',diesel:'D',emy:'EMY',coil:'K',contactor:'K',contact_no:'K',contact_nc:'K',contact_co:'K',timer_coil:'KT',timer_no:'KT',timer_nc:'KT',field_winding:'M',breaker:'QF',breaker1:'QF',fuse:'FU',thermal:'FR',lamp:'H',push_no:'S',push_nc:'S',step_driver:'DRV',junction:'J'};
  Object.assign(prefixes,{switch:'S',selector2:'SA',selector3:'SA',emergency_stop:'SE',limit_switch:'SQ',transformer1:'T',transformer3:'T',power_supply:'PS',rectifier1:'VC',rectifier3:'VC',diode:'VD',resistor:'R',rheostat:'RP',potentiometer:'RP',resistor_bank:'R',capacitor:'C',inductor:'L',terminal_block:'X',connector:'XP',busbar:'BB',net_label:'NET',offpage:'NET',earth:'PE',neutral:'N',induction1:'M',ac_generator1:'G',solenoid:'YV',brake:'YB',clutch:'YC',buzzer:'HA'});
  if(kind==='earth')return 'PE';
  const prefix=prefixes[kind]??'X';let n=1;while(project.devices.some(device=>designationKey(device.name)===`${prefix}${n}`))n++;return `${prefix}${n}`;
}
function repairLoadedProject(project:Project){
  try{return {project:attachJunctions(project),message:''};}
  catch(error){return {project,message:`Đã giữ nguyên sơ đồ. Chưa thể nối các nút trên dây: ${(error as Error).message}`};}
}
function initialProject(){try{const saved=localStorage.getItem(STORAGE_KEY);if(saved)return repairLoadedProject(parseProject(saved));}catch{/* Invalid saves do not replace the bundled example. */}return repairLoadedProject(clone(examples[0].project));}

function NumberField({label,unit,value,min,max,step=1,onChange}:{label:string;unit:string;value:number;min:number;max:number;step?:number;onChange:(value:number)=>void}){
  return <label className="parameter-field"><span>{label}</span><div><input key={value} aria-label={label} type="number" min={min} max={max} step={step} defaultValue={value} onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur();}} onBlur={event=>{const next=event.currentTarget.valueAsNumber;if(Number.isFinite(next)&&next>=min&&next<=max){if(next!==value)onChange(next);}else event.currentTarget.value=String(value);}}/><span>{unit}</span></div></label>;
}

export default function App(){
  const [restored]=useState(initialProject);
  const [project,setProject]=useState<Project>(restored.project);
  const projectRef=useRef(project);
  projectRef.current=project;
  const [simulation,setSimulation]=useState(()=>createInitialState(project));
  const [running,setRunning]=useState(false);
  const [selectedIds,setSelectedIds]=useState<string[]>([]);
  const [selectedWireIds,setSelectedWireIds]=useState<string[]>([]);
  const setSelectedId=useCallback((id:string|null)=>setSelectedIds(id?[id]:[]),[]);
  const setSelectedWireId=useCallback((id:string|null)=>setSelectedWireIds(id?[id]:[]),[]);
  const selectedId=selectedIds.length===1?selectedIds[0]:null;
  const selectedWireId=!selectedIds.length&&selectedWireIds.length===1?selectedWireIds[0]:null;
  const selectionCount=selectedIds.length+selectedWireIds.length;
  const [clipboard,setClipboard]=useState<ClipboardFragment|null>(null);
  const pasteCount=useRef(0);
  const [showTerminalLabels,setShowTerminalLabels]=useState(()=>{try{return localStorage.getItem('electrical-studio.terminal-labels')!=='hidden';}catch{return true;}});
  const [search,setSearch]=useState('');
  const [past,setPast]=useState<Project[]>([]);
  const [future,setFuture]=useState<Project[]>([]);
  const [toast,setToast]=useState(restored.message);
  const [modal,setModal]=useState<'examples'|'help'|'validation'|null>(null);
  const [monitorTab,setMonitorTab]=useState('circuit');
  const [sidebarOpen,setSidebarOpen]=useState(false);
  const [monitorOpen,setMonitorOpen]=useState(false);
  const [inspectorOpen,setInspectorOpen]=useState(false);
  const [saved,setSaved]=useState(true);
  const [tool,setTool]=useState<'select'|'connect'>('select');
  const [pendingTerminal,setPendingTerminal]=useState<{deviceId:string;portId:string}|null>(null);
  const [connecting,setConnecting]=useState(false);
  const [measuredNodes,setMeasuredNodes]=useState<Record<string,{width:number;height:number}>>({});
  const fileInput=useRef<HTMLInputElement>(null);
  const dragSnapshot=useRef<Project|null>(null);
  const flow=useReactFlow();
  const navigation=useCanvasNavigation();
  const flowStore=useStoreApi();
  const cancelConnection=useCallback(()=>{setPendingTerminal(null);setConnecting(false);flowStore.setState({connectionClickStartHandle:null});},[flowStore]);
  const nodesInitialized=useNodesInitialized();
  const initiallyFitted=useRef(false);
  useEffect(()=>{if(nodesInitialized&&!initiallyFitted.current){initiallyFitted.current=true;requestAnimationFrame(()=>flow.fitBounds(projectBounds(project),{padding:.12,duration:0}));}},[nodesInitialized,flow,project]);
  const graphReady=!project.devices.length||nodesInitialized;
  const selected=project.devices.find(device=>device.id===selectedId);
  const selectedWire=project.wires.find(wire=>wire.id===selectedWireId);
  const definition=selected?getDefinition(selected.kind):undefined;
  const selectedState=selected?simulation.devices[selected.id]:undefined;
  const issues=useMemo(()=>validateProject(project),[project]);
  const errorCount=issues.filter(issue=>issue.level==='error').length;
  const libraryCatalog=catalog.filter(item=>item.kind!=='contactor');
  const categories=[...new Set(libraryCatalog.map(item=>item.category))];

  const commit=useCallback((next:Project)=>{setPast(items=>[...items.slice(-39),project]);setFuture([]);setProject(next);},[project]);
  const commitWiring=useCallback((next:Project,options?:Parameters<typeof attachJunctions>[1])=>{
    try{commit(attachJunctions(next,options));return true;}
    catch(error){setToast((error as Error).message);return false;}
  },[commit]);
  const toggleDevice=useCallback((id:string)=>{
    const target=project.devices.find(device=>device.id===id);if(!target||!canActuate(target.kind))return;
    const selector=target.kind==='selector2'||target.kind==='selector3';
    const positions=target.kind==='selector3'?[0,1,-1]:[0,1];
    const position=positions[(positions.indexOf(target.params.position??0)+1)%positions.length];
    const changed=selector?{...target,params:{...target.params,position}}:{...target,enabled:!target.enabled};
    const next={...project,devices:project.devices.map(device=>device.id===id?changed:device)};
    commit(next);
    setSimulation(previous=>{const result=stepSimulation(next,previous,0);return {...result,events:[...result.events,{time:result.time,level:'info' as const,message:`${target.name}: ${selector?`vị trí ${position}`:changed.enabled?'tác động / đóng':'nhả / mở'}.`}].slice(-80)};});
  },[project,commit]);
  const pressButton=useCallback((id:string,pressed:boolean)=>{
    const next={...projectRef.current,devices:projectRef.current.devices.map(device=>device.id===id?{...device,enabled:device.kind==='push_nc'?!pressed:pressed}:device)};
    projectRef.current=next;setProject(next);setSimulation(previous=>stepSimulation(next,previous,0));
  },[]);
  const reset=useCallback(()=>{setRunning(false);setProject(current=>({...current,devices:current.devices.map(device=>['push_no','push_nc','limit_switch'].includes(device.kind)?{...device,enabled:device.kind==='push_nc'}:device)}));setSimulation(createInitialState(project));},[project]);
  const undo=useCallback(()=>{if(!past.length)return;const previous=past[past.length-1];setFuture(items=>[project,...items]);setPast(past.slice(0,-1));setProject(previous);setRunning(false);setSimulation(createInitialState(previous));},[past,project]);
  const redo=useCallback(()=>{if(!future.length)return;const next=future[0];setPast(items=>[...items,project]);setFuture(future.slice(1));setProject(next);setRunning(false);setSimulation(createInitialState(next));},[future,project]);
  const deleteSelected=useCallback(()=>{
    if(!selectionCount)return;
    commit({...project,devices:project.devices.filter(device=>!selectedIds.includes(device.id)),wires:project.wires.filter(wire=>!selectedWireIds.includes(wire.id)&&!selectedIds.includes(wire.from)&&!selectedIds.includes(wire.to))});
    setSelectedId(null);setSelectedWireId(null);
  },[commit,project,selectedIds,selectedWireIds,selectionCount,setSelectedId,setSelectedWireId]);
  const rotateSelected=useCallback(()=>{if(!selected)return;commit({...project,devices:project.devices.map(device=>device.id===selected.id?{...device,rotation:((device.rotation??0)+90)%360 as 0|90|180|270}:device),wires:project.wires.map(wire=>wire.from===selected.id||wire.to===selected.id?{...wire,waypoints:undefined}:wire)});},[selected,project,commit]);
  const pasteFragment=useCallback((fragment:ClipboardFragment,offset:Point)=>{
    try{
      const result=pasteSelection(project,fragment,offset);
      if(!commitWiring(result.project))return false;
      setSelectedIds(result.deviceIds);setSelectedWireIds(result.wireIds);cancelConnection();
      return true;
    }catch(error){setToast((error as Error).message);return false;}
  },[project,commitWiring,cancelConnection]);
  const copy=useCallback(()=>{
    if(!selectedIds.length)return;
    const fragment=copySelection(project,selectedIds);setClipboard(fragment);pasteCount.current=0;
    setToast(`Đã sao chép ${fragment.devices.length} phần tử và ${fragment.wires.length} dây nội bộ.`);
  },[project,selectedIds]);
  const paste=useCallback(()=>{
    if(!clipboard)return;
    const offset=(pasteCount.current+1)*40;
    if(pasteFragment(clipboard,{x:offset,y:offset}))pasteCount.current++;
  },[clipboard,pasteFragment]);
  const duplicate=useCallback(()=>{if(selectedIds.length)pasteFragment(copySelection(project,selectedIds),{x:40,y:40});},[selectedIds,project,pasteFragment]);
  const patchSelected=(changes:Partial<Device>)=>{if(selected)commit({...project,devices:project.devices.map(device=>device.id===selected.id?{...device,...changes}:device)});};
  const labelMove=useCallback((id:string,point:Point)=>commit({...project,devices:project.devices.map(device=>device.id===id?{...device,labelOffset:point}:device)}),[project,commit]);
  const addRelated=(kind:DeviceKind)=>{
    if(!selected||project.devices.length>=250)return;
    const relatedCount=project.devices.filter(device=>device.kind===kind&&designationKey(device.name)===designationKey(selected.name)).length;
    const device={...createDevice(kind,uid(kind),selected.x+getDeviceSize(selected).width+140,selected.y+relatedCount*180),name:selected.name};
    if(kind==='field_winding')device.windingRole=selected.fieldMode==='series'||(selected.fieldMode==='compound'&&relatedCount>0)?'series':'shunt';
    commit({...project,devices:[...project.devices,device]});setSelectedId(device.id);setSelectedWireId(null);
    setTimeout(()=>flow.fitBounds(projectBounds({...project,devices:[...project.devices,device]}),{padding:.12,duration:180}),180);
  };

  useEffect(()=>{try{localStorage.setItem(STORAGE_KEY,serializeProject(project));setSaved(true);}catch{setSaved(false);}},[project]);
  useEffect(()=>{try{localStorage.setItem('electrical-studio.terminal-labels',showTerminalLabels?'shown':'hidden');}catch{/* View preference remains usable without storage. */}},[showTerminalLabels]);
  useEffect(()=>{
    setSelectedIds(ids=>{const valid=ids.filter(id=>project.devices.some(device=>device.id===id));return valid.length===ids.length?ids:valid;});
    setSelectedWireIds(ids=>{const valid=ids.filter(id=>project.wires.some(wire=>wire.id===id));return valid.length===ids.length?ids:valid;});
  },[project]);
  useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(''),5000);return()=>clearTimeout(timer);},[toast]);
  useEffect(()=>{if(!running)return;const timer=setInterval(()=>setSimulation(previous=>stepSimulation(project,previous,.1)),100);return()=>clearInterval(timer);},[running,project]);
  useEffect(()=>{if(errorCount&&running){setRunning(false);setToast('Đã tạm dừng. Có kết nối cần kiểm tra.');}},[errorCount,running]);
  useEffect(()=>{
    const listener=(event:KeyboardEvent)=>{
      const tag=(event.target as HTMLElement).tagName;
      if(modal){if(event.key==='Escape')setModal(null);return;}
      if(['INPUT','TEXTAREA','SELECT'].includes(tag)||(event.target as HTMLElement).isContentEditable)return;
      if((event.ctrlKey||event.metaKey)&&event.key==='z'){event.preventDefault();event.shiftKey?redo():undo();}
      else if((event.ctrlKey||event.metaKey)&&event.key==='y'){event.preventDefault();redo();}
      else if((event.ctrlKey||event.metaKey)&&event.key==='d'){event.preventDefault();duplicate();}
      else if((event.ctrlKey||event.metaKey)&&event.key==='c'){event.preventDefault();copy();}
      else if((event.ctrlKey||event.metaKey)&&event.key==='v'){event.preventDefault();paste();}
      else if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();deleteSelected();}
      else if(event.key.toLowerCase()==='r'){event.preventDefault();rotateSelected();}
      else if(event.key==='/'){event.preventDefault();setSidebarOpen(true);setTimeout(()=>document.querySelector<HTMLInputElement>('.search-box input')?.focus(),50);}
      else if(event.code==='Space'&&tag!=='BUTTON'){event.preventDefault();if(!errorCount&&graphReady)setRunning(value=>!value);}
      else if(event.key==='Escape'){setSelectedId(null);setSelectedWireId(null);cancelConnection();setTool('select');setSidebarOpen(false);setInspectorOpen(false);setMonitorOpen(false);}
    };
    window.addEventListener('keydown',listener);return()=>window.removeEventListener('keydown',listener);
  },[undo,redo,deleteSelected,duplicate,copy,paste,rotateSelected,modal,errorCount,graphReady,cancelConnection]);

  const onConnect=useCallback((connection:Connection)=>{
    if(!connection.source||!connection.target||!connection.sourceHandle||!connection.targetHandle)return;
    if(project.wires.length>=750){setToast('Tối đa 750 đoạn dây.');return;}
    const wire:Wire={id:uid('w'),from:connection.source,fromPort:connection.sourceHandle,to:connection.target,toPort:connection.targetHandle,length:1,section:2.5};
    const error=validateConnection(project,wire);if(error){setToast(error);return;}
    commitWiring({...project,wires:[...project.wires,wire]});cancelConnection();
  },[project,commitWiring,cancelConnection]);
  const terminalClick=useCallback((deviceId:string,portId:string)=>{
    if(!pendingTerminal){setPendingTerminal({deviceId,portId});setToast(`Đã chọn ${portId}. Chọn đầu cực còn lại để nối dây.`);}
    else{onConnect({source:pendingTerminal.deviceId,sourceHandle:pendingTerminal.portId,target:deviceId,targetHandle:portId});setPendingTerminal(null);}
  },[pendingTerminal,onConnect]);
  const routeChange=useCallback((id:string,points:Point[])=>{
    if(points.length>64){setToast('Tối đa 64 điểm bẻ góc trên mỗi dây.');return;}
    commitWiring({...project,wires:project.wires.map(wire=>wire.id===id?{...wire,waypoints:points}:wire)});
  },[project,commitWiring]);
  const insertJunction=useCallback((wireId:string,point:Point,terminal?:Terminal)=>{
    try{
      const result=branchOnWire(project,wireId,point,terminal);
      if(result.project!==project&&commitWiring(result.project)){setSelectedWireId(null);setSelectedId(result.junctionId??null);}
    }catch(error){setToast((error as Error).message);}
    cancelConnection();
  },[project,commitWiring,cancelConnection]);
  const onConnectEnd=useCallback<OnConnectEnd>((event,connection)=>{
    setConnecting(false);
    if(connection.isValid||connection.toHandle||!connection.fromNode||!connection.fromHandle?.id)return;
    const pointer='changedTouches' in event?event.changedTouches[0]:event;
    if(!pointer)return;
    // Hit-test the actual cursor, not a snapped grid point; wires may be off-grid.
    const point=flow.screenToFlowPosition({x:pointer.clientX,y:pointer.clientY},{snapToGrid:false});
    const candidates=project.wires.map(wire=>({wire,...nearestPointOnWire(wirePoints(project,wire),point)})).filter(hit=>hit.distance<=10/flow.getZoom()).sort((a,b)=>a.distance-b.distance);
    const closest=candidates[0];
    if(closest)insertJunction(closest.wire.id,closest.point,{deviceId:connection.fromNode.id,portId:connection.fromHandle.id});
  },[flow,project,insertJunction]);

  const nodes:EquipmentFlowNode[]=useMemo(()=>project.devices.map(device=>({id:device.id,type:'equipment',position:{x:device.x-(device.kind==='junction'?JUNCTION_CANVAS_PADDING:0),y:device.y-(device.kind==='junction'?JUNCTION_CANVAS_PADDING:0)},measured:measuredNodes[device.id],selected:selectedIds.includes(device.id),data:{device,state:simulation.devices[device.id],running,timingMode:device.kind==='timer_coil'?device.params.timerMode:project.devices.find(part=>part.kind==='timer_coil'&&designationKey(part.name)===designationKey(device.name))?.params.timerMode,legacyThermal:project.wires.some(wire=>(wire.from===device.id&&['95','96'].includes(wire.fromPort))||(wire.to===device.id&&['95','96'].includes(wire.toPort))),onToggle:toggleDevice,onPress:pressButton,onTerminalClick:terminalClick,onLabelMove:labelMove}})),[project.devices,selectedIds,simulation.devices,running,toggleDevice,terminalClick,measuredNodes,labelMove,pressButton]);
  const edges:SchematicWire[]=useMemo(()=>project.wires.map(wire=>{
    const source=project.devices.find(device=>device.id===wire.from);
    const type=source?getDefinition(source.kind).ports.find(port=>port.id===wire.fromPort)?.type:'power';
    return {id:wire.id,source:wire.from,sourceHandle:wire.fromPort,target:wire.to,targetHandle:wire.toPort,type:'wire',selected:selectedWireIds.includes(wire.id),data:{wire,points:wirePoints(project,wire),active:!!simulation.wires[wire.id]?.energized,powered:!!simulation.wires[wire.id]?.powered,running,direction:simulation.wires[wire.id]?.direction,shaft:type==='shaft',sourceJunction:source?.kind==='junction',targetJunction:project.devices.find(device=>device.id===wire.to)?.kind==='junction',onRouteChange:routeChange,onJunction:insertJunction}};
  }),[project,simulation.wires,running,selectedWireIds,routeChange,insertJunction]);
  const onNodesChange=(changes:NodeChange<EquipmentFlowNode>[])=>{
    const selection=changes.filter(change=>change.type==='select');
    if(selection.length)setSelectedIds(current=>{const next=new Set(current);for(const change of selection)if(change.type==='select'){if(change.selected)next.add(change.id);else next.delete(change.id);}return [...next];});
    const dimensions=changes.filter(change=>change.type==='dimensions');
    if(dimensions.length)setMeasuredNodes(current=>{const next={...current};let changed=false;for(const change of dimensions)if(change.type==='dimensions'&&change.dimensions){const prior=current[change.id];if(prior?.width!==change.dimensions.width||prior?.height!==change.dimensions.height){next[change.id]=change.dimensions;changed=true;}}return changed?next:current;});
    const positions=changes.filter(change=>change.type==='position');
    if(positions.length)setProject(current=>{
      const moved=new Map<string,Point>();
      const devices=current.devices.map(device=>{
        const change=positions.find(item=>item.id===device.id);
        if(change?.type!=='position'||!change.position)return device;
        const padding=device.kind==='junction'?JUNCTION_CANVAS_PADDING:0;
        const x=change.position.x+padding,y=change.position.y+padding;
        moved.set(device.id,{x:x-device.x,y:y-device.y});
        return {...device,x,y};
      });
      // Preserve custom wire routes when both connected parts move together.
      const wires=current.wires.map(wire=>{
        const from=moved.get(wire.from),to=moved.get(wire.to);
        return wire.waypoints&&from&&to&&from.x===to.x&&from.y===to.y&&(from.x||from.y)?{...wire,waypoints:wire.waypoints.map(point=>({x:point.x+from.x,y:point.y+from.y}))}:wire;
      });
      return {...current,devices,wires};
    });
  };
  const onEdgesChange=(changes:EdgeChange<SchematicWire>[])=>{
    const selection=changes.filter(change=>change.type==='select');
    if(selection.length)setSelectedWireIds(current=>{const next=new Set(current);for(const change of selection)if(change.type==='select'){if(change.selected)next.add(change.id);else next.delete(change.id);}return [...next];});
  };
  const finishNodeDrag=()=>{
    const snapshot=dragSnapshot.current;if(!snapshot)return;
    dragSnapshot.current=null;
    const current=projectRef.current;
    const moved=current.devices.filter(device=>{const before=snapshot.devices.find(item=>item.id===device.id);return before&&(before.x!==device.x||before.y!==device.y);});
    if(!moved.length)return;
    try{
      const snapped=attachJunctions(current,{junctionIds:moved.filter(device=>device.kind==='junction').map(device=>device.id),snapDistance:moved.length===1?5:0});
      const next=attachJunctions(snapped);
      setPast(items=>[...items.slice(-39),snapshot]);setFuture([]);projectRef.current=next;setProject(next);
    }catch(error){projectRef.current=snapshot;setProject(snapshot);setToast((error as Error).message);}
  };
  const addDevice=(kind:DeviceKind,position?:Point)=>{
    if(project.devices.length>=250){setToast('Tối đa 250 phần tử.');return;}
    const rect=document.querySelector('.canvas-container')?.getBoundingClientRect();
    const point=position||flow.screenToFlowPosition({x:rect?rect.x+rect.width/2:innerWidth/2,y:rect?rect.y+rect.height/2:innerHeight/2});
    const centerOffset=kind==='junction'?6:0;
    const device=createDevice(kind,uid(kind),Math.round(point.x/10)*10-centerOffset,Math.round(point.y/10)*10-centerOffset);
    device.name=nextDesignation(kind,project);
    if(!commitWiring({...project,devices:[...project.devices,device]},kind==='junction'?{junctionIds:[device.id],snapDistance:5}:undefined))return;
    setSelectedId(device.id);setSelectedWireId(null);setSidebarOpen(false);
    if(!getDefinition(kind).ports.length)setInspectorOpen(true);
  };
  const loadProject=(next:Project)=>{
    const restored=repairLoadedProject(clone(next));
    commit(restored.project);setRunning(false);setSimulation(createInitialState(restored.project));setSelectedId(null);setSelectedWireId(null);setInspectorOpen(false);setModal(null);cancelConnection();
    if(restored.message)setToast(restored.message);
    setTimeout(()=>flow.fitBounds(projectBounds(restored.project),{padding:.12,duration:180}),180);
    return restored.message;
  };
  const exportProject=()=>{try{const url=URL.createObjectURL(new Blob([serializeProject(project)],{type:'application/json'}));const anchor=document.createElement('a');anchor.href=url;anchor.download=`${project.name.replace(/[^\p{L}\p{N} _-]/gu,'').slice(0,60)||'so-do'}.electrical.json`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setToast('Đã xuất sơ đồ.');}catch(error){setToast((error as Error).message);}};
  const connectMotor=(mode:'star'|'delta')=>{
    if(!selected)return;
    const pairs=mode==='star'?[['W2','U2'],['U2','V2']]:[['U1','W2'],['V1','U2'],['W1','V2']];
    const wires=project.wires.filter(wire=>!(wire.from===selected.id&&wire.to===selected.id));
    for(const [fromPort,toPort] of pairs)wires.push({id:uid('bridge'),from:selected.id,fromPort,to:selected.id,toPort,length:.1,section:4});
    commit({...project,wires});setToast(mode==='star'?'Đã nối chung W2–U2–V2 thành điểm sao.':'Đã nối ba cầu tam giác. Các cầu nối có thể kéo hoặc xóa như dây thường.');
  };

  return <div className="app-shell compact-app">
    <header className="compact-toolbar" role="toolbar" aria-label="Công cụ bản vẽ">
      <span className="compact-brand" title="Electrical Studio"><Zap size={20}/></span>
      <ToolButton label="Tạo mới" onClick={()=>loadProject({version:2,name:'Sơ đồ mới',devices:[],wires:[]})}><FilePlus2 size={17}/></ToolButton>
      <ToolButton label="Mở" onClick={()=>fileInput.current?.click()}><FolderOpen size={17}/></ToolButton>
      <ToolButton label="Lưu tệp" onClick={exportProject}><Download size={17}/></ToolButton>
      <ToolButton label="Mạch mẫu" onClick={()=>setModal('examples')}><Grid2X2 size={17}/></ToolButton>
      <span className="toolbar-separator"/>
      <ToolButton label="Hoàn tác" disabled={!past.length} onClick={undo}><Undo2 size={17}/></ToolButton>
      <ToolButton label="Làm lại" disabled={!future.length} onClick={redo}><Redo2 size={17}/></ToolButton>
      <ToolButton label="Sao chép" disabled={!selectedIds.length} onClick={copy}><Copy size={17}/></ToolButton>
      <ToolButton label="Dán" disabled={!clipboard} onClick={paste}><ClipboardPaste size={17}/></ToolButton>
      <ToolButton label="Nhân bản" disabled={!selectedIds.length} onClick={duplicate}><CopyPlus size={17}/></ToolButton>
      <ToolButton label="Xoay phần tử" disabled={!selected} onClick={rotateSelected}><RotateCw size={17}/></ToolButton>
      <ToolButton label="Xóa" disabled={!selectionCount} onClick={deleteSelected}><Trash2 size={17}/></ToolButton>
      <span className="toolbar-separator"/>
      <ToolButton label="Chọn và di chuyển" active={tool==='select'} onClick={()=>setTool('select')}><MousePointer2 size={17}/></ToolButton>
      <ToolButton label="Chế độ nối dây" active={tool==='connect'} onClick={()=>setTool('connect')}><Cable size={17}/></ToolButton>
      <ToolButton label="Thu nhỏ" onClick={()=>flow.zoomOut()}><ZoomOut size={17}/></ToolButton>
      <ToolButton label="Phóng to" onClick={()=>flow.zoomIn()}><ZoomIn size={17}/></ToolButton>
      <ToolButton label="Vừa màn hình" onClick={()=>flow.fitBounds(projectBounds(project),{padding:.12,duration:180})}><Maximize size={17}/></ToolButton>
      <ToolButton label={showTerminalLabels?'Ẩn số đầu cực':'Hiện số đầu cực'} active={showTerminalLabels} onClick={()=>setShowTerminalLabels(value=>!value)}><Hash size={17}/></ToolButton>
      <span className="toolbar-separator"/>
      <ToolButton label="Mở thư viện" active={sidebarOpen} onClick={()=>setSidebarOpen(!sidebarOpen)}><PanelLeft size={17}/></ToolButton>
      <ToolButton label="Thuộc tính" active={inspectorOpen} onClick={()=>setInspectorOpen(!inspectorOpen)}><Settings2 size={17}/></ToolButton>
      <ToolButton label="Trạng thái và nhật ký" active={monitorOpen} onClick={()=>setMonitorOpen(!monitorOpen)}><List size={17}/></ToolButton>
      <ToolButton label="Kiểm tra mạch" onClick={()=>setModal('validation')}><ShieldCheck size={17}/></ToolButton>
      <ToolButton label="Hướng dẫn" onClick={()=>setModal('help')}><CircleHelp size={17}/></ToolButton>
      <input className="project-name" title={project.name} aria-label="Tên dự án" maxLength={120} value={project.name} onChange={event=>setProject({...project,name:event.target.value})} onBlur={()=>{if(!project.name.trim())setProject({...project,name:'Sơ đồ mới'});}}/>
      <span className="save-indicator" title={saved?'Đã tự lưu':'Chưa lưu'}>{saved?<Check size={13}/>:<CircleHelp size={13}/>}</span>
      <div className="run-tools"><ToolButton className="run-button" label={running?'Tạm dừng':'Chạy mô phỏng'} disabled={!graphReady} active={running} onClick={()=>{if(errorCount){setModal('validation');return;}setRunning(!running);}}>{running?<Pause size={18}/>:<Play size={18} fill="currentColor"/>}</ToolButton><ToolButton className="stop-button" label="Đặt lại mô phỏng" onClick={reset}><Square size={15} fill="currentColor"/></ToolButton></div>
    </header>
    <ComponentPalette items={libraryCatalog} onAdd={addDevice}/>
    <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={async event=>{const file=event.target.files?.[0];if(!file)return;try{if(file.size>2_000_000)throw new Error('Tệp quá lớn, giới hạn 2 MB.');loadProject(parseProject(await file.text()));setToast(`Đã mở ${file.name}.`);}catch(error){setToast((error as Error).message);}event.target.value='';}}/>
    <div className="workspace">
      <main {...navigation.handlers} className={`canvas-container ${running?'simulation-running':''} ${navigation.panning?'panning':''} ${connecting||pendingTerminal?'connecting-wire':''} ${showTerminalLabels?'':'hide-terminal-labels'}`} onContextMenu={event=>event.preventDefault()} onDragOver={event=>{event.preventDefault();event.dataTransfer.dropEffect='copy';}} onDrop={event=>{event.preventDefault();const kind=event.dataTransfer.getData('application/electrical-device');if(catalog.some(item=>item.kind===kind))addDevice(kind as DeviceKind,flow.screenToFlowPosition({x:event.clientX,y:event.clientY}));}}>
        <ReactFlow<EquipmentFlowNode,SchematicWire> nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} connectionMode={ConnectionMode.Loose} connectOnClick onConnect={onConnect} onConnectStart={()=>setConnecting(true)} onConnectEnd={onConnectEnd} onClickConnectStart={(_,handle)=>{if(handle.nodeId&&handle.handleId)setPendingTerminal({deviceId:handle.nodeId,portId:handle.handleId});}} onClickConnectEnd={cancelConnection} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} selectionOnDrag={tool==='select'} selectionKeyCode={null} selectionMode={SelectionMode.Full} paneClickDistance={4} onSelectionStart={cancelConnection} onNodeDragStart={()=>{dragSnapshot.current=clone(project);}} onNodeDragStop={finishNodeDrag} onNodeClick={(event,node)=>{if(running&&canActuate(node.data.device.kind)&&!['push_no','push_nc','limit_switch'].includes(node.data.device.kind)&&!(event.target as HTMLElement).closest('.node-reference,.react-flow__handle'))toggleDevice(node.id);}} onNodeDoubleClick={(_,node)=>{setSelectedId(node.id);setSelectedWireId(null);setInspectorOpen(true);}} onEdgeClick={(event,edge)=>{if(pendingTerminal)insertJunction(edge.id,flow.screenToFlowPosition({x:event.clientX,y:event.clientY},{snapToGrid:false}),pendingTerminal);}} onEdgeDoubleClick={()=>{}} onPaneClick={()=>{setSelectedId(null);setSelectedWireId(null);cancelConnection();}} panOnDrag={[2]} panActivationKeyCode={null} panOnScroll={false} zoomOnScroll zoomOnDoubleClick={false} nodesDraggable={tool==='select'} deleteKeyCode={null} minZoom={.15} maxZoom={2.5} snapToGrid snapGrid={[10,10]} colorMode="light" proOptions={{hideAttribution:true}} connectionLineStyle={{stroke:'#2879c8',strokeWidth:1.8}}>
          <Background variant={BackgroundVariant.Dots} gap={10} size={.7} color="#d8dfe5"/>
          {!project.devices.length&&<Panel position="top-center" className="empty-canvas"><Cable size={32}/><p>Kéo phần tử từ thanh công cụ vào bản vẽ.</p><button className="button outlined" onClick={()=>setModal('examples')}>Mạch mẫu</button></Panel>}
        </ReactFlow>
      </main>
      {sidebarOpen&&<aside className="library floating-panel"><div className="section-heading"><h2>Phần tử</h2><ToolButton label="Thu gọn thư viện" onClick={()=>setSidebarOpen(false)}><X size={16}/></ToolButton></div><label className="search-box"><Search size={14}/><input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Tìm…" aria-label="Tìm thiết bị"/></label><div className="library-list">{categories.map(category=>{const items=libraryCatalog.filter(item=>item.category===category&&`${item.name} ${item.shortName} ${item.kind}`.toLocaleLowerCase('vi').includes(search.toLocaleLowerCase('vi')));return !!items.length&&<section key={category}><h3>{category}</h3><div className="library-items">{items.map(item=><button className="library-item" key={item.kind} title={item.name} aria-label={`Thêm ${item.name}`} draggable onDragStart={event=>event.dataTransfer.setData('application/electrical-device',item.kind)} onClick={()=>addDevice(item.kind)}><DeviceSymbol kind={item.kind} size={36}/><span>{item.shortName}</span></button>)}</div></section>;})}</div></aside>}
      {inspectorOpen&&<aside className="inspector floating-panel"><div className="section-heading"><h2>Thuộc tính</h2><ToolButton label="Đóng thuộc tính" onClick={()=>setInspectorOpen(false)}><X size={16}/></ToolButton></div><div className="inspector-content">
        {selected&&definition?<><div className="selected-device"><DeviceSymbol kind={selected.kind} size={32}/><h3>{definition.shortName}</h3></div><LinkedDeviceProperties device={selected} project={project} state={selectedState} onChange={patchSelected} onAdd={addRelated} onSelect={id=>{setSelectedId(id);setSelectedWireId(null);}}/>
          {['induction','synchronous'].includes(selected.kind)&&<div className="motor-bridges"><div><button className="button outlined" onClick={()=>connectMotor('star')}>Y · Đấu sao</button><button className="button outlined" onClick={()=>connectMotor('delta')}>Δ · Tam giác</button></div></div>}
          <details className="device-parameters"><summary>Đầu nối</summary><div className="pin-list">{definition.ports.filter(port=>!(selected.kind==='thermal'&&['95','96'].includes(port.id))).map(port=><div key={port.id}><strong>{port.label}</strong><span>{project.wires.filter(wire=>(wire.from===selected.id&&wire.fromPort===port.id)||(wire.to===selected.id&&wire.toPort===port.id)).length} dây</span></div>)}</div></details>
          {!!definition.parameters.filter(parameter=>!['delaySeconds','timerMode','position','stage','actuationPosition'].includes(parameter.key)).length&&<details className="device-parameters"><summary>Thông số định mức</summary><div className="parameters">{definition.parameters.filter(parameter=>!['delaySeconds','timerMode','position','stage','actuationPosition'].includes(parameter.key)).map(parameter=><NumberField key={`${selected.id}-${parameter.key}`} label={parameter.label} unit={parameter.unit} value={selected.params[parameter.key]??parameter.default} min={parameter.min} max={parameter.max} step={parameter.step} onChange={value=>patchSelected({params:{...selected.params,[parameter.key]:value}})}/>)}</div></details>}
          {simulation.time>0&&<p className="inspector-device-state">{selectedState?.status}</p>}
          <div className="inspector-actions"><ToolButton label="Xoay phần tử" onClick={rotateSelected}><RotateCw size={16}/></ToolButton><ToolButton label="Nhân bản" onClick={duplicate}><Copy size={16}/></ToolButton><ToolButton label="Xóa phần tử" onClick={deleteSelected}><Trash2 size={16}/></ToolButton></div>
        </>:selectedWire?<><div className="wire-endpoints"><span>{project.devices.find(device=>device.id===selectedWire.from)?.name} : {selectedWire.fromPort}</span><span>↕</span><span>{project.devices.find(device=>device.id===selectedWire.to)?.name} : {selectedWire.toPort}</span></div><label className="wire-color">Màu <input type="color" aria-label="Màu dây" value={selectedWire.color||'#455566'} onChange={event=>commit({...project,wires:project.wires.map(wire=>wire.id===selectedWire.id?{...wire,color:event.target.value}:wire)})}/></label><div className="inspector-actions"><ToolButton label="Tự đi dây lại" onClick={()=>commit({...project,wires:project.wires.map(wire=>wire.id===selectedWire.id?{...wire,waypoints:undefined}:wire)})}><RotateCcw size={16}/></ToolButton><ToolButton label="Xóa kết nối" onClick={deleteSelected}><Trash2 size={16}/></ToolButton></div></>:<p className="inspector-hint">{selectionCount>1?`Đang chọn ${selectedIds.length} phần tử, ${selectedWireIds.length} dây.`:'Chọn phần tử hoặc dây.'}</p>}
      </div></aside>}
      {monitorOpen&&<div className="monitor-popover"><ToolButton className="monitor-close" label="Đóng trạng thái" onClick={()=>setMonitorOpen(false)}><X size={14}/></ToolButton><CircuitMonitor project={project} simulation={simulation} selected={selected} running={running} tab={monitorTab} setTab={setMonitorTab}/></div>}
    </div>
    <footer className="status-bar"><span><i className={running?'status-good':''}/>{running?'Đang mô phỏng':'Vẽ mạch'} · {project.devices.length} phần tử · {project.wires.length} dây</span><span>{selectedIds.length>1||selectedWireIds.length>1?`Đã chọn ${selectedIds.length} phần tử, ${selectedWireIds.length} dây`:pendingTerminal?`Nối từ ${pendingTerminal.portId}`:selected?`${selected.name} · ${getDefinition(selected.kind).shortName}`:selectedWire?'Kéo ô vuông để chỉnh dây':''}</span></footer>
    {toast&&<div className="toast" role="status"><span>{toast}</span><button aria-label="Đóng thông báo" onClick={()=>setToast('')}><X size={14}/></button></div>}
    {modal&&<div className="modal-backdrop" onClick={()=>setModal(null)}><section role="dialog" aria-modal="true" aria-labelledby="modal-title" className="modal" onClick={event=>event.stopPropagation()}><div className="modal-heading"><h2 id="modal-title">{modal==='examples'?'Mạch mẫu':modal==='validation'?'Kiểm tra mạch':'Phím và thao tác'}</h2><ToolButton label="Đóng hộp thoại" onClick={()=>setModal(null)}><X size={18}/></ToolButton></div>
      {modal==='examples'?<div className="example-grid">{examples.map(example=><button className="example-card" key={example.id} title={example.description} onClick={()=>loadProject(example.project)}><div><h3>{example.name}</h3><small>{example.project.devices.length} phần tử · {example.project.wires.length} dây</small></div></button>)}</div>:modal==='validation'?<div className="validation-list">{issues.length?issues.map((issue,index)=><div className={`validation-item ${issue.level}`} key={index}><ShieldCheck size={16}/><p>{issue.message}</p></div>):<p className="validation-success">Kết nối hợp lệ.</p>}</div>:<div className="compact-help"><p>Ctrl+C / Ctrl+V: sao chép và dán nhóm cùng dây nội bộ. Nút #: ẩn/hiện số đầu cực.</p><p>Giữ chuột trái trên vùng trống: khoanh chọn. Kéo phần tử đã chọn: di chuyển nhóm. Delete: xóa nhóm.</p><p>Giữ chuột phải: kéo giấy. Lăn chuột: zoom. Chuột trái: chọn và thao tác.</p><p>Kéo đầu cực thả lên dây có sẵn để tạo nhánh.</p><p>Kéo icon vào bản vẽ. Kéo giữa hai đầu cực để nối dây.</p><p>Nhấn đúp dây: thêm nút nối. Chọn dây và kéo ô vuông: sửa đường đi.</p><p>Nhấn đúp phần tử: thuộc tính. Kéo tên để đổi vị trí; có thể ẩn tên.</p><p>Khi chạy: nhấn CB để đóng/cắt; nhấn rơle nhiệt để tác động/reset; giữ nút nhấn và thả để nhả. Máy điện hoạt động theo điều kiện mạch.</p><p>Cuộn hút, tiếp điểm, máy điện và cuộn kích từ liên kết bằng cùng tên.</p><p>R: xoay · Delete: xóa · Ctrl+D: nhân bản · Ctrl+Z/Y: hoàn tác/làm lại · Space: chạy/dừng · /: tìm · Esc: đóng bảng.</p><p>Mô phỏng trạng thái và đường dòng điện; chưa tính các đại lượng điện.</p></div>}
    </section></div>}
  </div>;
}
