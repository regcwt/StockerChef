import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  getStore: (key: string) => ipcRenderer.invoke('store-get', key),
  setStore: (key: string, value: unknown) => ipcRenderer.invoke('store-set', key, value),
});
