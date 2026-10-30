import type { Device, DeviceKind, Point, Project, Wire } from './types';

export interface ClipboardFragment { devices: Device[]; wires: Wire[] }
export interface PasteResult { project: Project; deviceIds: string[]; wireIds: string[] }

const controls = new Set<DeviceKind>(['coil', 'timer_coil', 'contactor', 'thermal','switch','selector2','selector3','emergency_stop','limit_switch']);
const machines = new Set<DeviceKind>(['dc_motor', 'dc_generator', 'ac_generator','ac_generator1', 'synchronous']);
const contacts = new Set<DeviceKind>(['contact_no', 'contact_nc', 'contact_co', 'timer_no', 'timer_nc']);
const designation = (name: string) => name.trim().normalize('NFC').toLocaleUpperCase('vi');

/** A fragment never retains a connection to a device outside the copied selection. */
export function copySelection(project: Project, selectedIds: Iterable<string>): ClipboardFragment {
  const selected = new Set(selectedIds);
  const devices = project.devices.filter(device => selected.has(device.id));
  const actualIds = new Set(devices.map(device => device.id));
  return structuredClone({
    devices,
    wires: project.wires.filter(wire => actualIds.has(wire.from) && actualIds.has(wire.to)),
  });
}

function nextDesignation(name: string, used: Set<string>): string {
  const normalized = designation(name) || 'X';
  const match = /^(.*?)(\d+)$/.exec(normalized);
  let stem = match ? match[1] : normalized;
  let number = match ? BigInt(match[2]) + 1n : 1n;
  let result: string;
  do {
    // Incrementing a 120-digit suffix can exceed the persisted name limit.
    // Restart with a short designation and still skip every reserved name.
    if (String(number).length > 120) { stem = stem || 'X'; number = 1n; }
    const suffix = String(number++);
    result = `${stem.slice(0, Math.max(0, 120 - suffix.length))}${suffix}`;
  } while (used.has(result));
  used.add(result);
  return result;
}

function shifted(point: Point, offset: Point): Point {
  const result = {x: point.x + offset.x, y: point.y + offset.y};
  if (![result.x, result.y].every(value => Number.isFinite(value) && Math.abs(value) <= 10000)) {
    throw new Error('Vị trí dán vượt giới hạn bản vẽ (±10000).');
  }
  return result;
}

/** Paste is one immutable edit, so rejected pastes and undo cannot leave partial groups. */
export function pasteSelection(
  project: Project,
  fragment: ClipboardFragment,
  offset: Point,
  makeId: () => string = () => crypto.randomUUID(),
): PasteResult {
  if (!fragment.devices.length) throw new Error('Chưa có phần tử được sao chép.');
  if (project.devices.length + fragment.devices.length > 250) throw new Error('Tối đa 250 phần tử trên bản vẽ.');
  if (project.wires.length + fragment.wires.length > 750) throw new Error('Tối đa 750 đoạn dây trên bản vẽ.');
  const sourceIds = new Set(fragment.devices.map(device => device.id));
  if (sourceIds.size !== fragment.devices.length || fragment.wires.some(wire => !sourceIds.has(wire.from) || !sourceIds.has(wire.to))) {
    throw new Error('Nhóm sao chép chứa mã trùng hoặc dây nối ra ngoài nhóm.');
  }

  const usedIds = new Set([...project.devices, ...project.wires].map(item => item.id));
  const freshId = () => {
    for (let attempt = 0; attempt < 32; attempt++) {
      const id = makeId();
      if (id && !usedIds.has(id)) { usedIds.add(id); return id; }
    }
    throw new Error('Không tạo được mã mới cho nhóm sao chép.');
  };
  const ids = new Map(fragment.devices.map(device => [device.id, freshId()]));
  const usedNames = new Set(project.devices.map(device => designation(device.name)));
  // Names retained by auxiliary-only copies must also be reserved when pasting into
  // another drawing, otherwise a newly named owner could accidentally control them.
  for (const device of fragment.devices) usedNames.add(designation(device.name));
  const ownerNames = new Map<string, string>();
  for (const device of fragment.devices) {
    if (!controls.has(device.kind) && !machines.has(device.kind)) continue;
    const key = designation(device.name);
    if (!ownerNames.has(key)) ownerNames.set(key, nextDesignation(device.name, usedNames));
  }
  const copiedNets=new Map<string,string>();
  const netKey=(device:Device)=>`${device.kind==='neutral'?'neutral':'net'}:${designation(device.name)}`;
  if(fragment.devices.length>1)for(const device of fragment.devices){
    if(!['net_label','offpage','neutral'].includes(device.kind))continue;
    const key=netKey(device);if(!copiedNets.has(key))copiedNets.set(key,nextDesignation(device.name,usedNames));
  }
  const nameFor = (device: Device) => {
    const key = designation(device.name);
    if(device.kind==='earth')return device.name;
    if(['net_label','offpage','neutral'].includes(device.kind))return copiedNets.get(netKey(device))??device.name;
    if (controls.has(device.kind) || machines.has(device.kind)) return ownerNames.get(key)!;
    if (device.kind === 'field_winding' || contacts.has(device.kind)) {
      const owner = fragment.devices.find(candidate => {
        if (designation(candidate.name) !== key) return false;
        if (device.kind === 'field_winding') return machines.has(candidate.kind);
        if (device.kind === 'timer_no' || device.kind === 'timer_nc') return candidate.kind === 'timer_coil';
        return controls.has(candidate.kind);
      });
      return owner ? ownerNames.get(key)! : device.name;
    }
    return nextDesignation(device.name, usedNames);
  };

  const devices = fragment.devices.map(original => {
    const device = structuredClone(original);
    return {
      ...device,
      ...shifted(device, offset),
      id: ids.get(device.id)!,
      name: nameFor(device),
      enabled: ['push_no','limit_switch'].includes(device.kind) ? false : device.kind === 'push_nc' ? true : device.enabled,
    };
  });
  const wires = fragment.wires.map(original => {
    const wire = structuredClone(original);
    return {
      ...wire,
      id: freshId(),
      from: ids.get(wire.from)!,
      to: ids.get(wire.to)!,
      ...(wire.waypoints ? {waypoints: wire.waypoints.map(point => shifted(point, offset))} : {}),
    };
  });
  return {
    project: {...project, devices: [...project.devices, ...devices], wires: [...project.wires, ...wires]},
    deviceIds: devices.map(device => device.id),
    wireIds: wires.map(wire => wire.id),
  };
}
