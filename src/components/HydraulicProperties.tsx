import { getDefinition } from '../model/catalog';
import type { Device, DeviceState, Project } from '../model/types';
import { measurementText } from './SensorSymbol';

function HydraulicNumber({label,unit,value,min=0,max=1000000,step='any',onChange}:{label:string;unit?:string;value:number;min?:number;max?:number;step?:number|'any';onChange:(value:number)=>void}){
  return <label className="select-field"><span>{label}{unit?` (${unit})`:''}</span><input key={value} aria-label={label} type="number" min={min} max={max} step={step} defaultValue={value} onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur();}} onBlur={event=>{const next=event.currentTarget.valueAsNumber;if(Number.isFinite(next)&&next>=min&&next<=max){if(next!==value)onChange(next);}else event.currentTarget.value=String(value);}}/></label>;
}

export function HydraulicProperties({device,project,state,onChange}:{device:Device;project:Project;state?:DeviceState;onChange:(changes:Partial<Device>)=>void}){
  const definition=getDefinition(device.kind),kind=device.kind;
  const setParam=(key:string,value:number)=>onChange({params:{...device.params,[key]:value}});
  const parameter=(key:string,label?:string)=>{
    const item=definition.parameters.find(parameter=>parameter.key===key);
    if(!item)return null;
    return <HydraulicNumber key={key} label={label??item.label} unit={item.unit} value={device.params[key]??item.default} min={item.min} max={item.max} step={item.step} onChange={value=>setParam(key,value)}/>;
  };
  const sensor=['pressure_sensor','flow_sensor','level_sensor'].includes(kind),mode=device.params.valveMode??0;
  const result=(label:string,value:number|undefined,unit:string)=><div className="sensor-result"><span>{label}</span><output aria-label={label}>{value===undefined?'—':`${new Intl.NumberFormat('vi-VN',{maximumFractionDigits:2}).format(value)} ${unit}`}</output></div>;
  return <section className="hydraulic-properties">
    {kind==='water_tank'&&<>
      <label className="select-field"><span>Nguồn nước</span><select aria-label="Nguồn nước" value={device.params.infinite??0} onChange={event=>setParam('infinite',Number(event.target.value))}><option value="0">Bình chứa hữu hạn</option><option value="1">Nguồn / nơi xả vô tận</option></select></label>
      {!device.params.infinite&&<>{parameter('capacityL')}{parameter('initialLevel')}{result('Lượng nước',state?.tankVolumeL,'L')}{result('Mức nước',state?.levelPercent,'%')}</>}
      {parameter('pressureBar')}
    </>}
    {kind==='hydraulic_pump'&&<>{parameter('flowRate')}{parameter('pressureBar')}{result('Lưu lượng hiện tại',state?.flowRate,'L/min')}{result('Áp suất đầu ra',state?.pressureBar,'bar')}</>}
    {kind==='hydraulic_valve'&&<>
      <label className="select-field"><span>Loại van</span><select aria-label="Loại van" value={mode} onChange={event=>setParam('valveMode',Number(event.target.value))}><option value="0">Van khóa tay</option><option value="1">Van một chiều</option><option value="2">Van tiết lưu</option><option value="3">Van an toàn</option></select></label>
      {mode===2&&parameter('opening')}{mode===3&&parameter('setPressure')}{parameter('resistance')}
      {result('Lưu lượng hiện tại',state?.flowRate,'L/min')}
    </>}
    {kind==='hydraulic_solenoid'&&<>{parameter('coilVoltage')}{parameter('resistance')}{result('Lưu lượng hiện tại',state?.flowRate,'L/min')}</>}
    {kind==='hydraulic_filter'&&<>{parameter('resistance')}{parameter('clogging')}{result('Lưu lượng hiện tại',state?.flowRate,'L/min')}</>}
    {kind==='level_sensor'&&<label className="select-field"><span>Bình chứa cần đo</span><select aria-label="Bình chứa cần đo" value={device.tankId??''} onChange={event=>onChange({tankId:event.target.value||undefined})}><option value="">Chọn bình chứa…</option>{project.devices.filter(part=>part.kind==='water_tank').map(tank=><option key={tank.id} value={tank.id}>{tank.name}{tank.params.infinite?' · vô tận':''}</option>)}</select></label>}
    {sensor&&<>
      <div className="sensor-result" data-quality={state?.measurement?.quality??'unavailable'}><span>{state?.measurement?.label??definition.shortName}</span><output aria-label="Giá trị đo">{measurementText(state?.measurement)}</output></div>
      <label className="select-field"><span>Điều kiện tác động</span><select aria-label="Điều kiện tác động" value={device.params.comparison??0} onChange={event=>setParam('comparison',Number(event.target.value))}><option value="0">Lớn hơn hoặc bằng ngưỡng (≥)</option><option value="1">Nhỏ hơn hoặc bằng ngưỡng (≤)</option></select></label>
      {parameter('threshold')}{parameter('hysteresis')}
      <div className="sensor-output" aria-label="Ngõ ra cảm biến">{state?.sensorOutput?'Ngõ ra: tác động':'Ngõ ra: chưa tác động'}</div>
      {state?.measurement?.reason&&<p className="sensor-note">{state.measurement.reason}</p>}
    </>}
  </section>;
}
