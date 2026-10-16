'use strict';
/*
 * Evidence zakázek – desktopové okno (Electron).
 * Spustí lokální server nad společnou databází a zobrazí ho v okně aplikace (ne v prohlížeči).
 */
const { app, BrowserWindow, Menu, dialog, nativeTheme, shell, screen, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { startServer, loadConfig, readText } = require('./server');

const argv = process.argv.slice(1);
const arg = (name) => {
  const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  return hit.includes('=') ? hit.slice(name.length + 3) : true;
};

const TITLEBAR_H = 56;
const THEME = {
  light: { color: '#ffffff', symbolColor: '#1c2420', background: '#f4f6f4' },
  dark: { color: '#151a17', symbolColor: '#e8eee9', background: '#0f1311' },
};

let win = null;
let backend = null;

app.setAppUserModelId('cz.evidence.zakazek');
// pevná cesta k profilu (bez diacritiky), aby do ní mohl instalátor zapsat nastavení a přežila aktualizace
app.setPath('userData', path.join(app.getPath('appData'), 'EvidenceZakazek'));

// ---------- uživatelské nastavení (vzhled, počet řádků…) v profilu uživatele ----------
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
let settings = {};
function loadSettings() { try { settings = JSON.parse(fs.readFileSync(settingsPath(), 'utf8')); } catch { settings = {}; } }
function saveSettings() { try { fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2)); } catch { /* nevadí */ } }
const THEMES = ['system', 'light', 'dark'];
function applyThemeSetting() {
  nativeTheme.themeSource = arg('theme') ? String(arg('theme')) : (THEMES.includes(settings.theme) ? settings.theme : 'system');
}
ipcMain.handle('settings:get', () => settings);
ipcMain.handle('settings:set', (_e, key, value) => {
  if (!['theme', 'pageSize'].includes(key)) return settings;
  if (key === 'theme' && !THEMES.includes(value)) return settings;
  settings[key] = value;
  saveSettings();
  if (key === 'theme') applyThemeSetting(); // přepne i vzhled stránky (prefers-color-scheme) a lištu okna
  return settings;
});

// ---------- aktualizace programu (GitHub Releases) ----------
// Stav: idle | checking | available | downloading | downloaded | uptodate | error | unsupported
let update = { state: app.isPackaged ? 'idle' : 'unsupported', current: app.getVersion() };
let autoUpdater = null;
function setUpdate(patch) {
  update = { ...update, ...patch };
  if (win && !win.isDestroyed()) win.webContents.send('update:state', update);
}
function initUpdater() {
  if (!app.isPackaged || arg('smoke')) return; // ve vývoji ani při zkouškách se neaktualizuje
  ({ autoUpdater } = require('electron-updater'));
  // zdroj aktualizací nastaven přímo v kódu (nespoléhá na app-update.yml, který u předsestavené složky nemusí vzniknout)
  autoUpdater.setFeedURL({ provider: 'github', owner: '0NDINEK', repo: 'eZAKAZKY' });
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => setUpdate({ state: 'checking', error: undefined }));
  autoUpdater.on('update-available', (i) => setUpdate({ state: 'available', version: i.version, percent: 0 }));
  autoUpdater.on('update-not-available', () => setUpdate({ state: 'uptodate', version: undefined }));
  autoUpdater.on('download-progress', (p) => setUpdate({ state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (i) => setUpdate({ state: 'downloaded', version: i.version, percent: 100 }));
  autoUpdater.on('error', (e) => setUpdate({ state: 'error', error: String(e?.message ?? e).split('\n')[0] }));
  // po startu (a pak každé 4 hodiny) se tiše podívat, jestli je nová verze
  const check = () => { if (['idle', 'uptodate', 'error'].includes(update.state)) autoUpdater.checkForUpdates().catch(() => {}); };
  setTimeout(check, 8000);
  setInterval(check, 4 * 60 * 60 * 1000);
}
ipcMain.handle('update:get', () => update);
ipcMain.handle('update:check', () => {
  if (autoUpdater && !['checking', 'downloading', 'downloaded'].includes(update.state)) autoUpdater.checkForUpdates().catch(() => {});
  return update;
});
ipcMain.handle('update:download', () => {
  if (autoUpdater && update.state === 'available') { setUpdate({ state: 'downloading', percent: 0 }); autoUpdater.downloadUpdate().catch(() => {}); }
  return update;
});
ipcMain.handle('update:install', () => {
  if (autoUpdater && update.state === 'downloaded') {
    saveWindowState();
    // tichá instalace, po ní se program sám znovu spustí; nastavení umístění dat zůstane
    setImmediate(() => autoUpdater.quitAndInstall(true, true));
  }
});

// Jen jedno okno na uživatele – druhé spuštění pouze přepne na existující okno.
if (!arg('smoke') && !app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

// ---------- konfigurace ----------
function configCandidates() {
  const explicit = arg('config');
  if (typeof explicit === 'string') return [path.resolve(explicit)];
  if (!app.isPackaged) return [path.join(__dirname, 'config.json')];
  // nainstalovaný program: nastavení uživatele (zapisuje instalátor, přežije aktualizaci), pak config.json vedle .exe
  return [path.join(app.getPath('userData'), 'config.json'), path.join(path.dirname(process.execPath), 'config.json')];
}

const toDataDir = (folder) => (path.basename(folder).toLowerCase() === 'data' ? folder : path.join(folder, 'data'));

/** První spuštění bez nastavené databáze: vybrat sdílenou složku. */
function needsFirstRun() {
  return app.isPackaged && !arg('data') && !arg('config') && !loadConfig(configCandidates()).file;
}
function firstRun() {
  for (;;) {
    const choice = dialog.showMessageBoxSync({
      type: 'info', title: 'Evidence zakázek', message: 'Vítejte v Evidenci zakázek',
      detail: 'Vyberte SDÍLENOU složku, ve které budou uloženy informace o zakázkách (databáze a zálohy). Musí být dostupná všem počítačům v práci a musíte do ní mít právo zápisu.\n\nPříklad: \\\\server\\firma\\Zakazky',
      buttons: ['Vybrat složku…', 'Konec'], defaultId: 0, cancelId: 1, noLink: true,
    });
    if (choice !== 0) return false;
    const pick = dialog.showOpenDialogSync({ title: 'Vyberte sdílenou složku s informacemi o zakázkách', properties: ['openDirectory', 'createDirectory'] });
    if (pick && pick[0]) { saveDataDir(null, toDataDir(pick[0])); return true; }
  }
}

async function launchBackend() {
  const { cfg, baseDir, file } = loadConfig(configCandidates());
  // režim „centrální server“: okno se jen připojí na jinde běžící server (node app/server.js --host 0.0.0.0)
  if (cfg.serverUrl) return { server: null, url: String(cfg.serverUrl), configFile: file };
  const override = arg('data');
  const dataDir = typeof override === 'string'
    ? path.resolve(override)
    : path.resolve(baseDir, String(cfg.dataDir ?? '../data'));
  const token = crypto.randomBytes(24).toString('hex');
  const server = await startServer({
    host: '127.0.0.1', port: 0, dataDir, keepDays: cfg.backupKeepDays, token, demo: !!arg('demo'),
  });
  return { server, url: `http://127.0.0.1:${server.port}/?k=${token}`, configFile: file };
}

function saveDataDir(file, dataDir) {
  const target = file || configCandidates()[0];
  fs.mkdirSync(path.dirname(target), { recursive: true });
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(target, 'utf8').replace(/^\uFEFF/, '')); } catch { /* nový soubor */ }
  cfg.dataDir = dataDir.replace(/\\/g, '/');
  fs.writeFileSync(target, JSON.stringify(cfg, null, 2) + '\n');
}

async function startWithRetry() {
  if (needsFirstRun() && !firstRun()) return null;
  for (;;) {
    try {
      return await launchBackend();
    } catch (e) {
      const { file } = loadConfig(configCandidates());
      const choice = dialog.showMessageBoxSync({
        type: 'error',
        title: 'Evidence zakázek',
        message: 'Nepodařilo se otevřít databázi.',
        detail: `${e.message}\n\nZkontrolujte, že je dostupný sdílený disk a že máte právo zápisu do složky s databází.\nNastavení: ${file ?? '(config.json nenalezen)'}`,
        buttons: ['Zkusit znovu', 'Vybrat jinou složku…', 'Otevřít nastavení', 'Konec'],
        defaultId: 0, cancelId: 3, noLink: true,
      });
      if (choice === 0) continue;
      if (choice === 1) { // nová složka pro data se zapíše do config.json
        const pick = dialog.showOpenDialogSync({ title: 'Vyberte sdílenou složku s informacemi o zakázkách', properties: ['openDirectory', 'createDirectory'] });
        if (pick && pick[0]) saveDataDir(file, toDataDir(pick[0]));
        continue;
      }
      if (choice === 2 && file) await shell.openPath(file);
      return null;
    }
  }
}

// ---------- okno ----------
function statePath() { return path.join(app.getPath('userData'), 'window-state.json'); }
function loadWindowState() {
  try {
    const s = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
    const visible = screen.getAllDisplays().some((d) => {
      const b = d.workArea;
      return s.x >= b.x - 50 && s.y >= b.y - 50 && s.x < b.x + b.width - 100 && s.y < b.y + b.height - 100;
    });
    return { width: s.width, height: s.height, ...(visible ? { x: s.x, y: s.y } : {}), maximized: !!s.maximized };
  } catch { return { width: 1360, height: 860, maximized: false }; }
}
function saveWindowState() {
  if (!win || win.isDestroyed()) return;
  try {
    const b = win.getNormalBounds();
    fs.writeFileSync(statePath(), JSON.stringify({ ...b, maximized: win.isMaximized() }));
  } catch { /* nevadí */ }
}

function applyTheme() {
  if (!win || win.isDestroyed()) return;
  const t = THEME[nativeTheme.shouldUseDarkColors ? 'dark' : 'light'];
  win.setBackgroundColor(t.background);
  if (process.platform === 'win32') win.setTitleBarOverlay({ color: t.color, symbolColor: t.symbolColor, height: TITLEBAR_H });
}

function createWindow(url) {
  const st = loadWindowState();
  const t = THEME[nativeTheme.shouldUseDarkColors ? 'dark' : 'light'];
  win = new BrowserWindow({
    width: st.width, height: st.height, x: st.x, y: st.y,
    minWidth: 980, minHeight: 600,
    show: false,
    title: 'Evidence zakázek',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    backgroundColor: t.background,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: t.color, symbolColor: t.symbolColor, height: TITLEBAR_H },
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, preload: path.join(__dirname, 'preload.js') },
  });
  if (st.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.on('close', saveWindowState);
  win.on('closed', () => { win = null; });
  nativeTheme.on('updated', applyTheme);

  // zůstat v aplikaci: žádná navigace jinam, žádná nová okna
  const origin = new URL(url).origin;
  win.webContents.on('will-navigate', (e, to) => { if (new URL(to).origin !== origin) e.preventDefault(); });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // přiblížení Ctrl +/-/0 (nabídka je skrytá, takže bez toho by nešlo)
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown' || !input.control) return;
    const z = win.webContents.getZoomFactor();
    if (input.key === '+' || input.key === '=') { win.webContents.setZoomFactor(Math.min(z + 0.1, 2)); e.preventDefault(); }
    else if (input.key === '-') { win.webContents.setZoomFactor(Math.max(z - 0.1, 0.6)); e.preventDefault(); }
    else if (input.key === '0') { win.webContents.setZoomFactor(1); e.preventDefault(); }
  });

  // export: po stažení ukázat soubor v průzkumníku
  win.webContents.session.on('will-download', (_e, item) => {
    item.once('done', (_ev, state) => { if (state === 'completed') shell.showItemInFolder(item.getSavePath()); });
  });

  win.loadURL(url);
  return win;
}

// ---------- start ----------
app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  loadSettings();
  applyThemeSetting();
  backend = await startWithRetry();
  if (!backend) return app.quit();

  const w = createWindow(backend.url);
  initUpdater();

  const smoke = arg('smoke');
  if (smoke) {
    // zkušební režim: načíst, volitelně provést skript, uložit snímek okna a skončit
    w.setSize(1360, 860);
    w.webContents.once('did-finish-load', async () => {
      await new Promise((r) => setTimeout(r, 1200));
      const js = process.env.ZAKAZKY_SMOKE_JS;
      if (js) { await w.webContents.executeJavaScript(fs.readFileSync(js, 'utf8')); await new Promise((r) => setTimeout(r, 600)); }
      const img = await w.webContents.capturePage();
      fs.writeFileSync(String(smoke), img.toPNG());
      app.quit();
    });
  }
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', async () => {
  const b = backend;
  backend = null;
  if (b?.server) await b.server.close();
});
