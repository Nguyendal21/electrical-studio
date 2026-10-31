import type { DeviceKind } from '../model/types';
import { MotorDirection } from './MotorDirection';
import { selectorAngle, selectorPositionLabel, selectorPositions } from '../model/catalog';
import { getProtectionFunction } from '../model/protection';

/** IEC-style passive symbols and functional blocks for the state simulator. */
export function ExpandedSymbol({kind,active,actuated,position=0,params={},rotationDirection=0,moving=false}:{kind:DeviceKind;active:boolean;actuated:boolean;position?:number;params?:Record<string,number>;rotationDirection?:number;moving?:boolean}){
  const label=(x:number,y:number,value:string,size=13)=><text x={x} y={y} textAnchor="middle" dominantBaseline="middle" stroke="none" fill="currentColor" fontSize={size} fontFamily="Arial,sans-serif">{value}</text>;
  const fill='var(--canvas, white)';
  if(kind==='switch')return <><circle cx="30" cy="30" r="22" fill={fill}/><path d={actuated?'M30 44V16':'M30 44L44 18'} strokeWidth="3"/></>;
  if(selectorPositions(kind,params).length)return <g className="selector-rotary" data-position={position}>
    <title>Bấm vạch để chọn nấc; phím trái/phải để chuyển nấc, Home về 0.</title>
    <circle cx="40" cy="40" r="23" fill={fill}/>
    {selectorPositions(kind,params).map(detent=><g key={detent} className="selector-detent" data-selector-position={detent} transform={`rotate(${selectorAngle(kind,detent,params)} 40 40)`}>
      <title>{selectorPositionLabel(kind,detent,params)}</title>
      <circle cx="40" cy="10" r="6" fill="transparent" stroke="none"/>
      <path d="M40 8V12" strokeWidth={position===detent?2.4:1.7}/>
    </g>)}
    <path className="selector-pointer" d="M40 51V20" strokeWidth="4" transform={`rotate(${selectorAngle(kind,position,params)} 40 40)`}/>
  </g>;
  if(kind==='protection_relay')return <g className="protection-relay" data-function={params.protectionFunction??0}>
    <title>{getProtectionFunction(params.protectionFunction??0).label} · Bấm để thử / xóa sự cố khi mô phỏng</title>
    <path d="M40 0V30 M40 70V100"/><rect x="16" y="30" width="48" height="40" fill={fill}/>
    {label(40,50,getProtectionFunction(params.protectionFunction??0).symbol,16)}
    {actuated&&<path d="M20 76H60" strokeDasharray="4 3"/>}
  </g>;
  if(kind==='emergency_stop')return <g transform={actuated?'translate(0 8)':undefined}><path d="M16 33Q16 13 40 13Q64 13 64 33Z" fill="#d76155"/><path d="M34 33V51H46V33 M25 55H55 M40 57V70" strokeDasharray="0"/><path d="M20 8A27 27 0 0 1 60 8 M55 4L60 8L54 12"/></g>;
  if(kind==='limit_switch')return <><rect x="22" y="46" width="36" height="22" fill={fill}/><path d={actuated?'M40 46V23':'M40 46L57 26'}/><circle cx={actuated?40:60} cy={actuated?18:22} r="5"/><path d="M40 68V76" strokeDasharray="3 3"/></>;
  if(kind==='transformer1')return <><path d="M0 30H42 M0 90H42 M120 30H78 M120 90H78 M42 30c-12 0 -12 15 0 15c-12 0 -12 15 0 15c-12 0 -12 15 0 15c-12 0 -12 15 0 15 M78 30c12 0 12 15 0 15c12 0 12 15 0 15c12 0 12 15 0 15c12 0 12 15 0 15 M58 22V98 M62 22V98"/></>;
  if(kind==='transformer3')return <><rect x="16" y="33" width="148" height="114" fill={fill}/>{[30,70,110,150].map(x=><path key={x} d={`M${x} 0V33 M${x} 147V180`}/>)}{[40,80,120].map(x=><g key={x}><circle cx={x} cy="76" r="17"/><circle cx={x} cy="99" r="17"/></g>)}{label(148,65,'Y',12)}{label(148,114,'Y',12)}</>;
  if(['power_supply','rectifier1','rectifier3'].includes(kind)){
    const three=kind==='rectifier3',w=three?140:120;
    return <><rect x="20" y="16" width={w-40} height={w-32} fill={fill}/><path d={`M20 ${w-16}L${w-20} 16`}/>{(three?[30,70,110]:[30,90]).map(y=><path key={y} d={`M0 ${y}H20`}/>)}{(three?[30,110]:[30,90]).map(y=><path key={y} d={`M${w-20} ${y}H${w}`}/>)}{label(three?44:39,39,three?'3~':'~',17)}<path d={`M${w-51} ${w-42}h23 M${w-51} ${w-37}h23`} strokeDasharray="0"/>{kind==='power_supply'&&<path d="M53 53L63 63 M57 49L67 59"/>}</>;
  }
  if(kind==='diode')return <><path d="M40 0V34 M40 65V100 M25 65H55"/><path d="M25 34H55L40 65Z" fill={fill}/></>;
  if(['resistor','rheostat','potentiometer','resistor_bank'].includes(kind)){
    const bank=kind==='resistor_bank',bottom=bank?140:100;
    const wiper=74-Math.max(0,Math.min(100,position))/100*48;
    return <><path d={`M40 0V24 M40 ${bottom-24}V${bottom}`}/><rect x="29" y="24" width="22" height={bottom-48} fill={fill}/>{kind==='rheostat'&&<path d="M15 78L65 23 M54 26L65 23L63 34"/>}{kind==='potentiometer'&&<path d={`M100 50H78V${wiper}H54 M62 ${wiper-6}L54 ${wiper}L62 ${wiper+6}`}/>}{bank&&<><path d="M29 52H51 M29 88H51 M63 110V30 M58 36L63 30L68 36"/>{label(68,125,String(position),10)}</>}</>;
  }
  if(kind==='capacitor')return <><path d="M40 0V45 M20 45H60 M20 55H60 M40 55V100"/></>;
  if(kind==='inductor')return <path d="M40 0V26c12 0 12 12 0 12c12 0 12 12 0 12c12 0 12 12 0 12c12 0 12 12 0 12V100"/>;
  if(kind==='terminal_block')return <><path d="M30 0V22 M30 38V60"/><circle cx="30" cy="30" r="8" fill={fill}/><path d="M24 36L36 24"/></>;
  if(kind==='connector')return <>{[30,70,110].map(y=><g key={y}><path d={`M0 ${y}H46 M54 ${y}H100 M46 ${y-7}V${y+7} M54 ${y-7}H61 M54 ${y+7}H61`}/><path d={`M46 ${y}H54`} strokeDasharray="2 2"/></g>)}<path d="M50 14V126" strokeDasharray="3 3"/></>;
  if(kind==='busbar')return <><path d="M20 15H140" strokeWidth="4"/>{[20,60,100,140].map(x=><path key={x} d={`M${x} 15V40`}/>)}</>;
  if(kind==='net_label'||kind==='offpage')return <><path d="M0 20H20"/><path d={kind==='net_label'?'M20 10H60L72 20L60 30H20Z':'M20 8H49V2L73 20L49 38V32H20Z'} fill={fill}/></>;
  if(kind==='earth')return <path d="M30 0V30 M10 30H50 M17 38H43 M24 46H36"/>;
  if(kind==='neutral')return <><path d="M30 0V22"/><circle cx="30" cy="36" r="14" fill={fill}/>{label(30,37,'N',15)}</>;
  if(kind==='induction1')return <><path d="M40 0V40 M80 0V40 M40 100V140 M80 100V140"/><path d="M96 70H120" strokeDasharray="7 3 1 3"/><circle cx="60" cy="70" r="36" fill={fill}/><MotorDirection x={60} y={70} direction={active?rotationDirection:0} moving={moving}/>{label(60,71,'M',25)}{label(60,94,'1~',13)}</>;
  if(kind==='ac_generator1')return <><path d="M0 70H30" strokeDasharray="7 3 1 3"/><path d="M40 140V85 M80 140V85"/><circle cx="60" cy="60" r="34" fill={fill}/>{label(60,51,'G',24)}{label(60,75,'1~',13)}</>;
  if(['solenoid','brake','clutch'].includes(kind))return <><path d="M40 0V30 M40 70V100"/><rect x="20" y="30" width="40" height="40" fill={active?'#e0f4e8':fill}/>{kind==='solenoid'?<path d="M20 70L60 30"/>:kind==='brake'?<><circle cx="40" cy="50" r="11"/><path d="M24 38V62 M56 38V62"/></>:<path d="M32 39V61 M48 39V61 M32 50H48"/>}</>;
  if(kind==='buzzer')return <><path d="M30 0V24 M30 56V80"/><path d="M20 28H36V52H20Z M36 28L48 20V60L36 52" fill={active?'#e0f4e8':fill}/>{active&&<path d="M53 30Q62 40 53 50"/>}</>;
  return null;
}
