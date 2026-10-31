# Letra no Ar 🎵

Uma janelinha **sempre em primeiro plano** (Windows) que mostra a **letra sincronizada** da música
tocando no **Spotify** — e rola no tempo certo, como o recurso de letras do próprio Spotify.

Feita pra deixar de canto na tela (ou encostada na barra de tarefas) enquanto você ouve música.

## O que faz

- Pega a música tocando no Spotify (login uma vez no Spotify web; guarda só o cookie da sua conta).
- Mostra a **letra sincronizada**, com a linha da vez destacada e rolagem automática.
- **Letra direto do Spotify** (a mesma do app, sincronia idêntica) quando você conecta as letras;
  senão cai no **LRCLIB / NetEase** como reserva.
- **Romanização** do coreano e do japonês (kana) e **tradução em português** (DeepL se tiver chave, senão MyMemory).
- **Modo barra**: deixe a janela bem baixinha e ela vira uma faixa horizontal
  `capa | música | ····· letra ····· | tempo`, mostrando só a linha da vez (e priorizando a romanização).
- Sempre em primeiro plano, sem bordas, arrastável, com opacidade e "modo fantasma" (clicar através, Ctrl+Alt+L).

## Como rodar

```
npm install
npm run app
```

Gerar um `.exe` portátil:

```
npm run dist
```

No app, clique no ⚙️ → **Conectar o Spotify**: abre o login do Spotify web numa janelinha (uma vez).
Esse mesmo login serve pra saber o que está tocando **e** pra pegar a letra — não precisa de app registrado
no Spotify nem de liberar usuários, então roda pra qualquer pessoa em qualquer máquina.

## Como está feito

- **Electron** (`main.js` processo principal, `preload.js` a ponte, `ui/` a interface).
- `letras.js` — letra pela fonte reserva (LRCLIB + NetEase), romanização do coreano e tradução. Com cache em disco.
- `spotify-letras.js` — fala com o Spotify usando o cookie `sp_dc` → token (TOTP): o que está tocando
  (`/me/player/currently-playing`) e a letra (`color-lyrics`, não-oficial). Traduz e romaniza por cima.

## Avisos

- O endpoint de letras do Spotify é **não-oficial** e pode mudar; quando mudar, é preciso atualizar.
- Romanização de **kanji** (japonês) ainda não é feita (precisaria de um dicionário de leituras) — por ora,
  só as linhas de kana romanizam.
- Nenhum segredo (cookie/token) fica no repositório — tudo mora em `%APPDATA%\letra-no-ar`.

---

Feito com carinho pra ouvir música com os amigos. 🐸
