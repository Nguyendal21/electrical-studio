import { getSensorFunction, sensorFunctions } from '../model/sensors';
import type { Device, DeviceState } from '../model/types';
import { measurementText } from './SensorSymbol';

function SensorNumber({label,unit,value,min=-1000000,max=1000000,onChange}:{label:string;unit?:string;value:number;min?:number;max?:number;onChange:(value:number)=>void}){
  return <label className="select-field"><span>{label}{unit?` (${unit})`:''}</span><input key={value} aria-label={label} type="number" step="any" min={min} max={max} defaultValue={value} onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur();}} onBlur={event=>{const next=event.currentTarget.valueAsNumber;if(Number.isFinite(next)&&next>=min&&next<=max){if(next!==value)onChange(next);}else event.currentTarget.value=String(value);}}/></label>;
}

export function SensorProperties({device,state,onChange}:{device:Device;state?:DeviceState;onChange:(changes:Partial<Device>)=>void}){
  const fn=getSensorFunction(device.kind,device.params),functions=sensorFunctions(device.kind),process=device.kind==='process_sensor';
  const setParam=(key:string,value:number)=>onChange({params:{...device.params,[key]:value}});
  const measured=state?.measurement?.label===fn.label?state.measurement:undefined;
  return <section className="sensor-properties">
    {functions.length>1&&<label className="select-field"><span>Đại lượng đo</span><select aria-label="Đại lượng đo" value={fn.value} onChange={event=>{
      const sensorFunction=Number(event.target.value);
      onChange({params:{...device.params,sensorFunction,...(process?{inputValue:0,threshold:sensorFunction===4?1:50,hysteresis:sensorFunction===4?0:1}:{} )}});
    }}>{functions.map(item=><option key={item.value} value={item.value}>{item.label}{item.unit?` (${item.unit})`:''}</option>)}</select></label>}
    <div className="sensor-result" data-quality={measured?.quality??'unavailable'}>
      <span>{fn.label}</span><output aria-label="Giá trị đo">{measurementText(measured)}</output>
      <small>{measured?.quality==='simulated'?(process?'Giá trị nhập để thử mạch':'Trạng thái mô phỏng'):measured?.quality==='measured'?'Theo mô hình hiện tại':'Chưa có số đo'}</small>
    </div>
    {measured?.reason&&<p className="sensor-note">{measured.reason}</p>}
    {!measured&&<p className="sensor-note">Chạy mô phỏng để đọc giá trị.</p>}
    {process&&<>
      {fn.value===4?<label className="select-field"><span>Trạng thái vật thể</span><select aria-label="Trạng thái vật thể" value={(device.params.inputValue??0)>=1?1:0} onChange={event=>setParam('inputValue',Number(event.target.value))}><option value="0">Không có vật</option><option value="1">Có vật</option></select></label>:<SensorNumber label="Giá trị đầu vào" unit={fn.unit} value={device.params.inputValue??0} onChange={value=>setParam('inputValue',value)}/>}
      <label className="select-field"><span>Điều kiện tác động</span><select aria-label="Điều kiện tác động" value={device.params.comparison??0} onChange={event=>setParam('comparison',Number(event.target.value))}><option value="0">Lớn hơn hoặc bằng ngưỡng (≥)</option><option value="1">Nhỏ hơn hoặc bằng ngưỡng (≤)</option></select></label>
      <SensorNumber label="Ngưỡng tác động" unit={fn.unit} value={device.params.threshold??50} onChange={value=>setParam('threshold',value)}/>
      <SensorNumber label="Độ trễ hồi phục" unit={fn.unit} min={0} value={device.params.hysteresis??1} onChange={value=>setParam('hysteresis',value)}/>
      <p className="sensor-note">Nhập giá trị để thử mạch. A1–A2 cấp nguồn; các tiếp điểm cùng tên đổi trạng thái khi đạt ngưỡng. Độ trễ hồi phục giữ tiếp điểm ổn định quanh ngưỡng.</p>
      <div className="sensor-output" aria-label="Ngõ ra cảm biến">{state?.sensorOutput?'Ngõ ra: tác động':'Ngõ ra: chưa tác động'}</div>
    </>}
  </section>;
}
