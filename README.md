# Task Tracker

Captura de tareas sin fricción para Windows. Un atajo, una línea de texto, Enter.
La tarea se archiva sola en la columna que corresponde y la ventana desaparece.

Vive en la bandeja del sistema. No usa la red, no tiene cuentas, no sincroniza nada:
tus tareas son un archivo JSON en tu propia máquina.

---

## Cómo funciona

Apretás `Ctrl+Alt+T` en cualquier momento y aparece una barra. Escribís:

```
llamar al contador - trabajo
```

Enter, y la tarea queda en la columna **Trabajo**. La ventana se va sola.
`Ctrl+Alt+B` abre el tablero cuando querés ver todo.

### Las categorías se crean solas

No hay que configurar nada antes de empezar. Cualquier cosa después del guion
que no reconozca crea una columna nueva:

```
comprar cinta -mudanza      →  crea la columna "Mudanza"
pedir presupuesto -mudanza  →  cae en la misma
```

Esas columnas son **temporales**: desaparecen solas cuando se quedan sin tareas.
Si te equivocaste al escribir, movés la tarjeta y la columna del typo se evapora.
Si el proyecto resultó ser permanente, clic derecho en el nombre de la columna →
*Fijar como categoría permanente*.

El guion acepta las dos formas, `- trabajo` y `-trabajo`, y no le importan las
mayúsculas ni las tildes: `TRABAJO`, `Trabajo` y `trabajo` son la misma columna.

Las tareas sin guion van a **Sin clasificar**, que sólo aparece cuando tiene algo.

### El guardrail

Si todo lo que sigue a un guion creara una columna, `llamar a Juan - preguntarle por
el presupuesto` te llenaría el tablero de basura. Sólo cuenta como categoría lo de
**hasta 3 palabras y 24 caracteres**; más largo que eso se toma como parte de la frase
y la tarea va entera a Sin clasificar, sin recortar nada.

Por eso también `e-mail`, `Coca-Cola` y `JIRA-1234` quedan intactos: el guion sólo
separa si tiene un espacio delante.

---

## En el tablero

| Acción | Cómo |
|---|---|
| Completar | Clic en el círculo. Quedan 5 segundos para deshacer antes de que se borre |
| Corregir el texto | Doble clic en la tarjeta |
| Reordenar / cambiar de columna | Arrastrar |
| Mover una tarea | Clic derecho en la tarjeta |
| Mover una columna entera | Clic derecho en el nombre de la columna |
| Fijar o soltar una categoría | Clic derecho en el nombre de la columna |
| Categorías, alias, colores y atajos | Botón ⚙ |

Completar borra la tarea de verdad: esto es una bandeja de entrada, no un historial.
Los 5 segundos de deshacer son la red de seguridad, y hasta que se cumplen no se
toca el disco.

---

## Instalación

Descargá el instalador desde [Releases](../../releases) y ejecutalo.

Windows va a mostrar **"Windows protegió su PC"** porque el ejecutable no está
firmado (firmar cuesta cientos de dólares al año). Hacé clic en **Más información →
Ejecutar de todos modos**.

---

## Correrlo desde el código

```bash
npm install
npm start
```

`npm run dev` es lo mismo pero sin ocultar la ventana al perder el foco, que es
lo que hace posible abrir las DevTools.

Para generar el instalador y la versión portable:

```bash
npm run dist
```

---

## Dónde viven tus datos

`%APPDATA%\task-tracker\`

- `data.json` — las tareas
- `config.json` — categorías, alias, colores y atajos

Son archivos de texto legibles. Se pueden editar a mano, versionar o copiar a otra
máquina. Sobreviven a las actualizaciones porque están fuera del programa.

---

## Cómo está hecho

Electron sin frameworks de UI: HTML, CSS y JavaScript a secas. Sin React, sin build
step, sin dependencias en tiempo de ejecución.

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`
- El renderer no toca el disco ni Node: todo pasa por un `preload.js` con una
  superficie IPC chica y explícita
- Escrituras con debounce de 300ms y `tmp` + `rename` atómico
- Una sola `BrowserWindow` que cambia de tamaño y se oculta, nunca se destruye

| Archivo | Qué hace |
|---|---|
| `main.js` | Ventana, atajos globales, bandeja, menús nativos, IPC |
| `preload.js` | El único puente entre el renderer y el proceso principal |
| `src/parser.js` | El parseo del texto. Módulo puro, sin Electron ni fs |
| `src/config-manager.js` | `config.json`: categorías, alias, atajos |
| `src/data-store.js` | `data.json` con escritura debounced |
| `src/renderer.js` | La UI: tablero, drag & drop, panel de configuración |

---

## Licencia

MIT — ver [LICENSE](LICENSE).

El código es MIT y podés hacer lo que quieras con él. El isotipo de los iconos
(`src/tray-on-*.png`, `build/icon.ico`) es marca de **InSait** y no entra en esa
licencia: si publicás un fork, cambiá los iconos por los tuyos.

---

<p align="center">
  <sub>Designed by <b>InSait</b></sub>
</p>
