import test from 'node:test';
import assert from 'node:assert/strict';
import { createDevice } from './catalog';
import { protectionFunctions } from './protection';
import { createInitialState, stepSimulation, validateProject } from './simulation';
import type { DeviceKind, Project, Wire } from './types';

const device = (kind: DeviceKind, id: string, name = id) => ({ ...createDevice(kind, id, 0, 0), name });
const wire = (id: string, from: string, fromPort: string, to: string, toPort: string): Wire => ({ id, from, fromPort, to, toPort, length: 1, section: 2.5 });

function fixture() {
  const relay = device('protection_relay', 'relay', ' RP1 ');
  const supplySwitch = device('breaker1', 'supply-switch');
  supplySwitch.enabled = true;
  const project: Project = {
    version: 2, name: 'Protection relay functional test',
    devices: [device('dc', 'source'), supplySwitch, relay,
      device('contact_no', 'no', 'rp1'), device('contact_nc', 'nc', 'RP1'), device('contact_co', 'co', 'RP1'),
      device('lamp', 'no-load'), device('lamp', 'nc-load'), device('lamp', 'co-no-load'), device('lamp', 'co-nc-load')],
    wires: [
      wire('supply-feed', 'source', '+', 'supply-switch', '1'), wire('supply-switched', 'supply-switch', '2', 'relay', 'A1'), wire('supply-return', 'relay', 'A2', 'source', '-'),
      wire('no-feed', 'source', '+', 'no', '13'), wire('no-output', 'no', '14', 'no-load', '1'), wire('no-return', 'no-load', '2', 'source', '-'),
      wire('nc-feed', 'source', '+', 'nc', '21'), wire('nc-output', 'nc', '22', 'nc-load', '1'), wire('nc-return', 'nc-load', '2', 'source', '-'),
      wire('co-feed', 'source', '+', 'co', '11'), wire('co-no-output', 'co', '14', 'co-no-load', '1'), wire('co-no-return', 'co-no-load', '2', 'source', '-'),
      wire('co-nc-output', 'co', '12', 'co-nc-load', '1'), wire('co-nc-return', 'co-nc-load', '2', 'source', '-'),
    ],
  };
  let state = createInitialState(project);
  return { project, relay, supplySwitch, tick(dt = .1) { state = stepSimulation(project, state, dt); return state; } };
}

test('all configured protection functions use an explicit powered fault test and operate named NO/NC/CO contacts', () => {
  for (const option of protectionFunctions) {
    const circuit = fixture();
    circuit.relay.params.protectionFunction = option.value;
    assert.deepEqual(validateProject(circuit.project), []);
    let state = circuit.tick();
    assert.equal(state.devices.relay.coilEnergized, true, option.label);
    assert.equal(state.devices.relay.tripped, false, option.label);
    assert.equal(state.devices['nc-load'].energized, true);
    assert.equal(state.devices['co-nc-load'].energized, true);
    assert.equal(state.devices['no-load'].energized, false);
    assert.equal(state.devices['co-no-load'].energized, false);

    circuit.relay.enabled = false;
    state = circuit.tick();
    assert.equal(state.devices.relay.tripped, true, option.label);
    assert.equal(state.devices['no-load'].energized, true, option.label);
    assert.equal(state.devices['co-no-load'].energized, true);
    assert.equal(state.devices['nc-load'].energized, false);
    assert.equal(state.devices['co-nc-load'].energized, false);
    assert.match(state.devices.relay.status, /thử sự cố/);
    assert.equal(state.devices.relay.current, 0, 'unit solver values are not published as measurements');
    assert.equal(state.devices.relay.voltage, 0);
    assert.equal(state.events.length, 0, 'auxiliary supply must behave as a load, not a short circuit');

    circuit.relay.enabled = true;
    state = circuit.tick();
    assert.equal(state.devices.relay.tripped, false);
    assert.equal(state.devices['no-load'].energized, false);
    assert.equal(state.devices['nc-load'].energized, true);
  }
});

test('protection fault input cannot operate a relay with an open auxiliary supply or a missing return', () => {
  const circuit = fixture();
  circuit.relay.enabled = false;
  circuit.supplySwitch.enabled = false;
  let state = circuit.tick();
  assert.equal(state.devices.relay.tripped, false);
  assert.equal(state.devices.relay.coilEnergized, false);
  assert.equal(state.devices['no-load'].energized, false);
  assert.equal(state.devices['nc-load'].energized, true);

  circuit.supplySwitch.enabled = true;
  state = circuit.tick();
  assert.equal(state.devices.relay.tripped, true);
  assert.equal(state.devices['no-load'].energized, true);
  circuit.project.wires = circuit.project.wires.filter(item => item.id !== 'supply-return');
  state = circuit.tick();
  assert.equal(state.devices.relay.tripped, false);
  assert.equal(state.devices.relay.coilEnergized, false);
  assert.equal(state.devices['no-load'].energized, false);
  assert.equal(state.devices['nc-load'].energized, true);
});

test('fault delay advances once per simulation tick and trips exactly at its configured delay', () => {
  const circuit = fixture();
  circuit.relay.enabled = false;
  circuit.relay.params.delaySeconds = .6;
  let state = circuit.tick(.2);
  assert.equal(state.devices.relay.timerElapsed, .2);
  assert.equal(state.devices.relay.timerPending, true);
  assert.equal(state.devices['no-load'].energized, false);
  state = circuit.tick(.2);
  assert.equal(state.devices.relay.timerElapsed, .4);
  assert.equal(state.devices.relay.tripped, false);
  state = circuit.tick(.2);
  assert.equal(state.devices.relay.timerElapsed, .6, 'feedback passes must not add extra elapsed time');
  assert.equal(state.devices.relay.timerPending, false);
  assert.equal(state.devices.relay.tripped, true);
  assert.equal(state.devices['no-load'].energized, true);
  assert.equal(state.devices['nc-load'].energized, false);
});

test('fault reset, lost power, and function changes cancel elapsed protection delay', () => {
  const circuit = fixture();
  circuit.relay.params.delaySeconds = .6;
  circuit.relay.enabled = false;
  circuit.tick(.4);
  circuit.relay.enabled = true;
  let state = circuit.tick(.1);
  assert.equal(state.devices.relay.timerElapsed, 0);
  assert.equal(state.devices.relay.timerPending, false);

  circuit.relay.enabled = false;
  state = circuit.tick(.2);
  assert.equal(state.devices.relay.timerElapsed, .2);
  circuit.supplySwitch.enabled = false;
  state = circuit.tick(.2);
  assert.equal(state.devices.relay.timerElapsed, 0);
  assert.equal(state.devices.relay.tripped, false);
  circuit.supplySwitch.enabled = true;
  state = circuit.tick(.2);
  assert.equal(state.devices.relay.timerElapsed, .2);

  circuit.relay.params.protectionFunction = 3;
  state = circuit.tick(.2);
  assert.equal(state.devices.relay.timerElapsed, .2, 'a new function begins a fresh fault delay');
  assert.equal(state.devices.relay.protectionFunction, 3);
  assert.equal(state.devices.relay.tripped, false);
  circuit.tick(.4);
  circuit.supplySwitch.enabled = false;
  state = circuit.tick(.1);
  assert.equal(state.devices.relay.tripped, false, 'a tripped output releases on loss of auxiliary power');
  assert.equal(state.devices['nc-load'].energized, true);
  circuit.supplySwitch.enabled = true;
  state = circuit.tick(.2);
  assert.equal(state.devices.relay.tripped, false);
  assert.equal(state.devices.relay.timerElapsed, .2);
});

test('protection relay test state only controls ordinary contacts with the same apparatus name', () => {
  const circuit = fixture();
  circuit.relay.enabled = false;
  circuit.project.devices.find(item => item.id === 'no')!.name = 'OTHER';
  const state = circuit.tick();
  assert.equal(state.devices.relay.tripped, true);
  assert.equal(state.devices['no-load'].energized, false);
  assert.equal(state.devices['co-no-load'].energized, true);
});
