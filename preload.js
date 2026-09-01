'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Unica superficie expuesta al renderer: sin fs, sin require, sin ipcRenderer crudo.
contextBridge.exposeInMainWorld('api', {
  // tareas
  getTasks: () => ipcRenderer.invoke('tasks:get'),
  addTask: (text) => ipcRenderer.invoke('tasks:add', text),
  deleteTask: (id) => ipcRenderer.invoke('tasks:delete', id),
  moveTask: (id, column) => ipcRenderer.invoke('tasks:move', { id, column }),
  reorder: (layout) => ipcRenderer.invoke('tasks:reorder', layout),
  moveAll: (from, to) => ipcRenderer.invoke('tasks:moveAll', { from, to }),
  updateText: (id, text) => ipcRenderer.invoke('tasks:updateText', { id, text }),
  contextMenu: (id, column) => ipcRenderer.invoke('tasks:contextMenu', { id, column }),

  // configuracion
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (categorias, atajos) => ipcRenderer.invoke('config:save', { categorias, atajos }),

  // categorias / columnas
  getColumns: () => ipcRenderer.invoke('columns:get'),
  columnMenu: (id) => ipcRenderer.invoke('columns:contextMenu', { id }),
  setPinned: (id, pinned) => ipcRenderer.invoke('columns:setPinned', { id, pinned }),

  // ventana
  hide: () => ipcRenderer.send('window:hide'),
  setMode: (mode) => ipcRenderer.send('window:mode', mode),
  setBoardColumns: (count) => ipcRenderer.send('window:boardColumns', count),
  setModal: (open) => ipcRenderer.send('window:modal', open),

  // main -> renderer
  onMode: (callback) => ipcRenderer.on('mode', (event, mode) => callback(mode))
});
