import { getDefinition } from '../model/catalog';
import type { DeviceKind, DeviceState } from '../model/types';
import { measurementText } from './SensorSymbol';

export { isHydraulicKind } from '../model/hydraulicCatalog';

/** External leads use catalogue coordinates, including after node rotation. */
export function HydraulicSymbol({kind,params,state,closed=false}:{kind:DeviceKind;params:Record<string,number>;state?:DeviceState;closed?:boolean}){
  const definition=getDefinition(kind),{width,height}=definition.size,canvas='var(--canvas, white)';
  const terminal=(id:string)=>{
    const port=definition.ports.find(item=>item.id===id)!;
    return {x:port.side==='left'?0:port.side==='right'?width:width*port.offset/100,y:port.side==='top'?0:port.side==='bottom'?height:height*port.offset/100};
  };
  const lead=(id:string,x:number,y:number,shaft=false)=>{const port=terminal(id);return <path key={id} d={`M${port.x} ${port.y}L${x} ${y}`} strokeDasharray={shaft?'7 3 1 3':undefined}/>;};
  const label=(x:number,y:number,text:string,size=12,backdrop=false)=><text x={x} y={y} textAnchor="middle" dominantBaseline="middle" stroke={backdrop?canvas:'none'} strokeWidth={backdrop?3:undefined} paintOrder={backdrop?'stroke':undefined} fill="currentColor" fontSize={size} fontFamily="Arial,sans-serif" className="hydraulic-reading">{text}</text>;
  const mode=Math.round(params.valveMode??0);
  let body;
  if(kind==='hydraulic_pump')body=<>
    {lead('IN',28,60)}{lead('OUT',92,60)}{lead('shaft',60,92,true)}
    <circle cx="60" cy="60" r="32" fill={canvas}/><path d="M49 46L76 60L49 74Z" fill="currentColor"/>
  </>;
  else if(kind==='water_tank'){
    const infinite=!!params.infinite,level=Math.max(0,Math.min(100,state?.levelPercent??params.initialLevel??50)),surface=128-level*.94;
    body=<g className="water-tank" data-level-percent={level} data-infinite={infinite}>
      <rect x="20" y="16" width="80" height="114" fill={canvas} stroke="none"/>
      <rect className="tank-water" x="21" y={surface} width="78" height={128-surface} fill="#cceefa" stroke="none"/>
      {level>0&&<path d={`M22 ${surface}H98`} stroke="#55a6c2"/>}
      <path d="M20 16V130H100V16"/>{lead('IN',20,40)}{lead('OUT',100,120)}
      {label(60,82,infinite?'∞':`${Math.round(level)}%`,infinite?27:17,true)}
    </g>;
  }else if(kind==='hydraulic_valve'){
    const open=state?.contactClosed??closed;
    body=<g className="hydraulic-valve" data-valve-mode={mode} data-open={open}>
      {lead('IN',25,40)}{lead('OUT',75,40)}
      {mode===1?<><path d="M35 27V53 M35 40H75"/><circle cx="42" cy="40" r="7" fill={canvas}/><path d="M61 23H78L73 18 M78 23L73 28"/></>
        :mode===3?<><rect x="25" y="24" width="50" height="32" fill={canvas}/><path d="M35 48L63 32L59 41 M63 32H53 M50 24V18l-5 -3 10 -4 -10 -4 5 -3"/></>
        :<><path d="M25 24L75 56V24L25 56Z" fill={canvas}/>{mode===2?<path d="M28 66L72 14H62 M72 14V24"/>:<><path d={open?'M50 40V14H70':'M50 40V14 M40 14H60'}/>{!open&&<path d="M46 34L54 46 M54 34L46 46"/>}</>}</>}
    </g>;
  }else if(kind==='hydraulic_solenoid'){
    const open=!!state?.coilEnergized;
    body=<g data-valve-open={open}>
      {lead('IN',30,60)}{lead('OUT',90,60)}
      <path d="M30 0V18H45 M90 0V18H75"/><rect x="45" y="7" width="30" height="22" fill={canvas}/><path d="M45 29L75 7 M60 29V40"/>
      <rect x="30" y="40" width="60" height="40" fill={canvas}/>
      {open?<path d="M39 60H81L73 53 M81 60L73 67"/>:<path d="M30 60H47V50 M47 60V70 M90 60H73V50 M73 60V70"/>}
    </g>;
  }else if(kind==='hydraulic_filter')body=<>
    {lead('IN',24,40)}{lead('OUT',76,40)}<path d="M24 40L50 14L76 40L50 66Z" fill={canvas}/><path d="M37 27L63 53" strokeDasharray="2 4"/>
  </>;
  else if(kind==='pipe_junction')body=<circle cx="6" cy="6" r="4" fill="currentColor"/>;
  else{
    const measured=state?.measurement;
    const compact=measured?.value!==undefined&&measured.value!==null&&Number.isFinite(measured.value)?{...measured,value:Number(measured.value.toPrecision(3))}:measured;
    const cx=kind==='flow_sensor'?50:40,reading=measurementText(compact),symbol=kind==='pressure_sensor'?'P':kind==='flow_sensor'?'Q':'L';
    body=<g className="hydraulic-sensor" data-sensor-output={!!state?.sensorOutput}>
      {kind==='pressure_sensor'&&lead('P',40,66)}
      {kind==='flow_sensor'&&<>{lead('IN',24,40)}{lead('OUT',76,40)}</>}
      <circle cx={cx} cy="40" r="26" fill={canvas}/>
      {label(cx,30,symbol,18)}{label(cx,51,reading,reading.length>9?7.5:reading.length>7?9:11)}
      <title>{state?.measurement?`${state.measurement.label}: ${reading}`:definition.name}</title>
    </g>;
  }
  return <g className="hydraulic-symbol" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" fill="none">{body}</g>;
}
