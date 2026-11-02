import { getSensorFunction, isSensorKind } from './sensors';
import type { Device, Project, SensorMeasurement, SimulationState } from './types';

type Complex = { r: number; i: number };
export interface MeasurementBranch { id: string; a: string; b: string; g: number; device?: string; role?: string; wire?: { id: string }; acOnly?: boolean; diode?: boolean }
export interface MeasurementNetwork { branches: MeasurementBranch[]; constraints: { a: string; b: string; value: Complex }[]; activeSourceIds: Set<string> }
type Source = { a: string; b: string; value: Complex; frequency: number; device: string };
const zero: Complex = { r: 0, i: 0 };
const pin = (device: string, port: string) => `${device}\u0000${port}`;
const add = (a: Complex, b: Complex): Complex => ({ r: a.r + b.r, i: a.i + b.i });
const sub = (a: Complex, b: Complex): Complex => ({ r: a.r - b.r, i: a.i - b.i });
const scale = (a: Complex, n: number): Complex => ({ r: a.r * n, i: a.i * n });
const magnitude = (a: Complex) => Math.hypot(a.r, a.i);
const multiplyConjugate = (a: Complex, b: Complex): Complex => ({ r: a.r * b.r + a.i * b.i, i: a.i * b.r - a.r * b.i });
const clean = (value: number) => Math.abs(value) < 1e-10 ? 0 : value;

/** Exact ideal conductor/source constraints. Each disconnected source floats;
 * no arbitrary common earth is introduced by a voltmeter. */
class Potentials {
  parent = new Map<string, string>();
  offsets = new Map<string, Complex>();
  invalid = new Set<string>();
  find(key: string): { root: string; offset: Complex } {
    const parent = this.parent.get(key);
    if (!parent) { this.parent.set(key, key); return { root: key, offset: zero }; }
    if (parent === key) return { root: key, offset: zero };
    const result = this.find(parent), offset = add(this.offsets.get(key) ?? zero, result.offset);
    this.parent.set(key, result.root); this.offsets.set(key, offset);
    return { root: result.root, offset };
  }
  join(a: string, b: string, difference = zero) {
    const aa = this.find(a), bb = this.find(b);
    if (aa.root === bb.root) { if (magnitude(sub(sub(aa.offset, bb.offset), difference)) > 1e-6) this.invalid.add(a); return; }
    this.parent.set(aa.root, bb.root); this.offsets.set(aa.root, add(sub(difference, aa.offset), bb.offset));
  }
  difference(a: string, b: string): Complex | null {
    const aa = this.find(a), bb = this.find(b);
    return aa.root === bb.root ? sub(aa.offset, bb.offset) : null;
  }
}

function graphReach(start: string, adjacency: Map<string, string[]>): Set<string> {
  const seen = new Set([start]), queue = [start];
  for (let i = 0; i < queue.length; i++) for (const next of adjacency.get(queue[i]) ?? []) if (!seen.has(next)) { seen.add(next); queue.push(next); }
  return seen;
}
function connect(adjacency: Map<string, string[]>, a: string, b: string) {
  adjacency.set(a, [...adjacency.get(a) ?? [], b]); adjacency.set(b, [...adjacency.get(b) ?? [], a]);
}

function buildPhysicalModel(project: Project, network: MeasurementNetwork) {
  const devices = new Map(project.devices.map(device => [device.id, device]));
  const direct = new Potentials(), connectivity = new Potentials();
  const sources: Source[] = [], resolved = new Set<string>();
  for (const branch of network.branches) {
    connectivity.join(branch.a, branch.b);
    if (branch.g === 100) direct.join(branch.a, branch.b);
  }
  for (const link of network.constraints) connectivity.join(link.a, link.b);
  const sourceLinks = (device: Device) => network.constraints.filter(link => link.a.split('\u0000')[0] === device.id);
  const insert = (source: Source) => { sources.push(source); direct.join(source.a, source.b, source.value); };
  for (const device of project.devices) {
    if (!network.activeSourceIds.has(device.id) || !['dc', 'ac1', 'ac3', 'power_supply'].includes(device.kind)) continue;
    const voltage = device.params.voltage, frequency = ['ac1', 'ac3'].includes(device.kind) ? device.params.frequency : 0;
    if (!(voltage > 0) || !Number.isFinite(voltage) || !(frequency >= 0) || !Number.isFinite(frequency)) continue;
    for (const link of sourceLinks(device)) insert({ ...link, value: scale(link.value, voltage / (device.kind === 'ac3' ? Math.sqrt(3) : 1)), frequency, device: device.id });
    resolved.add(device.id);
  }
  // A transformer ratio is meaningful when the actual primary phasor is known.
  // The secondary remains electrically isolated. Cascaded transformers settle
  // in a bounded number of passes without borrowing a normalized unit voltage.
  for (let pass = 0; pass < project.devices.length; pass++) {
    let changed = false;
    for (const device of project.devices) {
      if (device.kind !== 'transformer1' || resolved.has(device.id) || !network.activeSourceIds.has(device.id)) continue;
      const a = pin(device.id, 'P1'), b = pin(device.id, 'P2'), input = direct.difference(a, b);
      const root = connectivity.find(a).root;
      // Do not turn uncertainty on an upstream bus into a fictitious known
      // secondary supply. This also propagates uncertainty through cascades.
      if ([...direct.invalid].some(key => connectivity.find(key).root === root) || network.constraints.some(link => connectivity.find(link.a).root === root && !resolved.has(link.a.split('\u0000')[0]))) continue;
      const frequencies = new Set(sources.filter(source => connectivity.find(source.a).root === root).map(source => source.frequency));
      const ratio = device.params.secondaryVoltage / device.params.primaryVoltage;
      if (!input || frequencies.size !== 1 || !([...frequencies][0] > 0) || !(ratio > 0) || !Number.isFinite(ratio)) continue;
      const frequency = [...frequencies][0];
      insert({ a: pin(device.id, 'S1'), b: pin(device.id, 'S2'), value: scale(input, ratio), frequency, device: device.id });
      resolved.add(device.id); changed = true;
    }
    if (!changed) break;
  }
  const component = (key: string) => connectivity.find(key).root;
  const unsupportedLoads = new Set<string>(), unsupportedSources = new Set<string>(), inconsistent = new Set<string>();
  const resistors: (MeasurementBranch & { conductance: number })[] = [];
  for (const branch of network.branches) if (branch.g !== 100) {
    const device = devices.get(branch.device ?? '');
    // Only a component with a defined physical R is admitted. Motor nameplate
    // power and the continuity solver's artificial g=1 are never load models.
    if (device?.kind === 'resistor' && Number.isFinite(device.params.resistance) && device.params.resistance > 0) resistors.push({ ...branch, conductance: 1 / device.params.resistance });
    else unsupportedLoads.add(component(branch.a));
  }
  for (const link of network.constraints) if (!resolved.has(link.a.split('\u0000')[0])) unsupportedSources.add(component(link.a));
  for (const key of direct.invalid) inconsistent.add(component(key));
  const frequencies = (key: string) => new Set(sources.filter(source => component(source.a) === component(key)).map(source => source.frequency));
  function problem(key: string, needsLoads: boolean): string | null {
    if (inconsistent.has(component(key))) return 'Các nguồn lý tưởng trong nhánh có điện áp không tương thích.';
    if (unsupportedSources.has(component(key))) return 'Nguồn trong nhánh chưa có mô hình điện áp/tần số định lượng.';
    if (frequencies(key).size > 1) return 'Chưa đo nhánh có nguồn khác tần số hoặc trộn AC và DC.';
    if (needsLoads && unsupportedLoads.has(component(key))) return 'Nhánh có tải chưa có mô hình tính dòng điện; hiện chỉ tính tải điện trở R.';
    if (!frequencies(key).size) return 'Chưa có nguồn định lượng nối vào nhánh đo.';
    return null;
  }
  // Nodal solve of physical resistances after exact ideal source constraints.
  // Source-connected components with unknown loads are rejected on reading,
  // never interpreted as open circuits or arbitrary 1-ohm loads.
  const adjacency = new Map<string, { to: string; g: number }[]>(), rhs = new Map<string, Complex>();
  for (const branch of resistors) {
    const a = direct.find(branch.a), b = direct.find(branch.b), g = branch.conductance;
    if (a.root === b.root) continue;
    adjacency.set(a.root, [...adjacency.get(a.root) ?? [], { to: b.root, g }]); adjacency.set(b.root, [...adjacency.get(b.root) ?? [], { to: a.root, g }]);
    const offset = scale(sub(a.offset, b.offset), g);
    rhs.set(a.root, sub(rhs.get(a.root) ?? zero, offset)); rhs.set(b.root, add(rhs.get(b.root) ?? zero, offset));
  }
  const grounded = new Set<string>(), seen = new Set<string>();
  for (const root of adjacency.keys()) if (!seen.has(root)) {
    grounded.add(root); seen.add(root); const queue = [root];
    for (let i = 0; i < queue.length; i++) for (const edge of adjacency.get(queue[i]) ?? []) if (!seen.has(edge.to)) { seen.add(edge.to); queue.push(edge.to); }
  }
  const unknown = [...adjacency.keys()].filter(key => !grounded.has(key)), indices = new Map(unknown.map((key, i) => [key, i]));
  const diagonal = unknown.map(key => (adjacency.get(key) ?? []).reduce((value, edge) => value + edge.g, 0));
  const multiply = (x: number[]) => unknown.map((key, i) => diagonal[i] * x[i] - (adjacency.get(key) ?? []).reduce((value, edge) => value + (indices.has(edge.to) ? edge.g * x[indices.get(edge.to)!] : 0), 0));
  let converged = true;
  function solve(axis: 'r' | 'i'): number[] {
    const values = unknown.map(key => rhs.get(key)?.[axis] ?? 0), x = unknown.map(() => 0), r = [...values], z = r.map((value, i) => value / diagonal[i]);
    let d = [...z], rz = r.reduce((value, residual, i) => value + residual * z[i], 0);
    for (let iteration = 0; iteration < Math.min(3000, unknown.length * 4 + 30) && Math.abs(rz) > 1e-24; iteration++) {
      const ad = multiply(d), denominator = d.reduce((value, entry, i) => value + entry * ad[i], 0);
      if (Math.abs(denominator) < 1e-30) break;
      const alpha = rz / denominator;
      for (let i = 0; i < x.length; i++) { x[i] += alpha * d[i]; r[i] -= alpha * ad[i]; z[i] = r[i] / diagonal[i]; }
      const next = r.reduce((value, residual, i) => value + residual * z[i], 0), beta = next / rz;
      d = z.map((value, i) => value + beta * d[i]); rz = next;
    }
    if (r.some((value, i) => !Number.isFinite(value) || Math.abs(value) > 1e-8 * Math.max(1, Math.abs(values[i])))) converged = false;
    return x;
  }
  const real = solve('r'), imaginary = solve('i');
  const potential = (key: string) => { const found = direct.find(key), index = indices.get(found.root); return add(found.offset, index === undefined ? zero : { r: real[index], i: imaginary[index] }); };
  type Reading = { value: Complex; frequency: number; reason?: never } | { reason: string; value?: never; frequency?: never };
  function voltage(a: string, b: string): Reading {
    if (component(a) !== component(b)) return { reason: 'Hai đầu đo đang hở hoặc thuộc hai mạch cách ly.' };
    const exact = direct.difference(a, b), error = problem(a, exact === null);
    if (error) return { reason: error };
    if (!exact && !converged) return { reason: 'Bộ tính điện trở chưa hội tụ.' };
    return { value: exact ?? sub(potential(a), potential(b)), frequency: [...frequencies(a)][0] };
  }
  function current(device: Device): Reading {
    const meter = network.branches.find(branch => branch.device === device.id && branch.role === 'meter-current');
    if (!meter) return { reason: 'Chưa nối kênh đo dòng vào nhánh nối tiếp.' };
    const error = problem(meter.a, true);
    if (error) return { reason: error };
    if (!converged) return { reason: 'Bộ tính điện trở chưa hội tụ.' };
    const links = new Map<string, string[]>();
    for (const branch of network.branches) if (branch.g === 100 && branch.id !== meter.id) connect(links, branch.a, branch.b);
    for (const source of sources) connect(links, source.a, source.b);
    const side = graphReach(meter.a, links);
    if (side.has(meter.b)) return { reason: 'Kênh đo dòng bị nối tắt song song; không xác định được dòng chia qua dây lý tưởng.' };
    let result = zero;
    for (const branch of resistors) {
      const a = side.has(branch.a), b = side.has(branch.b);
      if (a !== b) result = add(result, scale(sub(potential(branch.a), potential(branch.b)), branch.conductance * (a ? -1 : 1)));
    }
    return { value: result, frequency: [...frequencies(meter.a)][0] };
  }
  return { voltage, current, sameCircuit: (a: string, b: string) => component(a) === component(b) };
}

/** Pure observation of a settled continuity network. Voltage channels never
 * introduce a branch; current channels are the caller's exact ideal conductors.
 * Numeric scope is ideal configured sources, transformer ratios, and resistors.
 * Unknown electromechanical loads explicitly report unavailable. */
export function measureSensors(project: Project, state: SimulationState, previous: SimulationState, dt: number, network: MeasurementNetwork): void {
  const sensors = project.devices.filter(device => isSensorKind(device.kind) && device.kind !== 'process_sensor');
  if (!sensors.length) return;
  const model = buildPhysicalModel(project, network);
  const connected = (device: Device, port: string) => project.wires.some(wire => wire.from === device.id && wire.fromPort === port || wire.to === device.id && wire.toPort === port);
  for (const device of sensors) {
    const target = state.devices[device.id]; if (!target) continue;
    const definition = getSensorFunction(device.kind, device.params), fn = definition.value;
    target.sensorFunction = fn;
    if (device.kind === 'power_sensor' && fn === 4) target.sensorEnergyKWh = previous.devices[device.id]?.sensorFunction === 4 ? previous.devices[device.id]?.sensorEnergyKWh ?? 0 : 0;
    const unavailable = (reason: string): SensorMeasurement => ({ value: null, label: definition.label, unit: definition.unit, quality: 'unavailable', reason });
    const measured = (value: number, text?: string): SensorMeasurement => ({ value: clean(value), label: definition.label, unit: definition.unit, quality: 'measured', ...(text ? { text } : {}) });
    let measurement: SensorMeasurement = unavailable('Chưa nối đủ các đầu đo.');
    if (device.kind === 'voltage_sensor' && connected(device, 'V+') && connected(device, 'V-')) {
      const reading = model.voltage(pin(device.id, 'V+'), pin(device.id, 'V-'));
      measurement = reading.reason ? unavailable(reading.reason) : fn === 1
        ? magnitude(reading.value!) > 1e-8 ? measured(reading.frequency!) : unavailable('Không có tín hiệu điện áp để xác định tần số.')
        : measured(reading.frequency ? magnitude(reading.value!) : reading.value!.r);
    } else if (device.kind === 'current_sensor' && connected(device, '1') && connected(device, '2')) {
      const reading = model.current(device);
      measurement = reading.reason ? unavailable(reading.reason) : measured(reading.frequency ? magnitude(reading.value!) : reading.value!.r);
    } else if (device.kind === 'power_sensor' && ['I1', 'I2', 'U1', 'U2'].every(port => connected(device, port))) {
      const voltage = model.voltage(pin(device.id, 'U1'), pin(device.id, 'U2')), current = model.current(device);
      if (voltage.reason || current.reason) measurement = unavailable(voltage.reason || current.reason!);
      else if (!model.sameCircuit(pin(device.id, 'I1'), pin(device.id, 'U1'))) measurement = unavailable('Kênh điện áp và dòng điện thuộc hai mạch cách ly.');
      else if (voltage.frequency !== current.frequency) measurement = unavailable('Kênh điện áp và dòng điện có tần số khác nhau.');
      else {
        const power = multiplyConjugate(voltage.value!, current.value!), apparent = magnitude(voltage.value!) * magnitude(current.value!);
        if (fn === 0) measurement = measured(power.r);
        else if (fn === 1) measurement = measured(power.i);
        else if (fn === 2) measurement = measured(apparent);
        else if (fn === 3) measurement = apparent > 1e-10 ? measured(power.r / apparent) : unavailable('Hệ số công suất không xác định khi công suất biểu kiến bằng 0.');
        else {
          target.sensorEnergyKWh = (target.sensorEnergyKWh ?? 0) + power.r * (Number.isFinite(dt) ? Math.max(0, Math.min(1, dt)) : 0) / 3_600_000;
          measurement = measured(target.sensorEnergyKWh);
        }
      }
    } else if (device.kind === 'phase_sensor') {
      if (['L1', 'L2', 'L3'].every(port => connected(device, port))) {
        const ab = model.voltage(pin(device.id, 'L1'), pin(device.id, 'L2')), bc = model.voltage(pin(device.id, 'L2'), pin(device.id, 'L3'));
        if (ab.reason || bc.reason) measurement = unavailable(ab.reason || bc.reason!);
        else if (!ab.frequency || ab.frequency !== bc.frequency) measurement = unavailable('Cần ba pha AC cùng tần số.');
        else if ([ab.value!, bc.value!, add(ab.value!, bc.value!)].some(value => magnitude(value) < 1e-8) || Math.abs(multiplyConjugate(ab.value!, bc.value!).i) < 1e-8) measurement = measured(0, 'Thiếu pha / trùng pha');
        else if (fn === 1) measurement = measured(1, 'Đủ 3 pha');
        else {
          const sequence = multiplyConjugate(ab.value!, bc.value!).i;
          measurement = Math.abs(sequence) < 1e-8 ? unavailable('Không xác định được thứ tự pha.') : measured(sequence > 0 ? 1 : -1, sequence > 0 ? 'L1 → L2 → L3' : 'L1 → L3 → L2');
        }
      } else measurement = unavailable(`Chưa nối đầu đo ${['L1', 'L2', 'L3'].filter(port => !connected(device, port)).join(', ')}.`);
    } else if (device.kind === 'speed_sensor') {
      const wire = project.wires.find(item => item.to === device.id && item.toPort === 'shaft' || item.from === device.id && item.fromPort === 'shaft');
      const driver = wire ? state.devices[wire.to === device.id ? wire.from : wire.to] : undefined;
      if (driver) {
        if (fn === 0) measurement = driver.energized ? unavailable('Mô hình cơ học chưa tính tốc độ rpm thực; tốc độ định mức không phải số đo.') : { ...measured(0, 'Dừng · 0 rpm'), quality: 'simulated' };
        else { const direction = driver.energized ? Math.sign(driver.rpm) : 0; measurement = { ...measured(direction, direction > 0 ? 'Thuận' : direction < 0 ? 'Ngược' : 'Dừng'), quality: 'simulated' }; }
      }
    }
    target.measurement = measurement;
    target.energized = measurement.quality !== 'unavailable';
    target.status = measurement.reason ?? measurement.text ?? `${measurement.value?.toLocaleString('vi-VN', { maximumFractionDigits: 4 })} ${measurement.unit}`.trim();
  }
}
