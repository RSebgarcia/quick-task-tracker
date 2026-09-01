'use strict';

const fs = require('fs');
const path = require('path');
const { normalize } = require('./parser');

/**
 * config.json: la lista de categorias.
 *
 *   fija: true  -> columna permanente, se muestra aunque este vacia y nunca se borra sola.
 *   fija: false -> categoria temporal creada al vuelo desde la barra de captura.
 *                  Se borra sola en cuanto se queda sin tareas (asi se limpian los typos).
 */

/**
 * Instalacion nueva: sin categorias. Cada una nace sola al escribir "tarea - nombre",
 * asi el que la instala arranca con las suyas y no con las de otro.
 * (Los config.json que ya existen no se tocan: esto solo aplica al primer arranque.)
 */
const DEFAULT_CATEGORIES = [];

// Colores para las categorias nuevas. Se elige el menos usado en ese momento.
const PALETTE = ['#f472b6', '#38bdf8', '#fb923c', '#a3e635', '#c084fc', '#2dd4bf', '#facc15', '#f87171'];

const DEFAULT_SHORTCUTS = {
  captura: 'Control+Alt+T',
  tablero: 'Control+Alt+B'
};

let configPath = null;
let categories = [];
let shortcuts = Object.assign({}, DEFAULT_SHORTCUTS);
let firstRun = false; // true si el config.json no existia: sirve para el setup inicial

function init(dir) {
  configPath = path.join(dir, 'config.json');
  fs.mkdirSync(dir, { recursive: true });

  let raw = null;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) {
    raw = null; // no existe o esta roto -> se regenera
  }

  firstRun = raw === null;
  categories = readCategories(raw);
  shortcuts = readShortcuts(raw);
  save();
  return categories;
}

function readShortcuts(raw) {
  const out = Object.assign({}, DEFAULT_SHORTCUTS);
  const src = raw && raw.atajos;
  if (!src || typeof src !== 'object') return out;

  for (const key of Object.keys(DEFAULT_SHORTCUTS)) {
    if (typeof src[key] === 'string' && src[key].trim()) out[key] = src[key].trim();
  }
  return out;
}

/** Primer arranque de esta instalacion (no habia config.json). */
function isFirstRun() {
  return firstRun;
}

/** Acepta el formato nuevo, migra el viejo ({ nombre: [alias...] }) y cae al default si no hay nada. */
function readCategories(raw) {
  if (!raw || typeof raw !== 'object') return cloneDefaults();

  if (Array.isArray(raw.categorias)) {
    const list = raw.categorias.map(sanitize).filter(Boolean);
    return list.length ? ensureDefaultsPresent(list) : cloneDefaults();
  }

  // Formato viejo: { trabajo: ["trabajo","laburo"], casa: [...] }
  const legacyKeys = Object.keys(raw).filter(function (k) { return Array.isArray(raw[k]); });
  if (legacyKeys.length) {
    const migrated = legacyKeys.map(function (key) {
      const preset = DEFAULT_CATEGORIES.find(function (d) { return d.id === key; });
      return {
        id: key,
        label: preset ? preset.label : titleCase(key),
        fija: true, // todo lo que existia antes era columna fija
        color: preset ? preset.color : pickColor([]),
        alias: raw[key].filter(function (a) { return typeof a === 'string' && a.trim(); })
      };
    });
    return ensureDefaultsPresent(migrated);
  }

  return cloneDefaults();
}

function sanitize(entry) {
  if (!entry || typeof entry !== 'object') return null;

  const id = normalize(entry.id || entry.label);
  if (!id) return null;

  return {
    id: slug(id),
    label: typeof entry.label === 'string' && entry.label.trim() ? entry.label.trim() : titleCase(id),
    fija: entry.fija !== false,
    color: typeof entry.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(entry.color) ? entry.color : PALETTE[0],
    alias: Array.isArray(entry.alias)
      ? entry.alias.filter(function (a) { return typeof a === 'string' && a.trim(); })
      : []
  };
}

/** Si el usuario borro una fija a mano del config, no la resucitamos: solo evita quedarse sin nada. */
function ensureDefaultsPresent(list) {
  return list.length ? list : cloneDefaults();
}

function cloneDefaults() {
  return DEFAULT_CATEGORIES.map(function (c) {
    return { id: c.id, label: c.label, fija: c.fija, color: c.color, alias: c.alias.slice() };
  });
}

function slug(text) {
  return normalize(text).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'cat';
}

// Hasta esta longitud, una palabra toda en mayusculas se toma como sigla (CX, BI, RRHH)
// y se deja como esta. Mas larga que eso es griterio y se normaliza.
const ACRONYM_MAX = 4;

/**
 * El nombre de la columna no depende de como venian las mayusculas:
 * "MUDANZA", "mudanza" y "Mudanza" dan todos "Mudanza". Lo unico que se respeta
 * es el case mixto a proposito (ProyectoX, McKinsey) y las siglas cortas (CX, RRHH).
 */
function titleCase(text) {
  return String(text)
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map(smartCase)
    .join(' ');
}

function smartCase(word) {
  if (!word) return word;

  const upper = word.toUpperCase();
  const lower = word.toLowerCase();

  // Case mixto: lo escribio asi a proposito.
  if (word !== lower && word !== upper) return word;

  // Sigla corta: se deja tal cual.
  if (word === upper && word.length <= ACRONYM_MAX && /[A-Z]/i.test(word)) return word;

  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function pickColor(existing) {
  const used = {};
  existing.forEach(function (c) { used[c.color] = (used[c.color] || 0) + 1; });

  let best = PALETTE[0];
  let bestCount = Infinity;
  PALETTE.forEach(function (color) {
    const n = used[color] || 0;
    if (n < bestCount) {
      bestCount = n;
      best = color;
    }
  });
  return best;
}

function save() {
  if (!configPath) return;
  try {
    fs.writeFileSync(
      configPath,
      JSON.stringify({ categorias: categories, atajos: shortcuts }, null, 2),
      'utf8'
    );
  } catch (err) {
    console.error('[config-manager] no se pudo escribir config.json:', err.message);
  }
}

// ---------------------------------------------------------------- API

function getCategories() {
  // Fijas primero (en el orden del config), despues las temporales.
  const fijas = categories.filter(function (c) { return c.fija; });
  const temporales = categories.filter(function (c) { return !c.fija; });
  return fijas.concat(temporales);
}

function getById(id) {
  return categories.find(function (c) { return c.id === id; }) || null;
}

/** Busca por id o por cualquiera de sus alias, todo normalizado. */
function findByText(text) {
  const needle = normalize(text);
  if (!needle) return null;

  for (const cat of categories) {
    if (cat.id === slug(needle)) return cat;
    if (normalize(cat.label) === needle) return cat;
    for (const alias of cat.alias) {
      if (normalize(alias) === needle) return cat;
    }
  }
  return null;
}

/** Devuelve la categoria existente, o crea una temporal nueva con ese nombre. */
function ensureCategory(labelRaw) {
  const found = findByText(labelRaw);
  if (found) return found;

  const label = String(labelRaw).trim();
  const cat = {
    id: uniqueId(slug(label)),
    label: titleCase(label),
    fija: false,
    color: pickColor(categories),
    alias: [label.toLowerCase()]
  };

  categories.push(cat);
  save();
  return cat;
}

function uniqueId(base, taken) {
  const isTaken = function (id) {
    return categories.some(function (c) { return c.id === id; }) || (taken ? taken.has(id) : false);
  };

  let id = base;
  let n = 2;
  while (isTaken(id)) {
    id = base + '_' + n;
    n += 1;
  }
  return id;
}

/** Solo borra temporales. Las fijas se quedan aunque esten vacias. */
function removeIfTemporary(id) {
  const i = categories.findIndex(function (c) { return c.id === id && !c.fija; });
  if (i === -1) return false;
  categories.splice(i, 1);
  save();
  return true;
}

/** Fijar una temporal (el proyecto dejo de ser temporal) o soltar una fija. */
function setPinned(id, pinned) {
  const cat = getById(id);
  if (!cat) return false;
  cat.fija = !!pinned;
  save();
  return true;
}

function getShortcuts() {
  return Object.assign({}, shortcuts);
}

function setShortcuts(next) {
  for (const key of Object.keys(DEFAULT_SHORTCUTS)) {
    if (next && typeof next[key] === 'string' && next[key].trim()) shortcuts[key] = next[key].trim();
  }
  save();
  return getShortcuts();
}

/**
 * Reemplaza la lista completa con lo que quedo en el panel de configuracion.
 * Los id NUNCA cambian: las tareas apuntan al id, asi que renombrar solo toca el label.
 * Las categorias que el usuario saco del panel se devuelven en `removed` para que
 * quien llama decida que hacer con sus tareas.
 */
function replaceCategories(list) {
  const incoming = Array.isArray(list) ? list : [];
  const kept = [];
  const seen = new Set();

  for (const entry of incoming) {
    const label = String(entry && entry.label != null ? entry.label : '').trim();
    if (!label) continue; // fila vacia del panel: se ignora

    const existing = entry.id ? getById(entry.id) : null;
    const id = existing ? existing.id : uniqueId(slug(label), seen);
    if (seen.has(id)) continue;
    seen.add(id);

    kept.push({
      id: id,
      label: label,
      fija: entry.fija !== false,
      color: typeof entry.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(entry.color)
        ? entry.color
        : (existing ? existing.color : pickColor(kept)),
      alias: normalizeAliasList(entry.alias, label)
    });
  }

  const removed = categories.filter((c) => !seen.has(c.id)).map((c) => c.id);
  categories = kept;
  save();
  return { removed: removed, categories: getCategories() };
}

function normalizeAliasList(raw, label) {
  const list = Array.isArray(raw)
    ? raw
    : String(raw == null ? '' : raw).split(',');

  const out = [];
  const seen = new Set();
  for (const item of list) {
    const clean = String(item).trim();
    if (!clean) continue;
    const key = normalize(clean);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }

  // El propio nombre siempre matchea, aunque el usuario borre todos los alias.
  if (!seen.has(normalize(label))) out.unshift(label.toLowerCase());
  return out;
}

function getPath() {
  return configPath;
}

module.exports = {
  init,
  isFirstRun,
  getCategories,
  getById,
  findByText,
  ensureCategory,
  removeIfTemporary,
  setPinned,
  replaceCategories,
  getShortcuts,
  setShortcuts,
  DEFAULT_SHORTCUTS,
  getPath,
  DEFAULT_CATEGORIES
};
