import type { DeviceKind } from '../model/types';
import { getDefinition } from '../model/catalog';
import { ExpandedSymbol } from './ExpandedSymbols';
import { MotorDirection } from './MotorDirection';

// Derive every resized symbol's external lead from its catalogue port so the
// SVG and the wire handle always meet at the same point.
function terminal(kind:DeviceKind,id:string){
  const {size:{width,height},ports}=getDefinition(kind),port=ports.find(item=>item.id===id)!;
  const coordinate=(span:number)=>Math.round(span*port.offset/100*1e6)/1e6;
  return {x:port.side==='left'?0:port.side==='right'?width:coordinate(width),y:port.side==='top'?0:port.side==='bottom'?height:coordinate(height)};
}

function breakerGeometry(kind:DeviceKind){
  const {height}=getDefinition(kind).size;
  return {xs:(kind==='breaker'?['1','3','5']:['1']).map(id=>terminal(kind,id).x),upper:30,lower:height-30};
}

// Small pick areas only where thin/open symbols would otherwise be hard to grab.
// Unpainted corners of the enclosing node remain transparent to wires below.
export function SymbolHitArea({kind}:{kind:DeviceKind}){
  let area;
  if(['contact_no','contact_nc','timer_no','timer_nc'].includes(kind))area=<rect x="32" y="29" width="32" height="43"/>;
  else if(['push_no','push_nc'].includes(kind))area=<rect x="7" y="29" width="57" height="43"/>;
  else if(kind==='contact_co')area=<path d="M40 32L20 64L60 64Z" stroke="transparent" strokeWidth="12"/>;
  else if(kind==='field_winding')area=<rect x="46" y="34" width="17" height="72"/>;
  else if(kind==='fuse')area=<rect x="27" y="22" width="26" height="56"/>;
  else if(kind==='breaker'||kind==='breaker1'){
    const {xs,upper,lower}=breakerGeometry(kind);
    area=xs.map(x=><path key={x} d={`M${x} ${upper}V${lower}L${x-18} ${upper+12}Z`} stroke="transparent" strokeWidth="12"/>);
  }
  return <g className="symbol-pick-area" fill="transparent" stroke="none">{area}</g>;
}

// Symbol coordinates and external pins share the same catalogue dimensions.
export function SchematicSymbol({kind,closed:closedProp,active=false,moving=false,rotationDirection=0,timingMode=0,actuated=false,legacyThermal=false,position=0,params={}}:{kind:DeviceKind;closed?:boolean;active?:boolean;moving?:boolean;rotationDirection?:number;timingMode?:number;actuated?:boolean;legacyThermal?:boolean;position?:number;params?:Record<string,number>}){
  const {width:w,height:h}=getDefinition(kind).size;
  const lead=(id:string,x:number,y:number)=>{const p=terminal(kind,id);return <path key={id} d={`M${p.x} ${p.y}L${x} ${y}`}/>;};
  const closed=closedProp??(!['breaker','breaker1','contact_no','timer_no','push_no','contactor'].includes(kind));
  const text=(x:number,y:number,label:string,size=17)=><text x={x} y={y} textAnchor="middle" dominantBaseline="middle" fill="currentColor" stroke="none" fontSize={size} fontFamily="Arial, sans-serif">{label}</text>;
  const circle=(x:number,y:number,r:number)=><circle cx={x} cy={y} r={r} fill="var(--canvas, white)"/>;
  const contact=(x:number,top=0,bottom=h,isClosed=closed)=><g><path d={`M${x} ${top}V${top+34} M${x} ${bottom-34}V${bottom}`}/><circle cx={x} cy={top+34} r="2.3"/><circle cx={x} cy={bottom-34} r="2.3"/><path d={`M${x} ${bottom-34}L${isClosed?x:x+19} ${top+34}`}/></g>;
  const directCurrent=(x:number,y:number)=><g><path d={`M${x-10} ${y}H${x+10}`}/><path d={`M${x-10} ${y+5}H${x+10}`} strokeDasharray="4 4"/></g>;
  const direction=(x:number,y:number)=><MotorDirection x={x} y={y} direction={active?rotationDirection:0} moving={moving}/>;
  let body;
  if(kind==='junction')body=<circle cx="6" cy="6" r="4" fill="currentColor"/>;
  else if(kind==='dc')body=<><path d="M50 0V37 M50 103V140"/>{circle(50,70,33)}{text(50,54,'+')}{text(50,86,'−')}</>;
  else if(kind==='ac1')body=<>{['L','N'].map(id=>{const p=terminal(kind,id);return lead(id,p.x,46+Math.sqrt(36**2-(p.x-60)**2));})}{circle(60,46,36)}<path d="M37 46C45 22 51 22 60 46S75 70 83 46"/>{text(60,97,'1~',12)}</>;
  else if(kind==='ac3'||kind==='ac_generator'){
    const cy=kind==='ac3'?50:70,r=37;
    body=<>{kind==='ac_generator'&&<path d={`M0 ${cy}H43`} strokeDasharray="7 3 1 3"/>}{['L1','L2','L3','N'].map(id=>{const p=terminal(kind,id),x=80+(p.x-80)*.45,y=cy+Math.sqrt(r*r-(x-80)**2);return <path key={id} d={`M${p.x} ${p.y}V${h-20}L${x} ${y}`}/>;})}{circle(80,cy,r)}{text(80,cy-8,kind==='ac3'?'3~':'G',23)}{text(80,cy+14,kind==='ac3'?'AC':'3~',kind==='ac3'?11:13)}</>;
  }
  else if(kind==='induction'||kind==='synchronous'){
    const cx=w/2,cy=h/2,r=42;
    body=<>{['U1','V1','W1','W2','U2','V2'].map(id=>{const p=terminal(kind,id),dy=Math.sqrt(r*r-(p.x-cx)**2);return lead(id,p.x,cy+(p.y===0?-dy:dy));})}<path d={`M${cx+r} ${cy}H${w}`} strokeDasharray="7 3 1 3"/>{circle(cx,cy,r)}{direction(cx,cy)}{text(cx,cy+1,'M',27)}{text(cx,cy+25,'3~',14)}</>;
  }
  else if(kind==='dc_motor'||kind==='dc_generator'){
    const cx=w/2,cy=h/2,r=34;
    body=<>{lead('+',cx,cy-r)}{lead('-',cx,cy+r)}<path d={kind==='dc_motor'?`M${cx+r} ${cy}H${w}`:`M0 ${cy}H${cx-r}`} strokeDasharray="7 3 1 3"/>{circle(cx,cy,r)}<path d={`M${cx-7} ${cy-r-2}h14v8h-14Z M${cx-7} ${cy+r-6}h14v8h-14Z`} fill="currentColor"/>{kind==='dc_motor'&&direction(cx,cy)}{text(cx,cy+(kind==='dc_motor'?1:-6),kind==='dc_motor'?'M':'G',25)}{directCurrent(cx,cy+(kind==='dc_motor'?18:14))}</>;
  }
  else if(kind==='stepper'){
    const cx=w/2,cy=h/2,r=40;
    body=<>{['A+','A-','B+','B-'].map(id=>{const p=terminal(kind,id),dy=Math.sqrt(r*r-(p.x-cx)**2);return lead(id,p.x,cy+(p.y===0?-dy:dy));})}<path d={`M${cx+r} ${cy}H${w}`} strokeDasharray="7 3 1 3"/>{circle(cx,cy,r)}{direction(cx,cy)}{text(cx,cy+1,'M',25)}{text(cx,cy+25,'STEP',11)}</>;
  }
  else if(kind==='step_driver')body=<><rect x="24" y="14" width="108" height="152" rx="2" fill="var(--canvas, white)"/>{['+','-','A+','A-','B+','B-'].map(id=>{const p=terminal(kind,id);return lead(id,p.x===0?24:132,p.y);})}{text(78,70,'DRIVER',16)}<path d="M45 105H57V89H70V105H83V89H96V105H110"/></>;
  else if(kind==='diesel')body=<><rect x="14" y="14" width="108" height="72" fill="var(--canvas, white)"/><path d={`M122 ${h/2}H${w}`} strokeDasharray="7 3 1 3"/>{text(68,42,'D',28)}{text(68,67,'DIESEL',11)}</>;
  else if(kind==='emy')body=<>{lead('+',80,36)}{lead('-',80,124)}<path d="M0 80H36" strokeDasharray="7 3 1 3"/>{lead('F1',28,30)}{lead('F2',28,130)}<path d="M28 30V48 M28 130V112 M28 48c-13 0 -13 16 0 16c-13 0 -13 16 0 16c-13 0 -13 16 0 16c-13 0 -13 16 0 16"/>{circle(80,80,44)}<path d="M73 36H87V44H73Z M73 116H87V124H73Z" fill="currentColor"/>{text(80,72,'EMY',19)}{text(80,94,'ЭМУ',13)}</>;
  else if(kind==='breaker'||kind==='breaker1'){
    const {xs,upper,lower}=breakerGeometry(kind),mid=(upper+lower)/2;
    body=<>{xs.map(x=><g key={x}><path d={`M${x} 0V${upper} M${x} ${lower}V${h} M${x} ${lower}L${closed?x:x-18} ${closed?upper:upper+12} M${x-4} ${upper-4}L${x+4} ${upper+4} M${x-4} ${upper+4}L${x+4} ${upper-4}`}/></g>)}{xs.length>1&&<path d={`M${xs[0]-(closed?0:10)} ${mid}H${xs[xs.length-1]-(closed?0:10)}`} strokeDasharray="5 3"/>}<path d={`M${xs[0]-22} ${mid+4}l7 -5 4 6 M${xs[0]-22} ${mid+11}l7 -5 4 6`}/></>;
  }
  else if(kind==='thermal')body=<><rect x="14" y="40" width="112" height="60" fill="var(--canvas, white)"/>{['1','3','5'].map(id=>{const {x}=terminal(kind,id);return <path key={id} d={`M${x} 0V50H${x+10}V90H${x}V${h}`}/>;})}{actuated&&<path d="M18 106H122" strokeDasharray="4 4"/>}{legacyThermal&&<>{lead('95',132,50)}{lead('96',132,90)}<path d={actuated?'M132 90L145 56':'M132 90V50'}/></>}</>;
  else if(kind==='contactor')body=<><rect x="20" y="82" width="20" height="36" fill="var(--canvas, white)"/><path d="M0 70H30V82 M0 130H30V118 M40 100H160" strokeDasharray="4 3"/>{['1','3','5'].map(id=>{const {x}=terminal(kind,id);return <g key={id}>{contact(x,20,180)}<path d={`M${x} 0V20 M${x} 180V200`}/></g>;})}<path d="M240 40H216 M240 80H216 M240 130H216 M240 170H216"/><path d={closed?'M216 80V40 M216 170L230 130':'M216 80L230 40 M216 170V130'}/>{text(30,102,'K',12)}<path d="M211 130H221"/></>;
  else if(kind==='fuse')body=<><path d="M40 0V24 M40 76V100 M40 24V76"/><rect x="29" y="24" width="22" height="52" fill="none"/>{!closed&&<path d="M31 43L49 57 M49 43L31 57"/>}</>;
  else if(kind==='lamp')body=<>{lead('1',30,14)}{lead('2',30,46)}<circle cx="30" cy="30" r="16" fill={active?'#fef08a':'var(--canvas, white)'} className={active?'lamp-glow':''}/><path d="M19 19L41 41 M19 41L41 19"/></>;
  else if(kind==='push_no'||kind==='push_nc')body=<>{contact(40,0,100)}<path d="M12 50H32 M12 40V60" strokeDasharray="3 2"/>{kind==='push_nc'&&<path d="M33 34H47"/>}</>;
  else if(kind==='field_winding')body=<><path d="M50 0V38 M50 102V140 M50 38a8 8 0 0 1 0 16a8 8 0 0 1 0 16a8 8 0 0 1 0 16a8 8 0 0 1 0 16"/></>;
  else if(kind==='coil'||kind==='timer_coil')body=<><path d="M40 0V32 M40 68V100"/><rect x="16" y="32" width="48" height="36" fill="var(--canvas, white)"/>{kind==='timer_coil'&&<><path d={timingMode===1?'M16 40H64':'M16 60H64'}/><rect x="17" y={timingMode===1?33:61} width="46" height="6" fill="currentColor" stroke="none"/></>}</>;
  else if(['contact_no','contact_nc','timer_no','timer_nc'].includes(kind))body=<>{contact(40,0,100)}{kind.endsWith('_nc')&&<path d="M33 34H47"/>}{kind.startsWith('timer_')&&<><path d="M14 50H34" strokeDasharray="3 3"/><path d={timingMode===1?'M18 40Q4 50 18 60':'M8 40Q22 50 8 60'}/></>}</>;
  else if(kind==='contact_co')body=<><path d="M40 0V32 M20 64V100 M60 64V100 M14 64H26 M54 64H66"/><path d={actuated?'M40 32L60 64':'M40 32L20 64'}/></>;
  return <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{body??<ExpandedSymbol kind={kind} active={active} actuated={actuated} position={position} params={params} rotationDirection={rotationDirection} moving={moving}/>}</g>;
}
