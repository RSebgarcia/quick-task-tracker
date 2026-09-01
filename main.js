'use strict';

const { app, BrowserWindow, globalShortcut, ipcMain, Menu, Tray, nativeImage, nativeTheme, screen, dialog } = require('electron');
const path = require('path');

const config = require('./src/config-manager');
const store = require('./src/data-store');
const { parseTaskInput, UNCLASSIFIED } = require('./src/parser');

// TT_DEV=1 (npm run dev) desactiva el auto-ocultar al perder foco; si no, es imposible
// inspeccionar la ventana con las devtools abiertas.
const DEV = process.env.TT_DEV === '1';

const DATA_DIR = path.join(app.getPath('appData'), 'task-tracker');

const UNCLASSIFIED_LABEL = 'Sin clasificar';
const UNCLASSIFIED_COLOR = '#8b90a0';

// La ventana es transparente y el marco visual lo dibuja el HTML: estas medidas incluyen
// 28px de aire a cada lado (--win-pad en styles.css) para que la sombra entre completa.
// Si el aire es menor que el alcance de la sombra, el borde de la ventana la corta
// y se ve una linea recta debajo del panel.
const WIN_PAD = 56; // 28px por lado
const CAPTURE_SIZE = { width: 480 + WIN_PAD, height: 56 + WIN_PAD };
const BOARD_HEIGHT = 420 + WIN_PAD;

// Ancho del tablero: crece con la cantidad de columnas hasta donde entre en la pantalla.
const COL_W = 176;
const COL_GAP = 10;
const PANEL_PAD = 24; // padding interno de .columns
const BOARD_MIN_W = 560;

let win = null;
let tray = null; // hay que guardar la referencia o el GC se lleva el icono
let currentMode = 'capture';
let boardColumns = 4;
let menuOpen = false;
let modalOpen = false; // panel de configuracion abierto: no auto-ocultar
let rendererReady = false;

function createWindow() {
  win = new BrowserWindow({
    width: CAPTURE_SIZE.width,
    height: CAPTURE_SIZE.height,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false, // la sombra la dibuja el CSS
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false // el timer de deshacer corre aunque la ventana este oculta
    }
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile(path.join(__dirname, 'src', 'index.html'));

  win.on('blur', () => {
    // modalOpen: con el panel de configuracion abierto, el selector de color nativo roba
    // el foco. Si ocultaramos la ventana ahi, se perderia todo lo que estaba editando.
    if (DEV || menuOpen || modalOpen || !win.isVisible()) return;
    win.hide();
  });

  // La ventana nunca se destruye: solo se oculta.
  win.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });

  win.webContents.on('did-finish-load', () => {
    rendererReady = true;
    applyMode('capture');
    showWindow();
  });
}

/**
 * La pantalla donde esta el mouse, no la principal: con dos monitores, la barra tiene que
 * aparecer donde estas trabajando y no saltar al otro.
 */
function activeWorkArea() {
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
}

function boardWidth(columnCount, workArea) {
  const cols = Math.max(columnCount, 1);
  const raw = WIN_PAD + PANEL_PAD + cols * COL_W + (cols - 1) * COL_GAP;
  const max = (workArea || activeWorkArea()).width - 80;
  return Math.max(BOARD_MIN_W, Math.min(raw, max));
}

function targetSize(mode, workArea) {
  if (mode === 'capture') return CAPTURE_SIZE;
  return { width: boardWidth(boardColumns, workArea), height: BOARD_HEIGHT };
}

function applyMode(mode) {
  if (!win) return;
  currentMode = mode;

  const workArea = activeWorkArea();
  const size = targetSize(mode, workArea);
  const x = Math.round(workArea.x + (workArea.width - size.width) / 2);
  const y =
    mode === 'capture'
      ? Math.round(workArea.y + workArea.height * 0.2) // ~20% del alto de la pantalla
      : Math.round(workArea.y + (workArea.height - size.height) / 2);

  win.setBounds({ x: x, y: y, width: size.width, height: size.height });
  if (rendererReady) win.webContents.send('mode', mode);
}

function showWindow() {
  if (!win) return;
  win.show();
  win.focus();
}

// Ctrl+Alt+T / Ctrl+Alt+B: si ya esta visible en ese modo, oculta. Si no, muestra.
function toggleMode(mode) {
  if (!win) return;
  if (win.isVisible() && currentMode === mode) {
    win.hide();
    return;
  }
  applyMode(mode);
  showWindow();
}

/**
 * La app vive en la bandeja: ocultar la ventana no la cierra, y salir de verdad
 * se hace desde aca. Sin esto, con skipTaskbar, no habria forma de recuperarla
 * si los atajos globales quedaran pisados por otra app.
 */
/**
 * El icono es oscuro: sobre una barra de tareas oscura desaparece.
 * Por eso hay dos versiones del mismo dibujo y se elige segun el tema.
 * (shouldUseDarkColors sigue el tema de apps; en Windows viene junto con el del sistema
 * salvo que se configure el "modo personalizado" a mano.)
 */
function trayIconPath() {
  const file = nativeTheme.shouldUseDarkColors ? 'tray-on-dark.png' : 'tray-on-light.png';
  return path.join(__dirname, 'src', file);
}

// ---- arranque con Windows ----
// Solo tiene sentido en la app empaquetada: en desarrollo registraria electron.exe.
function autoStartEnabled() {
  return app.getLoginItemSettings().openAtLogin;
}

/**
 * Que ejecutable registrar en el arranque.
 * En la version portable, process.execPath apunta a la carpeta temporal donde el .exe se
 * autoextrae, y esa carpeta se borra al cerrar la app: registrarla dejaria un arranque roto.
 * El .exe de verdad, el que el usuario guardo, lo pasa el propio portable en esta variable.
 */
function autoStartTarget() {
  return process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
}

function setAutoStart(enabled) {
  app.setLoginItemSettings({ openAtLogin: !!enabled, path: autoStartTarget(), args: [] });
}

function buildTrayMenu() {
  const s = config.getShortcuts();
  return Menu.buildFromTemplate([
    { label: 'Capturar tarea', accelerator: s.captura, click: function () { showMode('capture'); } },
    { label: 'Ver tablero', accelerator: s.tablero, click: function () { showMode('board'); } },
    { type: 'separator' },
    {
      label: 'Arrancar con Windows',
      type: 'checkbox',
      enabled: app.isPackaged,
      checked: app.isPackaged && autoStartEnabled(),
      click: function (item) {
        setAutoStart(item.checked);
        if (tray) tray.setContextMenu(buildTrayMenu()); // que el tilde refleje lo real
      }
    },
    { type: 'separator' },
    {
      label: 'Salir de Task Tracker',
      click: function () {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(trayIconPath()));
  tray.setToolTip('Task Tracker');

  nativeTheme.on('updated', function () {
    if (tray) tray.setImage(nativeImage.createFromPath(trayIconPath()));
  });

  tray.setContextMenu(buildTrayMenu());

  // Click izquierdo: la barra de captura, que es para lo que se abre el 90% de las veces.
  tray.on('click', function () { showMode('capture'); });
  tray.on('double-click', function () { showMode('board'); });
}

function showMode(mode) {
  applyMode(mode);
  showWindow();
}

/**
 * Registra los atajos que esten en el config. Devuelve los que no se pudieron tomar
 * (otra app ya los usa), para poder avisarlo sin cortar el arranque.
 */
function registerShortcuts(notifyOnFail) {
  globalShortcut.unregisterAll();

  const s = config.getShortcuts();
  const wanted = [
    [s.captura, function () { toggleMode('capture'); }],
    [s.tablero, function () { toggleMode('board'); }]
  ];

  const failed = [];
  for (const entry of wanted) {
    if (!entry[0]) continue;
    let ok = false;
    try {
      ok = globalShortcut.register(entry[0], entry[1]);
    } catch (err) {
      ok = false; // combinacion invalida
    }
    if (!ok) failed.push(entry[0]);
  }

  if (failed.length && notifyOnFail) {
    dialog.showErrorBox(
      'Task Tracker',
      'No se pudieron registrar estos atajos globales porque otra aplicacion ya los usa:\n\n  ' +
        failed.join('\n  ') +
        '\n\nLa app arranca igual: abrila desde el icono de la bandeja, al lado del reloj,\n' +
        'y cambia los atajos desde el boton de configuracion del tablero.'
    );
  }

  if (tray) tray.setContextMenu(buildTrayMenu());
  return failed;
}

// ---------------------------------------------------------------- categorias

/**
 * Una categoria temporal existe solo mientras tenga tareas. En cuanto se vacia
 * (moviste la tarea del typo, o terminaste el proyecto) se borra sola del config.
 * Las fijas se quedan siempre.
 */
function pruneTemporary() {
  const tasks = store.getTasks();
  let changed = false;

  config.getCategories().forEach(function (cat) {
    if (cat.fija) return;
    const stillUsed = tasks.some(function (t) { return t.column === cat.id; });
    if (!stillUsed && config.removeIfTemporary(cat.id)) changed = true;
  });

  return changed;
}

/** Lo que ve el renderer: las categorias del config + "Sin clasificar" si tiene tareas. */
function columnsForBoard() {
  const tasks = store.getTasks();
  const list = config.getCategories().map(function (c) {
    return { id: c.id, label: c.label, fija: c.fija, color: c.color };
  });

  if (tasks.some(function (t) { return t.column === UNCLASSIFIED; })) {
    list.push({ id: UNCLASSIFIED, label: UNCLASSIFIED_LABEL, fija: false, color: UNCLASSIFIED_COLOR });
  }

  return list;
}

// ---------------------------------------------------------------- IPC

ipcMain.handle('tasks:get', function () {
  return store.getTasks();
});

ipcMain.handle('columns:get', function () {
  return columnsForBoard();
});

ipcMain.handle('tasks:add', function (e, rawText) {
  const parsed = parseTaskInput(rawText, config.getCategories());
  if (!parsed) return null;

  // Categoria nueva: se crea al vuelo como temporal.
  const column = parsed.newLabel ? config.ensureCategory(parsed.newLabel).id : parsed.column;
  return store.addTask(parsed.text, column);
});

ipcMain.handle('tasks:delete', function (e, id) {
  const ok = store.deleteTask(id);
  pruneTemporary();
  return ok;
});

ipcMain.handle('tasks:move', function (e, payload) {
  const ok = store.moveTask(payload.id, payload.column);
  pruneTemporary();
  return ok;
});

ipcMain.handle('tasks:reorder', function (e, layout) {
  const ok = store.applyLayout(layout);
  pruneTemporary();
  return ok;
});

ipcMain.handle('tasks:moveAll', function (e, payload) {
  const moved = store.moveAll(payload.from, payload.to);
  pruneTemporary();
  return moved;
});

// Menu nativo de clic derecho sobre una tarjeta. Resuelve con la columna elegida, o null.
ipcMain.handle('tasks:contextMenu', function (e, payload) {
  return new Promise(function (resolve) {
    const finish = once(resolve);

    const targets = columnsForBoard();
    // "Sin clasificar" siempre disponible como destino, tenga tareas o no.
    if (!targets.some(function (c) { return c.id === UNCLASSIFIED; })) {
      targets.push({ id: UNCLASSIFIED, label: UNCLASSIFIED_LABEL });
    }

    const items = targets.map(function (c) {
      return {
        label: c.label,
        type: 'radio',
        checked: c.id === payload.column,
        click: function () { finish(c.id); }
      };
    });

    popup([{ label: 'Mover a', enabled: false }, { type: 'separator' }].concat(items), finish);
  });
});

/**
 * Menu nativo de clic derecho sobre la cabecera de una columna.
 * Resuelve con { action: 'move-all', to } | { action: 'pin' | 'unpin' } | null.
 */
ipcMain.handle('columns:contextMenu', function (e, payload) {
  return new Promise(function (resolve) {
    const finish = once(resolve);

    const self = config.getById(payload.id);
    const others = columnsForBoard().filter(function (c) { return c.id !== payload.id; });
    if (!others.some(function (c) { return c.id === UNCLASSIFIED; }) && payload.id !== UNCLASSIFIED) {
      others.push({ id: UNCLASSIFIED, label: UNCLASSIFIED_LABEL });
    }

    const template = [
      {
        label: 'Mover todas las tareas a',
        submenu: others.map(function (c) {
          return { label: c.label, click: function () { finish({ action: 'move-all', to: c.id }); } };
        })
      }
    ];

    // "Sin clasificar" no es una categoria del config: no se fija ni se desfija.
    if (self) {
      template.push({ type: 'separator' });
      template.push(
        self.fija
          ? { label: 'Volver temporal', click: function () { finish({ action: 'unpin' }); } }
          : { label: 'Fijar como categoria permanente', click: function () { finish({ action: 'pin' }); } }
      );
    }

    popup(template, finish);
  });
});

// ---- panel de configuracion ----

ipcMain.handle('config:get', function () {
  return {
    categorias: config.getCategories().map(function (c) {
      return { id: c.id, label: c.label, fija: c.fija, color: c.color, alias: c.alias.slice() };
    }),
    atajos: config.getShortcuts(),
    // cuantas tareas tiene cada una, para avisar antes de borrar
    conteo: store.getTasks().reduce(function (acc, t) {
      acc[t.column] = (acc[t.column] || 0) + 1;
      return acc;
    }, {})
  };
});

ipcMain.handle('config:save', function (e, payload) {
  const res = config.replaceCategories(payload && payload.categorias);

  // Las tareas de una categoria borrada no se pierden: vuelven a "Sin clasificar".
  let reasignadas = 0;
  for (const id of res.removed) {
    reasignadas += store.moveAll(id, UNCLASSIFIED);
  }

  const failed = payload && payload.atajos ? applyShortcuts(payload.atajos) : [];

  boardColumns = columnsForBoard().length;
  if (currentMode === 'board') applyMode('board');

  return { removidas: res.removed, reasignadas: reasignadas, atajosFallidos: failed };
});

function applyShortcuts(next) {
  const previos = config.getShortcuts();
  config.setShortcuts(next);

  const failed = registerShortcuts(false);
  if (failed.length) {
    config.setShortcuts(previos); // no dejar la app sin atajos utilizables
    registerShortcuts(false);
  }
  return failed;
}

ipcMain.handle('tasks:updateText', function (e, payload) {
  return store.updateText(payload.id, payload.text);
});

ipcMain.handle('columns:setPinned', function (e, payload) {
  const ok = config.setPinned(payload.id, payload.pinned);
  if (ok && !payload.pinned) pruneTemporary(); // si la desfijo vacia, se va
  return ok;
});

function once(resolve) {
  let settled = false;
  return function (value) {
    if (settled) return;
    settled = true;
    resolve(value);
  };
}

function popup(template, finish) {
  const menu = Menu.buildFromTemplate(template);
  menuOpen = true;
  menu.popup({
    window: win,
    callback: function () {
      menuOpen = false;
      // El click del item se dispara antes que este callback; el tick le da margen.
      setTimeout(function () {
        finish(null);
        if (win && win.isVisible()) win.focus();
      }, 0);
    }
  });
}

ipcMain.on('window:modal', function (e, open) {
  modalOpen = !!open;
});

ipcMain.on('window:hide', function () {
  if (win) win.hide();
});

ipcMain.on('window:mode', function (e, mode) {
  if (mode === 'capture' || mode === 'board') showMode(mode);
});

// El tablero avisa cuantas columnas esta mostrando para ajustar el ancho de la ventana.
ipcMain.on('window:boardColumns', function (e, count) {
  const next = Math.max(1, Number(count) || 1);
  if (next === boardColumns) return;
  boardColumns = next;
  if (currentMode === 'board') applyMode('board');
});

// ---------------------------------------------------------------- ciclo de vida

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', function () {
    toggleMode('capture');
  });

  app.whenReady().then(function () {
    store.init(DATA_DIR);
    config.init(DATA_DIR);
    pruneTemporary(); // arranca limpio: temporales que quedaron sin tareas se van
    // Primera instalacion: queda en la bandeja desde que prende la PC. Despues es
    // decision del usuario, desde el tilde del menu de la bandeja.
    if (app.isPackaged && config.isFirstRun()) setAutoStart(true);

    boardColumns = columnsForBoard().length;
    createWindow();
    createTray();
    registerShortcuts(true);

    app.on('activate', function () {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', function () {
  app.quit();
});

app.on('before-quit', function () {
  app.isQuitting = true;
  globalShortcut.unregisterAll();
  store.flush(); // no perder lo que quedo pendiente en el debounce
});
