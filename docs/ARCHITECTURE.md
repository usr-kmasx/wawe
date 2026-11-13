# Arquitetura do Wawe

**Release:** V13-2.11.26

## Componentes

- `start.sh`: inicialização, download opcional do executável `cloudflared` para `bin/` e abertura do navegador.
- `server/index.js`: inicializa HTTP, opcionalmente Cloudflare Quick Tunnel e encerramento gracioso.
- `server/app.js`: Express, rotas públicas, validação, CSP, API de salas e Socket.IO.
- `server/rooms.js`: estados efêmeros de salas, tokens, senha e vencimento.
- `server/signaling.js`: autenticação das conexões Socket.IO, chat, presença, permissões do host e sinalização WebRTC.
- `public/js/rtc.js`: `RTCPeerConnection`, captura local, controle de microfone/câmera/tela e trilhas do remetente.
- `public/js/outgoing-audio.js`: combinação de microfone e áudio da fonte compartilhada, quando possível.
- `public/js/stage-layout.js`: organização visual local dos vídeos, miniaturas móveis e redimensionáveis, e palco inteiro em tela cheia.
- `public/js/room.js`: interface, estado da sala, chat, prévias, botões e qualidade.
- `public/css/styles.css`: interface adaptável para desktop e dispositivos móveis.

## Fluxo de uma chamada

1. O host cria uma sala e senha; o servidor guarda os estados apenas em memória.
2. O convidado entra usando o link público e a senha. O servidor autentica os dois via tokens de sessão.
3. Socket.IO transporta ofertas, respostas e candidatos ICE entre os navegadores.
4. WebRTC envia as mídias diretamente entre os participantes após a negociação.
5. Mídias e interface são locais a cada navegador; selecionar ou redimensionar um vídeo não altera a tela do outro participante.

Há uma transmissão de vídeo principal e uma trilha adicional de câmera, permitindo mostrar a tela e a câmera ao mesmo tempo. O microfone funciona sem câmera. Quando não há áudio de tela, a transmissão de vídeo continua funcionando.

## Tela cheia

O elemento do palco (`.videos`) é colocado em tela cheia pela Fullscreen API. Assim, o vídeo em destaque **e as miniaturas** pertencem ao mesmo elemento fullscreen. A posição e o tamanho das miniaturas continuam controlados localmente.

## Limites de rede

Cloudflare Quick Tunnel publica o site HTTP e a sinalização HTTPS/WebSocket. O tráfego de mídia permanece WebRTC P2P; o túnel não fornece relay TURN. STUN ajuda a descobrir caminhos de rede, mas certas redes/NAT podem impedir a conexão. O endereço público temporário muda quando o túnel reinicia.

## Não incluído nesta versão

Navegador remoto sincronizado, WPE/WebKit integrado, filtros DeepAR e controle remoto do computador. Esses experimentos não fazem parte do projeto publicado.
