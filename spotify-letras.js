// Letra DIRETO do Spotify — o mesmo endpoint interno que o app do Spotify usa (letra do Musixmatch,
// com os tempos exatos). É NÃO-OFICIAL: precisa do cookie sp_dc da conta logada e, de vez em quando, o
// Spotify muda a proteção (TOTP) e isso quebra — aí é só atualizar. Fonte do método (mantido em dia):
// https://github.com/akashrchandran/spotify-lyrics-api  (o segredo versionado vem do spot-secrets-go).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const URL_TOKEN = 'https://open.spotify.com/api/token';
const URL_HORA = 'https://open.spotify.com/api/server-time';
const URL_LETRA = 'https://spclient.wg.spotify.com/color-lyrics/v2/track/';
const URL_SEGREDO = 'https://raw.githubusercontent.com/xyloflake/spot-secrets-go/main/secrets/secretDict.json';

// o segredo do TOTP vem de uma lista versionada; cada número é "desembaralhado" e os números viram
// uma string (os dígitos concatenados), que é a chave do HMAC.
async function pegarSegredo() {
  const r = await fetch(URL_SEGREDO, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('não baixei o segredo do TOTP (HTTP ' + r.status + ')');
  const dict = await r.json();
  const versoes = Object.keys(dict);
  const versao = versoes[versoes.length - 1];
  const segredo = dict[versao].map((c, i) => c ^ ((i % 33) + 9)).join('');
  return { segredo, versao };
}

function gerarTotp(segredo, horaSegundos) {
  const contador = Math.floor(horaSegundos / 30);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(contador));
  const h = crypto.createHmac('sha1', segredo).update(buf).digest();
  const off = h[h.length - 1] & 0x0f;
  const bin = ((h[off] & 0x7f) << 24) | ((h[off + 1] & 0xff) << 16) | ((h[off + 2] & 0xff) << 8) | (h[off + 3] & 0xff);
  return String(bin % 1000000).padStart(6, '0');
}

module.exports = function criarSpotifyLetras({ getSpDc, romanizar, traduzir, dataDir, dictPath, log }) {
  let token = null; // { access, exp }

  // kuroshiro: romaniza japonês de verdade (inclusive kanji), offline, usando o dicionário do kuromoji.
  // Carrega o dicionário na 1ª música japonesa (demora ~1-2 s), depois fica pronto em memória.
  let kuro = null, kuroInit = null;
  function garantirKuro() {
    if (kuro) return Promise.resolve(kuro);
    if (!kuroInit && dictPath) {
      kuroInit = (async () => {
        const K = require('kuroshiro').default || require('kuroshiro');
        const A = require('kuroshiro-analyzer-kuromoji').default || require('kuroshiro-analyzer-kuromoji');
        const k = new K();
        await k.init(new A({ dictPath }));
        kuro = k; log('kuroshiro pronto (romaji de japonês com kanji)'); return k;
      })().catch((e) => { log('kuroshiro falhou: ' + e.message); kuroInit = null; throw e; });
    }
    return kuroInit || Promise.reject(new Error('sem dicionário'));
  }
  async function romajiJa(texto) {
    try { const k = await garantirKuro(); const r = await k.convert(texto, { to: 'romaji', mode: 'spaced', romajiSystem: 'hepburn' }); return r.replace(/\s+/g, ' ').trim(); }
    catch { return romaji(texto); } // sem dicionário: cai no kana (kanji fica no original)
  }
  const dirCache = path.join(dataDir, 'spotify-letras');
  try { fs.mkdirSync(dirCache, { recursive: true }); } catch {}
  const normal = (s) => String(s || '').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, '');

  // ---------- japonês ----------
  const temKana = (s) => /[぀-ヿ]/.test(s || '');       // hiragana ou katakana
  const temKanji = (s) => /[㐀-鿿]/.test(s || '');       // ideogramas (kanji)
  // romaji só a partir do kana (hiragana/katakana); kanji precisaria de dicionário, então linha com kanji
  // fica sem romanização (a tradução, essa sim, cobre tudo).
  const KANA = { 'あ': 'a', 'い': 'i', 'う': 'u', 'え': 'e', 'お': 'o', 'か': 'ka', 'き': 'ki', 'く': 'ku', 'け': 'ke', 'こ': 'ko', 'が': 'ga', 'ぎ': 'gi', 'ぐ': 'gu', 'げ': 'ge', 'ご': 'go', 'さ': 'sa', 'し': 'shi', 'す': 'su', 'せ': 'se', 'そ': 'so', 'ざ': 'za', 'じ': 'ji', 'ず': 'zu', 'ぜ': 'ze', 'ぞ': 'zo', 'た': 'ta', 'ち': 'chi', 'つ': 'tsu', 'て': 'te', 'と': 'to', 'だ': 'da', 'ぢ': 'ji', 'づ': 'zu', 'で': 'de', 'ど': 'do', 'な': 'na', 'に': 'ni', 'ぬ': 'nu', 'ね': 'ne', 'の': 'no', 'は': 'ha', 'ひ': 'hi', 'ふ': 'fu', 'へ': 'he', 'ほ': 'ho', 'ば': 'ba', 'び': 'bi', 'ぶ': 'bu', 'べ': 'be', 'ぼ': 'bo', 'ぱ': 'pa', 'ぴ': 'pi', 'ぷ': 'pu', 'ぺ': 'pe', 'ぽ': 'po', 'ま': 'ma', 'み': 'mi', 'む': 'mu', 'め': 'me', 'も': 'mo', 'や': 'ya', 'ゆ': 'yu', 'よ': 'yo', 'ら': 'ra', 'り': 'ri', 'る': 'ru', 'れ': 're', 'ろ': 'ro', 'わ': 'wa', 'ゐ': 'i', 'ゑ': 'e', 'を': 'o', 'ん': 'n', 'ぁ': 'a', 'ぃ': 'i', 'ぅ': 'u', 'ぇ': 'e', 'ぉ': 'o', 'ゔ': 'vu' };
  const YOUON = { 'ゃ': 'ya', 'ゅ': 'yu', 'ょ': 'yo' };
  function romaji(texto) {
    // katakana → hiragana (mesmo som), aí usa a mesma tabela
    const arr = [...texto].map((ch) => { const c = ch.codePointAt(0); return (c >= 0x30a1 && c <= 0x30f6) ? String.fromCodePoint(c - 0x60) : ch; });
    let out = ''; let dobra = false;
    for (let i = 0; i < arr.length; i++) {
      const ch = arr[i], nx = arr[i + 1];
      if (ch === 'っ') { dobra = true; continue; }              // tsu pequeno: dobra a próxima consoante
      if (ch === 'ー' || ch === '〜') { out += (out.slice(-1) || ''); continue; } // alonga a vogal anterior
      let r = KANA[ch];
      if (r === undefined) { out += ch; continue; }             // kanji ou outro caractere: mantém
      if (nx && YOUON[nx]) {                                     // きゃ = kya, しゃ = sha…
        const y = YOUON[nx];
        if (r.endsWith('i')) r = (r === 'shi' ? 'sh' : r === 'chi' ? 'ch' : r === 'ji' ? 'j' : r.slice(0, -1)) + (r === 'shi' || r === 'chi' || r === 'ji' ? y.slice(1) : y);
        i++;
      }
      if (dobra) { r = (r[0] || '') + r; dobra = false; }
      out += r;
    }
    return out;
  }

  async function renovarToken() {
    const spDc = getSpDc();
    if (!spDc) throw new Error('sem cookie do Spotify (faça o login das letras)');
    const { segredo, versao } = await pegarSegredo();
    const rh = await fetch(URL_HORA, { headers: { 'User-Agent': UA, Cookie: 'sp_dc=' + spDc }, signal: AbortSignal.timeout(8000) });
    const horaSeg = (await rh.json()).serverTime || Math.floor(Date.now() / 1000);
    const p = new URLSearchParams({ reason: 'transport', productType: 'web-player', totp: gerarTotp(segredo, horaSeg), totpVer: versao, ts: String(Math.floor(Date.now() / 1000)) });
    const r = await fetch(URL_TOKEN + '?' + p, { headers: { 'User-Agent': UA, Cookie: 'sp_dc=' + spDc }, signal: AbortSignal.timeout(8000) });
    const j = await r.json().catch(() => ({}));
    if (!j.accessToken || j.isAnonymous) throw new Error('o cookie do Spotify venceu — faça o login das letras de novo');
    token = { access: j.accessToken, exp: j.accessTokenExpirationTimestampMs || (Date.now() + 3600000) };
  }

  async function garantirToken() {
    if (!token || Date.now() > token.exp - 30000) await renovarToken();
  }

  const temHangul = (s) => /[가-힣]/.test(s || '');
  const temLetra = (s) => /[a-z]/i.test(s || '');

  const ehJa = (s) => !temHangul(s) && (temKana(s) || temKanji(s));

  // em segundo plano: romaniza o japonês (com kanji, via kuroshiro) e traduz tudo para PT.
  async function enriquecer(letra) {
    const linhas = letra.linhas;
    // romaji completo do japonês (substitui o kana-só que já estava na tela)
    const idxJaRom = linhas.map((l, i) => (ehJa(l.ko) ? i : -1)).filter((i) => i >= 0);
    await Promise.all(idxJaRom.map(async (i) => { linhas[i].rom = await romajiJa(linhas[i].ko); }));
    const idxKo = linhas.map((l, i) => (temHangul(l.ko) ? i : -1)).filter((i) => i >= 0);
    const idxJa = linhas.map((l, i) => (ehJa(l.ko) ? i : -1)).filter((i) => i >= 0);
    const idxEn = linhas.map((l, i) => (!temHangul(l.ko) && !ehJa(l.ko) && temLetra(l.ko) ? i : -1)).filter((i) => i >= 0);
    const [koPt, jaPt, enPt] = await Promise.all([
      traduzir(idxKo.map((i) => linhas[i].ko), 'ko', 'pt'),
      traduzir(idxJa.map((i) => linhas[i].ko), 'ja', 'pt'),
      traduzir(idxEn.map((i) => linhas[i].ko), 'en', 'pt'),
    ]);
    idxKo.forEach((i, k) => { linhas[i].pt = koPt[k]; });
    idxJa.forEach((i, k) => { linhas[i].pt = jaPt[k]; });
    idxEn.forEach((i, k) => { const t = enPt[k]; linhas[i].pt = t && normal(t) !== normal(linhas[i].ko) ? t : null; });
    const faltou = idxKo.some((i) => linhas[i].pt == null) || idxJa.some((i, k) => jaPt[k] == null) || idxEn.some((i, k) => enPt[k] == null);
    letra.traduzido = true;
    // guarda em cache só quando a tradução veio completa (senão tenta de novo na próxima vez)
    if (!faltou && letra.id) { try { fs.writeFileSync(path.join(dirCache, letra.id + '.json'), JSON.stringify(letra)); } catch {} }
    return letra;
  }

  // busca a letra de uma faixa (id do Spotify). Devolve { achou, sincronizada, fonte:'Spotify', linhas:[{t,ko,rom,pt}] }.
  // aoTraduzir(letra) é chamado DEPOIS, quando a tradução fica pronta (a letra aparece na hora, a tradução chega em seguida).
  async function obter(trackId, aoTraduzir) {
    // cache (já com tradução)
    try {
      const c = JSON.parse(fs.readFileSync(path.join(dirCache, trackId + '.json'), 'utf8'));
      if (c && c.versao === 1) return c;
    } catch {}
    await garantirToken();
    const buscar = () => fetch(URL_LETRA + trackId + '?format=json&market=from_token',
      { headers: { 'User-Agent': UA, 'App-platform': 'WebPlayer', Authorization: 'Bearer ' + token.access }, signal: AbortSignal.timeout(8000) });
    let r = await buscar();
    if (r.status === 401) { token = null; await garantirToken(); r = await buscar(); }
    if (r.status === 404) { log('letra Spotify: não tem pra essa faixa'); return { achou: false, naoTem: true }; }
    if (!r.ok) throw new Error('color-lyrics HTTP ' + r.status);
    const j = await r.json();
    const lyr = j && j.lyrics;
    const linhasBrutas = (lyr && lyr.lines) || [];
    const sincronizada = !!lyr && lyr.syncType === 'LINE_SYNCED';
    const linhas = linhasBrutas.map((l) => {
      const ko = l.words || '';
      // romanização: coreano (regra do letras.js) ou japonês só-kana (kanji precisaria de dicionário)
      const rom = temHangul(ko) ? romanizar(ko) : (temKana(ko) && !temKanji(ko)) ? romaji(ko) : null;
      return { t: sincronizada ? +l.startTimeMs : null, ko, rom };
    });
    log(`letra Spotify: ${linhas.length} linhas (${sincronizada ? 'sincronizada' : 'sem sincronia'})`);
    const letra = { versao: 1, id: trackId, achou: linhas.length > 0, sincronizada, fonte: 'Spotify', linhas, traduzido: false };
    // em segundo plano: romaniza o japonês (com kanji) e traduz — depois reenvia a letra enriquecida
    if (letra.achou) {
      enriquecer(letra).then((t) => { if (typeof aoTraduzir === 'function') aoTraduzir(t); }).catch((e) => log('enriquecer letra falhou: ' + e.message));
    }
    return letra;
  }

  // consulta a Web API do Spotify com o MESMO token do login web (ex.: o que está tocando).
  // Assim não precisa de app registrado nem do limite de usuários do modo de desenvolvimento.
  async function api(caminho) {
    await garantirToken();
    const call = () => fetch('https://api.spotify.com/v1' + caminho, { headers: { Authorization: 'Bearer ' + token.access, 'User-Agent': UA } });
    let r = await call();
    if (r.status === 401) { token = null; await garantirToken(); r = await call(); }
    if (r.status === 204) return null; // nada tocando
    if (r.status === 429) throw new Error('Spotify HTTP 429:' + (+r.headers.get('retry-after') || 10));
    if (!r.ok) throw new Error('Spotify HTTP ' + r.status);
    return r.json();
  }

  function esquecer() { token = null; }
  return { obter, esquecer, api };
};
