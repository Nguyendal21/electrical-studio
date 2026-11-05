import type { Device, Project, SimulationState } from './types';

/** Resolve mechanical exclusion independently of device/wire iteration order.
 * Only contacts held in the previous simulation tick get priority. Intermediate
 * relay-settling passes must not create a winner from simultaneous commands. */
export function resolveInterlocks(project:Project,previous:SimulationState,requested:(device:Device)=>boolean):Map<string,{closed:boolean;blocked:boolean}>{
  const contacts=project.devices.filter(device=>device.kind==='interlocked_contact');
  const neighbours=new Map(contacts.map(device=>[device.id,new Set<string>()]));
  for(const wire of project.wires){
    if(wire.fromPort!=='lock'||wire.toPort!=='lock'||wire.from===wire.to||!neighbours.has(wire.from)||!neighbours.has(wire.to))continue;
    neighbours.get(wire.from)!.add(wire.to);neighbours.get(wire.to)!.add(wire.from);
  }
  const commands=new Set(contacts.filter(requested).map(device=>device.id));
  const held=new Set(contacts.filter(device=>commands.has(device.id)&&previous.devices[device.id]?.contactClosed).map(device=>device.id));
  // Editing a link between two already closed contacts cannot preserve an
  // impossible double closure: both release until the commands are resolved.
  const retained=new Set([...held].filter(id=>![...neighbours.get(id)!].some(other=>held.has(other))));
  const eligible=new Set([...commands].filter(id=>!held.has(id)&&![...neighbours.get(id)!].some(other=>retained.has(other))));
  const closed=new Set([...retained,...[...eligible].filter(id=>![...neighbours.get(id)!].some(other=>eligible.has(other)))]);
  return new Map(contacts.map(device=>[device.id,{closed:closed.has(device.id),blocked:commands.has(device.id)&&!closed.has(device.id)}]));
}
