import test from 'node:test';
import assert from 'node:assert/strict';
import { createDevice } from './catalog';
import { hydraulicSensorActive, stepHydraulics } from './hydraulics';
import type { Device, DeviceKind, DeviceState, Project, SimulationState, Wire } from './types';

const device = (kind: DeviceKind, id: string, params: Record<string, number> = {}): Device => ({ ...createDevice(kind, id, 0, 0), name: id, params: { ...createDevice(kind, id, 0, 0).params, ...params } });
const wire = (id: string, from: string, fromPort: string, to: string, toPort: string): Wire => ({ id, from, fromPort, to, toPort, length: 1, section: 2.5 });
const blank = (): DeviceState => ({ energized: false, voltage: 0, current: 0, power: 0, rpm: 0, frequency: 0, tripped: false, heat: 0, status: '' });
const initial = (project: Project): SimulationState => ({ time: 0, devices: Object.fromEntries(project.devices.map(item => [item.id, blank()])), wires: {}, events: [] });
const near = (actual: number | undefined, expected: number, tolerance = 1e-6) => assert.ok(actual !== undefined && Math.abs(actual - expected) < tolerance, `${actual} ≈ ${expected}`);
function network(source: Record<string, number> = {}, destination: Record<string, number> = {}): Project {
  return { version: 2, name: 'Water transfer', devices: [device('diesel', 'motor'), device('hydraulic_pump', 'pump'), device('water_tank', 'source', { capacityL: 1000, initialLevel: 100, ...source }), device('water_tank', 'destination', { capacityL: 1000, initialLevel: 0, ...destination })], wires: [wire('shaft', 'motor', 'shaft', 'pump', 'shaft'), wire('suction', 'source', 'OUT', 'pump', 'IN'), wire('discharge', 'pump', 'OUT', 'destination', 'IN')] };
}
function advance(project: Project, previous = initial(project), dt = 0, rpm = 1): SimulationState {
  const electrical = structuredClone(previous);
  electrical.devices.motor = { ...blank(), energized: rpm !== 0, rpm };
  const patches = stepHydraulics(project, previous, electrical, dt);
  return { ...electrical, time: previous.time + dt, devices: Object.fromEntries(project.devices.map(item => [item.id, { ...electrical.devices[item.id] ?? blank(), ...patches.devices[item.id] }])), wires: Object.fromEntries(project.wires.map(item => [item.id, { energized: false, powered: false, current: 0, voltage: 0, ...patches.wires[item.id] }])) };
}
function insert(project: Project, kind: DeviceKind, params: Record<string, number> = {}) {
  project.devices.push(device(kind, 'inline', params));
  project.wires = project.wires.filter(item => item.id !== 'discharge');
  project.wires.push(wire('pump-inline', 'pump', 'OUT', 'inline', 'IN'), wire('inline-tank', 'inline', 'OUT', 'destination', 'IN'));
}

test('a shaft-driven pump follows its linear curve and conserves transferred water', () => {
  const project = network(), expected = 3 / (.05 + .002 + .0002), state = advance(project, undefined, 30);
  near(state.devices.pump.flowRate, expected);
  near(state.devices.source.tankVolumeL, 1000 - expected / 2);
  near(state.devices.destination.tankVolumeL, expected / 2);
  near(state.devices.source.tankVolumeL! + state.devices.destination.tankVolumeL!, 1000);
  assert.equal(state.wires.discharge.energized, true);
  near(state.wires.discharge.flowRate, expected);
});

test('pump requires a rotating shaft and water at its suction, never just enabled state', () => {
  const project = network();
  let state = advance(project, undefined, 10, 0);
  near(state.devices.pump.flowRate, 0); near(state.devices.destination.tankVolumeL, 0);
  project.wires = project.wires.filter(item => item.id !== 'shaft');
  state = advance(project, undefined, 10);
  near(state.devices.pump.flowRate, 0);
  const dry = network({ initialLevel: 0 });
  state = advance(dry, undefined, 10);
  near(state.devices.pump.pressureBar, 0); near(state.devices.pump.flowRate, 0);
  assert.match(state.devices.pump.status, /khô/);
  dry.devices.find(item => item.id === 'source')!.params.infinite = 1;
  assert.ok(advance(dry, undefined, 1).devices.pump.flowRate! > 0);
});

test('closed discharge has shutoff pressure and zero flow, without consuming water', () => {
  const project = network(); insert(project, 'hydraulic_valve', { valveMode: 0 });
  project.devices.find(item => item.id === 'inline')!.enabled = false;
  const state = advance(project, undefined, 60);
  near(state.devices.pump.pressureBar, 3);
  near(state.devices.pump.flowRate, 0);
  near(state.devices.source.tankVolumeL, 1000);
  assert.equal(state.wires['pump-inline'].powered, true);
  assert.equal(state.wires['pump-inline'].energized, false);
});

test('tank empty/full events stop transfer at boundaries even during a long timestep', () => {
  let project = network({ capacityL: 20 }, { capacityL: 10 });
  let state = advance(project, undefined, 600);
  near(state.devices.source.tankVolumeL, 10);
  near(state.devices.destination.tankVolumeL, 10);
  near(state.devices.pump.flowRate, 0); near(state.devices.pump.pressureBar, 3);
  project = network({ capacityL: 5 }, { capacityL: 10 });
  state = advance(project, undefined, 600);
  near(state.devices.source.tankVolumeL, 0); near(state.devices.destination.tankVolumeL, 5);
  near(state.devices.pump.flowRate, 0); near(state.devices.pump.pressureBar, 0);
});

test('zero-time settling preserves volume; restart and changed tank setup restore configured level', () => {
  const project = network(), first = advance(project, undefined, 10), settled = advance(project, first, 0);
  near(settled.devices.source.tankVolumeL, first.devices.source.tankVolumeL!);
  near(advance(project).devices.source.tankVolumeL, 1000);
  project.devices.find(item => item.id === 'destination')!.params.initialLevel = 25;
  near(advance(project, first).devices.destination.tankVolumeL, 250);
  near(advance(project, first).devices.source.tankVolumeL, first.devices.source.tankVolumeL!);
});

test('infinite source and destination keep levels while allowing continuous transfer', () => {
  const project = network({ infinite: 1, initialLevel: 1 }, { infinite: 1, initialLevel: 0 }), state = advance(project, undefined, 3600);
  assert.ok(state.devices.pump.flowRate! > 0);
  near(state.devices.source.tankVolumeL, 10); near(state.devices.destination.tankVolumeL, 0);
  near(state.devices.source.levelPercent, 100); near(state.devices.destination.levelPercent, 100);
});

test('check valves pass forward flow and block reversed installation', () => {
  const project = network(); insert(project, 'hydraulic_valve', { valveMode: 1 });
  project.devices.find(item => item.id === 'inline')!.enabled = false;
  assert.ok(advance(project).devices.pump.flowRate! > 0);
  for (const item of project.wires) { if (item.from === 'inline') item.fromPort = 'IN'; if (item.to === 'inline') item.toPort = 'OUT'; }
  const state = advance(project);
  near(state.devices.pump.flowRate, 0); near(state.devices.pump.pressureBar, 3);
});

test('throttle, blocked filter and relief valve change flow according to configuration', () => {
  const project = network(); insert(project, 'hydraulic_valve', { valveMode: 2, opening: 100 });
  const open = advance(project).devices.pump.flowRate!;
  project.devices.find(item => item.id === 'inline')!.params.opening = 50;
  assert.ok(advance(project).devices.pump.flowRate! < open);
  project.devices.find(item => item.id === 'inline')!.params.opening = 0;
  near(advance(project).devices.pump.flowRate, 0);
  const relief = network(); insert(relief, 'hydraulic_valve', { valveMode: 3, setPressure: 4 });
  near(advance(relief).devices.pump.flowRate, 0);
  relief.devices.find(item => item.id === 'inline')!.params.setPressure = 1;
  assert.ok(advance(relief).devices.pump.flowRate! > 0);
  const filter = network(); insert(filter, 'hydraulic_filter', { clogging: 100 });
  near(advance(filter).devices.pump.flowRate, 0);
  filter.devices.find(item => item.id === 'inline')!.params.clogging = 50;
  assert.ok(advance(filter).devices.pump.flowRate! > 0);
});

test('solenoid hydraulic path follows its electrical coil, not manual enabled flag', () => {
  const project = network(); insert(project, 'hydraulic_solenoid');
  const previous = initial(project), electrical = initial(project);
  electrical.devices.motor.rpm = 1;
  near(stepHydraulics(project, previous, electrical, 0).devices.pump.flowRate, 0);
  electrical.devices.inline.coilEnergized = true;
  project.devices.find(item => item.id === 'inline')!.enabled = false;
  assert.ok(stepHydraulics(project, previous, electrical, 0).devices.pump.flowRate! > 0);
});

test('parallel outlet branches split flow and a junction does not create extra water', () => {
  const project = network();
  project.devices.push(device('pipe_junction', 'tee'), device('water_tank', 'destination2', { initialLevel: 0 }));
  project.wires = project.wires.filter(item => item.id !== 'discharge');
  project.wires.push(wire('to-tee', 'pump', 'OUT', 'tee', 'J'), wire('branch-a', 'tee', 'J', 'destination', 'IN'), wire('branch-b', 'tee', 'J', 'destination2', 'IN'));
  const state = advance(project, undefined, 60);
  near(state.wires['branch-a'].flowRate, state.wires['branch-b'].flowRate!);
  near(state.devices.pump.flowRate, state.wires['branch-a'].flowRate! + state.wires['branch-b'].flowRate!);
  near(state.devices.source.tankVolumeL! + state.devices.destination.tankVolumeL! + state.devices.destination2.tankVolumeL!, 1000);
});

test('series pumps add head only when supplied; unconnected pump loops remain dry', () => {
  const project = network(); project.devices.push(device('hydraulic_pump', 'pump2'));
  project.wires.push(wire('shaft2', 'motor', 'shaft', 'pump2', 'shaft'));
  project.wires = project.wires.filter(item => item.id !== 'discharge');
  project.wires.push(wire('series', 'pump', 'OUT', 'pump2', 'IN'));
  const state = advance(project);
  near(state.devices.pump2.pressureBar, 6); near(state.devices.pump2.flowRate, 0);
  project.wires = project.wires.filter(item => item.id !== 'suction');
  project.wires.push(wire('loop', 'pump2', 'OUT', 'pump', 'IN'));
  const dry = advance(project);
  near(dry.devices.pump.pressureBar, 0); near(dry.devices.pump2.flowRate, 0);
});

test('pressure tap reads deadhead without drawing flow, and same-name contacts use its threshold', () => {
  const project = network(); project.devices.push(device('pressure_sensor', 'PS', { threshold: 2, hysteresis: .2 }), device('contact_no', 'contact'));
  project.devices.find(item => item.id === 'contact')!.name = '  ps  ';
  project.wires = project.wires.filter(item => item.id !== 'discharge');
  project.wires.push(wire('tap', 'pump', 'OUT', 'PS', 'P'));
  let state = advance(project);
  near(state.devices.PS.measurement?.value ?? undefined, 3); near(state.wires.tap.flowRate, 0);
  assert.equal(state.devices.PS.sensorOutput, true);
  assert.equal(hydraulicSensorActive(project, state.devices, project.devices.find(item => item.id === 'contact')!), true);
  state = advance(project, state, 0, 0);
  near(state.devices.PS.measurement?.value ?? undefined, 0); assert.equal(state.devices.PS.sensorOutput, false);
});

test('level switch binds a tank ID and retains low-level hysteresis until recovery', () => {
  const project = network({ initialLevel: 55 }); project.devices.push({ ...device('level_sensor', 'LS', { threshold: 50, comparison: 1, hysteresis: 5 }), tankId: 'source' });
  let state = advance(project, undefined, 0, 0);
  assert.equal(state.devices.LS.sensorOutput, false);
  state.devices.source.tankVolumeL = 490; state = advance(project, state, 0, 0);
  assert.equal(state.devices.LS.sensorOutput, true);
  state.devices.source.tankVolumeL = 520; state = advance(project, state, 0, 0);
  assert.equal(state.devices.LS.sensorOutput, true);
  state.devices.source.tankVolumeL = 560; state = advance(project, state, 0, 0);
  assert.equal(state.devices.LS.sensorOutput, false);
  project.devices.find(item => item.id === 'LS')!.tankId = 'missing';
  state = advance(project, state, 0, 0);
  assert.equal(state.devices.LS.measurement?.value, null); assert.equal(state.devices.LS.sensorOutput, false);
});

test('flow sensor needs both pipe ports, reports real network flow and drives its threshold', () => {
  const project = network(); insert(project, 'flow_sensor', { threshold: 10 });
  let state = advance(project);
  near(state.devices.inline.measurement?.value ?? undefined, state.devices.pump.flowRate!);
  assert.equal(state.devices.inline.sensorOutput, true);
  project.wires = project.wires.filter(item => item.id !== 'inline-tank');
  state = advance(project);
  assert.equal(state.devices.inline.measurement?.value, null); assert.equal(state.devices.inline.sensorOutput, false);
});

test('pipe drawing direction does not dictate water direction, while tank ports remain directional', () => {
  const project = network();
  const discharge = project.wires.find(item => item.id === 'discharge')!;
  [discharge.from, discharge.to, discharge.fromPort, discharge.toPort] = [discharge.to, discharge.from, discharge.toPort, discharge.fromPort];
  assert.ok(advance(project).wires.discharge.flowRate! < 0);
  discharge.fromPort = 'OUT';
  near(advance(project).devices.pump.flowRate, 0);
});

test('a zero-flow pump setting cannot produce water or pressure', () => {
  const project = network(); project.devices.find(item => item.id === 'pump')!.params.flowRate = 0;
  const state = advance(project, undefined, 60);
  near(state.devices.pump.flowRate, 0); near(state.devices.pump.pressureBar, 0);
  near(state.devices.destination.tankVolumeL, 0); near(state.devices.source.tankVolumeL, 1000);
});

test('parallel pumps combine flow while a weaker pump cannot admit reverse flow', () => {
  const project = network(); project.devices.push(device('hydraulic_pump', 'pump2'));
  project.wires.push(wire('shaft2', 'motor', 'shaft', 'pump2', 'shaft'), wire('suction2', 'source', 'OUT', 'pump2', 'IN'), wire('discharge2', 'pump2', 'OUT', 'destination', 'IN'));
  let state = advance(project, undefined, 60);
  near(state.devices.pump.flowRate, state.devices.pump2.flowRate!);
  near(state.devices.destination.tankVolumeL, state.devices.pump.flowRate! + state.devices.pump2.flowRate!);
  near(state.devices.destination.tankVolumeL! + state.devices.source.tankVolumeL!, 1000);
  project.devices.find(item => item.id === 'destination')!.params.pressureBar = 2;
  project.devices.find(item => item.id === 'pump2')!.params.pressureBar = 1;
  state = advance(project, undefined, 1);
  assert.ok(state.devices.pump.flowRate! > 0); near(state.devices.pump2.flowRate, 0);
});

test('recirculating into the same reservoir conserves its inventory', () => {
  const project = network(); project.wires.find(item => item.id === 'discharge')!.to = 'source';
  const state = advance(project, undefined, 60);
  assert.ok(state.devices.pump.flowRate! > 0);
  near(state.devices.source.tankVolumeL, 1000);
});

test('splitting a pipe with a short segment preserves its pressure loss and flow', () => {
  const project = network(), original = advance(project);
  project.devices.push(device('pipe_junction', 'split'));
  const discharge = project.wires.find(item => item.id === 'discharge')!;
  discharge.to = 'split'; discharge.toPort = 'J'; discharge.length = .01;
  project.wires.push({ ...wire('short-tail', 'split', 'J', 'destination', 'IN'), length: .99 });
  const state = advance(project);
  near(state.devices.pump.flowRate, original.devices.pump.flowRate!, 1e-5);
  near(state.devices.pump.pressureBar, original.devices.pump.pressureBar!, 1e-5);
  near(state.wires['short-tail'].flowRate, original.wires.discharge.flowRate!, 1e-5);
});

test('an infinite source has no finite level measurement or level-switch output', () => {
  const project = network({ infinite: 1 });
  project.devices.push({ ...device('level_sensor', 'LS', { threshold: 1 }), tankId: 'source' });
  const state = advance(project);
  assert.equal(state.devices.LS.measurement?.value, null);
  assert.equal(state.devices.LS.measurement?.quality, 'unavailable');
  assert.match(state.devices.LS.measurement?.reason ?? '', /vô tận/);
  assert.equal(state.devices.LS.sensorOutput, false);
});
