// Letras para a sessão de álbum: busca a letra sincronizada no LRCLIB (grátis, sem chave), romaniza o
// coreano (Romanização Revisada, regra fixa — feita aqui) e traduz para português (MyMemory, grátis).
// Tudo fica guardado em disco: a mesma música não é buscada nem traduzida duas vezes.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------- romanização do coreano ----------
const INI = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'];
const MED = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i'];
// final como fim de sílaba (antes de consoante ou no fim da palavra)
const FIM = ['', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'k', 'm', 'l', 'l', 'l', 'p', 'l', 'm', 'p', 'p', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 't'];
// final quando a próxima sílaba começa com vogal (ㅇ): a consoante "passa" para a próxima sílaba
const LIGA = [null, ['', 'g'], ['', 'kk'], ['k', 's'], ['', 'n'], ['n', 'j'], ['n', ''], ['', 'd'], ['', 'r'], ['l', 'g'], ['l', 'm'], ['l', 'b'],
  ['l', 's'], ['l', 't'], ['l', 'p'], ['l', ''], ['', 'm'], ['', 'b'], ['p', 's'], ['', 's'], ['', 'ss'], ['ng', ''], ['', 'j'], ['', 'ch'],
  ['', 'k'], ['', 't'], ['', 'p'], ['', '']];
const ehHangul = (c) => c >= 0xac00 && c <= 0xd7a3;

function romanizar(texto) {
  const cs = [...texto];
  const sil = cs.map((ch) => {
    const c = ch.codePointAt(0);
    if (!ehHangul(c)) return null;
    const i = c - 0xac00;
    return { ini: Math.floor(i / 588), med: Math.floor((i % 588) / 28), fim: i % 28 };
  });
  let out = '';
  for (let k = 0; k < cs.length; k++) {
    const s = sil[k];
    if (!s) { out += cs[k]; continue; }
    const prox = sil[k + 1];
    let inicial = INI[s.ini];
    // a consoante final da sílaba anterior pode ter "passado" para esta
    if (s._ini != null) inicial = s._ini;
    let final = FIM[s.fim];
    if (s.fim && prox) {
      if (prox.ini === 11 && prox.med === 20 && (s.fim === 7 || s.fim === 25)) { // ㄷ/ㅌ + 이 → ji/chi (같이 = gachi)
        final = '';
        prox._ini = s.fim === 7 ? 'j' : 'ch';
      } else if (prox.ini === 11 && LIGA[s.fim]) { // seguida de vogal: liga
        final = LIGA[s.fim][0];
        prox._ini = LIGA[s.fim][1];
      } else if (s.fim === 8 && (prox.ini === 5 || prox.ini === 2)) { final = 'l'; prox._ini = 'l'; } // ㄹ+ㄹ/ㄴ → ll
      else if (s.fim === 4 && prox.ini === 5) { final = 'l'; prox._ini = 'l'; }                          // ㄴ+ㄹ → ll
      else if ([1, 2, 24].includes(s.fim) && [2, 6].includes(prox.ini)) final = 'ng';                    // ㄱ+ㄴ/ㅁ → ng
      else if ([7, 19, 20, 22, 23, 25, 27].includes(s.fim) && [2, 6].includes(prox.ini)) final = 'n';   // ㄷ+ㄴ/ㅁ → n
      else if ([17, 26].includes(s.fim) && [2, 6].includes(prox.ini)) final = 'm';                      // ㅂ+ㄴ/ㅁ → m
    }
    out += inicial + MED[s.med] + final;
    // separa sílabas coreanas seguidas por espaço só onde já havia espaço (mantém a palavra junta)
  }
  return out;
}

// ---------- tradução ----------
// DeepL API Free (chave em traducao.json: {"deeplKey": "..."}) — melhor para coreano, 500 mil caracteres/mês grátis.
// Sem chave: MyMemory (grátis, mas com cota diária pequena). Nenhum dos dois é IA de chat; nada gasta tokens.
// Devolve null nas linhas que não deram para traduzir (ex.: cota estourada) — essas NÃO vão para o cache.
const AVISO_COTA = /MYMEMORY WARNING|QUERY LENGTH LIMIT|USED ALL AVAILABLE FREE/i;
let cotaMyMemoryAte = 0; // quando a cota acaba, não insiste por algumas horas

// Chave antiga do plano grátis termina em ":fx" (api-free); a do plano "Developer" de 2026 pode não terminar.
// Então tenta o endereço provável e, se recusar a chave, o outro — e lembra qual funcionou.
let deeplHost = null;
async function deepl(chave, linhas, de, para) {
  const out = new Array(linhas.length).fill(null);
  const hosts = deeplHost ? [deeplHost] : (/:fx$/.test(chave) ? ['api-free.deepl.com', 'api.deepl.com'] : ['api.deepl.com', 'api-free.deepl.com']);
  for (let i = 0; i < linhas.length; i += 50) {
    const lote = linhas.slice(i, i + 50);
    const corpo = new URLSearchParams({ source_lang: de.toUpperCase(), target_lang: para === 'en' ? 'EN-US' : 'PT-BR', preserve_formatting: '1' });
    lote.forEach((l) => corpo.append('text', l));
    let r = null;
    for (const host of hosts) {
      r = await fetch(`https://${host}/v2/translate`, { method: 'POST', headers: { Authorization: `DeepL-Auth-Key ${chave}` }, body: corpo, signal: AbortSignal.timeout(15000) });
      if (r.ok) { deeplHost = host; break; }
      if (r.status !== 403 && r.status !== 401) break; // outro erro (ex.: 456 = créditos acabaram): não adianta trocar
    }
    if (!r.ok) throw new Error(r.status === 456 ? 'créditos do DeepL acabaram' : `DeepL HTTP ${r.status}`);
    const j = await r.json();
    (j.translations || []).forEach((t, k) => { out[i + k] = t.text; });
  }
  return out;
}
async function mymemory(linhas, de, para) {
  const out = new Array(linhas.length).fill(null);
  if (Date.now() < cotaMyMemoryAte) return out;
  let lote = [], tam = 0;
  const lotes = [];
  linhas.forEach((l, i) => {
    if (tam + l.length + 1 > 450 && lote.length) { lotes.push(lote); lote = []; tam = 0; }
    lote.push(i); tam += l.length + 1;
  });
  if (lote.length) lotes.push(lote);
  for (const grupo of lotes) {
    const q = grupo.map((i) => linhas[i]).join('\n');
    try {
      const r = await fetch(`https://api.mymemory.translated.net/get?langpair=${de}|${para === 'en' ? 'en-US' : 'pt-BR'}&q=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(8000) });
      const j = await r.json();
      const texto = String(j?.responseData?.translatedText || '');
      if (AVISO_COTA.test(texto) || j?.quotaFinished) { cotaMyMemoryAte = Date.now() + 6 * 3600 * 1000; return out; }
      const t = texto.split('\n');
      if (t.length === grupo.length) grupo.forEach((i, k) => { out[i] = t[k].trim(); });
      else if (grupo.length === 1) out[grupo[0]] = t.join(' ').trim();
    } catch {}
  }
  return out;
}

// ---------- fontes da letra ----------
function lerLRC(txt) {
  const linhas = [];
  for (const l of String(txt || '').split('\n')) {
    const m = /^\[(\d+):(\d+(?:\.\d+)?)\]\s?(.*)$/.exec(l.trim());
    if (m) linhas.push({ t: Math.round((+m[1] * 60 + +m[2]) * 1000), ko: m[3].trim() });
  }
  return linhas;
}
const temHangul = (s) => /[가-힣]/.test(s || '');
// Coreano já romanizado (letra sem o original): palavras com os "sons" típicos da romanização (eo, eu, ae,
// consoantes dobradas…) que montam sílabas coreanas. Essas linhas NÃO vão para o tradutor: o DeepL achava que
// era inglês e inventava ("Teure bakin chain" virou "cadeia de padarias caras").
const SILABAS_ROM = /^(?:(?:kk|tt|pp|ss|jj|ch|[gkndtrlmbpsjhyw])?(?:yae|yeo|wae|ae|ya|eo|ye|wa|oe|yo|wo|we|wi|yu|eu|ui|a|e|o|u|i)(?:ng|[kntlmp])?)+$/;
const MARCA_ROM = /eo|eu|ae|oe|ui|kk|tt|pp|jj|ss(?!$)/;
const palavraRomanizada = (w) => w.length >= 3 && SILABAS_ROM.test(w) && MARCA_ROM.test(w);
const palavras = (texto) => String(texto || '').toLowerCase().replace(/[’']/g, '').match(/[a-z]+/g) || [];
const linhaRomanizada = (texto) => palavras(texto).some(palavraRomanizada);
// Uma ou outra palavra em inglês também tem esses sons ("people", "neon", "getting"); por isso só trata como
// coreano romanizado a letra que tem isso de verdade: várias palavras diferentes e boa parte do texto.
function letraRomanizada(linhas) {
  const ws = linhas.flatMap((l) => palavras(l.ko));
  const rom = ws.filter(palavraRomanizada);
  return new Set(rom).size >= 4 && rom.length / ws.length >= 0.12;
}
// Sincronia inventada: todos os tempos em segundos redondos (LRC de verdade tem centésimos).
function sincroniaFalsa(linhas) {
  const ts = linhas.map((l) => l.t).filter((t) => typeof t === 'number');
  return ts.length >= 8 && ts.filter((t) => t % 1000 === 0).length / ts.length > 0.9;
}
const normal = (s) => String(s || '').toLowerCase().normalize('NFKC').replace(/\(.*?\)|\[.*?\]/g, '').replace(/[^\p{L}\p{N}]+/gu, '');

async function buscarLRCLIB({ artista, faixa, album, dur }) {
  const ua = { headers: { 'User-Agent': 'QuFlix (sala de amigos)' }, signal: AbortSignal.timeout(8000) };
  const alvo = dur ? dur / 1000 : null;
  // busca todas as versões e escolhe: com coreano > sincronizada > duração mais parecida
  const r = await fetch(`https://lrclib.net/api/search?${new URLSearchParams({ track_name: faixa, artist_name: artista })}`, ua).catch(() => null);
  let lista = r && r.ok ? await r.json().catch(() => []) : [];
  if (!Array.isArray(lista)) lista = [];
  lista = lista.filter((x) => !alvo || Math.abs(x.duration - alvo) <= 8);
  if (!lista.length) {
    const p = new URLSearchParams({ artist_name: artista, track_name: faixa });
    if (album) p.set('album_name', album);
    if (dur) p.set('duration', String(Math.round(alvo)));
    const g = await fetch(`https://lrclib.net/api/get?${p}`, ua).catch(() => null);
    return g && g.ok ? g.json() : null;
  }
  const nota = (x) => (temHangul(x.syncedLyrics || x.plainLyrics) ? 4 : 0) + (x.syncedLyrics ? 2 : 0) - (alvo ? Math.abs(x.duration - alvo) / 10 : 0);
  lista.sort((a, b) => nota(b) - nota(a));
  return lista[0];
}

// NetEase Cloud Music: tem muito K-pop com a letra ORIGINAL em coreano, sincronizada (sem chave).
const CREDITO = /^\s*(作?词|作?曲|編曲|编曲|制作人?|製作人?|監製|监制|混音|录音|錄音|和声|和聲|吉他|贝斯|貝斯|鼓|弦乐|弦樂|母带|母帶|出品|发行|發行|企划|企劃|统筹|統籌|Lyricist|Composer|Arrang(?:e|er)|Produce(?:d|r)|Written(?:\sby)?|Mix(?:ed|ing)?|Master(?:ed|ing)?|Vocal|Background|OP|SP)\s*[:：]/i;
async function buscarNetEase({ artista, faixa, dur }) {
  const ua = { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) };
  const r = await fetch(`https://music.163.com/api/search/get?${new URLSearchParams({ s: `${artista} ${faixa}`, type: '1', limit: '10' })}`, ua).catch(() => null);
  const j = r && r.ok ? await r.json().catch(() => null) : null;
  const musicas = (j && j.result && j.result.songs) || [];
  const alvo = dur ? dur / 1000 : null;
  const certa = musicas.find((m) => normal(m.name) === normal(faixa)
    && (m.artists || []).some((a) => normal(a.name).includes(normal(artista)) || normal(artista).includes(normal(a.name)))
    && (!alvo || Math.abs(m.duration / 1000 - alvo) <= 8));
  if (!certa) return null;
  const l = await fetch(`https://music.163.com/api/song/lyric?id=${certa.id}&lv=1`, ua).catch(() => null);
  const lj = l && l.ok ? await l.json().catch(() => null) : null;
  const lrc = (lj && lj.lrc && lj.lrc.lyric) || '';
  const linhas = lerLRC(lrc).filter((x) => !CREDITO.test(x.ko));
  if (!linhas.length) return null;
  return { linhas, sincronizada: true };
}

module.exports = function criarLetras({ dataDir, log }) {
  const dir = path.join(dataDir, 'letras');
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  // limpa letras que ficaram guardadas com o aviso de cota do MyMemory no lugar da tradução
  try {
    for (const f of fs.readdirSync(dir)) {
      const arq = path.join(dir, f);
      if (AVISO_COTA.test(fs.readFileSync(arq, 'utf8'))) { fs.rmSync(arq, { force: true }); log(`letra com aviso de cota removida do cache: ${f}`); }
    }
  } catch {}
  const chaveDeepl = () => { try { return JSON.parse(fs.readFileSync(path.join(dataDir, 'traducao.json'), 'utf8')).deeplKey || null; } catch { return null; } };
  async function traduzir(linhas, de, para) {
    if (!linhas.length) return [];
    const k = chaveDeepl();
    if (k) { try { return await deepl(k, linhas, de, para); } catch (e) { log(`DeepL falhou (${e.message}); usando o MyMemory`); } }
    return mymemory(linhas, de, para);
  }
  const emAndamento = new Map();

  async function obter(q) {
    const chave = crypto.createHash('sha1').update(`${q.artista}|${q.faixa}|${q.album}`.toLowerCase()).digest('hex').slice(0, 20);
    const arq = path.join(dir, chave + '.json');
    try {
      const c = JSON.parse(fs.readFileSync(arq, 'utf8'));
      // versão 2 sem coreano (só romanizada) pode ter tradução inventada: refaz com as regras novas
      // versão 3 marcava linha em inglês como romanizada ("people"): refaz as letras sem coreano que tinham isso
      const semKo = !c.linhas.some((l) => temHangul(l.ko));
      if (c.versao === 4 || (c.versao === 3 && !(semKo && c.linhas.some((l) => l.romanizada)))
        || (c.versao === 2 && !(c.fonte === 'LRCLIB' && semKo))) return c;
    } catch {}
    if (emAndamento.has(chave)) return emAndamento.get(chave);
    const p = (async () => {
      // as duas fontes ao mesmo tempo; fica com a que tem o coreano original
      const [lr, ne] = await Promise.all([buscarLRCLIB(q).catch(() => null), buscarNetEase(q).catch(() => null)]);
      let linhas = [], sincronizada = false, fonte = null;
      const lrLinhas = lr && lr.syncedLyrics ? lerLRC(lr.syncedLyrics) : lr && lr.plainLyrics ? lr.plainLyrics.split('\n').map((ko) => ({ t: null, ko: ko.trim() })) : [];
      const neTemKo = !!ne && ne.linhas.some((x) => temHangul(x.ko));
      const lrTemKo = lrLinhas.some((x) => temHangul(x.ko));
      if (neTemKo && !(lrTemKo && lr.syncedLyrics)) { linhas = ne.linhas; sincronizada = true; fonte = 'NetEase'; }
      else if (lrLinhas.length) { linhas = lrLinhas; sincronizada = !!lr.syncedLyrics; fonte = 'LRCLIB'; }
      else if (ne) { linhas = ne.linhas; sincronizada = true; fonte = 'NetEase'; }
      const instrumental = !!(lr && lr.instrumental) && !linhas.length;
      if (sincronizada && fonte === 'LRCLIB' && sincroniaFalsa(linhas)) { sincronizada = false; for (const l of linhas) l.t = null; }

      // cada linha: original (ko), romanizado (rom), inglês (en), português (pt)
      for (const l of linhas) l.rom = temHangul(l.ko) ? romanizar(l.ko) : null;
      const idxKo = linhas.map((l, i) => (temHangul(l.ko) ? i : -1)).filter((i) => i >= 0);
      // coreano que já veio romanizado: só em letra com cara de coreano (tem hangul ou o texto todo é romanizado)
      const podeRomanizada = idxKo.length > 0 || letraRomanizada(linhas);
      if (podeRomanizada) for (const l of linhas) if (!temHangul(l.ko) && linhaRomanizada(l.ko)) l.romanizada = true; // mostrada como romanização, sem tradução
      const idxOutra = linhas.map((l, i) => (!temHangul(l.ko) && !l.romanizada && /[a-z]/i.test(l.ko) ? i : -1)).filter((i) => i >= 0);
      const [koEn, koPt, outraPt] = await Promise.all([
        traduzir(idxKo.map((i) => linhas[i].ko), 'ko', 'en'),
        traduzir(idxKo.map((i) => linhas[i].ko), 'ko', 'pt'),
        traduzir(idxOutra.map((i) => linhas[i].ko), 'en', 'pt'),
      ]);
      idxKo.forEach((i, k) => { linhas[i].en = koEn[k]; linhas[i].pt = koPt[k]; });
      idxOutra.forEach((i, k) => {
        const t = outraPt[k];
        // se a "tradução" voltou igual, a linha não era inglês (ex.: coreano romanizado) — não mostra tradução falsa
        linhas[i].pt = t && normal(t) !== normal(linhas[i].ko) ? t : null;
      });
      const faltou = idxKo.some((i) => linhas[i].en == null || linhas[i].pt == null) || idxOutra.some((i, k) => outraPt[k] == null);
      const soRomanizada = !idxKo.length && podeRomanizada && linhas.filter((l) => l.romanizada || (l.pt == null && /[a-z]/i.test(l.ko))).length > linhas.length / 4;
      const res = { versao: 4, achou: !!linhas.length, sincronizada, instrumental, linhas, fonte, soRomanizada, traducao: chaveDeepl() ? 'DeepL' : 'MyMemory', traducaoIncompleta: faltou };
      // guarda só o que veio completo; com tradução faltando (cota), tenta de novo numa próxima vez
      if (linhas.length && !faltou) { try { fs.writeFileSync(arq, JSON.stringify(res)); } catch {} }
      log(`letra: ${q.artista} — ${q.faixa}: ${linhas.length ? `${linhas.length} linhas (${fonte}${idxKo.length ? ', com coreano' : ''})${faltou ? ', tradução incompleta' : ''}` : 'não encontrada'}`);
      return res;
    })().finally(() => emAndamento.delete(chave));
    emAndamento.set(chave, p);
    return p;
  }
  return { obter, romanizar, traduzir };
};
