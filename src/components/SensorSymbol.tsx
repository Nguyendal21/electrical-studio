import { getSensorFunction } from '../model/sensors';
import type { DeviceKind, SensorMeasurement } from '../model/types';

export function measurementText(measurement?:SensorMeasurement){
  if(!measurement)return '—';
  if(measurement.text)return measurement.text;
  if(measurement.value===null||!Number.isFinite(measurement.value))return '—';
  const magnitude=Math.abs(measurement.value);
  const value=magnitude>0&&(magnitude<.001||magnitude>=1e6)?measurement.value.toExponential(2).replace('.',','):new Intl.NumberFormat('vi-VN',{maximumSignificantDigits:5}).format(measurement.value);
  return `${value}${measurement.unit?` ${measurement.unit}`:''}`;
}

/** The symbol body is the pick area; its empty rectangular corners stay clear. */
export function SensorSymbol({kind,params,measurement}:{kind:DeviceKind;params:Record<string,number>;measurement?:SensorMeasurement}){
  const fn=getSensorFunction(kind,params),fill='var(--canvas, white)';
  const cx=kind==='speed_sensor'?45:kind==='power_sensor'||kind==='phase_sensor'?50:40;
  const cy=kind==='speed_sensor'?40:kind==='phase_sensor'?60:50;
  const reading=measurementText(measurement);
  const reason=measurement?.reason??fn.label;
  const label=(x:number,y:number,text:string,size:number,className?:string)=><text x={x} y={y} textAnchor="middle" dominantBaseline="middle" stroke="none" fill="currentColor" fontSize={size} fontFamily="Arial,sans-serif" className={className}>{text}</text>;
  return <g className="sensor-symbol" data-sensor-function={fn.value} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" fill="none">
    <title>{fn.label}: {measurement?`${reading}. ${reason}`:fn.unit}</title>
    {kind==='power_sensor'?<><path d="M0 20H30V28 M0 80H30V72 M100 20H70V28 M100 80H70V72"/><circle cx={cx} cy={cy} r="30" fill={fill}/></>
      :kind==='phase_sensor'?<><path d="M10 0V20L30 42 M50 0V33 M90 0V20L70 42"/><circle cx={cx} cy={cy} r="27" fill={fill}/></>
      :kind==='speed_sensor'?<><path d="M0 40H20" strokeDasharray="7 3 1 3"/><circle cx={cx} cy={cy} r="25" fill={fill}/></>
      :kind==='process_sensor'?<><path d="M40 0V25 M40 75V100"/><rect x="16" y="25" width="48" height="50" fill={fill}/><path d="M16 36L27 25"/></>
      :<><path d="M40 0V25 M40 75V100"/><circle cx={cx} cy={cy} r="25" fill={fill}/></>}
    {label(cx,cy-(measurement?8:0),fn.symbol,fn.symbol.length>3?14:20)}
    {measurement&&<g data-quality={measurement.quality} aria-label={`${fn.label}: ${reading}`}>
      {label(cx,cy+11,reading,reading.length>9?7.5:reading.length>7?9:11,'sensor-reading')}
    </g>}
  </g>;
}
