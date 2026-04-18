export interface ElectronAPI {
  getStore: (key: string) => Promise<unknown>;
  setStore: (key: string, value: unknown) => Promise<boolean>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
