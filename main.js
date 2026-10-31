// Letra no Ar — processo principal do Electron.
// Janelinha sem bordas, sempre em primeiro plano, que:
//   1) conecta no Spotify uma vez (login sem senha guardada, PKCE);
//   2) pergunta de segundo em segundo o que está tocando (música, artista e a posição exata da faixa);
//   3) busca a letra sincronizada (reaproveitando o letras.js do QuFlix: LRCLIB + NetEase + romanização
//      do coreano + tradução), e manda tudo para a janela, que rola a letra no tempo certo.
// Não guarda senha nenhuma: só o token do Spotify (que a própria pessoa autorizou) fica em disco.
const { app, BrowserWindow, ipcMain, shell, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const criarLetras = require('./letras.js');
const criarSpotifyLetras = require('./spotify-letras.js');

// App "QuFlix" da conta do Spotify dela; o redirect de loopback já está registrado nesse app.
// Dá pra trocar por outro Client ID criando um config.json na pasta de dados: {"clientId": "..."}.
const CLIENT_ID_PADRAO = '5e9de6d58a4349c497ba3319e4cfa434';
const REDIRECT = 'http://127.0.0.1:3040/spotify';
const PORTA_LOGIN = 3040;
const ESCOPO = 'user-read-currently-playing user-read-playback-state';

const PASTA = app.getPath('userData');
const log = (m) => console.log(new Date().toISOString(), m);
const letras = criarLetras({ dataDir: PASTA, log });
const spLetras = criarSpotifyLetras({ getSpDc: () => config.spDc, romanizar: letras.romanizar, traduzir: letras.traduzir, dataDir: PASTA, log });

let janela = null;
let token = lerJSON('spotify.json', null);     // { access, refresh, exp, scope }
const config = lerJSON('config.json', {});     // { clientId?, traduzir?, janela?, prefs? }
let idAtual = null;                            // id da faixa que está tocando (pra não rebuscar a letra à toa)

function lerJSON(nome, padrao) {
  try { return JSON.parse(fs.readFileSync(path.join(PASTA, nome), 'utf8')); } catch { return padrao; }
}
function gravarJSON(nome, valor) {
  try { fs.writeFileSync(path.join(PASTA, nome), JSON.stringify(valor)); } catch (e) { log('não gravou ' + nome + ': ' + e.message); }
}
const clientId = () => config.clientId || CLIENT_ID_PADRAO;
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// ---------- login do Spotify (PKCE, sem senha guardada) ----------
let servidorLogin = null;
function entrar() {
  if (servidorLogin) return; // já tem um login em andamento
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  servidorLogin = http.createServer(async (req, res) => {
    const u = new URL(req.url, REDIRECT);
    if (u.pathname !== '/spotify') { res.writeHead(404); return res.end(); }
    const fim = (texto) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(`<!doctype html><meta charset="utf-8"><body style="font-family:system-ui,sans-serif;background:#12101a;color:#eee;text-align:center;padding-top:80px"><h2>${texto}</h2><p>Pode fechar esta aba e voltar pro app.</p></body>`); };
    try {
      await trocarToken({ grant_type: 'authorization_code', code: u.searchParams.get('code'), redirect_uri: REDIRECT, code_verifier: verifier });
      fim('✅ Spotify conectado!');
      enviar({ tipo: 'conexao', conectado: true });
    } catch (e) { fim('❌ Deu erro: ' + e.message); }
    servidorLogin.close(); servidorLogin = null;
  });
  servidorLogin.on('error', (e) => { log('servidor de login: ' + e.message); enviar({ tipo: 'erro', msg: 'Não consegui abrir a porta do login (' + e.message + ').' }); servidorLogin = null; });
  servidorLogin.listen(PORTA_LOGIN, '127.0.0.1', () => {
    const p = new URLSearchParams({ client_id: clientId(), response_type: 'code', redirect_uri: REDIRECT, code_challenge_method: 'S256', code_challenge: challenge, scope: ESCOPO });
    shell.openExternal('https://accounts.spotify.com/authorize?' + p);
  });
}
function sair() { token = null; try { fs.rmSync(path.join(PASTA, 'spotify.json'), { force: true }); } catch {} idAtual = null; enviar({ tipo: 'conexao', conectado: false }); }

// ---------- login das LETRAS (cookie sp_dc do Spotify web) ----------
// Abre o Spotify web numa janelinha; quando o cookie sp_dc aparecer (logou), guarda e fecha.
let janelaLogin = null;
function conectarLetras() {
  if (janelaLogin && !janelaLogin.isDestroyed()) { janelaLogin.focus(); return; }
  janelaLogin = new BrowserWindow({ width: 500, height: 720, title: 'Entrar no Spotify (para as letras)', autoHideMenuBar: true });
  janelaLogin.loadURL('https://accounts.spotify.com/pt-BR/login?continue=https%3A%2F%2Fopen.spotify.com%2F');
  const checar = async () => {
    if (!janelaLogin || janelaLogin.isDestroyed()) return;
    try {
      const cks = await janelaLogin.webContents.session.cookies.get({ name: 'sp_dc' });
      const c = cks.find((x) => x.name === 'sp_dc' && x.value);
      if (c) {
        config.spDc = c.value; gravarJSON('config.json', config); spLetras.esquecer();
        enviar({ tipo: 'letras-conectado', ok: true }); idAtual = null; olhar();
        if (!janelaLogin.isDestroyed()) janelaLogin.close();
      }
    } catch {}
  };
  const timer = setInterval(checar, 1500);
  janelaLogin.on('closed', () => { clearInterval(timer); janelaLogin = null; });
}
function desconectarLetras() { config.spDc = null; gravarJSON('config.json', config); spLetras.esquecer(); idAtual = null; enviar({ tipo: 'letras-conectado', ok: false }); }

async function trocarToken(params) {
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId(), ...params }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error_description || j.error || 'falha no login');
  token = { access: j.access_token, refresh: j.refresh_token || token?.refresh, exp: Date.now() + j.expires_in * 1000, scope: j.scope || token?.scope || '' };
  gravarJSON('spotify.json', token);
}

async function spotify(caminho) {
  if (!token) throw new Error('não conectado');
  if (Date.now() > token.exp - 60000) await trocarToken({ grant_type: 'refresh_token', refresh_token: token.refresh });
  const r = await fetch('https://api.spotify.com/v1' + caminho, { headers: { Authorization: 'Bearer ' + token.access } });
  if (r.status === 204) return null;       // não tem nada tocando agora
  if (r.status === 401) { token = null; throw new Error('a conexão com o Spotify expirou — entre de novo'); }
  if (!r.ok) throw new Error('Spotify HTTP ' + r.status);
  return r.json();
}

// ---------- pergunta a cada segundo o que está tocando ----------
async function olhar() {
  if (!token) return;
  try {
    const j = await spotify('/me/player/currently-playing?additional_types=track');
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
      // 1º: a letra do próprio Spotify (sincronia idêntica), se o login das letras foi feito
      if (config.spDc) {
        try {
          // a tradução chega depois: quando ficar pronta, reenvia a letra (se ainda for a faixa atual)
          const sl = await spLetras.obter(it.id, (traduzida) => { if (idAtual === it.id) enviar({ tipo: 'letra', id: it.id, letra: traduzida }); });
          if (sl.achou) letra = sl;
        }
        catch (e) { log('letra Spotify falhou: ' + e.message); if (/venceu|login das letras/.test(e.message)) enviar({ tipo: 'letras-conectado', ok: false }); }
      }
      // 2º: reserva — LRCLIB/NetEase (tem tradução, mas a sincronia às vezes não bate)
      if (!letra) {
        try { letra = await letras.obter({ artista: principal, faixa: it.name, album: it.album && it.album.name, dur: it.duration_ms }); }
        catch (e) { letra = { achou: false, erro: e.message }; }
      }
      enviar({ tipo: 'letra', id: it.id, letra });
    }
  } catch (e) {
    if (/não conectado|expirou/.test(e.message)) enviar({ tipo: 'conexao', conectado: false });
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
    enviar({ tipo: 'conexao', conectado: !!token });
    enviar({ tipo: 'letras-conectado', ok: !!config.spDc });
    enviar({ tipo: 'prefs', prefs: config.prefs || {} });
    olhar();
  });
}

// ---------- ordens vindas da janela ----------
ipcMain.handle('entrar', () => entrar());
ipcMain.handle('sair', () => sair());
ipcMain.handle('conectar-letras', () => conectarLetras());
ipcMain.handle('desconectar-letras', () => desconectarLetras());
ipcMain.handle('fechar', () => { if (janela) janela.close(); });
ipcMain.handle('minimizar', () => { if (janela) janela.minimize(); });
ipcMain.handle('fixar', (_e, fixo) => { if (janela) janela.setAlwaysOnTop(!!fixo, 'screen-saver'); return fixo; });
ipcMain.handle('opacidade', (_e, v) => { if (janela) janela.setOpacity(Math.max(0.3, Math.min(1, v))); });
ipcMain.handle('ignorar-clique', (_e, ignora) => { if (janela) janela.setIgnoreMouseEvents(!!ignora, { forward: true }); });
ipcMain.handle('salvar-prefs', (_e, prefs) => { config.prefs = prefs; gravarJSON('config.json', config); });
ipcMain.handle('abrir-spotify', () => shell.openExternal('https://open.spotify.com'));
ipcMain.handle('expandir', () => { if (!janela) return; const f = config.full || { width: 400, height: 540 }; const b = janela.getBounds(); janela.setBounds({ x: b.x, y: b.y, width: f.width, height: f.height }); });

app.whenReady().then(() => {
  criarJanela();
  setInterval(olhar, 1000);
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
