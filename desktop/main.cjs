const { app, BrowserWindow, dialog, Menu, net, protocol, session } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { mkdirSync } = require('node:fs');
const { createUpdateController } = require('./updater.cjs');

const origin = 'app://electrical-studio';
app.setName('Electrical Studio');
app.setAppUserModelId('vn.electricalstudio.app');
// Keep drawings when the portable EXE moves or extracts to a new temp folder.
const profile = app.commandLine.getSwitchValue('user-data-dir') || path.join(app.getPath('appData'), 'Electrical Studio');
mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

let mainWindow;
const contentPolicy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'";

async function serveApp(request) {
  try {
    const url = new URL(request.url);
    if (url.host !== 'electrical-studio' || !['GET', 'HEAD'].includes(request.method)) return new Response('', { status: 403 });
    const root = path.join(app.getAppPath(), 'dist');
    const filename = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    const relative = path.relative(root, filename);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return new Response('', { status: 403 });
    const result = await net.fetch(pathToFileURL(filename).href);
    const headers = new Headers(result.headers);
    headers.set('Content-Security-Policy', contentPolicy);
    return new Response(result.body, { status: result.status, headers });
  } catch {
    return new Response('File not found', { status: 404 });
  }
}

function openWindow() {
  mainWindow = new BrowserWindow({
    title: 'Electrical Studio', width: 1440, height: 960, minWidth: 900, minHeight: 620,
    show: false, backgroundColor: '#f7f8fa', autoHideMenuBar: true,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, target) => {
    if (target !== `${origin}/index.html`) event.preventDefault();
  });
  mainWindow.once('ready-to-show', () => { mainWindow.maximize(); mainWindow.show(); });
  mainWindow.on('closed', () => { mainWindow = undefined; });
  mainWindow.loadURL(`${origin}/index.html`).catch(error => {
    dialog.showErrorBox('Electrical Studio', `Không mở được ứng dụng.\n${error.message}`);
    app.quit();
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow?.isMinimized()) mainWindow.restore();
    mainWindow?.show(); mainWindow?.focus();
  });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    protocol.handle('app', serveApp);
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.on('will-download', (_event, item) => {
      item.setSaveDialogOptions({
        title: 'Lưu sơ đồ điện', defaultPath: path.join(app.getPath('documents'), item.getFilename()),
        filters: [{ name: 'Sơ đồ Electrical Studio', extensions: ['json'] }],
      });
    });
    openWindow();
    // Installed Windows builds support NSIS updates. Portable builds and local
    // development never try to replace themselves with an installer.
    if (app.isPackaged && process.platform === 'win32' && !process.env.PORTABLE_EXECUTABLE_FILE) {
      const { autoUpdater } = require('electron-updater');
      const updates = createUpdateController({ updater: autoUpdater, dialog, getWindow: () => mainWindow, flushStorage: () => session.defaultSession.flushStorageData() });
      const firstCheck = setTimeout(() => updates.check(), 15000);
      const periodicCheck = setInterval(() => updates.check(), 4 * 60 * 60 * 1000);
      firstCheck.unref(); periodicCheck.unref();
      app.on('before-quit', () => { clearTimeout(firstCheck); clearInterval(periodicCheck); });
    }
  });
  app.on('window-all-closed', () => app.quit());
}
