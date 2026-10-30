import { Cable, CircleCheck, CircleDashed, List } from 'lucide-react';
import { getDefinition } from '../model/catalog';
import type { Device, Project, SimulationState } from '../model/types';

export function CircuitMonitor({project,simulation,selected,running,tab,setTab}:{project:Project;simulation:SimulationState;selected?:Device;running:boolean;tab:string;setTab:(value:string)=>void}){
  const activeWires=project.wires.filter(wire=>simulation.wires[wire.id]?.energized).length;
  const poweredWires=project.wires.filter(wire=>simulation.wires[wire.id]?.powered).length;
  const activeDevices=project.devices.filter(device=>simulation.devices[device.id]?.energized).length;
  const definition=selected?getDefinition(selected.kind):null;
  const state=selected?simulation.devices[selected.id]:null;
  return <section className="circuit-monitor">
    <div className="monitor-heading"><div className="monitor-tabs"><button className={tab==='circuit'?'active':''} onClick={()=>setTab('circuit')}><Cable size={15}/> Trạng thái mạch</button><button className={tab==='events'?'active':''} onClick={()=>setTab('events')}><List size={14}/> Nhật ký <span className="count">{simulation.events.length}</span></button></div><span className="monitor-caption">Mô phỏng đóng / cắt · Chưa tính toán điện</span></div>
    {tab==='events'?<div className="event-list">{simulation.events.length?[...simulation.events].reverse().map((event,index)=><div className={`event-row ${event.level}`} key={index}><time>{event.time.toFixed(1)} s</time><span>{event.message}</span></div>):<p>Chưa có sự kiện. Đóng hoặc ngắt thiết bị để theo dõi.</p>}</div>:<div className="circuit-monitor-body">
      <div className="circuit-summary"><span className={`activity-led ${running?'on':''}`}/><div><strong>{running?'Đang mô phỏng':simulation.time?'Đã tạm dừng':'Sẵn sàng đấu dây'}</strong><span>{poweredWires} dây được cấp điện · {activeWires} có dòng · {activeDevices} thiết bị hoạt động</span></div></div>
      {selected&&definition?<div className="terminal-summary"><div className="selected-status"><strong>{selected.name}</strong><span>{state?.status||'Chưa chạy mô phỏng'}</span>{state?.connection&&<b>{state.connection}</b>}</div><div className="terminal-pills">{definition.ports.filter(port=>port.type==='power').map(port=>{const wires=project.wires.filter(wire=>(wire.from===selected.id&&wire.fromPort===port.id)||(wire.to===selected.id&&wire.toPort===port.id));const active=wires.some(wire=>simulation.wires[wire.id]?.powered||simulation.wires[wire.id]?.energized);return <span key={port.id} className={`terminal-pill ${active?'active':''}`} title={wires.length?`${wires.length} dây nối`:'Đầu cực chưa nối'}>{wires.length?<CircleCheck size={11}/>:<CircleDashed size={11}/>} {port.label}</span>;})}</div></div>:<p className="monitor-tip">Chọn một phần tử để xem các đầu cực và trạng thái hoạt động.</p>}
    </div>}
  </section>;
}
