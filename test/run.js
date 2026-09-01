'use strict';

/**
 * Tests sin dependencias: node test/run.js
 * Cubren los tres modulos puros (parser, config-manager, data-store), que es donde
 * viven las reglas y donde un bug se lleva puestas las tareas del usuario.
 */

const os = require('os');
const fs = require('fs');
const path = require('path');

const parser = require('../src/parser');
const config = require('../src/config-manager');
const store = require('../src/data-store');

const { parseTaskInput, UNCLASSIFIED } = parser;

let fails = 0;
let total = 0;

function check(name, actual, expected) {
  total += 1;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log('  ok   ' + name);
    return;
  }
  fails += 1;
  console.log('  FALLA ' + name + '\n         esperaba ' + e + '\n         obtuvo   ' + a);
}

function section(title) {
  console.log('\n' + title);
}

function tempDir(tag) {
  const dir = path.join(os.tmpdir(), 'tt-test-' + tag + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const dirs = [];
function freshApp() {
  const dir = tempDir('app');
  dirs.push(dir);
  store.init(dir);
  config.init(dir);
  return dir;
}

/** Lo mismo que hace main.js al recibir una tarea de la barra de captura. */
function capture(raw) {
  const parsed = parseTaskInput(raw, config.getCategories());
  if (!parsed) return null;
  const column = parsed.newLabel ? config.ensureCategory(parsed.newLabel).id : parsed.column;
  return store.addTask(parsed.text, column);
}

/** Lo mismo que hace main.js despues de borrar o mover tareas. */
function prune() {
  const tasks = store.getTasks();
  config.getCategories().forEach(function (cat) {
    if (cat.fija) return;
    if (!tasks.some(function (t) { return t.column === cat.id; })) config.removeIfTemporary(cat.id);
  });
}

const ids = function () {
  return config.getCategories().map(function (c) { return c.id + (c.fija ? '' : '*'); });
};

// ------------------------------------------------------------------ parser

section('parser: separador');
{
  const cats = [{ id: 'trabajo', label: 'Trabajo', alias: ['trabajo', 'laburo'] }];
  const col = function (raw) {
    const p = parseTaskInput(raw, cats);
    return p.newLabel ? 'NUEVA:' + p.newLabel : p.column;
  };

  check('con espacios', col('llamar - trabajo'), 'trabajo');
  check('pegado al guion', col('llamar -trabajo'), 'trabajo');
  check('varios espacios', col('llamar  -   trabajo'), 'trabajo');
  check('usa el ultimo separador', parseTaskInput('informe - Q3 - trabajo', cats).text, 'informe - Q3');
  check('sin guion', col('comprar pan'), UNCLASSIFIED);
  check('guion suelto al final', col('llamar -'), UNCLASSIFIED);
}

section('parser: guiones que no separan');
{
  const cats = [];
  const intacto = function (raw) {
    const p = parseTaskInput(raw, cats);
    return p.column === UNCLASSIFIED && p.text === raw;
  };

  check('e-mail', intacto('mandar un e-mail'), true);
  check('Coca-Cola', intacto('comprar Coca-Cola'), true);
  check('ticket JIRA-1234', intacto('ver el ticket JIRA-1234'), true);
  check('pre-venta', intacto('reunion pre-venta'), true);
  check('expediente 4471/26-A', intacto('revisar expediente 4471/26-A'), true);
}

section('parser: mayusculas y tildes');
{
  const cats = [{ id: 'academia', label: 'Academia', alias: ['academia'] }];
  const col = function (raw) { return parseTaskInput(raw, cats).column; };

  check('minusculas', col('x -academia'), 'academia');
  check('MAYUSCULAS', col('x -ACADEMIA'), 'academia');
  check('MiXtO', col('x -AcAdEmIa'), 'academia');
  check('con tilde', col('x -ACADÉMIA'), 'academia');
}

section('parser: guardrail de frases largas');
{
  const largo = 'llamar a Juan - preguntarle por el presupuesto';
  const p = parseTaskInput(largo, []);
  check('no crea categoria', p.column, UNCLASSIFIED);
  check('conserva el texto entero', p.text, largo);
  check('tres palabras si crean', parseTaskInput('x - obra casa nueva', []).newLabel, 'obra casa nueva');
  check('cuatro palabras no', parseTaskInput('x - obra de casa nueva', []).column, UNCLASSIFIED);
}

// ------------------------------------------------------------------ categorias

section('categorias: instalacion nueva');
{
  freshApp();
  check('arranca sin categorias', ids(), []);
  check('marca primer arranque', config.isFirstRun(), true);
  check('atajos por defecto', config.getShortcuts(), { captura: 'Control+Alt+T', tablero: 'Control+Alt+B' });
}

section('categorias: nacen solas');
{
  freshApp();
  check('crea la columna', capture('comprar cinta -mudanza').column, 'mudanza');
  check('nombre normalizado', config.getById('mudanza').label, 'Mudanza');
  check('reusa con otro tipeo', capture('pedir flete - MUDANZA').column, 'mudanza');
  check('no duplica', ids(), ['mudanza*']);
  check('es temporal', config.getById('mudanza').fija, false);
}

section('categorias: la temporal vacia se borra sola');
{
  freshApp();
  const t = capture('mandar informe -trabjo'); // typo a proposito
  check('el typo creo su columna', ids(), ['trabjo*']);
  capture('otra cosa -trabajo');
  store.moveTask(t.id, 'trabajo');
  prune();
  check('la del typo desaparecio', ids(), ['trabajo*']);
}

section('categorias: fijar y desfijar');
{
  freshApp();
  capture('algo -obra');
  config.setPinned('obra', true);
  store.moveAll('obra', UNCLASSIFIED);
  prune();
  check('la fija sobrevive vacia', ids(), ['obra']);
  config.setPinned('obra', false);
  prune();
  check('al desfijarla vacia, se va', ids(), []);
}

section('categorias: panel de configuracion');
{
  freshApp();
  config.replaceCategories([
    { label: 'Trabajo', color: '#5b8cff', alias: 'trabajo, laburo', fija: true },
    { label: 'Casa', color: '#2dd4a7', alias: '', fija: true }
  ]);
  check('crea las dos', ids(), ['trabajo', 'casa']);
  check('guarda los alias', config.getById('trabajo').alias, ['trabajo', 'laburo']);
  check('sin alias usa el nombre', config.getById('casa').alias, ['casa']);
  check('el alias funciona', parseTaskInput('x -laburo', config.getCategories()).column, 'trabajo');

  const t = capture('pagar luz -casa');
  config.replaceCategories([
    { id: 'trabajo', label: 'Trabajo', color: '#5b8cff', alias: 'trabajo', fija: true },
    { id: 'casa', label: 'Hogar', color: '#2dd4a7', alias: 'hogar, casa', fija: true }
  ]);
  check('renombrar no cambia el id', ids(), ['trabajo', 'casa']);
  check('el nombre si cambia', config.getById('casa').label, 'Hogar');
  check('la tarea sigue en su lugar', store.getTasks().filter(function (x) { return x.column === 'casa'; }).length, 1);
  check('el nombre viejo sigue andando', parseTaskInput('x -casa', config.getCategories()).column, 'casa');

  const res = config.replaceCategories([{ id: 'trabajo', label: 'Trabajo', color: '#5b8cff', alias: 'trabajo', fija: true }]);
  check('avisa cual borro', res.removed, ['casa']);
  check('sus tareas se rescatan', store.moveAll('casa', UNCLASSIFIED), 1);
  check('van a sin clasificar', store.getTasks().find(function (x) { return x.id === t.id; }).column, UNCLASSIFIED);
}

section('categorias: nombres repetidos no pisan ids');
{
  freshApp();
  config.replaceCategories([
    { label: 'Trabajo', color: '#5b8cff', alias: '', fija: true },
    { label: 'Trabajo', color: '#f472b6', alias: '', fija: true }
  ]);
  check('ids distintos', ids(), ['trabajo', 'trabajo_2']);
}

// ------------------------------------------------------------------ tareas

section('tareas: alta, orden y edicion');
{
  freshApp();
  const a = capture('uno -casa');
  const b = capture('dos -casa');
  check('se agregan al final', [a.order, b.order], [0, 1]);

  store.applyLayout({ casa: [b.id, a.id] });
  const casa = store.getTasks().filter(function (t) { return t.column === 'casa'; });
  check('el drag reordena', casa.map(function (t) { return t.text; }), ['dos', 'uno']);

  check('editar el texto', store.updateText(a.id, 'uno corregido'), true);
  check('quedo guardado', store.getTasks().find(function (t) { return t.id === a.id; }).text, 'uno corregido');
  check('texto vacio no pisa', store.updateText(a.id, '   '), false);
  check('id inexistente', store.updateText('nope', 'x'), false);
}

section('tareas: borrar');
{
  freshApp();
  const t = capture('algo -casa');
  check('borra', store.deleteTask(t.id), true);
  check('no queda nada', store.getTasks().length, 0);
  check('borrar dos veces', store.deleteTask(t.id), false);
}

// ------------------------------------------------------------------ persistencia

section('persistencia: sobrevive al reinicio');
{
  const dir = freshApp();
  capture('tarea uno -casa');
  config.setShortcuts({ captura: 'Control+Alt+J' });
  config.setPinned('casa', true);
  store.flush();

  config.init(dir);
  store.init(dir);
  check('las categorias', ids(), ['casa']);
  check('las tareas', store.getTasks().length, 1);
  check('los atajos', config.getShortcuts().captura, 'Control+Alt+J');
  check('ya no es primer arranque', config.isFirstRun(), false);
}

section('persistencia: archivos rotos no rompen la app');
{
  const dir = tempDir('roto');
  dirs.push(dir);
  fs.writeFileSync(path.join(dir, 'config.json'), '{ esto no es json');
  fs.writeFileSync(path.join(dir, 'data.json'), 'tampoco');
  store.init(dir);
  config.init(dir);
  check('config se regenera', ids(), []);
  check('data se regenera', store.getTasks(), []);
}

section('persistencia: migra el formato viejo');
{
  const dir = tempDir('legacy');
  dirs.push(dir);
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ trabajo: ['trabajo', 'laburo'], casa: ['casa'] }));
  store.init(dir);
  config.init(dir);
  check('migra las claves', ids(), ['trabajo', 'casa']);
  check('conserva los alias', config.getById('trabajo').alias, ['trabajo', 'laburo']);
  check('quedan fijas', config.getById('casa').fija, true);
}

// ------------------------------------------------------------------

dirs.forEach(function (d) {
  try { fs.rmSync(d, { recursive: true, force: true }); } catch (err) { /* ya no esta */ }
});

console.log('\n' + (total - fails) + '/' + total + ' checks');
if (fails) {
  console.log(fails + ' FALLARON');
  process.exit(1);
}
console.log('todo ok');
