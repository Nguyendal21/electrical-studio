const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electricalFiles', {
  open: () => ipcRenderer.invoke('electrical-files:open'),
  save: request => ipcRenderer.invoke('electrical-files:save', {
    documentId: request?.documentId,
    content: request?.content,
    suggestedName: request?.suggestedName,
    saveAs: request?.saveAs === true,
    automatic: request?.automatic === true,
  }),
});
