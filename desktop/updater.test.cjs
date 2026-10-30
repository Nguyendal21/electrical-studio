const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createUpdateController } = require('./updater.cjs');

function setup(responses = []) {
  const updater = new EventEmitter();
  const log = [], prompts = [];
  updater.checkForUpdates = async () => { log.push('check'); updater.emit('update-available', { version: '0.2.2' }); };
  updater.downloadUpdate = async () => { log.push('download'); updater.emit('download-progress', { percent: 50 }); };
  updater.quitAndInstall = (...args) => { log.push(['install', ...args]); };
  const window = { isDestroyed: () => false, setProgressBar: value => log.push(['progress', value]) };
  const controller = createUpdateController({ updater, getWindow: () => window, flushStorage: () => log.push('flush'), dialog: { showMessageBox: async (_window, options) => { prompts.push(options); return { response: responses.shift() ?? 1 }; } } });
  return { updater, controller, log, prompts, window };
}
test('declining never downloads and suppresses repeated prompts for this session', async () => {
  const { updater, controller, log, prompts } = setup([1]);
  await controller.check(); await controller.check();
  assert.equal(updater.autoDownload, false); assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(updater.allowDowngrade, false); assert.equal(prompts.length, 1);
  assert.ok(!log.includes('download'));
});
test('installation requires a second explicit choice and flushes drawings first', async () => {
  const { controller, log, prompts } = setup([0, 0]);
  await controller.check();
  assert.equal(prompts.length, 2);
  assert.ok(log.indexOf('download') < log.indexOf('flush'));
  assert.deepEqual(log[log.indexOf('flush') + 1], ['install', false, true]);
});
test('deferring installation leaves the old version running', async () => {
  const { controller, log } = setup([0, 1]);
  await controller.check();
  assert.ok(log.includes('download')); assert.ok(!log.includes('flush'));
  assert.ok(!log.some(entry => Array.isArray(entry) && entry[0] === 'install'));
});
test('offline checks are quiet and retry on the next check', async () => {
  const { controller, updater, prompts } = setup([1]);
  const original = updater.checkForUpdates;
  updater.checkForUpdates = async () => { const error = new Error('offline'); updater.emit('error', error); throw error; };
  await controller.check(); assert.equal(prompts.length, 0);
  updater.checkForUpdates = original; await controller.check(); assert.equal(prompts.length, 1);
});
test('failed downloads report the failure without installing', async () => {
  const { controller, updater, log, prompts } = setup([0]);
  updater.downloadUpdate = async () => { throw new Error('download interrupted'); };
  await controller.check(); assert.equal(prompts[1].type, 'warning'); assert.ok(!log.includes('flush'));
});
test('concurrent checks cannot show two prompts or download twice', async () => {
  const { controller, updater, log, prompts } = setup([0, 1]);
  const original = updater.checkForUpdates;
  let finish;
  updater.checkForUpdates = () => new Promise(resolve => { finish = async () => { await original(); resolve(); }; });
  const first = controller.check(); await controller.check(); await finish(); await first;
  assert.equal(log.filter(item => item === 'check').length, 1); assert.equal(prompts.length, 2);
});
test('no update or a closed window does not download', async () => {
  const { controller, updater, window, log, prompts } = setup([0]);
  const original = updater.checkForUpdates;
  updater.checkForUpdates = async () => {}; await controller.check();
  updater.checkForUpdates = original; window.isDestroyed = () => true; await controller.check();
  assert.equal(prompts.length, 0); assert.ok(!log.includes('download'));
});
