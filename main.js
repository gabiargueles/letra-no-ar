// Letra no Ar — processo principal do Electron.
// Janelinha sem bordas, sempre em primeiro plano, que:
//   1) conecta no Spotify uma vez (login no Spotify web; guarda só o cookie sp_dc da própria pessoa);
//   2) com esse login, pergunta de segundo em segundo o que está tocando E busca a letra sincronizada
//      (o MESMO login serve pros dois — não precisa de app registrado nem tem limite de usuários);
//   3) romaniza (coreano/japonês), traduz, e manda tudo para a janela, que rola a letra no tempo certo.
const { app, BrowserWindow, ipcMain, shell, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const criarLetras = require('./letras.js');
const criarSpotifyLetras = require('./spotify-letras.js');

const PASTA = app.getPath('userData');
const log = (m) => console.log(new Date().toISOString(), m);
const letras = criarLetras({ dataDir: PASTA, log });
// dicionário do japonês (kuromoji): no app empacotado ele fica fora do asar (asarUnpack)
let DICT = path.join(__dirname, 'node_modules', 'kuromoji', 'dict');
if (app.isPackaged) DICT = DICT.replace('app.asar', 'app.asar.unpacked');
const spLetras = criarSpotifyLetras({ getSpDc: () => config.spDc, romanizar: letras.romanizar, traduzir: letras.traduzir, dataDir: PASTA, dictPath: DICT, log });

let janela = null;
const config = lerJSON('config.json', {});     // { spDc?, janela?, full?, prefs? }
let idAtual = null;                            // id da faixa que está tocando (pra não rebuscar a letra à toa)

function lerJSON(nome, padrao) {
  try { return JSON.parse(fs.readFileSync(path.join(PASTA, nome), 'utf8')); } catch { return padrao; }
}
function gravarJSON(nome, valor) {
  try { fs.writeFileSync(path.join(PASTA, nome), JSON.stringify(valor)); } catch (e) { log('não gravou ' + nome + ': ' + e.message); }
}

// ---------- login do Spotify (no Spotify web; guarda só o cookie sp_dc) ----------
// Abre o Spotify web numa janelinha; quando o cookie sp_dc aparecer (logou), guarda e fecha.
// Esse mesmo login serve pro "o que está tocando" E pra letra.
let janelaLogin = null;
function conectar() {
  if (janelaLogin && !janelaLogin.isDestroyed()) { janelaLogin.focus(); return; }
  janelaLogin = new BrowserWindow({ width: 500, height: 720, title: 'Entrar no Spotify', autoHideMenuBar: true });
  janelaLogin.loadURL('https://accounts.spotify.com/pt-BR/login?continue=https%3A%2F%2Fopen.spotify.com%2F');
  const checar = async () => {
    if (!janelaLogin || janelaLogin.isDestroyed()) return;
    try {
      const cks = await janelaLogin.webContents.session.cookies.get({ name: 'sp_dc' });
      const c = cks.find((x) => x.name === 'sp_dc' && x.value);
      if (c) {
        config.spDc = c.value; gravarJSON('config.json', config); spLetras.esquecer();
        enviar({ tipo: 'conexao', conectado: true }); idAtual = null; olhar();
        if (!janelaLogin.isDestroyed()) janelaLogin.close();
      }
    } catch {}
  };
  const timer = setInterval(checar, 1500);
  janelaLogin.on('closed', () => { clearInterval(timer); janelaLogin = null; });
}
function desconectar() { config.spDc = null; gravarJSON('config.json', config); spLetras.esquecer(); idAtual = null; enviar({ tipo: 'conexao', conectado: false }); }

// ---------- pergunta de tempos em tempos o que está tocando (pelo mesmo login web) ----------
// A janela conta o relógio entre as consultas, então não precisa perguntar toda hora.
let pausarAte = 0; // quando leva 429 (rate limit), segura um pouco
async function olhar() {
  if (!config.spDc || Date.now() < pausarAte) return;
  try {
    const j = await spLetras.api('/me/player/currently-playing?additional_types=track');
    if (!j || !j.item) { enviar({ tipo: 'parado' }); idAtual = null; return; }
    const it = j.item;
    const artistas = (it.artists || []).map((a) => a.name).join(', ');
    enviar({ tipo: 'tocando', id: it.id, artista: artistas, faixa: it.name, album: it.album && it.album.name,
      capa: it.album && it.album.images && it.album.images[0] && it.album.images[0].url,
      pos: j.progress_ms || 0, dur: it.duration_ms || 0, tocando: !!j.is_playing });
    if (it.id !== idAtual) {
      idAtual = it.id;
      const principal = (it.artists && it.artists[0] && it.artists[0].name) || artistas;
      enviar({ tipo: 'letra-carregando', id: it.id });
      let letra = null;
      // 1º: a letra do próprio Spotify (sincronia idêntica)
      try {
        // a tradução chega depois: quando ficar pronta, reenvia a letra (se ainda for a faixa atual)
        const sl = await spLetras.obter(it.id, (traduzida) => { if (idAtual === it.id) enviar({ tipo: 'letra', id: it.id, letra: traduzida }); });
        if (sl.achou) letra = sl;
      }
      catch (e) { log('letra Spotify falhou: ' + e.message); if (/venceu|cookie/.test(e.message)) enviar({ tipo: 'conexao', conectado: false }); }
      // 2º: reserva — LRCLIB/NetEase (tem tradução, mas a sincronia às vezes não bate)
      if (!letra) {
        try { letra = await letras.obter({ artista: principal, faixa: it.name, album: it.album && it.album.name, dur: it.duration_ms }); }
        catch (e) { letra = { achou: false, erro: e.message }; }
      }
      enviar({ tipo: 'letra', id: it.id, letra });
    }
  } catch (e) {
    if (/cookie|venceu|HTTP 401/.test(e.message)) enviar({ tipo: 'conexao', conectado: false });
    const m429 = /HTTP 429:(\d+)/.exec(e.message);
    if (m429) { const s = +m429[1] + 2; pausarAte = Date.now() + s * 1000; log('rate limit do Spotify — pausando ' + s + ' s'); }
    enviar({ tipo: 'erro', msg: e.message });
  }
}

function enviar(msg) { if (janela && !janela.isDestroyed()) janela.webContents.send('estado', msg); }

// ---------- a janela ----------
function criarJanela() {
  const j = config.janela || {};
  janela = new BrowserWindow({
    width: j.width || 400, height: j.height || 540, x: j.x, y: j.y,
    minWidth: 220, minHeight: 44,
    frame: false, transparent: true, backgroundColor: '#00000000',
    alwaysOnTop: true, skipTaskbar: false, resizable: true,
    title: 'Letra no Ar',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  janela.setAlwaysOnTop(true, 'screen-saver'); // fica acima até de jogos em janela
  janela.loadFile(path.join(__dirname, 'ui', 'index.html'));
  const guardarGeometria = () => { if (janela.isDestroyed()) return; const b = janela.getBounds(); config.janela = b; if (b.height >= 120) config.full = b; gravarJSON('config.json', config); };
  janela.on('resized', guardarGeometria);
  janela.on('moved', guardarGeometria);
  janela.webContents.on('did-finish-load', () => {
    enviar({ tipo: 'conexao', conectado: !!config.spDc });
    enviar({ tipo: 'deepl', tem: fs.existsSync(path.join(PASTA, 'traducao.json')) });
    enviar({ tipo: 'prefs', prefs: config.prefs || {} });
    olhar();
  });
}

// ---------- ordens vindas da janela ----------
ipcMain.handle('entrar', () => conectar());
ipcMain.handle('sair', () => desconectar());
ipcMain.handle('fechar', () => { if (janela) janela.close(); });
ipcMain.handle('minimizar', () => { if (janela) janela.minimize(); });
ipcMain.handle('fixar', (_e, fixo) => { if (janela) janela.setAlwaysOnTop(!!fixo, 'screen-saver'); return fixo; });
ipcMain.handle('opacidade', (_e, v) => { if (janela) janela.setOpacity(Math.max(0.3, Math.min(1, v))); });
ipcMain.handle('ignorar-clique', (_e, ignora) => { if (janela) janela.setIgnoreMouseEvents(!!ignora, { forward: true }); });
ipcMain.handle('salvar-prefs', (_e, prefs) => { config.prefs = prefs; gravarJSON('config.json', config); });
ipcMain.handle('abrir-spotify', () => shell.openExternal('https://open.spotify.com'));
ipcMain.handle('expandir', () => { if (!janela) return; const f = config.full || { width: 400, height: 540 }; const b = janela.getBounds(); janela.setBounds({ x: b.x, y: b.y, width: f.width, height: f.height }); });
// chave do DeepL: grava traducao.json na pasta de dados (o letras.js lê de lá a cada tradução).
ipcMain.handle('salvar-chave-deepl', (_e, chave) => {
  const arq = path.join(PASTA, 'traducao.json');
  const k = String(chave || '').trim();
  try {
    if (!k) fs.rmSync(arq, { force: true });
    else fs.writeFileSync(arq, JSON.stringify({ deeplKey: k }));
    // limpa o cache de letras pra retraduzir com a fonte nova e rebusca a faixa atual
    try { for (const f of fs.readdirSync(path.join(PASTA, 'spotify-letras'))) fs.rmSync(path.join(PASTA, 'spotify-letras', f), { force: true }); } catch {}
    idAtual = null; enviar({ tipo: 'deepl', tem: !!k }); olhar();
    return true;
  } catch (e) { log('chave DeepL: ' + e.message); return false; }
});

app.whenReady().then(() => {
  criarJanela();
  setInterval(olhar, 2500);
  // escotilha de segurança: liga/desliga o modo "fantasma" (clicar através da janela) mesmo quando a
  // janela não aceita clique nenhum — senão dava pra ela se trancar fora dos botões.
  globalShortcut.register('Control+Alt+L', () => {
    const prefs = config.prefs || {};
    prefs.atravessar = !prefs.atravessar;
    config.prefs = prefs; gravarJSON('config.json', config);
    if (janela) janela.setIgnoreMouseEvents(!!prefs.atravessar, { forward: true });
    enviar({ tipo: 'prefs', prefs });
  });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) criarJanela(); });
});
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
