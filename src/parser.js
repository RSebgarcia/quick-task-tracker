'use strict';

/**
 * Modulo puro: sin Electron, sin fs, sin estado. Se puede testear con node a secas.
 */

const SEPARATOR = ' - ';
const UNCLASSIFIED = 'sin_clasificar';

/**
 * Separador: espacio(s) + guion + espacios OPCIONALES.
 *   "mandar mail - trabajo"  ->  si
 *   "mandar mail -trabajo"   ->  si (mucha gente lo escribe pegado)
 *   "mandar e-mail"          ->  NO, a proposito: si no se exigiera el espacio antes del guion,
 *                        "Mandar un e-mail" se partiria en "Mandar un e" + categoria "mail".
 */
const SEPARATOR_RE = /\s+-\s*/g;

// Guardrail: si cualquier cosa despues de " - " creara una categoria, una tarea como
// "Llamar a Juan - preguntarle por el presupuesto" ensuciaria el tablero con una columna
// basura. Solo lo que parece un nombre de proyecto califica.
const MAX_CATEGORY_WORDS = 3;
const MAX_CATEGORY_CHARS = 24;

/**
 * Pasa a minusculas, saca tildes/diacriticos y colapsa espacios.
 * "Trabajo " -> "trabajo" | "Mudánza" -> "mudanza"
 */
function normalize(str) {
  return String(str == null ? '' : str)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Busca el texto entre los id, labels y alias de las categorias. Devuelve la categoria o null. */
function matchCategory(text, categories) {
  const needle = normalize(text);
  if (!needle) return null;

  for (const cat of categories || []) {
    if (normalize(cat.id) === needle) return cat;
    if (normalize(cat.label) === needle) return cat;
    for (const alias of cat.alias || []) {
      if (normalize(alias) === needle) return cat;
    }
  }
  return null;
}

/** Ultima aparicion del separador. Devuelve { index, length } o null. */
function findLastSeparator(input) {
  const re = new RegExp(SEPARATOR_RE.source, 'g');
  let last = null;
  let m;

  while ((m = re.exec(input)) !== null) {
    last = { index: m.index, length: m[0].length };
  }

  return last;
}

/** Un candidato sirve como nombre de categoria si es corto y tiene al menos un caracter util. */
function looksLikeCategory(candidate) {
  const clean = String(candidate).trim();
  if (!clean) return false;
  if (clean.length > MAX_CATEGORY_CHARS) return false;
  if (clean.split(/\s+/).length > MAX_CATEGORY_WORDS) return false;
  return /[a-z0-9]/i.test(normalize(clean));
}

/**
 * Parseo deterministico de la barra de captura.
 *
 *   "Llamar a Juan - trabajo"         -> { text: "Llamar a Juan", column: "trabajo" }
 *   "Revisar informe - Q3 - trabajo"  -> { text: "Revisar informe - Q3", column: "trabajo" }
 *   "Comprar cinta - mudanza"         -> { text: "Comprar cinta", newLabel: "mudanza" }   (categoria nueva)
 *   "Comprar pan"                     -> { text: "Comprar pan", column: "sin_clasificar" }
 *   "Llamar - preguntar por el presupuesto"
 *                                     -> { text: <todo el texto>, column: "sin_clasificar" }
 *                                        (el candidato es muy largo: era parte de la frase)
 *
 * Devuelve null si el input esta vacio.
 */
function parseTaskInput(inputString, categories) {
  const input = String(inputString == null ? '' : inputString).trim();
  if (!input) return null;

  const cut = findLastSeparator(input);
  if (!cut) {
    return { text: input, column: UNCLASSIFIED, newLabel: null };
  }

  const title = input.slice(0, cut.index).trim();
  const candidate = input.slice(cut.index + cut.length).trim();

  const known = matchCategory(candidate, categories);

  // El candidato no es un nombre de categoria plausible: el " - " era parte de la frase,
  // asi que la tarea va entera a sin clasificar sin recortarle nada.
  if (!known && !looksLikeCategory(candidate)) {
    return { text: input, column: UNCLASSIFIED, newLabel: null };
  }

  // Caso degenerado: " - mudanza" (titulo vacio). Nos quedamos con el candidato como texto
  // para no perder lo que escribio el usuario.
  const text = title || candidate;

  if (known) {
    return { text: text, column: known.id, newLabel: null };
  }

  // Sin titulo no vale la pena crear una categoria: seria una tarea llamada igual que su columna.
  if (!title) {
    return { text: text, column: UNCLASSIFIED, newLabel: null };
  }

  return { text: text, column: null, newLabel: candidate };
}

module.exports = {
  parseTaskInput,
  normalize,
  matchCategory,
  looksLikeCategory,
  SEPARATOR,
  UNCLASSIFIED,
  MAX_CATEGORY_WORDS,
  MAX_CATEGORY_CHARS
};
