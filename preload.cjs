/**
 * Context-isolated bridge. The webapp gets a tiny surface to talk to the
 * shell (open the connection manager); the connection manager itself gets
 * the list/save API.
 */

const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('pcaDesktop', {
    platform: 'electron',
    openConnections: () => ipcRenderer.invoke('app:open-connections'),
    connections: {
        list: () => ipcRenderer.invoke('connections:list'),
        save: list => ipcRenderer.invoke('connections:save', list),
    },
});
