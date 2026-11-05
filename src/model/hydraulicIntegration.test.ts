import test from 'node:test';
import assert from 'node:assert/strict';
import { createDevice } from './catalog';
import { hydraulicExamples } from './hydraulicExamples';
import { createInitialState, stepSimulation, validateProject } from './simulation';
import type { Device, DeviceKind, Project, SimulationState, Wire } from './types';

const device = (kind: DeviceKind, id: string, params: Record<string, number> = {}): Device => ({ ...createDevice(kind, id, 0, 0), name: id, params: { ...createDevice(kind, id, 0, 0).params, ...params } });
const wire = (id: string, from: string, fromPort: string, to: string, toPort: string): Wire => ({ id, from, fromPort, to, toPort, length: 1, section: 2.5 });
const near = (actual: number | undefined, expected: number, tolerance = 1e-6) => assert.ok(actual !== undefined && Math.abs(actual - expected) < tolerance, `${actual} ≈ ${expected}`);
function poweredPump(): Project {
  const motor = { ...device('dc_motor', 'M'), fieldMode: 'shunt' as const }, field = { ...device('field_winding', 'F'), name: 'M' };
  return { version: 2, name: 'Electrical hydraulic interlock', devices: [device('dc', 'DC'), motor, field, device('hydraulic_pump', 'P'), device('water_tank', 'T1', { initialLevel: 100, capacityL: 100 }), device('water_tank', 'T2', { initialLevel: 0, capacityL: 100 })], wires: [wire('armature+', 'DC', '+', 'M', '+'), wire('armature-', 'M', '-', 'DC', '-'), wire('field+', 'DC', '+', 'F', 'F1'), wire('field-', 'F', 'F2', 'DC', '-'), wire('shaft', 'M', 'shaft', 'P', 'shaft'), wire('suction', 'T1', 'OUT', 'P', 'IN'), wire('discharge', 'P', 'OUT', 'T2', 'IN')] };
}
function controlled(project: Project, name: string, kind: 'contact_no' | 'contact_nc') {
  project.devices.push({ ...device(kind, 'C'), name });
  project.wires.find(item => item.id === 'armature+')!.to = 'C';
  project.wires.find(item => item.id === 'armature+')!.toPort = kind === 'contact_no' ? '13' : '21';
  project.wires.push(wire('contact-motor', 'C', kind === 'contact_no' ? '14' : '22', 'M', '+'));
}
function checked(project: Project, previous = createInitialState(project), dt = .1): SimulationState {
  assert.deepEqual(validateProject(project).filter(issue => issue.level === 'error'), []);
  const state = stepSimulation(project, previous, dt);
  assert.deepEqual(state.events.filter(event => event.level === 'error'), []);
  return state;
}

test('electric DC motor pumps only with a valid powered armature and matching field', () => {
  const project = poweredPump(); let state = checked(project);
  assert.equal(state.devices.M.energized, true); assert.ok(state.devices.P.flowRate! > 0);
  assert.ok(state.devices.T2.tankVolumeL! > 0);
  project.wires = project.wires.filter(item => item.id !== 'field+');
  state = checked(project, state);
  assert.equal(state.devices.M.energized, false); near(state.devices.P.flowRate, 0);
  project.wires.push(wire('field+', 'DC', '+', 'F', 'F1'));
  project.wires = project.wires.filter(item => item.id !== 'armature+');
  state = checked(project, state);
  assert.equal(state.devices.M.energized, false); near(state.devices.P.flowRate, 0);
});

test('a priming pressure switch starts another motor through a same-name NO contact', () => {
  const project = poweredPump(); controlled(project, 'PS', 'contact_no');
  project.devices.push({ ...device('diesel', 'D'), enabled: false }, device('hydraulic_pump', 'PRIME'), device('pressure_sensor', 'PS', { threshold: 2, hysteresis: .2 }));
  project.wires.push(wire('prime-shaft', 'D', 'shaft', 'PRIME', 'shaft'), wire('prime-in', 'T1', 'OUT', 'PRIME', 'IN'), wire('pressure-tap', 'PRIME', 'OUT', 'PS', 'P'));
  let state = checked(project);
  assert.equal(state.devices.PS.sensorOutput, false); assert.equal(state.devices.M.energized, false);
  project.devices.find(item => item.id === 'D')!.enabled = true;
  state = checked(project, state);
  // The main pump shares the suction port, so its flow creates a small inlet loss.
  near(state.devices.PS.measurement?.value ?? undefined, 3, .01);
  assert.equal(state.devices.PS.sensorOutput, true); assert.equal(state.devices.C.contactClosed, true); assert.equal(state.devices.M.energized, true);
  assert.ok(state.devices.P.flowRate! > 0);
  project.devices.find(item => item.id === 'D')!.enabled = false;
  state = checked(project, state);
  assert.equal(state.devices.PS.sensorOutput, false); assert.equal(state.devices.M.energized, false); near(state.devices.P.flowRate, 0);
});

test('tank level contact stops the motor after filling, without requiring a virtual input value', () => {
  const project = poweredPump(); controlled(project, 'LS', 'contact_nc');
  project.devices.find(item => item.id === 'T2')!.params.capacityL = 10;
  project.devices.push({ ...device('level_sensor', 'LS', { threshold: 10, hysteresis: 2 }), tankId: 'T2' });
  let state = createInitialState(project);
  for (let i = 0; i < 30; i++) state = checked(project, state);
  assert.equal(state.devices.LS.sensorOutput, true); assert.equal(state.devices.C.contactClosed, false);
  assert.equal(state.devices.M.energized, false); near(state.devices.P.flowRate, 0);
  assert.ok(state.devices.T2.levelPercent! >= 10 && state.devices.T2.levelPercent! < 12);
  near(state.devices.T1.tankVolumeL! + state.devices.T2.tankVolumeL!, 100);
});

test('zero-time control settling and electrical faults preserve the water already transferred', () => {
  const project = poweredPump(); let state = checked(project, undefined, 1);
  const volume = state.devices.T2.tankVolumeL!;
  assert.ok(volume > 0);
  state = checked(project, state, 0); near(state.devices.T2.tankVolumeL, volume);
  state = checked(project, state, 0); near(state.devices.T2.tankVolumeL, volume);
  project.wires.push(wire('short', 'DC', '+', 'DC', '-'));
  state = stepSimulation(project, state, .1);
  assert.ok(state.events.some(event => event.level === 'error'));
  near(state.devices.T2.tankVolumeL, volume); assert.equal(state.devices.M.energized, false);
  project.wires = project.wires.filter(item => item.id !== 'short');
  state.events = [];
  state = checked(project, state, 0); near(state.devices.T2.tankVolumeL, volume);
  state = checked(project, state, .1); assert.ok(state.devices.T2.tankVolumeL! > volume);
});

test('hydraulic solenoid opens only when its A1–A2 electrical circuit is complete', () => {
  const project = poweredPump(); project.devices.push(device('hydraulic_solenoid', 'Y'));
  const discharge = project.wires.find(item => item.id === 'discharge')!;
  discharge.to = 'Y';
  project.wires.push(wire('valve-out', 'Y', 'OUT', 'T2', 'IN'), wire('coil+', 'DC', '+', 'Y', 'A1'));
  let state = checked(project);
  assert.equal(state.devices.Y.coilEnergized, false); near(state.devices.P.flowRate, 0); near(state.devices.P.pressureBar, 3);
  project.wires.push(wire('coil-', 'Y', 'A2', 'DC', '-'));
  state = checked(project, state);
  assert.equal(state.devices.Y.coilEnergized, true); assert.equal(state.devices.Y.contactClosed, true); assert.ok(state.devices.P.flowRate! > 0);
  project.wires = project.wires.filter(item => item.id !== 'coil+');
  state = checked(project, state);
  assert.equal(state.devices.Y.coilEnergized, false); near(state.devices.P.flowRate, 0);
});

test('transfer example measures flow, raises the level alarm and stops water at a full tank', () => {
  const project = structuredClone(hydraulicExamples.find(item => item.id === 'hydraulic-transfer')!.project);
  let state = checked(project);
  assert.ok(state.devices['transfer-flow'].measurement?.value! > 10);
  assert.equal(state.devices['transfer-level-lamp'].energized, false);
  for (let i = 0; i < 600; i++) state = checked(project, state);
  near(state.devices['transfer-target-tank'].tankVolumeL, 40);
  near(state.devices['transfer-source-tank'].tankVolumeL, 44);
  assert.equal(state.devices['transfer-level-lamp'].energized, true);
  near(state.devices['transfer-pump'].flowRate, 0);
});

test('priming example transfers pressure control to the main pump and isolates the stopped pilot', () => {
  const project = structuredClone(hydraulicExamples.find(item => item.id === 'hydraulic-priming')!.project);
  let state = checked(project);
  assert.equal(state.devices['priming-main-motor'].energized, false);
  project.devices.find(item => item.id === 'priming-start')!.enabled = true;
  state = checked(project, state);
  assert.equal(state.devices['priming-main-motor'].energized, true);
  assert.equal(state.devices['priming-pressure'].sensorOutput, true);
  project.devices.find(item => item.id === 'priming-start')!.enabled = false;
  for (let i = 0; i < 10; i++) state = checked(project, state);
  assert.equal(state.devices['priming-pilot-motor'].energized, false);
  assert.equal(state.devices['priming-main-motor'].energized, true);
  near(state.devices['priming-pilot-check'].flowRate, 0);
  assert.ok(state.devices['priming-pressure'].pressureBar! > .6);
  project.wires = project.wires.filter(item => item.id !== 'priming-main-control-feed');
  state = checked(project, state);
  assert.equal(state.devices['priming-main-motor'].energized, false);
  assert.equal(state.devices['priming-pressure'].sensorOutput, false);
  near(state.devices['priming-main-pump'].flowRate, 0);
});
