import test from 'node:test';
import assert from 'node:assert/strict';
import { createDevice } from './catalog';
import { copySelection, pasteSelection } from './clipboard';
import { parseProject, serializeProject } from './persistence';
import type { Device, DeviceKind, Project, Wire } from './types';

const part = (kind: DeviceKind, id: string, name: string): Device => ({...createDevice(kind, id, 100, 200), name});
const wire = (id: string, from: string, fromPort: string, to: string, toPort: string): Wire => ({
  id, from, fromPort, to, toPort, length: 3, section: 2.5, color: '#2288aa', waypoints: [{x: 150, y: 160}, {x: 320, y: 160}],
});
const projectWith = (devices: Device[], wires: Wire[] = []): Project => ({version: 2, name: 'Clipboard fixture', devices, wires});
function newIds() { let number = 0; return () => `new-${++number}`; }

test('copy/paste keeps internal wires, drops external wires and offsets every routed bend', () => {
  const source = part('dc', 'source', 'G1'), lamp = part('lamp', 'lamp', 'H1'), outside = part('lamp', 'outside', 'H2');
  const internal = wire('internal', 'source', '+', 'lamp', '1');
  const project = projectWith([source, lamp, outside], [internal, wire('external', 'source', '+', 'outside', '1')]);
  const snapshot = structuredClone(project);
  const fragment = copySelection(project, ['source', 'lamp']);
  const clipboardSnapshot = structuredClone(fragment);
  assert.deepEqual(fragment.wires.map(item => item.id), ['internal']);
  const result = pasteSelection(project, fragment, {x: 80, y: -40}, newIds());
  assert.equal(result.project.devices.length, 5);
  assert.equal(result.project.wires.length, 3);
  assert.deepEqual(result.deviceIds, ['new-1', 'new-2']);
  assert.deepEqual(result.wireIds, ['new-3']);
  const pasted = result.project.wires.at(-1)!;
  assert.equal(pasted.from, 'new-1'); assert.equal(pasted.to, 'new-2');
  assert.equal(pasted.fromPort, '+'); assert.equal(pasted.toPort, '1');
  assert.equal(pasted.length, internal.length); assert.equal(pasted.section, internal.section); assert.equal(pasted.color, internal.color);
  assert.deepEqual(pasted.waypoints, [{x: 230, y: 120}, {x: 400, y: 120}]);
  assert.deepEqual(result.project.devices.slice(-2).map(({x, y}) => ({x, y})), [{x: 180, y: 160}, {x: 180, y: 160}]);
  assert.deepEqual(project, snapshot); assert.deepEqual(fragment, clipboardSnapshot);
  assert.deepEqual(parseProject(serializeProject(result.project)), result.project);
});

test('clipboard snapshot and pasted parameters, label offsets and waypoints have independent ownership', () => {
  const machine = {...part('dc_motor', 'motor', 'M1'), rotation: 270 as const, fieldMode: 'compound' as const, hiddenLabel: true, labelOffset: {x: -20, y: 35}};
  const field = {...part('field_winding', 'field', 'M1'), windingRole: 'series' as const};
  const project = projectWith([machine, field], [wire('joined', 'motor', '+', 'field', 'F1')]);
  const fragment = copySelection(project, ['motor', 'field']);
  project.devices[0].params.voltage = 48;
  assert.equal(fragment.devices[0].params.voltage, 24);
  const result = pasteSelection(project, fragment, {x: 20, y: 20}, newIds());
  const copy = result.project.devices[2];
  assert.equal(copy.rotation, 270); assert.equal(copy.fieldMode, 'compound'); assert.equal(copy.hiddenLabel, true);
  assert.deepEqual(copy.labelOffset, {x: -20, y: 35});
  assert.equal(result.project.devices[3].windingRole, 'series');
  copy.params.voltage = 72; copy.labelOffset!.x = 100;
  result.project.wires.at(-1)!.waypoints![0].x = 1000;
  assert.equal(fragment.devices[0].params.voltage, 24); assert.equal(project.devices[0].params.voltage, 48);
  assert.equal(fragment.devices[0].labelOffset!.x, -20); assert.equal(project.devices[0].labelOffset!.x, -20);
  assert.equal(fragment.wires[0].waypoints![0].x, 150); assert.equal(project.wires[0].waypoints![0].x, 150);
});

test('a copied machine and both compound field windings receive one fresh, normalized designation', () => {
  const project = projectWith([
    part('dc_motor', 'motor', ' m1 '),
    {...part('field_winding', 'shunt', 'M1'), windingRole: 'shunt'},
    {...part('field_winding', 'series', 'm1'), windingRole: 'series'},
    part('dc_motor', 'existing', 'm2'),
  ]);
  const fragment = copySelection(project, ['motor', 'shunt', 'series']);
  const first = pasteSelection(project, fragment, {x: 40, y: 40}, newIds());
  assert.deepEqual(first.project.devices.slice(-3).map(item => item.name), ['M3', 'M3', 'M3']);
  const second = pasteSelection(first.project, fragment, {x: 80, y: 80}, newIds());
  assert.deepEqual(second.project.devices.slice(-3).map(item => item.name), ['M4', 'M4', 'M4']);
  assert.equal(new Set([...second.project.devices, ...second.project.wires].map(item => item.id)).size, second.project.devices.length + second.project.wires.length);
});

test('coil, timer and thermal groups retain their linked NO/NC/CO contacts after copying', () => {
  const project = projectWith([
    part('coil', 'coil', 'K1'), part('contact_no', 'no', 'k1'), part('contact_co', 'co', ' K1 '),
    part('timer_coil', 'timer', 'KT1'), part('timer_no', 'ton', 'KT1'), part('timer_nc', 'toff', 'KT1'),
    part('thermal', 'thermal', 'FR1'), part('contact_nc', 'nc', 'FR1'),
  ]);
  const result = pasteSelection(project, copySelection(project, project.devices.map(item => item.id)), {x: 40, y: 40}, newIds());
  assert.deepEqual(result.project.devices.slice(project.devices.length).map(item => item.name), ['K2', 'K2', 'K2', 'KT2', 'KT2', 'KT2', 'FR2', 'FR2']);
});

test('Unicode normalization links composed and decomposed names when reserving new designations', () => {
  const project = projectWith([part('coil', 'coil', 'ĐỆN1'), part('contact_no', 'contact', ' đện1 '.normalize('NFD')), part('coil', 'used', 'đện2'.normalize('NFD'))]);
  const result = pasteSelection(project, copySelection(project, ['coil', 'contact']), {x: 20, y: 20}, newIds());
  assert.deepEqual(result.project.devices.slice(-2).map(item => item.name), ['ĐỆN3', 'ĐỆN3']);
});

test('copying only auxiliary contacts or field windings retains the original apparatus name', () => {
  const project = projectWith([
    part('coil', 'coil', 'K1'), part('contact_no', 'contact', ' K1 '),
    part('dc_motor', 'motor', 'M1'), part('field_winding', 'field', 'm1'),
    part('timer_no', 'timed', 'KT1'),
  ]);
  const result = pasteSelection(project, copySelection(project, ['contact', 'field', 'timed']), {x: 20, y: 20}, newIds());
  assert.deepEqual(result.project.devices.slice(-3).map(item => item.name), [' K1 ', 'm1', 'KT1']);
});

test('an unrelated same-name part cannot rename a field or timed contact that it does not control', () => {
  const project = projectWith([part('coil', 'coil', 'M1'), part('field_winding', 'field', 'M1'), part('thermal', 'thermal', 'KT1'), part('timer_no', 'timed', 'KT1')]);
  const result = pasteSelection(project, copySelection(project, project.devices.map(item => item.id)), {x: 20, y: 20}, newIds());
  assert.deepEqual(result.project.devices.slice(-4).map(item => item.name), ['M2', 'M1', 'KT2', 'KT1']);
});

test('independent parts receive separate unused names even if the source names are duplicated', () => {
  const project = projectWith([part('lamp', 'a', 'H1'), part('lamp', 'b', ' h1 '), part('lamp', 'used', 'H2')]);
  const result = pasteSelection(project, copySelection(project, ['a', 'b']), {x: 20, y: 20}, newIds());
  assert.deepEqual(result.project.devices.slice(-2).map(item => item.name), ['H3', 'H4']);
});

test('maximum-length numeric names remain saveable after copying linked and independent parts', () => {
  const name = '9'.repeat(120);
  const project = projectWith([
    part('coil', 'coil', name), part('contact_no', 'contact', name),
    part('lamp', 'lamp', name), part('lamp', 'occupied', 'X1'),
  ]);
  assert.deepEqual(parseProject(serializeProject(project)), project);
  const result = pasteSelection(project, copySelection(project, ['coil', 'contact', 'lamp']), {x: 40, y: 40}, newIds());
  const names = result.project.devices.slice(-3).map(device => device.name);
  assert.equal(names[0], names[1], 'the copied coil and contact retain their shared designation');
  assert.notEqual(names[2], names[0], 'an independent part receives its own designation');
  for (const copiedName of names) {
    assert.ok(copiedName.length <= 120, 'generated names must fit the project file format');
    assert.ok(!project.devices.some(device => device.name === copiedName), 'generated names must be unused');
  }
  assert.deepEqual(parseProject(serializeProject(result.project)), result.project);
});

test('pressed momentary buttons return to rest while other physical control states are preserved', () => {
  const project = projectWith([
    {...part('push_no', 'start', 'S1'), enabled: true}, {...part('push_nc', 'stop', 'S2'), enabled: false},
    {...part('breaker1', 'breaker', 'Q1'), enabled: true}, {...part('thermal', 'thermal', 'FR1'), enabled: false},
  ]);
  const result = pasteSelection(project, copySelection(project, project.devices.map(item => item.id)), {x: 20, y: 20}, newIds());
  assert.deepEqual(result.project.devices.slice(-4).map(item => item.enabled), [false, true, true, false]);
});

test('empty selection, incomplete fragments and capacity failures leave the project unchanged', () => {
  const project = projectWith([part('lamp', 'lamp', 'H1')]);
  const fragment = copySelection(project, ['lamp']);
  assert.deepEqual(copySelection(project, ['missing']), {devices: [], wires: []});
  const full = projectWith(Array.from({length: 250}, (_, index) => part('lamp', `lamp-${index}`, `H${index}`)));
  const snapshot = structuredClone(full);
  assert.throws(() => pasteSelection(project, {devices: [], wires: []}, {x: 20, y: 20}), /Chưa có phần tử/);
  assert.throws(() => pasteSelection(full, fragment, {x: 20, y: 20}), /250/);
  assert.deepEqual(full, snapshot);
  const wired = projectWith([part('dc', 'source', 'G1'), part('lamp', 'load', 'H1')], [wire('wire', 'source', '+', 'load', '1')]);
  const fullWires = {...project, wires: Array.from({length: 750}, (_, index) => ({...wired.wires[0], id: `wire-${index}`}))};
  assert.throws(() => pasteSelection(fullWires, copySelection(wired, ['source', 'load']), {x: 20, y: 20}), /750/);
  assert.throws(() => pasteSelection(project, {...fragment, wires: wired.wires}, {x: 20, y: 20}), /ngoài nhóm/);
});

test('coordinate and ID generation failures do not partially modify the project or clipboard', () => {
  const project = projectWith([part('lamp', 'lamp', 'H1')]);
  const fragment = copySelection(project, ['lamp']), snapshot = structuredClone(project), clipboardSnapshot = structuredClone(fragment);
  assert.throws(() => pasteSelection(project, fragment, {x: 10000, y: 0}, newIds()), /giới hạn/);
  assert.throws(() => pasteSelection(project, fragment, {x: NaN, y: 0}, newIds()), /giới hạn/);
  assert.throws(() => pasteSelection(project, fragment, {x: 20, y: 20}, () => 'lamp'), /Không tạo được mã/);
  assert.deepEqual(project, snapshot); assert.deepEqual(fragment, clipboardSnapshot);
});
test('copied selector contacts and named nets retain internal links without joining the original circuit',()=>{
  const parts=[part('selector3','s','SA1'),part('contact_no','c','SA1'),part('net_label','net-a','LIVE'),part('offpage','net-b','live'),part('earth','pe','PE')];
  parts[0].params.position=-1;parts[1].params.actuationPosition=-1;
  const project=projectWith(parts),result=pasteSelection(project,copySelection(project,parts.map(p=>p.id)),{x:40,y:40},newIds());
  const copies=result.project.devices.slice(parts.length);
  assert.equal(copies[0].name,copies[1].name);assert.notEqual(copies[0].name,'SA1');
  assert.equal(copies[2].name,copies[3].name);assert.notEqual(copies[2].name,'LIVE');assert.equal(copies[4].name,'PE');
  assert.equal(copies[0].params.position,-1);assert.equal(copies[1].params.actuationPosition,-1);
  const single=pasteSelection(project,copySelection(project,['net-a']),{x:40,y:40},newIds());
  assert.equal(single.project.devices.at(-1)!.name,'LIVE');
});
