'use strict';

/* ============================================================
   Renderer: UI de la barra de captura y del tablero.
   No toca disco ni Node: todo pasa por window.api (preload).
   Las columnas ya no estan hardcodeadas: vienen del config.
   ============================================================ */

const UNDO_MS = 5000;

const captureInput = document.getElementById('capture-input');
const columnsEl = document.getElementById('columns');
const totalEl = document.getElementById('total-count');
const toastEl = document.getElementById('toast');
const toastUndoBtn = document.getElementById('toast-undo');
const toastCountEl = document.getElementById('toast-count');
const quitBtn = document.getElementById('btn-quit');

const configEl = document.getElementById('config');
const configBtn = document.getElementById('btn-config');
const configCloseBtn = document.getElementById('config-close');
const configCancelBtn = document.getElementById('config-cancel');
const configSaveBtn = document.getElementById('config-save');
const configMsg = document.getElementById('config-msg');
const catRowsEl = document.getElementById('config-cats');
const catAddBtn = document.getElementById('cat-add');
const scCaptura = document.getElementById('sc-captura');
const scTablero = document.getElementById('sc-tablero');
const hintCapture = document.getElementById('hint-capture');

let tasks = [];
let columns = [];
let shortcuts = { captura: 'Control+Alt+T', tablero: 'Control+Alt+B' };

// Tarea tachada esperando los 5s. Solo puede haber una a la vez: si llega otra,
// la anterior se confirma (se borra) de inmediato.
let pending = null; // { id, el, timer, ticker }

// ============================ modo ============================

window.api.onMode(function (mode) {
  document.body.className = 'mode-' + mode;
  closeConfig(); // cambiar de modo nunca deja el panel abierto

  if (mode === 'capture') {
    captureInput.value = '';
    // Las categorias se usan para autocompletar despues del guion.
    window.api.getColumns().then(function (list) { columns = list; });
    setTimeout(function () { captureInput.focus(); }, 0);
  } else {
    refresh();
  }
});

/** Version minima de la normalizacion del parser: el renderer no puede requerirlo (sandbox). */
function norm(text) {
  return String(text == null ? '' : text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Ultima aparicion del separador, igual que en parser.js. */
function lastSeparator(text) {
  const re = /\s+-\s*/g;
  let last = null;
  let m;
  while ((m = re.exec(text)) !== null) last = { index: m.index, length: m[0].length };
  return last;
}

// ============================ captura ============================

captureInput.addEventListener('keydown', function (e) {
  if (e.key !== 'Enter') return;
  e.preventDefault();

  const text = captureInput.value.trim();
  captureInput.value = '';

  if (!text) {
    window.api.hide();
    return;
  }

  window.api.addTask(text).then(function () {
    window.api.hide();
  });
});

/**
 * Autocompletado de categorias: al escribir despues del guion, completa con la primera
 * categoria que empiece igual y deja lo agregado seleccionado. Si seguis escribiendo lo
 * reemplaza; si te sirve, Enter y listo. Es la defensa contra el typo que crea una columna
 * nueva sin querer.
 */
captureInput.addEventListener('input', function (e) {
  if (e.inputType && e.inputType.indexOf('delete') === 0) return; // borrando: no estorbar
  if (captureInput.selectionStart !== captureInput.value.length) return; // editando al medio

  const value = captureInput.value;
  const cut = lastSeparator(value);
  if (!cut) return;

  const typed = value.slice(cut.index + cut.length);
  if (!typed) return;

  const key = norm(typed);
  const match = columns.find(function (c) {
    const label = norm(c.label);
    return label.length > key.length && label.indexOf(key) === 0;
  });
  if (!match) return;

  const completed = value.slice(0, cut.index + cut.length) + match.label;
  captureInput.value = completed;
  captureInput.setSelectionRange(value.length, completed.length);
});

// ============================ tablero ============================

function refresh() {
  return Promise.all([window.api.getTasks(), window.api.getColumns()]).then(function (res) {
    tasks = res[0];
    columns = res[1];
    render();
  });
}

function render() {
  window.api.setBoardColumns(columns.length);
  columnsEl.textContent = '';

  // Instalacion nueva: sin categorias el tablero queda en blanco y parece roto.
  // Hay que decir como se crea la primera.
  if (!columns.length) {
    renderEmptyBoard();
    updateCounts();
    return;
  }

  columns.forEach(function (col) {
    const colEl = document.createElement('div');
    colEl.className = 'col' + (col.fija ? '' : ' col-temp');
    colEl.dataset.col = col.id;
    colEl.style.setProperty('--accent', col.color);

    const head = document.createElement('div');
    head.className = 'col-head';
    head.title = col.fija ? col.label : col.label + ' (temporal — desaparece al quedarse sin tareas)';

    const dot = document.createElement('span');
    dot.className = 'col-dot';

    const name = document.createElement('span');
    name.className = 'col-name';
    name.textContent = col.label;

    const count = document.createElement('span');
    count.className = 'col-count';

    head.append(dot, name, count);
    head.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      openColumnMenu(col);
    });

    const body = document.createElement('div');
    body.className = 'col-body';

    const empty = document.createElement('div');
    empty.className = 'col-empty';
    empty.textContent = 'Sin tareas';
    body.appendChild(empty);

    tasks
      .filter(function (t) { return t.column === col.id; })
      .forEach(function (t) { body.appendChild(buildCard(t)); });

    wireDropZone(colEl, body);

    colEl.append(head, body);
    columnsEl.appendChild(colEl);
  });

  syncPlaceholders();
  updateCounts();
}

function renderEmptyBoard() {
  const box = document.createElement('div');
  box.className = 'board-empty';

  const title = document.createElement('p');
  title.className = 'board-empty-title';
  title.textContent = 'Todavía no hay categorías';

  const hint = document.createElement('p');
  hint.className = 'board-empty-hint';
  hint.textContent = 'Terminá una tarea con un guion y el nombre del proyecto, y la columna se crea sola:';

  const example = document.createElement('code');
  example.className = 'board-empty-example';
  example.textContent = 'comprar pan -casa';

  const foot = document.createElement('p');
  foot.className = 'board-empty-hint';
  // El atajo es configurable: hay que mostrar el que este puesto, no uno fijo.
  foot.textContent = 'Capturá con ' + prettyAccel(shortcuts.captura) +
    '. Las tareas sin guion van a "Sin clasificar".';

  box.append(title, hint, example, foot);
  columnsEl.appendChild(box);
}

function buildCard(task) {
  const el = document.createElement('div');
  el.className = 'card';
  el.draggable = true;
  el.dataset.id = task.id;

  const check = document.createElement('button');
  check.className = 'check';
  check.title = 'Completar';

  const text = document.createElement('p');
  text.className = 'text';
  text.textContent = task.text;

  el.append(check, text);

  // Si esta tarjeta es la que esta esperando el deshacer, se reconstruye ya tachada
  // y oculta, y el pending pasa a apuntar al nodo nuevo.
  if (pending && pending.id === task.id) {
    el.classList.add('done', 'hidden-done');
    pending.el = el;
  }

  check.addEventListener('click', function (e) {
    e.stopPropagation();
    completeTask(task.id, el);
  });

  // Doble clic: corregir el texto sin tener que borrar y volver a escribir la tarea.
  text.addEventListener('dblclick', function () { startEditing(task, el, text); });

  el.addEventListener('contextmenu', function (e) {
    e.preventDefault();
    e.stopPropagation();
    const parent = el.closest('.col');
    const currentColumn = parent ? parent.dataset.col : task.column;

    window.api.contextMenu(task.id, currentColumn).then(function (target) {
      if (!target || target === currentColumn) return;
      window.api.moveTask(task.id, target).then(refresh);
    });
  });

  el.addEventListener('dragstart', function (e) {
    el.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', task.id);
  });

  el.addEventListener('dragend', function () {
    el.classList.remove('dragging');
    document.querySelectorAll('.col.drop-target').forEach(function (c) {
      c.classList.remove('drop-target');
    });
    commitLayout();
  });

  return el;
}

/**
 * Edicion en el lugar. Mientras se edita hay que apagar el draggable de la tarjeta,
 * porque si no el navegador arrastra en vez de dejar seleccionar el texto.
 */
function startEditing(task, cardEl, textEl) {
  if (textEl.isContentEditable) return;

  const original = textEl.textContent;
  cardEl.draggable = false;
  textEl.contentEditable = 'true';
  textEl.spellcheck = false;
  textEl.focus();

  const range = document.createRange();
  range.selectNodeContents(textEl);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  let done = false;
  const finish = function (save) {
    if (done) return;
    done = true;

    textEl.contentEditable = 'false';
    cardEl.draggable = true;
    textEl.removeEventListener('keydown', onKey);
    textEl.removeEventListener('blur', onBlur);

    const next = textEl.textContent.replace(/\s+/g, ' ').trim();

    if (!save || !next || next === original) {
      textEl.textContent = original; // cancelado, vacio o sin cambios
      return;
    }

    textEl.textContent = next;
    task.text = next;
    window.api.updateText(task.id, next);
  };

  const onKey = function (e) {
    e.stopPropagation(); // que Escape no oculte la ventana mientras edito
    if (e.key === 'Enter') {
      e.preventDefault();
      finish(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finish(false);
    }
  };

  const onBlur = function () { finish(true); };

  textEl.addEventListener('keydown', onKey);
  textEl.addEventListener('blur', onBlur);
}

/** Clic derecho en la cabecera: mover toda la columna de una, o fijar/desfijar la categoria. */
function openColumnMenu(col) {
  window.api.columnMenu(col.id).then(function (choice) {
    if (!choice) return;

    if (choice.action === 'move-all') {
      window.api.moveAll(col.id, choice.to).then(refresh);
      return;
    }

    if (choice.action === 'pin' || choice.action === 'unpin') {
      window.api.setPinned(col.id, choice.action === 'pin').then(refresh);
    }
  });
}

// ---- drag & drop nativo ----

function wireDropZone(colEl, body) {
  body.addEventListener('dragover', function (e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const dragging = document.querySelector('.card.dragging');
    if (!dragging) return;

    colEl.classList.add('drop-target');

    const after = getDragAfterElement(body, e.clientY);
    if (after === null) body.appendChild(dragging);
    else body.insertBefore(dragging, after);

    syncPlaceholders();
  });

  body.addEventListener('dragleave', function (e) {
    if (!body.contains(e.relatedTarget)) colEl.classList.remove('drop-target');
  });

  body.addEventListener('drop', function (e) {
    e.preventDefault();
    colEl.classList.remove('drop-target');
  });
}

/** Devuelve la tarjeta delante de la cual hay que insertar, o null para ir al final. */
function getDragAfterElement(body, y) {
  const cards = Array.prototype.slice.call(body.querySelectorAll('.card:not(.dragging)'));

  let closest = null;
  let closestOffset = Number.NEGATIVE_INFINITY;

  cards.forEach(function (card) {
    const box = card.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closestOffset) {
      closestOffset = offset;
      closest = card;
    }
  });

  return closest;
}

/** Persiste columna + orden tal como quedaron visualmente en el tablero. */
function commitLayout() {
  const layout = {};

  document.querySelectorAll('.col').forEach(function (colEl) {
    const ids = [];
    colEl.querySelectorAll('.card').forEach(function (card) { ids.push(card.dataset.id); });
    layout[colEl.dataset.col] = ids;
  });

  // Refresca completo: mover la ultima tarea de una categoria temporal la elimina,
  // asi que la lista de columnas puede haber cambiado.
  window.api.reorder(layout).then(refresh);
}

function syncPlaceholders() {
  document.querySelectorAll('.col-body').forEach(function (body) {
    const hasVisible = !!body.querySelector('.card:not(.hidden-done)');
    const empty = body.querySelector('.col-empty');
    if (empty) empty.style.display = hasVisible ? 'none' : '';
  });
}

function updateCounts() {
  let total = 0;

  document.querySelectorAll('.col').forEach(function (colEl) {
    const n = colEl.querySelectorAll('.card:not(.hidden-done)').length;
    total += n;
    const label = colEl.querySelector('.col-count');
    if (label) label.textContent = n ? String(n) : '';
  });

  totalEl.textContent = total ? total + (total === 1 ? ' tarea' : ' tareas') : 'sin tareas';
}

// ============================ completar + deshacer ============================

function completeTask(id, el) {
  if (pending && pending.id === id) return;
  if (pending) finalizePending(); // llega una nueva: la anterior se confirma ya

  el.classList.add('done');
  setTimeout(function () {
    el.classList.add('hidden-done');
    syncPlaceholders();
    updateCounts(); // recien aca la tarjeta sale del flujo: los contadores bajan ahora
  }, 180);

  let left = UNDO_MS / 1000;
  toastCountEl.textContent = String(left);

  const ticker = setInterval(function () {
    left -= 1;
    toastCountEl.textContent = String(Math.max(left, 0));
  }, 1000);

  const timer = setTimeout(finalizePending, UNDO_MS);

  pending = { id: id, el: el, timer: timer, ticker: ticker };

  showToast();
}

/** Se cumplieron los 5s: recien ahi se toca el disco. */
function finalizePending() {
  if (!pending) return;

  const p = pending;
  pending = null;

  clearTimeout(p.timer);
  clearInterval(p.ticker);
  hideToast();

  if (p.el && p.el.parentNode) p.el.remove();
  tasks = tasks.filter(function (t) { return t.id !== p.id; });

  // El borrado puede dejar vacia una categoria temporal, que desaparece sola.
  window.api.deleteTask(p.id).then(refresh);
}

/** Deshacer: cancela el timer y devuelve la tarjeta. El disco nunca se toco. */
function undoPending() {
  if (!pending) return;

  const p = pending;
  pending = null;

  clearTimeout(p.timer);
  clearInterval(p.ticker);
  hideToast();

  if (p.el) p.el.classList.remove('done', 'hidden-done');
  syncPlaceholders();
  updateCounts();
}

function showToast() {
  // Reinicia la animacion de la barra de 5s aunque el toast ya estuviera visible.
  toastEl.classList.remove('show');
  void toastEl.offsetWidth;
  toastEl.classList.add('show');
}

function hideToast() {
  toastEl.classList.remove('show');
}

toastUndoBtn.addEventListener('click', undoPending);

// ============================ panel de configuracion ============================

const PALETA = ['#5b8cff', '#a78bfa', '#2dd4a7', '#f5a524', '#f472b6', '#38bdf8', '#fb923c', '#a3e635'];

function openConfigPanel() {
  window.api.getConfig().then(function (cfg) {
    shortcuts = cfg.atajos;
    scCaptura.value = prettyAccel(cfg.atajos.captura);
    scCaptura.dataset.accel = cfg.atajos.captura;
    scTablero.value = prettyAccel(cfg.atajos.tablero);
    scTablero.dataset.accel = cfg.atajos.tablero;

    catRowsEl.textContent = '';
    cfg.categorias
      .filter(function (c) { return c.fija; })
      .forEach(function (c) { catRowsEl.appendChild(catRow(c, cfg.conteo[c.id] || 0)); });

    setMsg('');
    configEl.classList.add('open');
    window.api.setModal(true); // el selector de color roba el foco: no auto-ocultar
  });
}

function closeConfig() {
  if (!configEl.classList.contains('open')) return;
  configEl.classList.remove('open');
  window.api.setModal(false);
}

function catRow(cat, count) {
  const row = document.createElement('div');
  row.className = 'cat-row';
  row.dataset.id = cat.id || '';
  row.style.setProperty('--accent', cat.color);

  const color = document.createElement('input');
  color.type = 'color';
  color.className = 'cat-color';
  color.value = cat.color;
  color.title = 'Color de la columna';
  color.addEventListener('input', function () {
    row.style.setProperty('--accent', color.value);
  });

  const name = document.createElement('input');
  name.className = 'cat-name';
  name.value = cat.label;
  name.placeholder = 'Nombre';
  name.maxLength = 24;

  const alias = document.createElement('input');
  alias.className = 'cat-alias';
  alias.value = (cat.alias || []).join(', ');
  alias.placeholder = 'otras formas de escribirlo, separadas por coma';

  const badge = document.createElement('span');
  badge.className = 'cat-count';
  badge.textContent = count ? count + (count === 1 ? ' tarea' : ' tareas') : '';

  const del = document.createElement('button');
  del.className = 'cat-del';
  del.textContent = '✕';
  del.title = count
    ? 'Quitar (sus ' + count + ' tareas van a Sin clasificar)'
    : 'Quitar esta categoría';
  del.addEventListener('click', function () { row.remove(); });

  row.append(color, name, alias, badge, del);
  return row;
}

catAddBtn.addEventListener('click', function () {
  const usados = catRowsEl.querySelectorAll('.cat-row').length;
  const row = catRow({ label: '', color: PALETA[usados % PALETA.length], alias: [] }, 0);
  catRowsEl.appendChild(row);
  row.querySelector('.cat-name').focus();
});

function collectRows() {
  return Array.prototype.map.call(catRowsEl.querySelectorAll('.cat-row'), function (row) {
    return {
      id: row.dataset.id || null,
      label: row.querySelector('.cat-name').value.trim(),
      color: row.querySelector('.cat-color').value,
      alias: row.querySelector('.cat-alias').value,
      fija: true
    };
  });
}

configSaveBtn.addEventListener('click', function () {
  const rows = collectRows();

  const vacias = rows.filter(function (r) { return !r.label; });
  if (vacias.length) {
    setMsg('Hay una categoría sin nombre.', 'error');
    return;
  }

  const nombres = rows.map(function (r) { return norm(r.label); });
  const repetido = nombres.find(function (n, i) { return nombres.indexOf(n) !== i; });
  if (repetido) {
    setMsg('Hay dos categorías con el mismo nombre.', 'error');
    return;
  }

  const atajos = {
    captura: scCaptura.dataset.accel,
    tablero: scTablero.dataset.accel
  };
  if (atajos.captura === atajos.tablero) {
    setMsg('Los dos atajos son iguales.', 'error');
    return;
  }

  window.api.saveConfig(rows, atajos).then(function (res) {
    if (res.atajosFallidos && res.atajosFallidos.length) {
      setMsg('Otra app ya usa ' + res.atajosFallidos.map(prettyAccel).join(' y ') + '. Se dejaron los anteriores.', 'error');
      openConfigPanel();
      return;
    }
    closeConfig();
    refresh();
    updateHint();
  });
});

configCloseBtn.addEventListener('click', closeConfig);
configCancelBtn.addEventListener('click', closeConfig);
configBtn.addEventListener('click', openConfigPanel);

function setMsg(text, kind) {
  configMsg.textContent = text;
  configMsg.className = 'config-msg' + (kind ? ' ' + kind : '');
}

// ---- captura de combinaciones de teclas ----

function prettyAccel(accel) {
  return String(accel || '')
    .replace('Control', 'Ctrl')
    .split('+')
    .join(' + ');
}

[scCaptura, scTablero].forEach(function (input) {
  input.addEventListener('focus', function () {
    input.classList.add('capturing');
    input.value = 'Apretá la combinación…';
  });

  input.addEventListener('blur', function () {
    input.classList.remove('capturing');
    input.value = prettyAccel(input.dataset.accel);
  });

  input.addEventListener('keydown', function (e) {
    e.preventDefault();
    e.stopPropagation();

    if (e.key === 'Escape') { input.blur(); return; }

    const mods = [];
    if (e.ctrlKey) mods.push('Control');
    if (e.altKey) mods.push('Alt');
    if (e.shiftKey) mods.push('Shift');
    if (e.metaKey) mods.push('Super');

    const key = accelKey(e);
    if (!key) return;            // solo modificadores: sigue esperando
    if (!mods.length) {
      input.value = 'Necesita Ctrl, Alt o Shift';
      return;                    // una tecla sola secuestraria el teclado entero
    }

    const accel = mods.concat(key).join('+');
    input.dataset.accel = accel;
    input.blur();
  });
});

/** Traduce el evento a la tecla que entiende Electron, o null si es solo un modificador. */
function accelKey(e) {
  const code = e.code || '';
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^F\d{1,2}$/.test(code)) return code;
  if (code === 'Space') return 'Space';
  if (code === 'Enter') return 'Return';
  if (code === 'Backquote') return '`';
  if (code === 'Tab') return 'Tab';
  return null;
}

function updateHint() {
  window.api.getConfig().then(function (cfg) {
    shortcuts = cfg.atajos;
    hintCapture.textContent = prettyAccel(cfg.atajos.captura) + ' para capturar';
  });
}

updateHint();

// ============================ ventana ============================

// Oculta, no cierra: la app sigue viva en la bandeja (se sale desde ahi).
quitBtn.addEventListener('click', function () { window.api.hide(); });

document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') {
    // Con el panel abierto, Escape cierra el panel y no la ventana entera.
    if (configEl.classList.contains('open')) {
      closeConfig();
      return;
    }
    window.api.hide();
    return;
  }

  if (configEl.classList.contains('open')) return; // el panel se maneja solo

  if (!document.body.classList.contains('mode-board')) return;

  // Ctrl+N desde el tablero: saltar a la barra de captura.
  if (e.key.toLowerCase() === 'n' && e.ctrlKey) {
    e.preventDefault();
    window.api.setMode('capture');
    return;
  }

  // Ctrl+Z deshace el ultimo completado mientras el toast siga vivo.
  if (e.key.toLowerCase() === 'z' && e.ctrlKey && pending) {
    e.preventDefault();
    undoPending();
  }
});

// El drop fuera de una columna no debe abrir el archivo en la ventana.
window.addEventListener('dragover', function (e) { e.preventDefault(); });
window.addEventListener('drop', function (e) { e.preventDefault(); });
