import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect } from '@playwright/test';

// Exercise an OLD packaged build against its REAL public GitHub update feed.
// No feed/version/checksum/download implementation is mocked. Only native user
// choices are automated. Installer entry points are blocked as a final guard.
// Usage: node scripts/smoke-update-feed.mjs [older-app.exe] [timeout-minutes>=5]
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executablePath = path.resolve(root, process.argv[2] ?? 'release/win-unpacked/Electrical Studio.exe');
const timeoutMinutes = Number(process.argv[3] ?? 10);
assert.ok(Number.isFinite(timeoutMinutes) && timeoutMinutes >= 5, 'Timeout must be at least five minutes.');
assert.equal(process.platform, 'win32', 'This smoke test exercises the Windows NSIS updater.');
await access(executablePath);
const artifactsRoot = path.join(root, 'tmp-references');
await mkdir(artifactsRoot, { recursive: true });
const artifacts = await mkdtemp(path.join(artifactsRoot, 'update-feed-smoke-'));
const profile = path.join(artifacts, 'isolated profile');
const cacheRoot = path.join(artifacts, 'LocalAppData');
const roaming = path.join(artifacts, 'AppData');
const temporary = path.join(artifacts, 'Temp');
const mainReportPath = path.join(artifacts, 'updater-events.json');
await Promise.all([profile, cacheRoot, roaming, temporary].map(directory => mkdir(directory, { recursive: true })));
const storageKey = 'electrical-studio.project.v2';
const logs = [];
const rendererErrors = [];
let app;
let page;
let report;

function requireInside(directory, filename) {
  const relative = path.relative(directory, filename);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), `Path must stay inside the isolated test directory: ${filename}`);
}

async function snapshot() {
  return app.evaluate(() => globalThis.__electricalUpdateSmoke.snapshot());
}

try {
  const env = { ...process.env, LOCALAPPDATA: cacheRoot, APPDATA: roaming, TEMP: temporary, TMP: temporary };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.PORTABLE_EXECUTABLE_FILE;
  delete env.PORTABLE_EXECUTABLE_DIR;
  delete env.PORTABLE_EXECUTABLE_APP_FILENAME;
  app = await electron.launch({ executablePath, args: [`--user-data-dir=${profile}`], env, timeout: 60_000 });
  app.process().stdout?.on('data', data => logs.push(data.toString()));
  app.process().stderr?.on('data', data => logs.push(data.toString()));

  // Attach before the production 15-second startup check. The actual updater
  // controller retains all its own flags, scheduling, and public feed config.
  const installed = await app.evaluate(async ({ app, dialog, BrowserWindow }, reportPath) => {
    await app.whenReady();
    const { autoUpdater: updater } = process.mainModule.require('electron-updater');
    const fs = process.mainModule.require('node:fs');
    const state = {
      version: app.getVersion(), userData: app.getPath('userData'),
      localAppData: process.env.LOCALAPPDATA, baseCachePath: updater.app.baseCachePath,
      attachedAtUptime: process.uptime(), events: [], dialogs: [], errors: [],
      blockedInstallCalls: [], progressEvents: 0, lastPercent: 0,
    };
    const record = (type, details = {}) => {
      const event = { sequence: state.events.length + 1, at: new Date().toISOString(), type, ...details };
      state.events.push(event);
      return event;
    };
    const getSnapshot = () => ({
      ...state, autoDownload: updater.autoDownload, autoInstallOnAppQuit: updater.autoInstallOnAppQuit,
      currentVersion: updater.currentVersion.version,
      windowIds: BrowserWindow.getAllWindows().map(window => window.id),
      cachedFile: updater.downloadedUpdateHelper?.file ?? null,
      cachedFileInfo: updater.downloadedUpdateHelper?.downloadedFileInfo ?? null,
    });
    const writeReport = () => fs.writeFileSync(reportPath, JSON.stringify(getSnapshot(), null, 2));
    // Never execute NSIS, even if a future consent-flow regression attempts it.
    for (const method of ['quitAndInstall', 'install', 'doInstall']) {
      updater[method] = (...args) => {
        state.blockedInstallCalls.push(record('blocked-install', { method, args }));
        writeReport();
        return false;
      };
    }
    dialog.showMessageBox = async (...args) => {
      const options = args.at(-1);
      const download = options.buttons?.[0] === 'Tải cập nhật';
      const install = options.buttons?.[0] === 'Cài và mở lại';
      const response = download ? 0 : install ? 1 : 0;
      state.dialogs.push(record('dialog', {
        title: options.title, message: options.message, buttons: options.buttons,
        response, kind: download ? 'download' : install ? 'install' : 'unexpected',
        downloadedBeforePrompt: state.events.filter(event => event.type === 'update-downloaded').length,
      }));
      return { response, checkboxChecked: false };
    };
    updater.on('checking-for-update', () => record('checking-for-update'));
    updater.on('update-available', info => {
      state.available = info;
      state.isNewer = updater.currentVersion.compare(info.version) < 0;
      state.resolvedFiles = updater.updateInfoAndProvider.provider.resolveFiles(info).map(file => ({ url: file.url.href, info: file.info }));
      record('update-available', { version: info.version });
    });
    updater.on('update-not-available', info => record('update-not-available', { version: info.version }));
    updater.on('download-progress', progress => {
      state.progressEvents += 1;
      const percent = Math.floor(progress.percent);
      if (percent !== state.lastPercent) record('download-progress', { percent, transferred: progress.transferred, total: progress.total });
      state.lastPercent = percent;
    });
    updater.on('update-downloaded', info => {
      state.downloaded = info;
      record('update-downloaded', { version: info.version, downloadedFile: info.downloadedFile });
    });
    updater.on('error', error => {
      state.errors.push({ message: error.message, code: error.code });
      record('error', { message: error.message, code: error.code });
    });
    app.on('quit', () => { record('app-quit'); writeReport(); });
    globalThis.__electricalUpdateSmoke = { snapshot: getSnapshot, writeReport };
    state.feed = await updater.configOnDisk.value;
    return getSnapshot();
  }, mainReportPath);
  assert.ok(installed.attachedAtUptime < 14, 'Instrumentation must attach before the 15-second startup update check.');
  assert.equal(installed.userData, profile);
  assert.equal(installed.localAppData, cacheRoot);
  assert.equal(installed.baseCachePath, cacheRoot);
  assert.equal(installed.autoDownload, false, 'Production code must require consent before downloading.');
  assert.equal(installed.autoInstallOnAppQuit, false, 'Production code must not install a declined update on exit.');
  assert.equal(installed.feed.provider, 'github');
  assert.equal(installed.feed.owner, 'Nguyendal21');
  assert.equal(installed.feed.repo, 'electrical-studio');

  page = await app.firstWindow();
  page.on('pageerror', error => rendererErrors.push(error.message));
  await page.waitForURL('app://electrical-studio/index.html');
  await expect(page.locator('.react-flow')).toBeVisible();
  const name = 'Bản vẽ giữ lại sau khi hoãn cập nhật';
  await page.getByRole('textbox', { name: 'Tên dự án', exact: true }).fill(name);
  const savedProject = () => page.evaluate(key => JSON.parse(localStorage.getItem(key) || 'null'), storageKey);
  await expect.poll(async () => (await savedProject())?.name).toBe(name);
  const before = await savedProject();
  const windowIds = (await snapshot()).windowIds;
  await page.getByRole('button', { name: 'Chạy mô phỏng', exact: true }).click();
  await expect(page.locator('.react-flow__node[data-id="motor-dc"] .equipment-node')).toHaveClass(/\blive\b/);
  console.log(`Checking the public GitHub feed from packaged version ${installed.version}. Artifacts: ${artifacts}`);

  const deadline = Date.now() + timeoutMinutes * 60_000;
  let lastStatus = '';
  for (;;) {
    report = await snapshot();
    assert.deepEqual(report.errors, [], 'The real feed check/download must complete without updater errors.');
    assert.deepEqual(report.blockedInstallCalls, [], 'The app must never attempt installation after the declined prompt.');
    assert.ok(!report.events.some(event => event.type === 'update-not-available'), `No newer version was offered to ${report.version}; publish a newer stable release or choose an older executable.`);
    assert.ok(!report.dialogs.some(prompt => prompt.kind === 'unexpected'), 'The controller showed an unexpected warning/dialog.');
    const status = `${report.available?.version ?? 'checking'} · ${report.lastPercent}% · ${report.dialogs.length} prompts`;
    if (status !== lastStatus) { console.log(status); lastStatus = status; }
    if (report.dialogs.some(prompt => prompt.kind === 'install')) break;
    assert.ok(Date.now() < deadline, `Timed out after ${timeoutMinutes} minutes waiting for the real update download.`);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  assert.equal(report.isNewer, true, 'The real feed version must be newer than the executable version.');
  assert.deepEqual(report.dialogs.map(prompt => [prompt.kind, prompt.response]), [['download', 0], ['install', 1]]);
  assert.equal(report.events.filter(event => event.type === 'checking-for-update').length, 1);
  assert.equal(report.events.filter(event => event.type === 'update-available').length, 1);
  assert.equal(report.events.filter(event => event.type === 'update-downloaded').length, 1);
  assert.equal(report.dialogs[0].downloadedBeforePrompt, 0, 'The download-consent prompt must precede the download.');
  assert.equal(report.dialogs[1].downloadedBeforePrompt, 1, 'The install prompt must follow a successfully verified download.');
  assert.equal(report.downloaded.version, report.available.version);
  assert.equal(report.currentVersion, installed.version, 'Declining installation must leave the running version unchanged.');
  assert.ok(report.resolvedFiles.some(file => new URL(file.url).host === 'github.com' && new URL(file.url).pathname.startsWith('/Nguyendal21/electrical-studio/releases/download/')),
    'The updater must resolve installer assets from the real public GitHub release.');
  const downloadedPath = report.downloaded.downloadedFile;
  requireInside(cacheRoot, downloadedPath);
  assert.equal(report.cachedFile, downloadedPath);
  assert.ok(report.cachedFileInfo?.sha512, 'The updater must store the verified SHA-512 from release metadata.');
  const publishedFile = report.available.files.find(file => file.sha512 === report.cachedFileInfo.sha512);
  assert.ok(publishedFile, 'The cached installer checksum must match a file in the actual feed metadata.');
  const downloadStat = await stat(downloadedPath);
  assert.ok(downloadStat.isFile() && downloadStat.size > 0, 'The downloaded installer must exist in the isolated cache.');
  if (publishedFile.size != null) assert.equal(downloadStat.size, publishedFile.size);
  const hash = createHash('sha512');
  for await (const chunk of createReadStream(downloadedPath)) hash.update(chunk);
  assert.equal(hash.digest('base64'), publishedFile.sha512, 'Independent SHA-512 verification must match the actual public feed.');

  assert.equal(page.isClosed(), false);
  assert.deepEqual((await snapshot()).windowIds, windowIds, 'Declining installation must retain the same application window.');
  assert.deepEqual(await savedProject(), before, 'The open circuit must survive the update prompts unchanged.');
  await expect(page.getByRole('textbox', { name: 'Tên dự án', exact: true })).toHaveValue(name);
  await expect(page.locator('.react-flow__node')).toHaveCount(before.devices.length);
  await expect(page.locator('.react-flow__edge')).toHaveCount(before.wires.length);
  await expect(page.locator('.react-flow__node[data-id="motor-dc"] .equipment-node')).toHaveClass(/\blive\b/);
  await page.getByRole('button', { name: 'Tạm dừng', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Chạy mô phỏng', exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(artifacts, 'update-declined-circuit-preserved.png'), scale: 'css' });
  assert.deepEqual(rendererErrors, []);
  report = await snapshot();
  assert.equal(report.autoInstallOnAppQuit, false);
  assert.deepEqual(report.blockedInstallCalls, []);
  await app.close();
  app = undefined;
  const afterQuit = JSON.parse(await readFile(mainReportPath, 'utf8'));
  assert.deepEqual(afterQuit.blockedInstallCalls, [], 'Closing the app after declining must not attempt installation.');
  assert.ok(afterQuit.events.some(event => event.type === 'app-quit'));
  console.log(`Real update feed passed: ${installed.version} → ${report.available.version}; downloaded ${downloadStat.size} bytes, verified SHA-512, declined installation, retained circuit, and exited without installing.\nArtifacts: ${artifacts}`);
} catch (error) {
  if (app) {
    await app.evaluate(() => globalThis.__electricalUpdateSmoke?.writeReport()).catch(() => {});
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(artifacts, 'failure.png'), scale: 'css' }).catch(() => {});
  }
  console.error(`Update smoke failed. Artifacts: ${artifacts}`);
  throw error;
} finally {
  if (app) await app.close();
  await writeFile(path.join(artifacts, 'electron.log'), logs.join(''), 'utf8');
}
