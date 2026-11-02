import test from 'node:test';
import assert from 'node:assert/strict';
import { canActuate, createDevice, getDefinition } from './catalog';
import { getPortGeometry } from './geometry';
import { parseProject, serializeProject } from './persistence';
import { getSensorFunction, isSensorKind, processSensorOutput, sensorFunctions, sensorKinds } from './sensors';
import type { Device, Project } from './types';

const project = (devices: Device[]): Project => ({ version: 2, name: 'Sensors', devices, wires: [] });

test('sensor ports stay on the same 10 px drawing grid in every orientation', () => {
  for (const kind of sensorKinds) {
    const definition = getDefinition(kind);
    assert.equal(definition.category, 'Đo lường & cảm biến');
    assert.equal(canActuate(kind), false, 'a sensor is not a manually operated circuit switch');
    assert.equal(new Set(definition.ports.map(port => port.id)).size, definition.ports.length);
    for (const rotation of [0, 90, 180, 270] as const) {
      const device = { ...createDevice(kind, kind, 0, 0), rotation };
      for (const port of definition.ports) {
        const point = getPortGeometry(device, port);
        assert.equal(point.x % 10, 0, `${kind}.${port.id} x after rotation ${rotation}`);
        assert.equal(point.y % 10, 0, `${kind}.${port.id} y after rotation ${rotation}`);
      }
    }
  }
  assert.deepEqual(getDefinition('power_sensor').ports.map(port => port.id), ['I1', 'I2', 'U1', 'U2']);
  assert.deepEqual(getDefinition('voltage_sensor').ports.map(port => port.id), ['V+', 'V-']);
  assert.deepEqual(getDefinition('phase_sensor').ports.map(port => port.id), ['L1', 'L2', 'L3']);
  assert.equal(getDefinition('speed_sensor').ports[0].type, 'shaft');
  assert.equal(getDefinition('speed_sensor').ports[0].direction, 'in');
});

test('each configured measurement function and its unit survive saving and reopening', () => {
  const devices = [...sensorKinds].flatMap(kind => sensorFunctions(kind).map(option => {
    const device = createDevice(kind, `${kind}-${option.value}`, 0, 0);
    device.params.sensorFunction = option.value;
    return device;
  }));
  const restored = parseProject(serializeProject(project(devices)));
  assert.deepEqual(restored.devices, devices);
  for (const device of restored.devices) {
    assert.equal(isSensorKind(device.kind), true);
    const option = getSensorFunction(device.kind, device.params);
    assert.equal(option.value, device.params.sensorFunction);
    assert.ok(option.label.length > 0);
    assert.ok(option.symbol.length > 0);
  }
  assert.equal(getSensorFunction('voltage_sensor', { sensorFunction: 1 }).unit, 'Hz');
  assert.equal(getSensorFunction('current_sensor').unit, 'A');
  assert.equal(getSensorFunction('power_sensor', { sensorFunction: 4 }).unit, 'kWh');
  assert.equal(getSensorFunction('speed_sensor').unit, 'rpm');
  assert.equal(getSensorFunction('process_sensor', { sensorFunction: 3 }).unit, 'm³/h');
  assert.deepEqual(sensorFunctions('lamp'), []);
});

test('omitted sensor configuration receives known defaults without changing existing devices', () => {
  const devices = [...sensorKinds].map(kind => ({ ...createDevice(kind, kind, 0, 0), params: {} }));
  const source = createDevice('dc', 'dc-source', 100, 200);
  const restored = parseProject(JSON.stringify(project([...devices, source])));
  for (const device of restored.devices.slice(0, -1)) {
    assert.deepEqual(device.params, createDevice(device.kind, device.id, 0, 0).params);
  }
  assert.deepEqual(restored.devices.at(-1), source);
});

test('imports reject invalid function indices and process comparator modes', () => {
  for (const kind of sensorKinds) {
    for (const invalid of [-1, .5, sensorFunctions(kind).length]) {
      const device = createDevice(kind, 'sensor', 0, 0);
      device.params.sensorFunction = invalid;
      assert.throws(() => parseProject(JSON.stringify(project([device]))), /Dự án không hợp lệ/);
    }
  }
  for (const invalid of [-1, .5, 2]) {
    const device = createDevice('process_sensor', 'process', 0, 0);
    device.params.comparison = invalid;
    assert.throws(() => parseProject(JSON.stringify(project([device]))), /Dự án không hợp lệ/);
  }
  const process = createDevice('process_sensor', 'process', 0, 0);
  process.params.hysteresis = -1;
  assert.throws(() => parseProject(JSON.stringify(project([process]))), /Dự án không hợp lệ/);
});

test('high and low process thresholds retain their output across the configured hysteresis band', () => {
  const device = createDevice('process_sensor', 'process', 0, 0);
  device.params.threshold = 50;
  device.params.hysteresis = 5;
  device.params.inputValue = 49;
  assert.equal(processSensorOutput(device), false);
  device.params.inputValue = 50;
  assert.equal(processSensorOutput(device), true, 'high threshold includes equality');
  device.params.inputValue = 47;
  assert.equal(processSensorOutput(device, true), true);
  assert.equal(processSensorOutput(device, false), false);
  device.params.inputValue = 44;
  assert.equal(processSensorOutput(device, true), false);

  device.params.comparison = 1;
  device.params.inputValue = 51;
  assert.equal(processSensorOutput(device), false);
  device.params.inputValue = 50;
  assert.equal(processSensorOutput(device), true, 'low threshold includes equality');
  device.params.inputValue = 53;
  assert.equal(processSensorOutput(device, true), true);
  assert.equal(processSensorOutput(device, false), false);
  device.params.inputValue = 56;
  assert.equal(processSensorOutput(device, true), false);
});

test('zero hysteresis works as a direct comparator and invalid inputs never trigger an output', () => {
  const device = createDevice('process_sensor', 'process', 0, 0);
  device.params.sensorFunction = 4;
  device.params.threshold = 1;
  device.params.hysteresis = 0;
  device.params.inputValue = 1;
  assert.equal(processSensorOutput(device), true);
  device.params.inputValue = 0;
  assert.equal(processSensorOutput(device, true), false);
  device.params.inputValue = Number.NaN;
  assert.equal(processSensorOutput(device, true), false);
  device.params.inputValue = Number.POSITIVE_INFINITY;
  assert.equal(processSensorOutput(device, true), false);
  assert.equal(processSensorOutput(createDevice('lamp', 'lamp', 0, 0), true), false);
});
