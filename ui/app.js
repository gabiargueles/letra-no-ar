// A janela: recebe o 'estado' do processo principal e desenha a letra, rolando no tempo da música.
// Fora do Electron (ex.: abrindo no navegador pra testar o visual) o window.app não existe: um
// substituto bobo deixa a página rodar, e window.__teste(msg) permite simular estados.
if (!window.app) {
  const nada = () => {};
  window.app = { entrar: nada, sair: nada, fechar: nada, minimizar: nada, fixar: nada, opacidade: nada, ignorarClique: nada, salvarPrefs: nada, abrirSpotify: nada, aoAtualizar: (cb) => { window.__teste = cb; } };
}
const $ = (id) => document.getElementById(id);
const el = {
  capa: $('capa'), faixa: $('faixa'), artista: $('artista'), letra: $('letra'), aviso: $('aviso'),
  preenche: $('preenche'), fonte: $('fonte'), opcoes: $('opcoes'),
  btnConfig: $('btnConfig'), btnFixar: $('btnFixar'), btnMin: $('btnMin'), btnFechar: $('btnFechar'), btnFecharOpcoes: $('btnFecharOpcoes'),
  btnEntrar: $('btnEntrar'), btnSair: $('btnSair'),
  btnLetras: $('btnLetras'), btnLetrasSair: $('btnLetrasSair'),
  btnTraducao: $('btnTraducao'), bTraducao: $('bTraducao'),
  optRom: $('optRom'), optPt: $('optPt'), optAtravessar: $('optAtravessar'), optOpacidade: $('optOpacidade'),
  chaveDeepl: $('chaveDeepl'), btnSalvarChave: $('btnSalvarChave'), statusChave: $('statusChave'),
  clientId: $('clientId'), btnSalvarClient: $('btnSalvarClient'), statusClient: $('statusClient'),
  abrirDevSpotify: $('abrirDevSpotify'), abrirDeepl: $('abrirDeepl'),
  bCapa: $('bCapa'), bFaixa: $('bFaixa'), bLinha: $('bLinha'), bTempo: $('bTempo'), bConfig: $('bConfig'), bFechar: $('bFechar'),
};
const fmt = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let prefs = { rom: true, pt: true, atravessar: false, opacidade: 100, fixar: true, offset: 0 };
const S = {
  conectado: false,
  letra: null,          // { achou, sincronizada, instrumental, linhas:[{t,ko,rom,en,pt,romanizada}], fonte, soRomanizada }
  idLetra: null,        // id da faixa cuja letra está na tela
  base: null,           // { pos, em, tocando } — pra calcular a posição atual entre uma pergunta e outra
  dur: 0,
  nodes: [],            // os divs de cada linha (pra marcar a ativa)
  ativa: -1,
};

// quanto tempo de música já passou, calculado a partir da última resposta do Spotify
function posicaoAgora() {
  if (!S.base) return 0;
  if (!S.base.tocando) return S.base.pos;
  return S.base.pos + (Date.now() - S.base.em);
}

function mostrarAviso(texto, barra) {
  el.letra.classList.remove('sem-sync');
  el.letra.innerHTML = `<div class="aviso">${texto}</div>`;
  S.nodes = []; S.ativa = -1;
  // o mesmo aviso também aparece no modo barra (senão ficava a linha da música anterior)
  const b = barra != null ? barra : texto.replace(/<[^>]+>/g, ' ');
  el.bLinha.innerHTML = `<span class="b-base">${esc(b)}</span>`;
}

// desenha todas as linhas da letra atual
function desenharLetra() {
  const L = S.letra;
  if (!L) return;
  if (L.erro) return mostrarAviso('Não deu pra buscar a letra:<br>' + L.erro, 'não deu pra buscar a letra');
  if (L.instrumental) return mostrarAviso('🎵 Faixa instrumental', '🎵 instrumental');
  if (!L.achou || !L.linhas || !L.linhas.length) return mostrarAviso('Letra não encontrada 🙁', 'não tem letra 🙁');

  el.letra.classList.toggle('sem-sync', !L.sincronizada);
  el.letra.innerHTML = '';
  S.nodes = L.linhas.map((l) => {
    const div = document.createElement('div');
    div.className = 'ln';
    const orig = document.createElement('div');
    orig.className = 'orig' + (l.romanizada ? ' rom-only' : '');
    orig.textContent = l.ko || ' ';
    div.appendChild(orig);
    // romanização do coreano (linha de baixo, menor)
    if (prefs.rom && l.rom && !l.romanizada) {
      const r = document.createElement('div'); r.className = 'sub'; r.textContent = l.rom; div.appendChild(r);
    }
    // tradução em português
    if (prefs.pt && l.pt && !l.romanizada) {
      const p = document.createElement('div'); p.className = 'sub'; p.textContent = l.pt; div.appendChild(p);
    }
    el.letra.appendChild(div);
    return div;
  });
  S.ativa = -1;
  el.fonte.textContent = L.fonte ? (L.sincronizada ? '' : 'sem sincronia · ') + 'letra: ' + L.fonte : '';
  // na barra, letra sem sincronia não tem como rolar; avisa
  if (!L.sincronizada) el.bLinha.innerHTML = '<span class="b-base">♪ letra sem sincronia</span>';
}

// marca a linha da vez e centraliza
function rolar() {
  const pos = posicaoAgora();
  if (S.dur > 0) el.preenche.style.width = Math.min(100, (pos / S.dur) * 100) + '%';
  el.bTempo.textContent = fmt(pos) + (S.dur ? ' / ' + fmt(S.dur) : '');
  const L = S.letra;
  if (!L || !L.sincronizada || !S.nodes.length) return;
  // o ajuste fino entra só aqui (na escolha da linha), não na barra de progresso:
  // offset positivo = adianta a letra (mostra as linhas mais cedo).
  const cur = pos + (prefs.offset || 0);
  let i = -1;
  for (let k = 0; k < L.linhas.length; k++) { if (L.linhas[k].t != null && L.linhas[k].t <= cur) i = k; else if (L.linhas[k].t != null) break; }
  if (i === S.ativa) return;
  if (S.nodes[S.ativa]) S.nodes[S.ativa].classList.remove('ativa');
  S.ativa = i;
  if (S.nodes[i]) { S.nodes[i].classList.add('ativa'); S.nodes[i].scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  // no modo barra, a linha da vez. Com a tradução ligada → romanização (ou original) + tradução juntas.
  const lin = i >= 0 ? L.linhas[i] : null;
  if (!lin) { el.bLinha.innerHTML = '<span class="b-base">♪</span>'; }
  else {
    const base = lin.rom || lin.ko || '♪';
    // letra em cima; com a tradução ligada, o português embaixo (menor)
    el.bLinha.innerHTML = `<span class="b-base">${esc(base)}</span>` + (prefs.pt && lin.pt ? `<span class="b-pt">${esc(lin.pt)}</span>` : '');
  }
}
setInterval(rolar, 250);

// modo barra: quando a janela fica baixinha, vira a faixa horizontal
function verModo() { document.body.classList.toggle('compacto', window.innerHeight < 120); }
window.addEventListener('resize', verModo);
verModo();

// ---------- estado vindo do principal ----------
window.app.aoAtualizar((m) => {
  if (m.tipo === 'conexao') {
    S.conectado = m.conectado;
    el.btnEntrar.classList.toggle('escondido', m.conectado);
    el.btnSair.classList.toggle('escondido', !m.conectado);
    if (!m.conectado) { el.capa.src = 'icon.png'; el.bCapa.src = 'icon.png'; el.faixa.textContent = 'Letra no Ar'; el.bFaixa.textContent = 'Letra no Ar'; el.artista.textContent = 'conecte o Spotify pra começar'; mostrarAviso('Conecte o Spotify nas opções (⚙️).', 'conecte o Spotify'); el.preenche.style.width = '0'; }
    else if (!S.letra) mostrarAviso('Conectado! Dá play numa música no Spotify.', 'dá play no Spotify');
  } else if (m.tipo === 'tocando') {
    el.faixa.textContent = m.faixa;
    el.artista.textContent = m.artista;
    el.bFaixa.textContent = m.faixa;
    if (m.capa) { el.capa.src = m.capa; el.bCapa.src = m.capa; } else { el.capa.src = 'icon.png'; el.bCapa.src = 'icon.png'; }
    S.base = { pos: m.pos, em: Date.now(), tocando: m.tocando };
    S.dur = m.dur;
  } else if (m.tipo === 'parado') {
    el.faixa.textContent = 'Nada tocando'; el.artista.textContent = 'dá play no Spotify';
    el.capa.src = 'icon.png'; el.bCapa.src = 'icon.png'; el.preenche.style.width = '0';
    el.bFaixa.textContent = 'Nada tocando';
    S.base = null; S.letra = null; S.idLetra = null; mostrarAviso('Nada tocando agora. Dá play numa música no Spotify.', 'nada tocando');
  } else if (m.tipo === 'letra-carregando') {
    if (m.id !== S.idLetra) { S.letra = null; mostrarAviso('Buscando a letra…', 'buscando a letra…'); }
  } else if (m.tipo === 'letra') {
    S.letra = m.letra; S.idLetra = m.id; S.ativa = -1; desenharLetra();
  } else if (m.tipo === 'letras-conectado') {
    el.btnLetras.classList.toggle('escondido', m.ok);
    el.btnLetrasSair.classList.toggle('escondido', !m.ok);
  } else if (m.tipo === 'client-id') {
    el.statusClient.textContent = m.id ? '✅ Client ID salvo. Agora clique em Conectar o Spotify.' : 'Sem Client ID você usa o app padrão (limite de 5 pessoas). Pro seu, veja o tutorial abaixo.';
    el.clientId.value = m.id || '';
  } else if (m.tipo === 'deepl') {
    el.statusChave.textContent = m.tem ? '✅ Chave DeepL salva — tradução pelo DeepL.' : 'Sem chave: uso o MyMemory (grátis, cota pequena). A chave fica só aqui no seu PC.';
    if (m.tem) el.chaveDeepl.value = '';
    el.chaveDeepl.placeholder = m.tem ? 'Chave DeepL salva (cole outra pra trocar)' : 'Chave DeepL (tradução melhor)';
  } else if (m.tipo === 'prefs') {
    prefs = Object.assign(prefs, m.prefs || {});
    aplicarPrefs();
  }
  // 'erro' é silencioso na tela (não poluir); fica no console
});

function aplicarPrefs() {
  el.optRom.checked = prefs.rom;
  el.optPt.checked = prefs.pt;
  el.optAtravessar.checked = prefs.atravessar;
  el.optOpacidade.value = prefs.opacidade;
  el.btnFixar.classList.toggle('ativo', prefs.fixar);
  el.btnTraducao.classList.toggle('ativo', prefs.pt);
  el.bTraducao.classList.toggle('ativo', prefs.pt);
  window.app.opacidade(prefs.opacidade / 100);
  window.app.fixar(prefs.fixar);
  window.app.ignorarClique(prefs.atravessar);
}
function salvar() { window.app.salvarPrefs(prefs); }

// ---------- botões ----------
el.btnConfig.onclick = () => el.opcoes.classList.toggle('escondido');
el.btnFecharOpcoes.onclick = () => el.opcoes.classList.add('escondido');
el.btnFechar.onclick = () => window.app.fechar();
el.btnMin.onclick = () => window.app.minimizar();
el.btnFixar.onclick = () => { prefs.fixar = !prefs.fixar; el.btnFixar.classList.toggle('ativo', prefs.fixar); window.app.fixar(prefs.fixar); salvar(); };
el.btnEntrar.onclick = () => window.app.entrar();
el.btnSair.onclick = () => window.app.sair();
el.btnLetras.onclick = () => window.app.conectarLetras();
el.btnLetrasSair.onclick = () => window.app.desconectarLetras();
el.optRom.onchange = () => { prefs.rom = el.optRom.checked; desenharLetra(); salvar(); };
function aplicarTraducao() { el.optPt.checked = prefs.pt; el.btnTraducao.classList.toggle('ativo', prefs.pt); el.bTraducao.classList.toggle('ativo', prefs.pt); desenharLetra(); }
function alternarTraducao() { prefs.pt = !prefs.pt; aplicarTraducao(); salvar(); }
el.optPt.onchange = () => { prefs.pt = el.optPt.checked; aplicarTraducao(); salvar(); };
el.btnTraducao.onclick = alternarTraducao;
el.bTraducao.onclick = alternarTraducao;
el.optAtravessar.onchange = () => { prefs.atravessar = el.optAtravessar.checked; window.app.ignorarClique(prefs.atravessar); salvar(); };
el.optOpacidade.oninput = () => { prefs.opacidade = +el.optOpacidade.value; window.app.opacidade(prefs.opacidade / 100); };
el.optOpacidade.onchange = salvar;
// botões do modo barra: ⚙️ aumenta a janela e abre as opções; ✕ fecha
el.btnSalvarClient.onclick = () => { el.statusClient.textContent = 'Salvando…'; window.app.salvarClientId(el.clientId.value.trim()); };
el.clientId.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.btnSalvarClient.click(); });
el.abrirDevSpotify.onclick = () => window.app.abrirLink('https://developer.spotify.com/dashboard');
el.abrirDeepl.onclick = () => window.app.abrirLink('https://www.deepl.com/pro-api');
el.btnSalvarChave.onclick = () => { el.statusChave.textContent = 'Salvando…'; window.app.salvarChaveDeepl(el.chaveDeepl.value.trim()); };
el.chaveDeepl.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.btnSalvarChave.click(); });
el.bConfig.onclick = () => { window.app.expandir(); el.opcoes.classList.remove('escondido'); };
el.bFechar.onclick = () => window.app.fechar();
