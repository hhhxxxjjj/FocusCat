// preload: 把有限的 IPC 能力暴露给 renderer
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('committen', {
  quit: () => ipcRenderer.send('cat:quit'),
  resetPosition: () => ipcRenderer.send('cat:reset-position'),
  openConfig: () => ipcRenderer.send('cat:open-config'),

  // 主进程通知 renderer 切 sprite 状态(idle / walk / eat)
  onSetState: (callback) => {
    ipcRenderer.on('cat:set-state', (_e, state) => callback(state));
  },

  // 主进程推送饱腹感数值(0-100)
  onHunger: (callback) => {
    ipcRenderer.on('cat:hunger', (_e, value) => callback(value));
  },

  // 主进程推送猫朝向变化(1=右,-1=左)
  onDirection: (callback) => {
    ipcRenderer.on('cat:direction', (_e, dir) => callback(dir));
  },
});
