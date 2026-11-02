import test from 'node:test';
import assert from 'node:assert/strict';
import { createDevice } from './catalog';
import { createInitialState, stepSimulation } from './simulation';
import type { DeviceKind, Project, SimulationState, Wire } from './types';

const device = (kind: DeviceKind, id: string, params: Record<string, number> = {}) => { const result = createDevice(kind, id, 0, 0); return { ...result, name: id, params: { ...result.params, ...params } }; };
const wire = (id: string, from: string, fromPort: string, to: string, toPort: string): Wire => ({ id, from, fromPort, to, toPort, length: 1, section: 2.5 });
const tick = (project: Project, previous = createInitialState(project), dt = .1) => stepSimulation(project, previous, dt);
const reading = (state: SimulationState, id: string) => { const result = state.devices[id].measurement; assert.ok(result, `Missing measurement ${id}`); return result; };
const close = (actual: number | null, expected: number) => { assert.notEqual(actual, null); assert.ok(Math.abs(actual! - expected) < 1e-7, `${actual} != ${expected}`); };

function resistive(source: 'dc' | 'ac1' = 'dc', power = false): Project {
  const positive = source === 'dc' ? '+' : 'L', negative = source === 'dc' ? '-' : 'N';
  return { version: 2, name: 'Reference resistor measurement', devices: [device(source, 'source', { voltage: 24, frequency: 60 }), device('resistor', 'R', { resistance: 12 }), device(power ? 'power_sensor' : 'current_sensor', 'meter'), device('voltage_sensor', 'V')], wires: [
    wire('s-i', 'source', positive, 'meter', power ? 'I1' : '1'), wire('i-r', 'meter', power ? 'I2' : '2', 'R', '1'), wire('r-s', 'R', '2', 'source', negative), wire('v+', 'V', 'V+', 'source', positive), wire('v-', 'V', 'V-', 'source', negative),
    ...(power ? [wire('u1', 'meter', 'U1', 'source', positive), wire('u2', 'meter', 'U2', 'source', negative)] : []),
  ] };
}

test('DC/AC configured sources and real resistance produce engineering readings independently of unit continuity weights', () => {
  for (const source of ['dc', 'ac1'] as const) {
    const project = resistive(source), state = tick(project);
    close(reading(state, 'V').value, 24); close(reading(state, 'meter').value, 2);
    assert.equal(reading(state, 'meter').quality, 'measured');
    project.devices.find(item => item.id === 'R')!.params.resistance = 48;
    close(reading(tick(project), 'meter').value, .5);
    project.devices.find(item => item.id === 'V')!.params.sensorFunction = 1;
    close(reading(tick(project), 'V').value, source === 'dc' ? 0 : 60);
  }
});

test('DC meter polarity is signed; a series bypass cannot invent a current split', () => {
  const project = resistive();
  for (const connection of project.wires) if (connection.to === 'meter') connection.toPort = '2'; else if (connection.from === 'meter') connection.fromPort = '1';
  close(reading(tick(project), 'meter').value, -2);
  project.wires.push(wire('bypass', 'source', '+', 'R', '1'));
  assert.equal(reading(tick(project), 'meter').quality, 'unavailable');
});

test('high impedance voltage probes do not complete a coil return or connect floating independent sources', () => {
  const project: Project = { version: 2, name: 'Non-invasive probes', devices: [device('dc', 'S'), device('coil', 'K'), device('voltage_sensor', 'V')], wires: [wire('s-k', 'S', '+', 'K', 'A1'), wire('k-v', 'K', 'A2', 'V', 'V+'), wire('v-s', 'V', 'V-', 'S', '-')] };
  let state = tick(project);
  assert.equal(state.devices.K.energized, false);
  assert.equal(reading(state, 'V').quality, 'unavailable');
  project.devices.push(device('dc', 'S2'));
  project.wires = [wire('a', 'S', '+', 'V', 'V+'), wire('b', 'S2', '-', 'V', 'V-')];
  state = tick(project);
  assert.equal(reading(state, 'V').value, null);
  assert.equal(reading(state, 'V').quality, 'unavailable');
  project.wires.pop();
  assert.equal(reading(tick(project), 'V').quality, 'unavailable');
});

test('unknown loads suppress current and power without hiding a known source voltage', () => {
  const project = resistive();
  project.devices = project.devices.map(item => item.id === 'R' ? device('lamp', 'R') : item);
  const state = tick(project);
  close(reading(state, 'V').value, 24);
  assert.equal(reading(state, 'meter').value, null);
  assert.match(reading(state, 'meter').reason!, /chưa có mô hình/);
});

test('resistive divider uses Kirchhoff equations, not a normalized voltage ratio', () => {
  const project = resistive();
  project.devices.push(device('resistor', 'R2', { resistance: 36 }));
  project.wires = project.wires.filter(item => item.id !== 'r-s' && item.id !== 'v+');
  project.wires.push(wire('r-r2', 'R', '2', 'R2', '1'), wire('r2-s', 'R2', '2', 'source', '-'), wire('v-r2', 'V', 'V+', 'R2', '1'));
  const state = tick(project);
  close(reading(state, 'meter').value, .5); close(reading(state, 'V').value, 18);
});

test('three-phase line voltage, phase voltage, frequency and phase order use source line-line rating', () => {
  const project: Project = { version: 2, name: 'Three phase sensors', devices: [device('ac3', 'S', { voltage: 400, frequency: 50 }), device('voltage_sensor', 'V'), device('phase_sensor', 'P')], wires: [wire('v1', 'S', 'L1', 'V', 'V+'), wire('v2', 'S', 'L2', 'V', 'V-'), ...['L1', 'L2', 'L3'].map((port, i) => wire(`p${i}`, 'S', port, 'P', port))] };
  let state = tick(project); close(reading(state, 'V').value, 400); close(reading(state, 'P').value, 1);
  project.wires.find(item => item.id === 'v2')!.fromPort = 'N';
  close(reading(tick(project), 'V').value, 400 / Math.sqrt(3));
  project.wires.find(item => item.id === 'p1')!.fromPort = 'L3'; project.wires.find(item => item.id === 'p2')!.fromPort = 'L2';
  state = tick(project); close(reading(state, 'P').value, -1);
  project.devices.find(item => item.id === 'P')!.params.sensorFunction = 1;
  close(reading(tick(project), 'P').value, 1);
  project.wires.find(item => item.id === 'p1')!.fromPort = 'L1';
  close(reading(tick(project), 'P').value, 0);
});

test('transformer ratio inherits measured input voltage and frequency while preserving isolation', () => {
  const project: Project = { version: 2, name: 'Isolated meter', devices: [device('ac1', 'S', { voltage: 110, frequency: 60 }), device('transformer1', 'T', { primaryVoltage: 220, secondaryVoltage: 24 }), device('voltage_sensor', 'V')], wires: [wire('p1', 'S', 'L', 'T', 'P1'), wire('p2', 'S', 'N', 'T', 'P2'), wire('v1', 'T', 'S1', 'V', 'V+'), wire('v2', 'T', 'S2', 'V', 'V-')] };
  close(reading(tick(project), 'V').value, 12);
  project.devices.find(item => item.id === 'V')!.params.sensorFunction = 1;
  close(reading(tick(project), 'V').value, 60);
  project.wires.find(item => item.id === 'v2')!.from = 'S'; project.wires.find(item => item.id === 'v2')!.fromPort = 'N';
  assert.equal(reading(tick(project), 'V').quality, 'unavailable');
});

test('power channels compute P/Q/S/cosφ and energy once per tick, retaining accumulated energy through an unavailable sample', () => {
  const project = resistive('ac1', true), meter = project.devices.find(item => item.id === 'meter')!;
  for (const [fn, expected] of [[0, 48], [1, 0], [2, 48], [3, 1]]) { meter.params.sensorFunction = fn; close(reading(tick(project), 'meter').value, expected); }
  meter.params.sensorFunction = 4;
  let state = tick(project, undefined, 1); close(reading(state, 'meter').value, 48 / 3_600_000);
  state = tick(project, state, 1); close(reading(state, 'meter').value, 96 / 3_600_000);
  const removed = project.wires.pop()!;
  state = tick(project, state, 1); assert.equal(reading(state, 'meter').quality, 'unavailable');
  project.wires.push(removed);
  state = tick(project, state, 1); close(reading(state, 'meter').value, 144 / 3_600_000);
  meter.params.sensorFunction = 0; state = tick(project, state, 1);
  meter.params.sensorFunction = 4; state = tick(project, state, 1); close(reading(state, 'meter').value, 48 / 3_600_000);
  close(reading(tick(project, undefined, 1), 'meter').value, 48 / 3_600_000);
});

test('power meter rejects voltage and current channels on independent circuits', () => {
  const project = resistive('dc', true);
  project.devices.push(device('dc', 'other', { voltage: 24 }));
  for (const connection of project.wires) if (connection.id === 'u1' || connection.id === 'u2') connection.to = 'other';
  assert.equal(reading(tick(project), 'meter').quality, 'unavailable');
});

test('unequal parallel source settings cannot be hidden by normalized continuity potentials', () => {
  const project = resistive();
  project.devices.push(device('dc', 'other', { voltage: 48 }));
  project.wires.push(wire('parallel+', 'source', '+', 'other', '+'), wire('parallel-', 'source', '-', 'other', '-'));
  const state = tick(project);
  assert.equal(reading(state, 'V').quality, 'unavailable');
  assert.equal(reading(state, 'meter').quality, 'unavailable');
  assert.match(reading(state, 'V').reason!, /không tương thích/);
});

test('uncertain or contradictory primary supplies never become a trusted transformer secondary reading', () => {
  const project: Project = { version: 2, name: 'Transformer source uncertainty', devices: [device('ac1', 'S1', { voltage: 110 }), device('ac1', 'S2', { voltage: 220 }), device('transformer1', 'T'), device('voltage_sensor', 'V')], wires: [wire('p1', 'S1', 'L', 'T', 'P1'), wire('p2', 'S1', 'N', 'T', 'P2'), wire('parallelL', 'S1', 'L', 'S2', 'L'), wire('parallelN', 'S1', 'N', 'S2', 'N'), wire('v1', 'T', 'S1', 'V', 'V+'), wire('v2', 'T', 'S2', 'V', 'V-')] };
  assert.equal(reading(tick(project), 'V').quality, 'unavailable');
  project.devices.find(item => item.id === 'S2')!.params.voltage = 110;
  close(reading(tick(project), 'V').value, 12);
  project.devices.find(item => item.id === 'S2')!.params.frequency = 60;
  assert.equal(reading(tick(project), 'V').quality, 'unavailable');
});

test('different frequencies sharing a resistive network never produce a fabricated single RMS or frequency reading', () => {
  const project = resistive('ac1');
  project.devices.push(device('ac1', 'other', { voltage: 24, frequency: 50 }), device('resistor', 'link', { resistance: 100 }));
  project.wires.push(wire('common', 'source', 'N', 'other', 'N'), wire('other-r', 'other', 'L', 'link', '1'), wire('r-primary', 'link', '2', 'source', 'L'));
  const state = tick(project);
  assert.equal(reading(state, 'V').quality, 'unavailable');
  assert.equal(reading(state, 'meter').quality, 'unavailable');
  assert.match(reading(state, 'V').reason!, /khác tần số/);
});

test('meter in one of two resistor branches reports that branch current, and an open series path reads zero', () => {
  const project = resistive();
  project.devices.push(device('resistor', 'parallel', { resistance: 24 }));
  project.wires.push(wire('p+', 'source', '+', 'parallel', '1'), wire('p-', 'parallel', '2', 'source', '-'));
  close(reading(tick(project), 'meter').value, 2);
  project.devices.push(device('breaker1', 'Q'));
  project.wires = project.wires.filter(item => item.id !== 'i-r');
  project.wires.push(wire('i-q', 'meter', '2', 'Q', '1'), wire('q-r', 'Q', '2', 'R', '1'));
  close(reading(tick(project), 'meter').value, 0);
});

test('speed sensor shows logical direction but never treats signed continuity rpm as a physical speed', () => {
  const driver = device('diesel', 'D'); driver.enabled = true;
  const project: Project = { version: 2, name: 'Shaft sensor', devices: [driver, device('speed_sensor', 'N')], wires: [wire('shaft', 'D', 'shaft', 'N', 'shaft')] };
  let state = tick(project); assert.equal(reading(state, 'N').value, null);
  project.devices[1].params.sensorFunction = 1;
  state = tick(project); close(reading(state, 'N').value, 1); assert.equal(reading(state, 'N').quality, 'simulated');
  driver.enabled = false;
  close(reading(tick(project), 'N').value, 0);
  project.devices[1].params.sensorFunction = 0;
  state = tick(project); close(reading(state, 'N').value, 0); assert.equal(reading(state, 'N').quality, 'simulated');
});
