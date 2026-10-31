// Ponte segura entre a janela (HTML) e o processo principal. A janela não enxerga o Node direto;
// só pode chamar estas funções e ouvir o 'estado'.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('app', {
  entrar: () => ipcRenderer.invoke('entrar'),
  sair: () => ipcRenderer.invoke('sair'),
  conectarLetras: () => ipcRenderer.invoke('conectar-letras'),
  desconectarLetras: () => ipcRenderer.invoke('desconectar-letras'),
  fechar: () => ipcRenderer.invoke('fechar'),
  minimizar: () => ipcRenderer.invoke('minimizar'),
  fixar: (fixo) => ipcRenderer.invoke('fixar', fixo),
  opacidade: (v) => ipcRenderer.invoke('opacidade', v),
  ignorarClique: (ignora) => ipcRenderer.invoke('ignorar-clique', ignora),
  salvarPrefs: (prefs) => ipcRenderer.invoke('salvar-prefs', prefs),
  abrirSpotify: () => ipcRenderer.invoke('abrir-spotify'),
  expandir: () => ipcRenderer.invoke('expandir'),
  salvarChaveDeepl: (chave) => ipcRenderer.invoke('salvar-chave-deepl', chave),
  aoAtualizar: (cb) => ipcRenderer.on('estado', (_e, msg) => cb(msg)),
});
