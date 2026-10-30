import { getDefinition } from './catalog';
import type { Device, DeviceState, Project, SimulationState, ValidationIssue, Wire } from './types';

/** Unit-potential continuity solver. Values are internal logic, never engineering measurements. */
type Complex={r:number;i:number};
type Branch={id:string;a:string;b:string;g:number;device?:string;role?:string;wire?:Wire;acOnly?:boolean;diode?:boolean};
const pin=(device:string,port:string)=>`${device}\u0000${port}`;
const magnitude=(z:Complex)=>Math.hypot(z.r,z.i);
const difference=(a:Complex,b:Complex):Complex=>({r:a.r-b.r,i:a.i-b.i});
const sum=(a:Complex,b:Complex):Complex=>({r:a.r+b.r,i:a.i+b.i});
const zero:Complex={r:0,i:0};
const motors=new Set(['induction','induction1','synchronous','dc_motor','stepper']);
const converters=new Set(['transformer1','transformer3','power_supply','rectifier1','rectifier3']);
const acSources=new Set(['ac1','ac3','ac_generator','ac_generator1','transformer1','transformer3','step_driver']);
const sources=new Set(['dc','ac1','ac3','ac_generator','ac_generator1','dc_generator','emy','step_driver',...converters]);
const excitationMachines=new Set(['dc_motor','dc_generator','ac_generator','ac_generator1','synchronous']);
const manualControls=new Set(['switch','selector2','selector3','emergency_stop','limit_switch']);
const coilKinds=new Set(['coil','contactor','timer_coil']);
const contactKinds=new Set(['contact_no','contact_nc','contact_co','timer_no','timer_nc']);
/** The visible designation is also the electrical component linkage key. */
export const designation=(device:Device)=>device.name.trim().normalize('NFC').toLocaleUpperCase('vi');
const blank=():DeviceState=>({energized:false,voltage:0,current:0,power:0,rpm:0,frequency:0,tripped:false,status:'Chưa chạy',heat:0});

export function createInitialState(project:Project):SimulationState{return {time:0,devices:Object.fromEntries(project.devices.map(device=>[device.id,blank()])),wires:Object.fromEntries(project.wires.map(wire=>[wire.id,{energized:false,powered:false,current:0,voltage:0}])),events:[]};}

export function validateConnection(project:Project,wire:Wire):string|null{
  const a=project.devices.find(device=>device.id===wire.from),b=project.devices.find(device=>device.id===wire.to);
  if(!a||!b)return 'Đầu dây phải thuộc phần tử có trên bản vẽ.';
  const ap=getDefinition(a.kind).ports.find(port=>port.id===wire.fromPort),bp=getDefinition(b.kind).ports.find(port=>port.id===wire.toPort);
  if(!ap||!bp)return 'Đầu cực không tồn tại.';
  if(wire.from===wire.to&&wire.fromPort===wire.toPort)return 'Hai đầu dây không thể là cùng một đầu cực.';
  if(ap.type!==bp.type)return 'Dây điện và trục cơ khí là hai loại kết nối riêng.';
  const others=project.wires.filter(item=>item.id!==wire.id);
  if(others.some(item=>(item.from===wire.from&&item.fromPort===wire.fromPort&&item.to===wire.to&&item.toPort===wire.toPort)||(item.to===wire.from&&item.toPort===wire.fromPort&&item.from===wire.to&&item.fromPort===wire.toPort)))return 'Hai đầu cực này đã có dây nối.';
  if(ap.type==='shaft'){
    if(ap.direction===bp.direction)return 'Trục ra cần nối với trục vào.';
    const input=ap.direction==='in'?a.id:b.id;
    if(others.some(item=>(item.to===input&&item.toPort==='shaft')||(item.from===input&&item.fromPort==='shaft')))return 'Một trục vào chỉ nhận một máy dẫn động.';
    if(a.id===b.id)return 'Không nối trục cơ vào chính phần tử đó.';
  }
  return null;
}

export function validateProject(project:Project):ValidationIssue[]{
  const issues:ValidationIssue[]=[];
  for(const device of project.devices){
    let definition;try{definition=getDefinition(device.kind);}catch{issues.push({level:'error',deviceId:device.id,message:'Loại phần tử không được hỗ trợ.'});continue;}
    for(const port of definition.ports.filter(item=>item.type==='power'))if(!project.wires.some(wire=>(wire.from===device.id&&wire.fromPort===port.id)||(wire.to===device.id&&wire.toPort===port.id))){
      if(!['contactor','thermal','breaker','breaker1','junction','contact_co'].includes(device.kind))issues.push({level:'warning',deviceId:device.id,message:`${device.name}: đầu ${port.label} chưa nối.`});
    }
    if(excitationMachines.has(device.kind)&&!project.devices.some(other=>other.kind==='field_winding'&&designation(device)&&designation(other)===designation(device)))issues.push({level:'warning',deviceId:device.id,message:`${device.name}: chưa có cuộn kích từ cùng tên.`});
    if(contactKinds.has(device.kind)&&!project.devices.some(other=>(device.kind.startsWith('timer_')?other.kind==='timer_coil':coilKinds.has(other.kind)||other.kind==='thermal'||manualControls.has(other.kind))&&designation(device)&&designation(other)===designation(device)))issues.push({level:'warning',deviceId:device.id,message:`${device.name}: chưa có ${device.kind.startsWith('timer_')?'cuộn thời gian':'cuộn hút hoặc cơ cấu điều khiển'} cùng tên.`});
    if(coilKinds.has(device.kind)&&project.devices.filter(other=>coilKinds.has(other.kind)&&designation(other)===designation(device)).length>1)issues.push({level:'warning',deviceId:device.id,message:`${device.name}: có nhiều cuộn hút cùng tên; tiếp điểm tác động khi ít nhất một cuộn có điện.`});
  }
  if(issues.some(issue=>issue.level==='error'))return issues;
  for(const wire of project.wires){const error=validateConnection(project,wire);if(error)issues.push({level:'error',message:error});}
  return [...new Map(issues.map(issue=>[`${issue.deviceId}:${issue.message}`,issue])).values()];
}

class Union{
  parent=new Map<string,string>();
  find(x:string):string{const p=this.parent.get(x);if(!p){this.parent.set(x,x);return x;}if(p===x)return x;const root=this.find(p);this.parent.set(x,root);return root;}
  join(a:string,b:string){this.parent.set(this.find(a),this.find(b));}
}

type SourceLink={a:string;b:string;value:Complex};
// Each source floats independently. Its poles constrain a difference, not an
// absolute potential shared with all other sources in the drawing.
class PotentialGroups{
  parent=new Map<string,string>();offset=new Map<string,Complex>();
  find(x:string):{root:string;offset:Complex}{
    const p=this.parent.get(x);if(!p){this.parent.set(x,x);this.offset.set(x,zero);return {root:x,offset:zero};}
    if(p===x)return {root:x,offset:zero};
    const result=this.find(p),offset=sum(this.offset.get(x)!,result.offset);this.parent.set(x,result.root);this.offset.set(x,offset);return {root:result.root,offset};
  }
  join(a:string,b:string,value:Complex):boolean{
    const ap=this.find(a),bp=this.find(b);
    if(ap.root===bp.root)return magnitude(difference(difference(ap.offset,bp.offset),value))<1e-7;
    this.parent.set(ap.root,bp.root);this.offset.set(ap.root,sum(difference(value,ap.offset),bp.offset));return true;
  }
}
function sourceLinks(fixed:Map<string,Complex>,devices:Device[]):SourceLink[]{
  const links:SourceLink[]=[];
  for(const device of devices){
    const groups=device.kind==='step_driver'?[['A+','A-'],['B+','B-']]:[getDefinition(device.kind).ports.filter(port=>fixed.has(pin(device.id,port.id))).map(port=>port.id)];
    for(const group of groups){const reference=group.at(-1);if(!reference||!fixed.has(pin(device.id,reference)))continue;for(const port of group.slice(0,-1))links.push({a:pin(device.id,port),b:pin(device.id,reference),value:difference(fixed.get(pin(device.id,port))!,fixed.get(pin(device.id,reference))!)});}
  }
  return links;
}
function solve(branches:Branch[],constraints:SourceLink[]){
  const groups=new PotentialGroups();for(const link of constraints)groups.join(link.a,link.b,link.value);
  const adjacency=new Map<string,{to:string;g:number}[]>();
  const rhsValues=new Map<string,Complex>();
  for(const branch of branches){
    const a=groups.find(branch.a),b=groups.find(branch.b);if(a.root===b.root)continue;
    adjacency.set(a.root,[...adjacency.get(a.root)??[],{to:b.root,g:branch.g}]);adjacency.set(b.root,[...adjacency.get(b.root)??[],{to:a.root,g:branch.g}]);
    const d=difference(a.offset,b.offset),scaled={r:d.r*branch.g,i:d.i*branch.g};rhsValues.set(a.root,difference(rhsValues.get(a.root)??zero,scaled));rhsValues.set(b.root,sum(rhsValues.get(b.root)??zero,scaled));
  }
  const grounded=new Set<string>(),seen=new Set<string>();
  for(const root of adjacency.keys())if(!seen.has(root)){grounded.add(root);const queue=[root];seen.add(root);for(let j=0;j<queue.length;j++)for(const edge of adjacency.get(queue[j])??[])if(!seen.has(edge.to)){seen.add(edge.to);queue.push(edge.to);}}
  const unknown=[...adjacency.keys()].filter(key=>!grounded.has(key)),indices=new Map(unknown.map((key,index)=>[key,index]));
  const diagonal=unknown.map(key=>(adjacency.get(key)??[]).reduce((sum,edge)=>sum+edge.g,0));
  const multiply=(x:number[])=>unknown.map((key,index)=>diagonal[index]*x[index]-(adjacency.get(key)??[]).reduce((sum,edge)=>sum+(indices.has(edge.to)?edge.g*x[indices.get(edge.to)!]:0),0));
  function component(axis:'r'|'i'){
    const rhs=unknown.map(key=>rhsValues.get(key)?.[axis]??0);
    const x=unknown.map(()=>0),r=[...rhs],z=r.map((v,i)=>v/(diagonal[i]||1));let d=[...z],rz=r.reduce((sum,v,i)=>sum+v*z[i],0);
    for(let iteration=0;iteration<Math.min(3000,unknown.length*3+30)&&Math.abs(rz)>1e-22;iteration++){
      const ad=multiply(d),den=d.reduce((sum,v,i)=>sum+v*ad[i],0);if(Math.abs(den)<1e-28)break;
      const alpha=rz/den;for(let i=0;i<x.length;i++){x[i]+=alpha*d[i];r[i]-=alpha*ad[i];z[i]=r[i]/(diagonal[i]||1);}
      const next=r.reduce((sum,v,i)=>sum+v*z[i],0),beta=next/rz;d=z.map((v,i)=>v+beta*d[i]);rz=next;
    }
    return x;
  }
  const real=component('r'),imaginary=component('i');
  const voltages=new Map<string,Complex>();unknown.forEach((key,index)=>voltages.set(key,{r:real[index],i:imaginary[index]}));
  const potential=(key:string)=>{const result=groups.find(key);return sum(voltages.get(result.root)??zero,result.offset);};
  const voltage=(a:string,b:string)=>difference(potential(a),potential(b));
  return {voltage,active:(branch:Branch)=>magnitude(voltage(branch.a,branch.b))*branch.g>1e-5};
}

/** Separate AC continuity from steady DC: capacitors cannot invent a DC return.
 * Diodes use a small off conductance internally to determine their bias. These
 * unit potentials are only logic; they are never published as measurements. */
function solveCircuit(branches:Branch[],constraints:SourceLink[],acIds:Set<string>){
  const ac=solve(branches,constraints.map(link=>({...link,value:acIds.has(link.a.split('\u0000')[0])?link.value:zero})));
  const dcConstraints=constraints.map(link=>({...link,value:acIds.has(link.a.split('\u0000')[0])?zero:link.value}));
  const dcBranches=branches.filter(branch=>!branch.acOnly),blocked=new Set<string>();
  let dc=solve(dcBranches,dcConstraints);
  for(let pass=0;pass<24;pass++){
    let changed=false;
    for(const branch of dcBranches.filter(branch=>branch.diode)){
      const drop=dc.voltage(branch.a,branch.b).r;
      if(drop < -1e-7&&!blocked.has(branch.id)){blocked.add(branch.id);changed=true;}
      else if(drop > 1e-7&&blocked.has(branch.id)){blocked.delete(branch.id);changed=true;}
    }
    if(!changed)break;
    dc=solve(dcBranches.map(branch=>blocked.has(branch.id)?{...branch,g:1e-9}:branch),dcConstraints);
  }
  return {ac,dc,voltage:(a:string,b:string)=>sum(dc.voltage(a,b),ac.voltage(a,b)),active:(branch:Branch)=>ac.active(branch)||(!branch.acOnly&&!blocked.has(branch.id)&&dc.active(branch))};
}

/** Timers advance once per simulation tick, even while contact feedback settles. */
function timerState(device:Device,input:boolean,previous:DeviceState|undefined,dt:number){
  const delay=Math.max(0,device.params.delaySeconds??3),offDelay=device.params.timerMode===1;
  if(offDelay){
    if(input)return {timerOutput:true,timerElapsed:0,timerPending:false};
    if(!previous?.timerOutput)return {timerOutput:false,timerElapsed:0,timerPending:false};
    const elapsed=Math.min(delay,(previous.timerElapsed??0)+dt),pending=elapsed+1e-9<delay;
    return {timerOutput:pending,timerElapsed:elapsed,timerPending:pending};
  }
  if(!input)return {timerOutput:false,timerElapsed:0,timerPending:false};
  const elapsed=Math.min(delay,(previous?.coilEnergized?previous.timerElapsed??0:0)+dt);
  return {timerOutput:elapsed+1e-9>=delay,timerElapsed:elapsed,timerPending:elapsed+1e-9<delay};
}

export function stepSimulation(project:Project,previous:SimulationState,dt:number):SimulationState{
  if(!Number.isFinite(dt)||dt<0)return previous;
  const elapsed=Math.min(dt,1),next=createInitialState(project);next.time=previous.time+elapsed;next.events=[...previous.events];
  const errors=validateProject(project).filter(issue=>issue.level==='error');
  if(errors.length){for(const error of errors)if(!next.events.some(event=>event.message===error.message))next.events.push({time:next.time,level:'error',message:error.message});return next;}
  const byId=new Map(project.devices.map(device=>[device.id,device]));
  const isPower=(wire:Wire)=>getDefinition(byId.get(wire.from)!.kind).ports.find(port=>port.id===wire.fromPort)?.type==='power';
  const electrical=project.wires.filter(isPower);
  const mechanical=project.wires.filter(wire=>!isPower(wire)).map(wire=>getDefinition(byId.get(wire.from)!.kind).ports.find(port=>port.id===wire.fromPort)?.direction==='out'?{id:wire.id,from:wire.from,to:wire.to}:{id:wire.id,from:wire.to,to:wire.from});
  const coils=project.devices.filter(device=>coilKinds.has(device.kind));
  const converted=new Map(project.devices.filter(device=>converters.has(device.kind)).map(device=>[device.id,false]));
  const acIds=new Set(project.devices.filter(device=>acSources.has(device.kind)).map(device=>device.id));
  const coil=new Map(coils.map(device=>[device.id,!!previous.devices[device.id]?.coilEnergized]));
  const timerOutput=new Map(coils.filter(device=>device.kind==='timer_coil').map(device=>[device.id,!!previous.devices[device.id]?.timerOutput]));
  const auxiliary=new Map(project.devices.filter(device=>device.kind==='emy'||device.kind==='step_driver').map(device=>[device.id,!!previous.devices[device.id]?.coilEnergized]));
  const fieldReady=new Map(project.devices.filter(device=>excitationMachines.has(device.kind)).map(device=>[device.id,!!previous.devices[device.id]?.fieldEnergized]));
  const rotating=new Map(project.devices.filter(device=>motors.has(device.kind)||device.kind==='diesel').map(device=>[device.id,device.kind==='diesel'?device.enabled:!!previous.devices[device.id]?.energized]));
  const driven=(id:string)=>mechanical.some(wire=>wire.to===id&&rotating.get(wire.from));
  const matchingCoils=(device:Device)=>designation(device)?coils.filter(other=>designation(other)===designation(device)):[];
  const manualActive=(device:Device)=>!device.kind.startsWith('timer_')&&project.devices.some(other=>manualControls.has(other.kind)&&designation(device)&&designation(other)===designation(device)&&(other.kind.startsWith('selector')?(other.params.position??0)===(device.params.actuationPosition??1):other.enabled));
  const controlActive=(device:Device)=>manualActive(device)||matchingCoils(device).some(other=>device.kind.startsWith('timer_')?(other.kind==='timer_coil'&&timerOutput.get(other.id)):coil.get(other.id))||(!device.kind.startsWith('timer_')&&!!designation(device)&&project.devices.some(other=>other.kind==='thermal'&&designation(other)===designation(device)&&!other.enabled));
  const contactClosed=(device:Device)=>device.kind==='contact_co'||(device.kind.endsWith('_nc')?!controlActive(device):controlActive(device));
  let branches:Branch[]=[],fixed=new Map<string,Complex>(),constraints:SourceLink[]=[],logic=solveCircuit([],[],acIds),union=new Union(),activeSourceIds=new Set<string>();
  let shorted=false,stable=false;
  let sourceDomains: (device:Device)=>string[]=()=>[];
  let isDC: (device:Device)=>boolean=()=>true;
  let fieldActive: (device:Device)=>boolean=()=>false;
  let excitation: (device:Device)=>boolean=()=>false;
  let motorActive: (device:Device)=>boolean=()=>false;
  for(let pass=0;pass<32;pass++){
    branches=[];fixed=new Map();union=new Union();activeSourceIds=new Set();shorted=false;
    const add=(device:Device,a:string,b:string,role:string,conductive=false)=>{
      const branch:Branch={id:`${device.id}:${role}`,a:pin(device.id,a),b:pin(device.id,b),g:conductive?100:1,device:device.id,role,acOnly:device.kind==='capacitor',diode:device.kind==='diode'};branches.push(branch);if(conductive)union.join(branch.a,branch.b);
    };
    for(const wire of electrical){const branch={id:wire.id,a:pin(wire.from,wire.fromPort),b:pin(wire.to,wire.toPort),g:100,wire};branches.push(branch);union.join(branch.a,branch.b);}
    const namedNets=new Map<string,string>();
    for(const device of project.devices){
      if(!['net_label','offpage','earth','neutral'].includes(device.kind))continue;
      const port=device.kind==='earth'?'PE':device.kind==='neutral'?'N':'P';
      const family=['net_label','offpage'].includes(device.kind)?'net':device.kind;
      const key=`${family}:${designation(device)}`,endpoint=pin(device.id,port),first=namedNets.get(key);
      if(first){branches.push({id:`net:${device.id}`,a:first,b:endpoint,g:100});union.join(first,endpoint);}else namedNets.set(key,endpoint);
    }
    for(const device of project.devices){
      // `enabled` is the physical position of hand controls (or an old fuse fault),
      // never a permission to run motors, loads, fields or automatic contacts.
      const enabled=['breaker','breaker1','thermal','fuse','push_no','push_nc'].includes(device.kind)?device.enabled:true;
      if(['breaker','contactor','thermal'].includes(device.kind)){
        const closed=device.kind==='thermal'||(enabled&&(device.kind!=='contactor'||coil.get(device.id)));
        if(closed)for(const [a,b] of [['1','2'],['3','4'],['5','6']])add(device,a,b,`${a}-${b}`,true);
        if(device.kind==='contactor'){
          if(enabled)add(device,'A1','A2','coil');
          if(enabled&&coil.get(device.id))add(device,'13','14','aux-no',true);else add(device,'21','22','aux-nc',true);
        }
        if(device.kind==='thermal'&&enabled)add(device,'95','96','thermal-nc',true);
      }else if(device.kind==='breaker1'){if(enabled)add(device,'1','2','contact',true);}
      else if(device.kind==='coil'||device.kind==='timer_coil'){add(device,'A1','A2','coil');}
      else if(device.kind==='contact_co'){add(device,'11',controlActive(device)?'14':'12','contact',true);}
      else if(contactKinds.has(device.kind)){if(contactClosed(device)){const nc=device.kind.endsWith('_nc');add(device,nc?'21':'13',nc?'22':'14','contact',true);}}
      else if(device.kind==='field_winding'){if(enabled)add(device,'F1','F2','field');}
      else if(['fuse','push_no','push_nc'].includes(device.kind)){if(enabled)add(device,'1','2','contact',true);}
      else if(device.kind==='lamp'){if(enabled)add(device,'1','2','load');}
      else if(device.kind==='dc_motor'){if(enabled)add(device,'+','-','load');}
      else if(device.kind==='induction'||device.kind==='synchronous'){if(enabled)for(const letter of ['U','V','W'])add(device,`${letter}1`,`${letter}2`,letter);}
      else if(device.kind==='stepper'){if(enabled){add(device,'A+','A-','A');add(device,'B+','B-','B');}}
      else if(device.kind==='step_driver'){if(enabled)add(device,'+','-','supply');}
      else if(device.kind==='emy'){if(enabled)add(device,'F1','F2','field');}
      else if(['resistor','rheostat','resistor_bank','capacitor','inductor','buzzer'].includes(device.kind))add(device,'1','2','load');
      else if(device.kind==='diode')add(device,'A','K','load');
      else if(device.kind==='potentiometer'){add(device,'1','2','upper');add(device,'2','3','lower');}
      else if(device.kind==='terminal_block')add(device,'1','2','terminal',true);
      else if(device.kind==='connector')for(const [a,b] of [['1','2'],['3','4'],['5','6']])add(device,a,b,`${a}-${b}`,true);
      else if(device.kind==='busbar')for(const port of ['2','3','4'])add(device,'1',port,`bus-${port}`,true);
      else if(['solenoid','brake','clutch'].includes(device.kind))add(device,'A1','A2','load');
      else if(device.kind==='induction1'){add(device,'U1','U2','main');add(device,'Z1','Z2','auxiliary');}
      else if(device.kind==='transformer1')add(device,'P1','P2','input');
      else if(device.kind==='power_supply')add(device,'L','N','input');
      else if(device.kind==='rectifier1')add(device,'~1','~2','input');
      else if(device.kind==='transformer3')for(const port of ['P1','P2','P3'])add(device,port,'PN',`input-${port}`);
      else if(device.kind==='rectifier3')for(const [a,b] of [['L1','L2'],['L2','L3'],['L3','L1']])add(device,a,b,`input-${a}`);
    }
    const set=(id:string,port:string,value:Complex)=>{fixed.set(pin(id,port),value);};
    for(const device of project.devices){
      if(!sources.has(device.kind))continue;
      if(['ac_generator','ac_generator1','dc_generator','emy'].includes(device.kind)&&!driven(device.id))continue;
      if(['ac_generator','ac_generator1','dc_generator'].includes(device.kind)&&!fieldReady.get(device.id))continue;
      if(['emy','step_driver'].includes(device.kind)&&!auxiliary.get(device.id))continue;
      if(converters.has(device.kind)&&!converted.get(device.id))continue;
      activeSourceIds.add(device.id);
      if(['ac3','ac_generator','transformer3'].includes(device.kind)){
        if(device.kind==='transformer3'){set(device.id,'SN',zero);set(device.id,'S1',{r:1,i:0});set(device.id,'S2',{r:-.5,i:-Math.sqrt(3)/2});set(device.id,'S3',{r:-.5,i:Math.sqrt(3)/2});continue;}
        set(device.id,'N',zero);set(device.id,'L1',{r:1,i:0});set(device.id,'L2',{r:-.5,i:-Math.sqrt(3)/2});set(device.id,'L3',{r:-.5,i:Math.sqrt(3)/2});
      }else if(device.kind==='transformer1'){set(device.id,'S1',{r:1,i:0});set(device.id,'S2',zero);}
      else if(device.kind==='ac1'||device.kind==='ac_generator1'){set(device.id,'L',{r:1,i:0});set(device.id,'N',zero);}
      else if(device.kind==='step_driver'){set(device.id,'A+',{r:1,i:0});set(device.id,'A-',zero);set(device.id,'B+',{r:1,i:0});set(device.id,'B-',zero);}
      else{set(device.id,'+',{r:1,i:0});set(device.id,'-',zero);}
    }
    constraints=sourceLinks(fixed,project.devices);const potentials=new PotentialGroups();
    for(const branch of branches.filter(item=>item.g===100))potentials.join(branch.a,branch.b,zero);
    for(const link of constraints)if(!potentials.join(link.a,link.b,link.value))shorted=true;
    if(shorted)break;
    logic=solveCircuit(branches,constraints,acIds);
    const fullConnectivity=new Union();for(const branch of branches)fullConnectivity.join(branch.a,branch.b);
    sourceDomains=(device:Device)=>{
      const groups=new Set(getDefinition(device.kind).ports.filter(port=>port.type==='power').map(port=>fullConnectivity.find(pin(device.id,port.id))));
      return project.devices.filter(source=>activeSourceIds.has(source.id)&&getDefinition(source.kind).ports.some(port=>port.type==='power'&&groups.has(fullConnectivity.find(pin(source.id,port.id))))).map(source=>source.kind);
    };
    const branchActive=(device:Device,role:string)=>branches.some(branch=>branch.device===device.id&&branch.role===role&&logic.active(branch));
    // A shared return does not turn a DC field supply into AC. Test the AC
    // contribution across this load with every DC source set to zero.
    const acLogic=logic.ac;
    isDC=(device:Device)=>{const field=device.kind==='field_winding'||device.kind==='emy';return magnitude(acLogic.voltage(pin(device.id,field?'F1':'+'),pin(device.id,field?'F2':'-')))<1e-5;};
    fieldActive=(device:Device)=>branchActive(device,'field')&&isDC(device);
    const sameEnds=(field:Device,a:string,b:string)=>{
      const f1=union.find(pin(field.id,'F1')),f2=union.find(pin(field.id,'F2'));
      return (f1===union.find(a)&&f2===union.find(b))||(f1===union.find(b)&&f2===union.find(a));
    };
    const seriesCache=new Map<string,boolean>();
    const inSeries=(field:Device,machine:Device)=>{
      const key=`${field.id}:${machine.id}`;if(seriesCache.has(key))return seriesCache.get(key)!;
      const without=solveCircuit(branches.filter(branch=>branch.device!==field.id),constraints,acIds);
      let result=false;
      if(machine.kind==='dc_motor'){
        const armature=branches.find(branch=>branch.device===machine.id&&branch.role==='load');
        result=!!armature&&logic.active(armature)&&!without.active(armature);
      }else if(machine.kind==='dc_generator'){
        const connected=branches.filter(branch=>branch.wire&&(branch.wire.from===machine.id||branch.wire.to===machine.id));
        result=connected.some(branch=>logic.active(branch))&&!connected.some(branch=>without.active(branch));
      }
      seriesCache.set(key,result);return result;
    };
    excitation=(machine:Device)=>{
      const fields=project.devices.filter(field=>field.kind==='field_winding'&&designation(machine)&&designation(field)===designation(machine)&&fieldActive(field));
      if(!fields.length)return false;
      if(machine.kind==='synchronous'||machine.kind==='ac_generator'||machine.kind==='ac_generator1')return true;
      const positive=pin(machine.id,'+'),negative=pin(machine.id,'-');
      if((machine.fieldMode??'independent')==='independent')return fields.some(field=>!sameEnds(field,positive,negative)&&!inSeries(field,machine));
      if(machine.fieldMode==='shunt')return fields.some(field=>sameEnds(field,positive,negative));
      if(machine.fieldMode==='series')return fields.some(field=>inSeries(field,machine));
      const seriesFields=fields.filter(field=>field.windingRole==='series'&&inSeries(field,machine));
      return seriesFields.some(series=>fields.some(shunt=>shunt.id!==series.id&&(shunt.windingRole??'shunt')==='shunt'&&(
        sameEnds(shunt,positive,negative)||
        ['F1','F2'].some(port=>{const shared=union.find(pin(series.id,port));const outside=pin(series.id,port==='F1'?'F2':'F1');return shared===union.find(positive)?sameEnds(shunt,outside,negative):shared===union.find(negative)?sameEnds(shunt,positive,outside):false;})
      )));
    };
    motorActive=(device:Device)=>{
      if(device.kind==='dc_motor')return branchActive(device,'load')&&isDC(device)&&excitation(device);
      if(device.kind==='induction1'){
        const main=branches.find(branch=>branch.device===device.id&&branch.role==='main')!;
        const auxiliaryBranch=branches.find(branch=>branch.device===device.id&&branch.role==='auxiliary')!;
        if(!logic.ac.active(main)||!logic.ac.active(auxiliaryBranch))return false;
        // Require a capacitor in the auxiliary winding path, not a capacitor
        // placed across the source or in the common feed of both windings.
        return project.devices.filter(part=>part.kind==='capacitor').some(capacitor=>{
          const without=solveCircuit(branches.filter(branch=>branch.device!==capacitor.id),constraints,acIds);
          return !without.ac.active(auxiliaryBranch)&&without.ac.active(main);
        });
      }
      if(device.kind==='induction'||device.kind==='synchronous'){
        const winding=branches.filter(branch=>branch.device===device.id&&['U','V','W'].includes(branch.role??''));
        const v=winding.map(branch=>logic.voltage(branch.a,branch.b));
        const separated=v.length===3&&Math.abs(v[0].r*v[1].i-v[0].i*v[1].r)>.01;
        return winding.length===3&&winding.every(branch=>logic.active(branch))&&separated&&sourceDomains(device).some(kind=>kind==='ac3'||kind==='ac_generator'||kind==='transformer3')&&(device.kind!=='synchronous'||excitation(device));
      }
      if(device.kind==='stepper')return branchActive(device,'A')&&branchActive(device,'B')&&project.devices.some(driver=>driver.kind==='step_driver'&&activeSourceIds.has(driver.id)&&sourceDomains(device).includes('step_driver')&&(driver.params.pulseRate??1)>0);
      return false;
    };
    let changed=false;
    const update=(map:Map<string,boolean>,id:string,value:boolean)=>{if(value!==map.get(id)){map.set(id,value);changed=true;}};
    for(const device of project.devices){
      if(converters.has(device.kind)){
        const inputs=branches.filter(branch=>branch.device===device.id&&branch.role?.startsWith('input'));
        const voltages=inputs.map(branch=>logic.ac.voltage(branch.a,branch.b));
        const three=['transformer3','rectifier3'].includes(device.kind);
        const valid=inputs.length===(three?3:1)&&inputs.every(branch=>logic.ac.active(branch))&&(!three||Math.abs(voltages[0].r*voltages[1].i-voltages[0].i*voltages[1].r)>.01);
        update(converted,device.id,valid);
      }
    }
    // Rebuild derived supplies from external power on every tick, then settle
    // them before changing relay feedback. Otherwise the first, unpowered
    // transformer pass drops a self-holding coil when Start is released.
    // Keeping converted=false at the beginning also prevents an isolated
    // converter output from preserving a fictitious supply to its own input.
    if(changed)continue;
    for(const device of project.devices){
      if(coilKinds.has(device.kind)){
        const active=branchActive(device,'coil');update(coil,device.id,active);
        if(device.kind==='timer_coil')update(timerOutput,device.id,timerState(device,active,previous.devices[device.id],elapsed).timerOutput);
      }
      if(device.kind==='step_driver'||device.kind==='emy')update(auxiliary,device.id,branchActive(device,device.kind==='emy'?'field':'supply')&&isDC(device));
      if(excitationMachines.has(device.kind))update(fieldReady,device.id,excitation(device));
      if(motors.has(device.kind))update(rotating,device.id,motorActive(device));
    }
    if(!changed){stable=true;break;}
  }
  if(shorted||!stable){
    const message=shorted?'Phát hiện nối tắt giữa các cực nguồn. Mở mạch và sửa dây trước khi chạy.':'Mạch điều khiển tự đóng/ngắt liên tục. Kiểm tra tiếp điểm hồi tiếp.';
    if(next.events.at(-1)?.message!==message)next.events.push({time:next.time,level:'error',message});
    for(const device of project.devices)next.devices[device.id].status=shorted?'Nối tắt nguồn':'Mạch chưa ổn định';
    next.events=next.events.slice(-80);return next;
  }
  const activeBranches=branches.filter(branch=>logic.active(branch));
  // Only ideal conducting paths spread a source pole's indication: wires,
  // closed contacts, terminal blocks, busbars and matching net labels. Loads
  // still require a complete circuit; N/PE/reference poles are not live merely
  // because they are connected. Return wires carrying current remain colored.
  const liveRoots=new Set([...fixed].filter(([,value])=>magnitude(value)>1e-7).map(([endpoint])=>union.find(endpoint)));
  const powered=(branch:Branch)=>logic.active(branch)||liveRoots.has(union.find(branch.a));
  for(const wire of electrical){const branch=branches.find(item=>item.wire?.id===wire.id)!;const active=logic.active(branch);const drop=logic.voltage(branch.a,branch.b);next.wires[wire.id]={energized:active,powered:powered(branch),current:0,voltage:0,direction:drop.r<0?-1:1};}
  for(const device of project.devices){
    const state=next.devices[device.id],own=activeBranches.filter(branch=>branch.device===device.id),domain=sourceDomains(device);
    state.energized=own.length>0;
    state.powered=branches.some(branch=>branch.device===device.id&&branch.g===100&&powered(branch));
    state.status=state.energized?'Mạch kín':'Mạch hở';
    if(excitationMachines.has(device.kind))state.fieldEnergized=!!fieldReady.get(device.id);
    if(device.kind==='diesel'){state.energized=device.enabled;state.status=device.enabled?'Trục đang quay':'Trục dừng';state.rpm=device.enabled?1:0;}
    else if(manualControls.has(device.kind)){
      const actuated=device.kind.startsWith('selector')?(device.params.position??0)!==0:device.enabled;
      state.energized=actuated;state.coilEnergized=actuated;state.tripped=device.kind==='emergency_stop'&&actuated;
      state.status=device.kind.startsWith('selector')?`Vị trí ${device.params.position??0}`:device.kind==='emergency_stop'?(actuated?'Dừng khẩn đang giữ':'Dừng khẩn đã nhả'):actuated?'Đang tác động':'Vị trí nghỉ';
    }
    else if(coilKinds.has(device.kind)){
      state.coilEnergized=!!coil.get(device.id);state.energized=state.coilEnergized;
      state.status=state.coilEnergized?'Cuộn hút có điện':'Cuộn hút mất điện';
      if(device.kind==='timer_coil'){
        Object.assign(state,timerState(device,state.coilEnergized,previous.devices[device.id],elapsed));
        state.status=state.timerPending?(device.params.timerMode===1?'Đang trễ nhả':'Đang trễ đóng'):state.timerOutput?'Rơle đã tác động':'Rơle đã nhả';
      }
    }else if(contactKinds.has(device.kind)){
      state.contactClosed=contactClosed(device);state.coilEnergized=controlActive(device);
      state.status=device.kind==='contact_co'?`Tiếp điểm 11–${state.coilEnergized?'14':'12'} đóng`:state.contactClosed?(state.energized?'Tiếp điểm đóng · có dòng':'Tiếp điểm đóng'):'Tiếp điểm mở';
    }else if(device.kind==='field_winding'){
      state.energized=fieldActive(device);state.status=state.energized?'Cuộn kích từ có điện':own.length?'Cuộn kích từ cần nguồn DC':'Cuộn kích từ mất điện';
    }else if(device.kind==='induction'||device.kind==='synchronous'){
      state.energized=motorActive(device);
      state.status=state.energized?'Động cơ đang quay':device.kind==='synchronous'&&!state.fieldEnergized?'Thiếu kích từ cùng tên':own.length?'Thiếu pha / đấu dây chưa đúng':'Các cuộn chưa khép mạch';
      const root=(port:string)=>union.find(pin(device.id,port));
      state.connection=root('U2')===root('V2')&&root('V2')===root('W2')?'Y · Đấu sao':root('U1')===root('W2')&&root('V1')===root('U2')&&root('W1')===root('V2')?'Δ · Tam giác':'Chưa đấu Y / Δ';
      if(state.energized){
        // L1/L2/L3 at U/V/W defines the forward direction. Swapping two
        // phases reverses the winding sequence, in both star and delta.
        const u=logic.ac.voltage(pin(device.id,'U1'),pin(device.id,'U2'));
        const v=logic.ac.voltage(pin(device.id,'V1'),pin(device.id,'V2'));
        state.rpm=u.r*v.i-u.i*v.r<0?1:-1;
        state.status=state.rpm<0?'Quay ngược':'Quay thuận';
      }
    }else if(device.kind==='dc_motor'){
      state.energized=motorActive(device);
      if(!isDC(device))state.status='Phần ứng cần nguồn DC';
      else if(!state.fieldEnergized)state.status='Thiếu kích từ / đấu kích từ chưa đúng';
      else if(state.energized){
        const field=project.devices.find(other=>other.kind==='field_winding'&&designation(other)===designation(device)&&fieldActive(other));
        const fieldSign=field?logic.voltage(pin(field.id,'F1'),pin(field.id,'F2')).r:1;
        const armature=logic.voltage(pin(device.id,'+'),pin(device.id,'-')).r;
        state.rpm=armature*fieldSign<0?-1:1;state.status=state.rpm<0?'Quay ngược':'Quay thuận';
      }else state.status='Phần ứng chưa khép mạch';
    }else if(device.kind==='stepper'){
      state.energized=motorActive(device);state.status=own.length===2?'Giữ vị trí / chưa có xung':'Cần nối đủ hai cuộn vào driver';
      if(state.energized){
        const a=logic.ac.voltage(pin(device.id,'A+'),pin(device.id,'A-')).r;
        const b=logic.ac.voltage(pin(device.id,'B+'),pin(device.id,'B-')).r;
        // The qualitative driver assumes an A-then-B forward sequence.
        // Reversing one winding or exchanging the two channels reverses it.
        const aEnds=['A+','A-'].map(port=>union.find(pin(device.id,port)));
        const swapped=project.devices.some(driver=>driver.kind==='step_driver'&&activeSourceIds.has(driver.id)&&['B+','B-'].every(port=>aEnds.includes(union.find(pin(driver.id,port)))));
        state.rpm=(a*b<0?-1:1)*(swapped?-1:1);
        state.status=state.rpm<0?'Chạy bước ngược':'Chạy bước thuận';
      }
    }else if(device.kind==='induction1'){
      state.energized=motorActive(device);state.status='Cần nguồn AC và tụ nối tiếp cuộn phụ';
      if(state.energized){
        // Capacitor phase shift is not calculated in this state model. The
        // relative main/auxiliary polarity gives the chosen winding direction.
        const main=logic.ac.voltage(pin(device.id,'U1'),pin(device.id,'U2'));
        const auxiliary=logic.ac.voltage(pin(device.id,'Z1'),pin(device.id,'Z2'));
        state.rpm=main.r*auxiliary.r+main.i*auxiliary.i<0?-1:1;
        state.status=state.rpm<0?'Quay ngược':'Quay thuận';
      }
    }else if(device.kind==='lamp')state.status=state.energized?'Đèn sáng':'Đèn tắt';
    else if(device.kind==='buzzer')state.status=state.energized?'Còi đang tác động':'Còi tắt';
    else if(['solenoid','brake','clutch'].includes(device.kind))state.status=state.energized?'Cuộn điện từ có điện':'Cuộn điện từ mất điện';
    else if(device.kind==='capacitor')state.status=state.energized?'Nhánh AC có dòng':'Không dẫn DC liên tục / mạch hở';
    else if(device.kind==='diode')state.status=state.energized?'Diode đang dẫn':'Diode bị khóa / mạch hở';
    else if(device.kind==='thermal'){state.tripped=!device.enabled;state.energized=own.length>0;state.status=device.enabled?'Rơle nhiệt đã reset':'Rơle nhiệt đã tác động';}
    else if(sources.has(device.kind)){
      state.energized=activeSourceIds.has(device.id);
      state.status=state.energized?'Nguồn sẵn sàng':['ac_generator','ac_generator1','dc_generator'].includes(device.kind)?(!driven(device.id)?'Chưa có trục dẫn động':'Thiếu kích từ cùng tên'):device.kind==='emy'?'Cần trục quay và mạch F1–F2 kín':device.kind==='step_driver'?'Nguồn driver chưa kín':'Nguồn đang ngắt';
      if(device.kind==='emy'||device.kind==='step_driver')state.coilEnergized=!!auxiliary.get(device.id);
      if(converters.has(device.kind)){state.coilEnergized=!!converted.get(device.id);state.status=state.energized?'Đầu vào kín · đầu ra sẵn sàng':'Đầu vào cần nguồn AC đủ cực';}
    }else if(['junction','net_label','offpage','earth','neutral'].includes(device.kind)){state.energized=project.wires.some(wire=>(wire.from===device.id||wire.to===device.id)&&next.wires[wire.id]?.energized);state.powered=getDefinition(device.kind).ports.some(port=>liveRoots.has(union.find(pin(device.id,port.id))))||state.energized;state.status=state.energized?'Nhánh có dòng':state.powered?'Đã cấp điện':'Điểm nối';}
    else if(['breaker','breaker1','fuse','push_no','push_nc'].includes(device.kind)){state.contactClosed=device.enabled;state.status=device.enabled?(state.energized?'Tiếp điểm đóng · có dòng':'Tiếp điểm đóng'):'Tiếp điểm mở';}
  }
  for(const wire of mechanical)next.wires[wire.id]={energized:!!next.devices[wire.from]?.energized,powered:false,current:0,voltage:0};
  next.events=next.events.slice(-80);return next;
}

