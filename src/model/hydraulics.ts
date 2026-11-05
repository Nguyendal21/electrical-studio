import { getDefinition } from './catalog';
import type { Device, DeviceState, Project, SimulationState, WireState } from './types';

/** Quasi-steady water model. Pressures are gauge bar, flows L/min, volumes L.
 * Pumps have a linear Q/H curve and run at configured duty whenever their shaft
 * turns. Pipe loss is a fixed linear 0.001 bar/(L/min)/m. There is no elevation,
 * inertia, compressibility, pipe storage, cavitation or motor torque calculation.
 * Reservoir inlet/outlet and pump/check/relief edges are directional. */
type Edge = { id: string; a: string; b: string; resistance: number; head: number; forward: boolean; device?: string; wire?: string };
type Tank = { device: Device; capacity: number; volume: number; infinite: boolean; pressure: number; configuration: string };
export interface HydraulicResult { devices: Record<string, Partial<DeviceState>>; wires: Record<string, Partial<WireState>> }
const pin = (device: string, port: string) => `${device}\u0000${port}`;
const hydraulicKinds = new Set(['hydraulic_pump', 'water_tank', 'hydraulic_valve', 'hydraulic_solenoid', 'hydraulic_filter', 'pipe_junction', 'pressure_sensor', 'flow_sensor', 'level_sensor']);
const epsilon = 1e-8;
const finite = (value: number | undefined, fallback: number) => Number.isFinite(value) ? value! : fallback;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const clean = (value: number) => Math.abs(value) < epsilon ? 0 : value;
const designation = (device: Device) => device.name.trim().normalize('NFC').toLocaleUpperCase('vi');

function connect(graph: Map<string, string[]>, a: string, b: string) { graph.set(a, [...graph.get(a) ?? [], b]); }
function reachable(starts: string[], graph: Map<string, string[]>) {
  const visited = new Set(starts), queue = [...starts];
  for (let i = 0; i < queue.length; i++) for (const next of graph.get(queue[i]) ?? []) if (!visited.has(next)) { visited.add(next); queue.push(next); }
  return visited;
}

/** Sparse positive-definite pressure solve, one reference per isolated component.
 * The pump head is an edge source, not an arbitrarily grounded pressure node. */
function linearPressures(edges: Edge[], fixed: Map<string, number>): Map<string, number> {
  const adjacency = new Map<string, { to: string; g: number }[]>(), rhs = new Map<string, number>();
  for (const edge of edges) {
    if (edge.a === edge.b) continue;
    const g = 1 / edge.resistance;
    adjacency.set(edge.a, [...adjacency.get(edge.a) ?? [], { to: edge.b, g }]);
    adjacency.set(edge.b, [...adjacency.get(edge.b) ?? [], { to: edge.a, g }]);
    rhs.set(edge.a, (rhs.get(edge.a) ?? 0) - g * edge.head);
    rhs.set(edge.b, (rhs.get(edge.b) ?? 0) + g * edge.head);
  }
  const anchors = new Map(fixed), visited = new Set<string>();
  for (const start of adjacency.keys()) if (!visited.has(start)) {
    const queue = [start]; visited.add(start);
    for (let i = 0; i < queue.length; i++) for (const edge of adjacency.get(queue[i]) ?? []) if (!visited.has(edge.to)) { visited.add(edge.to); queue.push(edge.to); }
    if (!queue.some(node => anchors.has(node))) anchors.set(start, 0);
  }
  const unknown = [...adjacency.keys()].filter(key => !anchors.has(key)), index = new Map(unknown.map((key, i) => [key, i]));
  const diagonal = unknown.map(key => (adjacency.get(key) ?? []).reduce((sum, edge) => sum + edge.g, 0));
  const b = unknown.map(key => (rhs.get(key) ?? 0) + (adjacency.get(key) ?? []).reduce((sum, edge) => sum + edge.g * (anchors.get(edge.to) ?? 0), 0));
  const multiply = (x: number[]) => unknown.map((key, i) => diagonal[i] * x[i] - (adjacency.get(key) ?? []).reduce((sum, edge) => sum + (index.has(edge.to) ? edge.g * x[index.get(edge.to)!] : 0), 0));
  const x = unknown.map(() => 0), r = [...b], z = r.map((value, i) => value / diagonal[i]);
  let d = [...z], rz = r.reduce((sum, value, i) => sum + value * z[i], 0);
  for (let iteration = 0; iteration < Math.min(4000, unknown.length * 5 + 40) && Math.abs(rz) > 1e-22; iteration++) {
    const ad = multiply(d), denominator = d.reduce((sum, value, i) => sum + value * ad[i], 0);
    if (Math.abs(denominator) < 1e-30) break;
    const alpha = rz / denominator;
    for (let i = 0; i < x.length; i++) { x[i] += alpha * d[i]; r[i] -= alpha * ad[i]; z[i] = r[i] / diagonal[i]; }
    const next = r.reduce((sum, value, i) => sum + value * z[i], 0), beta = next / rz;
    d = z.map((value, i) => value + beta * d[i]); rz = next;
  }
  unknown.forEach((key, i) => anchors.set(key, clean(x[i])));
  return anchors;
}

/** Active-set solve for one-way elements. Reopening is essential when another
 * valve closing changes the bias of a previously blocked branch. */
function pressures(edges: Edge[], fixed: Map<string, number>) {
  const blocked = new Set<string>();
  let pressure = linearPressures(edges, fixed);
  for (let pass = 0; pass < Math.max(32, edges.length * 4); pass++) {
    const reverse = edges.filter(edge => edge.forward && !blocked.has(edge.id) && (pressure.get(edge.a) ?? 0) - (pressure.get(edge.b) ?? 0) + edge.head < -epsilon);
    if (reverse.length) reverse.forEach(edge => blocked.add(edge.id));
    else {
      const reopen = edges.find(edge => blocked.has(edge.id) && (pressure.get(edge.a) ?? 0) - (pressure.get(edge.b) ?? 0) + edge.head > epsilon);
      if (!reopen) break;
      blocked.delete(reopen.id);
    }
    pressure = linearPressures(edges.filter(edge => !blocked.has(edge.id)), fixed);
  }
  const flow = new Map(edges.map(edge => {
    const value = blocked.has(edge.id) ? 0 : ((pressure.get(edge.a) ?? 0) - (pressure.get(edge.b) ?? 0) + edge.head) / edge.resistance;
    return [edge.id, clean(edge.forward ? Math.max(0, value) : value)];
  }));
  return { pressure, flow };
}

function thresholdOutput(device: Device, value: number | null, old: DeviceState | undefined, configuration: string): boolean {
  if (value === null || !Number.isFinite(value)) return false;
  const threshold = finite(device.params.threshold, 0), hysteresis = Math.max(0, finite(device.params.hysteresis, 0));
  const held = old?.hydraulicConfiguration === configuration && old.sensorOutput;
  return device.params.comparison === 1 ? value <= threshold + (held ? hysteresis : 0) : value >= threshold - (held ? hysteresis : 0);
}

/** Compute only hydraulic patches. The caller owns the electrical/control loop.
 * Call with dt=0 while settling interlocks; integrate a positive dt exactly once.
 * An uninitialized tank starts from its configured level. Changing capacity,
 * initial level or infinite mode resets that tank, not unrelated reservoirs. */
export function stepHydraulics(project: Project, previous: SimulationState, electrical: SimulationState, dt: number): HydraulicResult {
  const devices = project.devices.filter(device => hydraulicKinds.has(device.kind)), byId = new Map(project.devices.map(device => [device.id, device]));
  const result: HydraulicResult = { devices: {}, wires: {} };
  if (!devices.length) return result;
  const fluidPort = (id: string, port: string) => { const device = byId.get(id); return device && getDefinition(device.kind).ports.some(item => item.id === port && item.type === 'fluid'); };
  const pipes = project.wires.filter(wire => fluidPort(wire.from, wire.fromPort) && fluidPort(wire.to, wire.toPort));
  const tanks: Tank[] = devices.filter(device => device.kind === 'water_tank').map(device => {
    const capacity = Math.max(.001, finite(device.params.capacityL, 1000)), initial = clamp(finite(device.params.initialLevel, 50), 0, 100), infinite = device.params.infinite === 1;
    const configuration = `${capacity}:${initial}:${infinite}`, old = previous.devices[device.id];
    const volume = !infinite && old?.hydraulicConfiguration === configuration && Number.isFinite(old.tankVolumeL) ? clamp(old.tankVolumeL!, 0, capacity) : capacity * initial / 100;
    return { device, capacity, volume, infinite, configuration, pressure: Math.max(0, finite(device.params.pressureBar, 0)) };
  });
  const tanksById = new Map(tanks.map(tank => [tank.device.id, tank]));
  const driven = (device: Device) => project.wires.some(wire => {
    const other = wire.from === device.id && wire.fromPort === 'shaft' ? wire.to : wire.to === device.id && wire.toPort === 'shaft' ? wire.from : null;
    if (!other) return false;
    const from = byId.get(other), port = wire.from === other ? wire.fromPort : wire.toPort;
    return !!from && getDefinition(from.kind).ports.some(item => item.id === port && item.type === 'shaft' && item.direction === 'out') && Math.abs(electrical.devices[other]?.rpm ?? 0) > epsilon;
  });
  const running = new Set(devices.filter(device => device.kind === 'hydraulic_pump' && driven(device)).map(device => device.id));
  const solenoidOpen = (device: Device) => !!electrical.devices[device.id]?.coilEnergized;

  function network() {
    const edges: Edge[] = [], fixed = new Map<string, number>(), wetGraph = new Map<string, string[]>();
    const add = (edge: Edge, wet = true) => { edges.push(edge); if (wet) { connect(wetGraph, edge.a, edge.b); if (!edge.forward) connect(wetGraph, edge.b, edge.a); } };
    for (const wire of pipes) add({ id: `wire:${wire.id}`, a: pin(wire.from, wire.fromPort), b: pin(wire.to, wire.toPort), resistance: .001 * Math.max(.001, finite(wire.length, 1)), head: 0, forward: false, wire: wire.id });
    for (const device of devices) {
      const resistance = Math.max(.000001, finite(device.params.resistance, .01)), a = pin(device.id, 'IN'), b = pin(device.id, 'OUT');
      const edge: Edge = { id: `device:${device.id}`, a, b, resistance, head: 0, forward: false, device: device.id };
      if (device.kind === 'hydraulic_pump' && running.has(device.id) && finite(device.params.flowRate, 60) > 0) {
        const head = Math.max(.001, finite(device.params.pressureBar, 3)), flow = finite(device.params.flowRate, 60);
        // Added provisionally to propagate water availability through series pumps.
        add({ ...edge, resistance: head / flow, head, forward: true });
      } else if (device.kind === 'hydraulic_filter' && device.params.clogging !== 100) {
        const opening = 1 - clamp(finite(device.params.clogging, 0), 0, 100) / 100;
        if (opening > 0) add({ ...edge, resistance: resistance / opening ** 2 });
      } else if (device.kind === 'hydraulic_solenoid' && solenoidOpen(device)) add(edge);
      else if (device.kind === 'flow_sensor') add({ ...edge, resistance: .0001 });
      else if (device.kind === 'hydraulic_valve') {
        const mode = device.params.valveMode ?? 0;
        if (mode === 0 && device.enabled) add(edge);
        else if (mode === 1) add({ ...edge, forward: true });
        else if (mode === 2) { const opening = clamp(finite(device.params.opening, 100), 0, 100) / 100; if (opening > 0) add({ ...edge, resistance: resistance / opening ** 2 }); }
        else if (mode === 3) add({ ...edge, forward: true, head: -Math.max(0, finite(device.params.setPressure, 3)) });
      }
    }
    const wet = reachable(tanks.filter(tank => tank.infinite || tank.volume > epsilon).map(tank => pin(tank.device.id, 'OUT')), wetGraph);
    // A rotating dry pump does not create pressure or invent water.
    const activeEdges = edges.filter(edge => !edge.device || byId.get(edge.device)?.kind !== 'hydraulic_pump' || wet.has(edge.a));
    for (const tank of tanks) {
      const reservoir = `reservoir:${tank.device.id}`; fixed.set(reservoir, tank.pressure);
      if (tank.infinite || tank.volume > epsilon) activeEdges.push({ id: `tank-out:${tank.device.id}`, a: reservoir, b: pin(tank.device.id, 'OUT'), resistance: .0001, head: 0, forward: true });
      activeEdges.push({ id: `tank-in:${tank.device.id}`, a: pin(tank.device.id, 'IN'), b: reservoir, resistance: .0001, head: 0, forward: true });
    }
    // A full reservoir may still receive the same water it is delivering (for
    // example a recirculation loop). Block only inlets that would add inventory.
    // Re-solve after each set of closures because branches share pump capacity.
    let allowed = activeEdges, solved = pressures(allowed, fixed);
    for (let pass = 0; pass < tanks.length; pass++) {
      const overflowing = new Set(tanks.filter(tank => !tank.infinite && tank.volume >= tank.capacity - epsilon && (solved.flow.get(`tank-in:${tank.device.id}`) ?? 0) - (solved.flow.get(`tank-out:${tank.device.id}`) ?? 0) > epsilon).map(tank => `tank-in:${tank.device.id}`));
      if (!overflowing.size) break;
      allowed = allowed.filter(edge => !overflowing.has(edge.id));
      solved = pressures(allowed, fixed);
    }
    return { ...solved, edges: allowed, wet };
  }

  let solved = network();
  const seconds = Math.max(0, finite(dt, 0));
  let remaining = seconds;
  // Stop exactly at tank boundaries, then re-solve with that inlet/outlet blocked.
  // This conserves volume even if a frame spans depletion or a full destination.
  for (let pass = 0; remaining > epsilon && pass < Math.max(32, tanks.length * 8); pass++) {
    const rates = new Map(tanks.filter(tank => !tank.infinite).map(tank => [tank.device.id, ((solved.flow.get(`tank-in:${tank.device.id}`) ?? 0) - (solved.flow.get(`tank-out:${tank.device.id}`) ?? 0)) / 60]));
    let interval = remaining;
    for (const tank of tanks) {
      const rate = rates.get(tank.device.id) ?? 0;
      if (rate > epsilon) interval = Math.min(interval, (tank.capacity - tank.volume) / rate);
      else if (rate < -epsilon) interval = Math.min(interval, -tank.volume / rate);
    }
    if (!(interval > epsilon)) break;
    for (const tank of tanks) if (!tank.infinite) tank.volume = clamp(tank.volume + (rates.get(tank.device.id) ?? 0) * interval, 0, tank.capacity);
    remaining -= interval;
    solved = network();
  }

  const { pressure, flow, wet } = solved;
  for (const wire of pipes) {
    const a = pin(wire.from, wire.fromPort), b = pin(wire.to, wire.toPort), rate = flow.get(`wire:${wire.id}`) ?? 0, gauge = Math.max(pressure.get(a) ?? 0, pressure.get(b) ?? 0);
    result.wires[wire.id] = { flowRate: rate, pressureBar: clean(gauge), energized: Math.abs(rate) > epsilon, powered: wet.has(a) && (gauge > epsilon || Math.abs(rate) > epsilon), direction: rate < 0 ? -1 : 1 };
  }
  for (const device of devices) {
    const rate = flow.get(`device:${device.id}`) ?? 0, inlet = pressure.get(pin(device.id, 'IN')) ?? 0, outlet = pressure.get(pin(device.id, 'OUT')) ?? 0;
    const state: Partial<DeviceState> = { energized: Math.abs(rate) > epsilon, powered: wet.has(pin(device.id, 'IN')) && Math.max(inlet, outlet) > epsilon, flowRate: clean(rate), pressureBar: clean(Math.max(inlet, outlet)), status: Math.abs(rate) > epsilon ? 'Nước đang chảy' : 'Không có dòng nước' };
    if (device.kind === 'water_tank') {
      const tank = tanksById.get(device.id)!;
      Object.assign(state, { energized: tank.infinite || tank.volume > epsilon, powered: tank.pressure > 0, tankVolumeL: tank.volume, levelPercent: tank.infinite ? 100 : tank.volume / tank.capacity * 100, pressureBar: tank.pressure, flowRate: (flow.get(`tank-in:${device.id}`) ?? 0) - (flow.get(`tank-out:${device.id}`) ?? 0), hydraulicConfiguration: tank.configuration, status: tank.infinite ? 'Nguồn / nơi xả vô tận' : tank.volume <= epsilon ? 'Bình đã cạn' : tank.volume >= tank.capacity - epsilon ? 'Bình đã đầy' : `${tank.volume.toFixed(1)} / ${tank.capacity} L` });
    } else if (device.kind === 'hydraulic_pump') {
      const rotating = running.has(device.id), supplied = wet.has(pin(device.id, 'IN'));
      Object.assign(state, { energized: rotating && supplied, powered: rotating && supplied, pressureBar: clean(outlet), rpm: rotating ? 1 : 0, status: !rotating ? 'Chưa có trục dẫn động' : !supplied ? 'Bơm chạy khô · không có nước đầu hút' : finite(device.params.flowRate, 60) <= 0 ? 'Lưu lượng đặt bằng 0' : rate > epsilon ? 'Bơm đang cấp nước' : 'Bơm có áp · không có lưu lượng' });
    } else if (device.kind === 'pipe_junction') {
      const joined = pipes.filter(wire => wire.from === device.id || wire.to === device.id), total = joined.reduce((sum, wire) => sum + Math.abs(flow.get(`wire:${wire.id}`) ?? 0), 0) / 2;
      Object.assign(state, { energized: total > epsilon, powered: wet.has(pin(device.id, 'J')) && (pressure.get(pin(device.id, 'J')) ?? 0) > epsilon, flowRate: total, pressureBar: pressure.get(pin(device.id, 'J')) ?? 0 });
    } else if (device.kind === 'hydraulic_solenoid') {
      state.contactClosed = solenoidOpen(device); state.coilEnergized = solenoidOpen(device);
      state.status = solenoidOpen(device) ? 'Van điện từ mở' : 'Van điện từ đóng';
    } else if (device.kind === 'hydraulic_valve') {
      state.contactClosed = (device.params.valveMode ?? 0) === 0 ? device.enabled : Math.abs(rate) > epsilon;
      if ((device.params.valveMode ?? 0) === 0) state.status = device.enabled ? 'Van khóa mở' : 'Van khóa đóng';
    } else if (['pressure_sensor', 'flow_sensor', 'level_sensor'].includes(device.kind)) {
      let value: number | null = null, unit = 'bar', label = 'Áp suất', reason = 'Chưa nối cảm biến vào đường ống.';
      if (device.kind === 'pressure_sensor' && pipes.some(wire => wire.from === device.id || wire.to === device.id)) value = pressure.get(pin(device.id, 'P')) ?? 0;
      if (device.kind === 'flow_sensor') {
        unit = 'L/min'; label = 'Lưu lượng';
        if (['IN', 'OUT'].every(port => pipes.some(wire => wire.from === device.id && wire.fromPort === port || wire.to === device.id && wire.toPort === port))) value = Math.abs(rate);
      }
      if (device.kind === 'level_sensor') {
        unit = '%'; label = 'Mức nước'; reason = 'Chưa chọn bình chứa cho cảm biến.';
        const tank = tanksById.get(device.tankId ?? '');
        if (tank?.infinite) reason = 'Nguồn vô tận không có mức nước hữu hạn.';
        else if (tank) value = tank.volume / tank.capacity * 100;
      }
      const configuration = [device.kind, device.tankId ?? '', device.params.comparison ?? 0, device.params.threshold ?? 0, device.params.hysteresis ?? 0].join(':');
      const output = thresholdOutput(device, value, previous.devices[device.id], configuration);
      Object.assign(state, { energized: value !== null, powered: value !== null, sensorOutput: output, hydraulicConfiguration: configuration, measurement: { value: value === null ? null : clean(value), unit, label, quality: value === null ? 'unavailable' : 'simulated', reason: value === null ? reason : 'Mô hình nước tuyến tính; chưa tính thủy động lực học đầy đủ.' }, status: value === null ? reason : output ? 'Đạt ngưỡng · tiếp điểm tác động' : 'Chưa đạt ngưỡng · tiếp điểm nghỉ' });
      if (device.kind === 'pressure_sensor') state.pressureBar = value ?? 0;
      if (device.kind === 'level_sensor') state.levelPercent = value ?? 0;
    }
    result.devices[device.id] = state;
  }
  return result;
}

/** Shared linked-contact designation matching, without adding hidden pipe links. */
export function hydraulicSensorActive(project: Project, states: Record<string, DeviceState>, contact: Device): boolean {
  return !!designation(contact) && project.devices.some(device => ['pressure_sensor', 'flow_sensor', 'level_sensor'].includes(device.kind) && designation(device) === designation(contact) && states[device.id]?.sensorOutput);
}
