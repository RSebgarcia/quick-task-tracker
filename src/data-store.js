'use strict';

const fs = require('fs');
const path = require('path');

const DEBOUNCE_MS = 300;

let dataPath = null;
let tmpPath = null;
let tasks = [];
let saveTimer = null;

function init(dir) {
  dataPath = path.join(dir, 'data.json');
  tmpPath = dataPath + '.tmp';
  fs.mkdirSync(dir, { recursive: true });

  let raw = null;
  try {
    raw = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  } catch (err) {
    raw = null;
  }

  tasks = raw && Array.isArray(raw.tasks) ? raw.tasks.filter(isValidTask) : [];
  if (!raw || !Array.isArray(raw.tasks)) flush();
  return tasks;
}

function isValidTask(t) {
  return t && typeof t === 'object' && typeof t.id === 'string' && typeof t.text === 'string';
}

/** Escritura debounced (~300ms): la rafaga de drag&drop toca disco una sola vez. */
function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, DEBOUNCE_MS);
}

/** Escritura atomica: tmp + rename, para no dejar un data.json a medio escribir. */
function flush() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (!dataPath) return;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify({ tasks }, null, 2), 'utf8');
    fs.renameSync(tmpPath, dataPath);
  } catch (err) {
    console.error('[data-store] no se pudo escribir data.json:', err.message);
  }
}

function getTasks() {
  return tasks
    .slice()
    .sort((a, b) => (a.order || 0) - (b.order || 0));
}

function newId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

function addTask(text, column) {
  const inColumn = tasks.filter((t) => t.column === column);
  const maxOrder = inColumn.reduce((max, t) => Math.max(max, t.order || 0), -1);

  const task = {
    id: newId(),
    text,
    column,
    order: maxOrder + 1,
    createdAt: new Date().toISOString(),
    completedAt: null
  };

  tasks.push(task);
  scheduleSave();
  return task;
}

function deleteTask(id) {
  const before = tasks.length;
  tasks = tasks.filter((t) => t.id !== id);
  if (tasks.length !== before) scheduleSave();
  return tasks.length !== before;
}

function moveTask(id, column) {
  const task = tasks.find((t) => t.id === id);
  if (!task || task.column === column) return false;

  const maxOrder = tasks
    .filter((t) => t.column === column)
    .reduce((max, t) => Math.max(max, t.order || 0), -1);

  task.column = column;
  task.order = maxOrder + 1;
  scheduleSave();
  return true;
}

/** Corrige el texto de una tarea ya guardada. */
function updateText(id, text) {
  const clean = String(text == null ? '' : text).trim();
  const task = tasks.find((t) => t.id === id);
  if (!task || !clean || task.text === clean) return false;

  task.text = clean;
  scheduleSave();
  return true;
}

/** Mueve todas las tareas de una columna a otra (arreglar un typo de categoria de una). */
function moveAll(from, to) {
  if (from === to) return 0;

  let maxOrder = tasks
    .filter((t) => t.column === to)
    .reduce((max, t) => Math.max(max, t.order || 0), -1);

  const moving = tasks
    .filter((t) => t.column === from)
    .sort((a, b) => (a.order || 0) - (b.order || 0));

  moving.forEach((task) => {
    maxOrder += 1;
    task.column = to;
    task.order = maxOrder;
  });

  if (moving.length) scheduleSave();
  return moving.length;
}

/**
 * layout = { trabajo: [id, id...], casa: [...], ... }
 * Reasigna columna y order segun el orden visual que quedo en el tablero.
 */
function applyLayout(layout) {
  if (!layout || typeof layout !== 'object') return false;

  const index = new Map(tasks.map((t) => [t.id, t]));
  let changed = false;

  for (const column of Object.keys(layout)) {
    const ids = Array.isArray(layout[column]) ? layout[column] : [];
    ids.forEach((id, i) => {
      const task = index.get(id);
      if (!task) return;
      if (task.column !== column || task.order !== i) {
        task.column = column;
        task.order = i;
        changed = true;
      }
    });
  }

  if (changed) scheduleSave();
  return changed;
}

function getPath() {
  return dataPath;
}

module.exports = { init, getTasks, addTask, deleteTask, moveTask, moveAll, updateText, applyLayout, flush, getPath };
