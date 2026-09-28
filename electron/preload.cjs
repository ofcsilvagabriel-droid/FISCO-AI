const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('fiscoaiDesktop', Object.freeze({
  isDesktop: true,
  platform: process.platform,
  version: process.versions.electron,
  agentApi: true,
}));
