import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect } from '@playwright/test';

// Run against the packaged executable, never the development server. A fresh
// profile keeps the checks independent of the user's own diagrams/preferences.
// Usage: node scripts/smoke-desktop.mjs [path/to/Electrical Studio.exe]
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executablePath = path.resolve(root, process.argv[2] ?? 'release/win-unpacked/Electrical Studio.exe');
const artifactsRoot = path.join(root, 'tmp-references');
await access(executablePath);
await mkdir(artifactsRoot, { recursive: true });
const artifacts = await mkdtemp(path.join(artifactsRoot, 'desktop-smoke-'));
const profile = path.join(artifacts, 'isolated profile');
const exportPath = path.join(artifacts, 'exported.electrical.json');
const storageKey = 'electrical-studio.project.v2';
const preferenceKey = 'electrical-studio.terminal-labels';
const rendererErrors = [];
const externalRequests = [];
let app;
let page;

const button = name => page.getByRole('button', { name, exact: true });
const savedProject = () => page.evaluate(key => JSON.parse(localStorage.getItem(key) || 'null'), storageKey);

async function launchOffline() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath, args: [`--user-data-dir=${profile}`], env, timeout: 60_000 });
  page = await app.firstWindow();
  page.on('pageerror', error => rendererErrors.push(error.message));
  page.on('request', request => {
    if (/^https?:/i.test(request.url())) externalRequests.push(request.url());
  });
  // Install both a network deny rule and Chromium's offline mode, then reload
  // so HTML, scripts, styles, and fonts all have to load from the package.
  await app.evaluate(({ session, BrowserWindow }) => {
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ['http://*/*', 'https://*/*'] },
      (_details, callback) => callback({ cancel: true }),
    );
    BrowserWindow.getAllWindows()[0]?.setBounds({ width: 1440, height: 960 });
  });
  await page.context().setOffline(true);
  await page.waitForURL('app://electrical-studio/index.html');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('.react-flow')).toBeVisible();
  await expect(button('Chạy mô phỏng')).toBeEnabled();
  assert.equal(new URL(page.url()).protocol, 'app:', 'The packaged UI must use its local app protocol.');
  const resources = await page.evaluate(async () => {
    const vietnamese = await document.fonts.load('400 16px "Be Vietnam Pro"', 'Điện áp');
    const mono = await document.fonts.load('400 14px "IBM Plex Mono"', 'M1');
    await document.fonts.ready;
    return {
      stylesheets: Array.from(document.styleSheets, sheet => ({ href: sheet.href, rules: sheet.cssRules.length })),
      fonts: [vietnamese, mono].map(faces => faces.map(face => ({ family: face.family, status: face.status }))),
      canvasHeight: document.querySelector('.react-flow').getBoundingClientRect().height,
      resources: performance.getEntriesByType('resource').map(resource => resource.name),
    };
  });
  assert.ok(resources.stylesheets.some(sheet => sheet.rules > 0 && sheet.href?.startsWith('app:')), 'Bundled styles must load.');
  assert.ok(resources.canvasHeight > 500, 'The drawing area must have its styled layout.');
  for (const faces of resources.fonts) {
    assert.ok(faces.length > 0, 'Both bundled font families must resolve without the internet.');
    assert.ok(faces.every(face => face.status === 'loaded'), 'Requested font subsets must finish loading.');
  }
  assert.ok(resources.resources.every(url => !/^https?:/i.test(url)), 'No asset may depend on an online URL.');
}

async function exportProject() {
  // Setting the save path bypasses the native file picker but exercises the
  // renderer's Blob download and Electron's real download implementation.
  const completed = app.evaluate(({ session }, outputPath) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The project download did not finish.')), 20_000);
    session.defaultSession.once('will-download', (_event, item) => {
      item.setSavePath(outputPath);
      item.once('done', (_event, state) => {
        clearTimeout(timer);
        if (state === 'completed') resolve(item.getSavePath());
        else reject(new Error(`The project download ended with state: ${state}`));
      });
    });
  }), exportPath);
  await button('Lưu tệp').click();
  await completed;
  return JSON.parse(await readFile(exportPath, 'utf8'));
}

try {
  await launchOffline();
  const initial = await savedProject();
  assert.ok(initial?.devices.some(device => device.id === 'motor-dc'), 'A fresh installation must load the DC example.');
  await expect(page.locator('.react-flow__node')).toHaveCount(initial.devices.length);
  await expect(page.locator('.react-flow__edge')).toHaveCount(initial.wires.length);
  const motor = page.locator('.react-flow__node[data-id="motor-dc"] .equipment-node');
  await expect(motor.locator('.motor-direction')).toHaveCount(0);
  await button('Chạy mô phỏng').click();
  await expect(motor).toHaveClass(/\blive\b/);
  await expect(motor.locator('.motor-direction')).toBeVisible();
  await expect(motor.locator('.motor-direction')).toHaveAttribute('data-direction', 'clockwise');
  await expect(motor.locator('.motor-direction')).toHaveAttribute('data-moving', 'true');
  await button('Tạm dừng').click();
  await expect(motor.locator('.motor-direction')).toHaveAttribute('data-moving', 'false');
  await page.screenshot({ path: path.join(artifacts, 'packaged-offline-motor.png'), scale: 'css' });

  await page.getByRole('textbox', { name: 'Tên dự án', exact: true }).fill('Kiểm tra bản chia sẻ · desktop');
  await button('Ẩn số đầu cực').click();
  await expect(button('Hiện số đầu cực')).toBeVisible();
  await expect.poll(async () => (await savedProject()).name).toBe('Kiểm tra bản chia sẻ · desktop');
  const edited = await savedProject();
  assert.deepEqual(await exportProject(), edited, 'Saving a file must preserve the complete diagram.');

  const imported = { ...edited, name: 'Mạch nhập lại · desktop' };
  await page.locator('input[type="file"]').setInputFiles({
    name: 'desktop-roundtrip.electrical.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(imported)),
  });
  await expect(page.getByRole('textbox', { name: 'Tên dự án', exact: true })).toHaveValue(imported.name);
  await expect.poll(savedProject).toEqual(imported);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), preferenceKey), 'hidden');
  await app.close();
  app = undefined;

  await launchOffline();
  await expect(page.getByRole('textbox', { name: 'Tên dự án', exact: true })).toHaveValue(imported.name);
  assert.deepEqual(await savedProject(), imported, 'The diagram must persist after exiting and reopening the executable.');
  await expect(button('Hiện số đầu cực')).toBeVisible();
  await expect(page.locator('.react-flow__node')).toHaveCount(imported.devices.length);
  await expect(page.locator('.react-flow__edge')).toHaveCount(imported.wires.length);
  await button('Chạy mô phỏng').click();
  await expect(page.locator('.react-flow__node[data-id="motor-dc"] .motor-direction')).toBeVisible();
  await page.screenshot({ path: path.join(artifacts, 'packaged-restored.png'), scale: 'css' });
  assert.deepEqual(rendererErrors, [], 'The packaged renderer must not report uncaught errors.');
  assert.deepEqual(externalRequests, [], 'The packaged app must not request external HTTP(S) resources.');
  console.log(`Desktop smoke checks passed: offline assets/fonts, DC rotation, file round trip, saved diagram and preferences after restart.\nArtifacts: ${artifacts}`);
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: path.join(artifacts, 'failure.png'), scale: 'css' }).catch(() => {});
  throw error;
} finally {
  if (app) await app.close();
}
