const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createDocumentFiles, trustedDocumentSender, MAX_DOCUMENT_BYTES } = require('./document-files.cjs');

const diagram = name => JSON.stringify({ version: 2, name, devices: [], wires: [] });
async function setup(t, replacements) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'electrical-files-test-'));
  t.after(async () => {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep + 'electrical-files-test-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  const picked = { open: null, save: null, conflict: 'cancel' };
  const calls = { open: 0, save: 0, conflict: 0 };
  const service = createDocumentFiles({ documentsPath: root,
    chooseOpen: async () => { calls.open++; return picked.open; },
    chooseSave: async () => { calls.save++; return picked.save; },
    confirmConflict: async () => { calls.conflict++; return picked.conflict; },
  }, replacements);
  return { root, picked, calls, service };
}

test('open grants a token; repeated saves replace the selected file atomically without another dialog', async t => {
  const { root, picked, calls, service } = await setup(t);
  picked.open = path.join(root, 'Mạch thử.electrical.json');
  await fs.writeFile(picked.open, diagram('Ban đầu'));
  const opened = await service.open();
  assert.equal(opened.content, diagram('Ban đầu'));
  assert.equal(opened.path, picked.open);
  assert.equal(opened.fileName, 'Mạch thử.electrical.json');
  const saved = await service.save({ documentId: opened.documentId, content: diagram('Sửa'), suggestedName: 'Other' });
  assert.equal(saved.documentId, opened.documentId);
  assert.equal(await fs.readFile(picked.open, 'utf8'), diagram('Sửa'));
  await service.save({ documentId: opened.documentId, content: diagram('Tự lưu'), automatic: true });
  assert.equal(await fs.readFile(picked.open, 'utf8'), diagram('Tự lưu'));
  assert.equal(calls.save, 0);
  assert.deepEqual(await fs.readdir(root), ['Mạch thử.electrical.json']);
});

test('new document and Save As use native selected destinations; cancellation preserves the old target', async t => {
  const { root, picked, service } = await setup(t);
  assert.equal(await service.open(), null);
  assert.equal(await service.save({ content: diagram('A'), suggestedName: 'A' }), null);
  picked.save = path.join(root, 'a.json');
  const first = await service.save({ content: diagram('A'), suggestedName: '../untrusted/path', path: path.join(root, 'forbidden.json') });
  picked.save = null;
  assert.equal(await service.save({ documentId: first.documentId, content: diagram('B'), saveAs: true }), null);
  assert.equal(await fs.readFile(first.path, 'utf8'), diagram('A'));
  picked.save = path.join(root, 'b.json');
  const second = await service.save({ documentId: first.documentId, content: diagram('B'), saveAs: true });
  assert.notEqual(first.documentId, second.documentId);
  assert.equal(await fs.readFile(second.path, 'utf8'), diagram('B'));
  assert.deepEqual((await fs.readdir(root)).sort(), ['a.json', 'b.json']);
});

test('automatic save cannot prompt or acquire a path; forged IDs cannot write', async t => {
  const { root, picked, calls, service } = await setup(t);
  picked.save = path.join(root, 'never.json');
  assert.equal(await service.save({ content: diagram('A'), automatic: true }), null);
  await assert.rejects(service.save({ documentId: picked.save, content: diagram('A') }), /không còn hợp lệ/);
  assert.equal(calls.save, 0);
  assert.deepEqual(await fs.readdir(root), []);
});

test('external changes block automatic saves and offer manual cancel, copy or overwrite', async t => {
  const { root, picked, calls, service } = await setup(t);
  picked.open = path.join(root, 'a.json');
  await fs.writeFile(picked.open, diagram('A'));
  const opened = await service.open();
  await fs.writeFile(picked.open, diagram('External'));
  const request = { documentId: opened.documentId, content: diagram('Local') };
  await assert.rejects(service.save({ ...request, automatic: true }), /thay đổi bên ngoài/);
  assert.equal(calls.conflict, 0);
  assert.equal(await service.save(request), null);
  assert.equal(await fs.readFile(picked.open, 'utf8'), diagram('External'));
  picked.conflict = 'saveAs';
  picked.save = path.join(root, 'copy.json');
  await service.save(request);
  assert.equal(await fs.readFile(picked.open, 'utf8'), diagram('External'));
  assert.equal(await fs.readFile(picked.save, 'utf8'), diagram('Local'));
  picked.conflict = 'overwrite';
  await service.save(request);
  assert.equal(await fs.readFile(picked.open, 'utf8'), diagram('Local'));
  await fs.unlink(picked.open);
  await assert.rejects(service.save({ ...request, automatic: true }), /thay đổi bên ngoài/);
});

test('invalid and oversized files do not become documents and cannot replace an existing file', async t => {
  const { root, picked, service } = await setup(t);
  picked.open = path.join(root, 'invalid.json');
  await fs.writeFile(picked.open, '{broken');
  await assert.rejects(service.open(), /JSON/);
  await fs.writeFile(picked.open, JSON.stringify({ version: 1, name: 'Old', devices: [], wires: [] }));
  await assert.rejects(service.open(), /phiên bản 2/);
  await fs.writeFile(picked.open, 'x'.repeat(MAX_DOCUMENT_BYTES + 1));
  await assert.rejects(service.open(), /2 MB/);
  await fs.writeFile(picked.open, diagram('Good'));
  const opened = await service.open();
  await assert.rejects(service.save({ documentId: opened.documentId, content: '{broken' }), /JSON/);
  await assert.rejects(service.save({ documentId: opened.documentId, content: 'x'.repeat(MAX_DOCUMENT_BYTES + 1) }), /2 MB/);
  assert.equal(await fs.readFile(picked.open, 'utf8'), diagram('Good'));
});

test('queued saves finish in request order and failed replacement cleans its temporary file', async t => {
  const { root, picked, service } = await setup(t);
  picked.save = path.join(root, 'a.json');
  const opened = await service.save({ content: diagram('A') });
  await Promise.all(['B', 'C', 'D'].map(name => service.save({ documentId: opened.documentId, content: diagram(name), automatic: true })));
  assert.equal(await fs.readFile(opened.path, 'utf8'), diagram('D'));
  picked.save = path.join(root, 'directory');
  await fs.mkdir(picked.save);
  await assert.rejects(service.save({ content: diagram('Cannot replace directory') }));
  assert.deepEqual((await fs.readdir(root)).sort(), ['a.json', 'directory']);
  await service.save({ documentId: opened.documentId, content: diagram('After failure') });
  assert.equal(await fs.readFile(opened.path, 'utf8'), diagram('After failure'));
});

test('IPC allows only the intended main frame in the app window', () => {
  const url = 'app://electrical-studio/index.html';
  const frame = { url };
  const window = { isDestroyed: () => false, webContents: { mainFrame: frame } };
  assert.equal(trustedDocumentSender({ sender: window.webContents, senderFrame: frame }, window, url), true);
  assert.equal(trustedDocumentSender({ sender: {}, senderFrame: frame }, window, url), false);
  assert.equal(trustedDocumentSender({ sender: window.webContents, senderFrame: { url } }, window, url), false);
  frame.url = 'https://example.com';
  assert.equal(trustedDocumentSender({ sender: window.webContents, senderFrame: frame }, window, url), false);
  assert.equal(trustedDocumentSender({}, undefined, url), false);
});

test('temporary Windows replacement locks retry the same atomic write and preserve the original until success', async t => {
  const delays = [], codes = ['EPERM', 'EACCES', 'EBUSY'];
  let attempts = 0;
  const { root, picked, calls, service } = await setup(t, {
    rename: async (temporary, destination) => {
      assert.equal(await fs.readFile(destination, 'utf8'), diagram('Original'));
      assert.equal(await fs.readFile(temporary, 'utf8'), diagram('Updated'));
      const code = codes[attempts++];
      if (code) throw Object.assign(new Error('Temporarily locked'), { code });
      await fs.rename(temporary, destination);
    },
    wait: async delay => { delays.push(delay); },
  });
  picked.open = path.join(root, 'locked.json');
  await fs.writeFile(picked.open, diagram('Original'));
  const opened = await service.open();
  const saved = await service.save({ documentId: opened.documentId, content: diagram('Updated'), automatic: true });
  assert.equal(saved.documentId, opened.documentId);
  assert.equal(attempts, 4);
  assert.deepEqual(delays, [25, 50, 100]);
  assert.equal(await fs.readFile(picked.open, 'utf8'), diagram('Updated'));
  assert.deepEqual(await fs.readdir(root), ['locked.json']);
  assert.equal(calls.conflict, 0);
  assert.equal(calls.save, 0);
});

test('persistent replacement locks exhaust bounded retries, preserve the original and allow queued saves to recover', async t => {
  let attempts = 0;
  const delays = [];
  const { root, picked, calls, service } = await setup(t, {
    rename: async (temporary, destination) => {
      attempts++;
      if (attempts <= 6) throw Object.assign(new Error('Still locked'), { code: 'EPERM' });
      // The failed save must clean its own temporary before the next queued save.
      assert.deepEqual((await fs.readdir(path.dirname(destination))).sort(), [path.basename(temporary), 'locked.json'].sort());
      assert.equal(await fs.readFile(destination, 'utf8'), diagram('Original'));
      await fs.rename(temporary, destination);
    },
    wait: async delay => { delays.push(delay); },
  });
  picked.open = path.join(root, 'locked.json');
  await fs.writeFile(picked.open, diagram('Original'));
  const opened = await service.open();
  const failed = assert.rejects(service.save({ documentId: opened.documentId, content: diagram('Failed'), automatic: true }), { code: 'EPERM' });
  const recovered = service.save({ documentId: opened.documentId, content: diagram('Recovered'), automatic: true });
  await failed;
  await recovered;
  assert.equal(attempts, 7);
  assert.deepEqual(delays, [25, 50, 100, 200, 400]);
  assert.equal(await fs.readFile(picked.open, 'utf8'), diagram('Recovered'));
  assert.deepEqual(await fs.readdir(root), ['locked.json']);
  assert.equal(calls.conflict, 0);
});

test('an external edit during replacement retry is preserved and requires a fresh conflict decision', async t => {
  let locked = true, attempts = 0;
  const { root, picked, calls, service } = await setup(t, {
    rename: async (temporary, destination) => {
      attempts++;
      if (locked) throw Object.assign(new Error('Temporarily locked'), { code: 'EBUSY' });
      await fs.rename(temporary, destination);
    },
    wait: async () => { await fs.writeFile(picked.open, diagram('External')); },
  });
  picked.open = path.join(root, 'edited.json');
  await fs.writeFile(picked.open, diagram('Original'));
  const opened = await service.open();
  const request = { documentId: opened.documentId, content: diagram('Local') };
  await assert.rejects(service.save({ ...request, automatic: true }), /thay đổi bên ngoài/);
  assert.equal(attempts, 1);
  assert.equal(calls.conflict, 0);
  assert.equal(await fs.readFile(picked.open, 'utf8'), diagram('External'));
  assert.deepEqual(await fs.readdir(root), ['edited.json']);
  locked = false;
  picked.conflict = 'overwrite';
  await service.save(request);
  assert.equal(calls.conflict, 1);
  assert.equal(await fs.readFile(picked.open, 'utf8'), diagram('Local'));
});

test('non-transient replacement errors are not retried and leave no temporary file', async t => {
  let attempts = 0;
  const { root, picked, service } = await setup(t, {
    rename: async () => { attempts++; throw Object.assign(new Error('No space'), { code: 'ENOSPC' }); },
    wait: async () => { assert.fail('A permanent error must not be retried.'); },
  });
  picked.open = path.join(root, 'unchanged.json');
  await fs.writeFile(picked.open, diagram('Original'));
  const opened = await service.open();
  await assert.rejects(service.save({ documentId: opened.documentId, content: diagram('Updated') }), { code: 'ENOSPC' });
  assert.equal(attempts, 1);
  assert.equal(await fs.readFile(picked.open, 'utf8'), diagram('Original'));
  assert.deepEqual(await fs.readdir(root), ['unchanged.json']);
});
