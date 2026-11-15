# Arquitetura do Wawe

**Release:** V14.11.26

## Componentes

- `start.sh`: inicialização, download opcional do executável `cloudflared` para `bin/` e abertura do navegador.
- `server/index.js`: inicializa HTTP, opcionalmente Cloudflare Quick Tunnel e encerramento gracioso.
- `server/app.js`: Express, rotas públicas, validação, CSP, API de salas e Socket.IO.
- `server/rooms.js`: estados efêmeros de salas, tokens, senha e vencimento.
- `server/signaling.js`: autenticação das conexões Socket.IO, chat, presença, permissões do host e sinalização WebRTC.
- `public/js/rtc.js`: `RTCPeerConnection`, captura local, controle de microfone/câmera/tela e trilhas do remetente.
- `public/js/outgoing-audio.js`: combinação de microfone e áudio da fonte compartilhada, quando possível.
- `public/js/stage-layout.js`: organização visual local dos vídeos, miniaturas móveis e redimensionáveis, controles PiP e palco inteiro em tela cheia.
- `public/js/video-pip.js`: uma janela Document Picture-in-Picture por aba, com vídeo mudo da trilha escolhida, sem tocar na conexão WebRTC ou nos elementos de vídeo originais.
- `public/css/pip.css`: visual da janela separada (carregado da mesma origem).
- `public/js/room.js`: interface, estado da sala, chat, prévias, botões e qualidade.
- `public/css/styles.css`: interface adaptável para desktop e dispositivos móveis.

## Fluxo de uma chamada

1. O host cria uma sala e senha; o servidor guarda os estados apenas em memória.
2. O convidado entra pelo convite autenticado (somente nome) ou pelo código e senha da sala. O servidor valida a entrada e autentica os dois via tokens de sessão.
3. Socket.IO transporta ofertas, respostas e candidatos ICE entre os navegadores.
4. WebRTC envia as mídias diretamente entre os participantes após a negociação.
5. Mídias e interface são locais a cada navegador; selecionar ou redimensionar um vídeo não altera a tela do outro participante.

Há uma transmissão de vídeo principal e uma trilha adicional de câmera, permitindo mostrar a tela e a câmera ao mesmo tempo. O microfone funciona sem câmera. Quando não há áudio de tela, a transmissão de vídeo continua funcionando.

## Tema visual

`public/js/theme.js` carrega a preferência local (`localStorage` em `wawe:theme`), aplica `data-theme` ao elemento `<html>` antes da folha de estilos e sincroniza a mudança entre abas do mesmo navegador. O botão `#theme-toggle`, situado imediatamente à direita da qualidade de vídeo, alterna entre claro e escuro e atualiza rótulo/estado acessível. `public/css/theme.css` substitui variáveis e detalhes de contraste sem modificar as cores reais das transmissões. A mesma preferência se aplica à sala e à página inicial, sem tráfego de rede nem sincronização entre participantes.

## Tela cheia

O elemento do palco (`.videos`) é colocado em tela cheia pela Fullscreen API. Assim, o vídeo em destaque **e as miniaturas** pertencem ao mesmo elemento fullscreen. A posição e o tamanho das miniaturas continuam controlados localmente. As posições personalizadas são salvas como frações do espaço útil disponível (`relativeX` / `relativeY`), não apenas pixels absolutos: 0 e 1 ancoram a miniatura às bordas, e valores intermediários mantêm a localização proporcional ao entrar ou sair do fullscreen. A alteração de `fullscreenchange` atualiza o layout imediatamente, enquanto `ResizeObserver` trata a alteração efetiva de dimensões. O redimensionamento manual de uma miniatura encaixada no canto mantém o encaixe. A prevenção de colisões continua aplicada depois da projeção das posições.

As miniaturas flutuantes passam por uma resolução local de colisões: a miniatura arrastada tem prioridade, enquanto as demais são deslocadas para uma área livre. O mesmo processo vale para redimensionar, alternar foco e alterar o tamanho do palco. A largura mínima preferencial é 120 px para câmera e tela; a altura da câmera segue sua proporção real. O motor tenta primeiro deslocar miniaturas sem colisão respeitando esse limite e, se necessário, distribuí-las em fileiras compactas. Apenas quando a área física não comporta todas em 120 px permite redução temporária ou organização excepcional em coluna, recuperando as dimensões preferidas quando o palco aumenta. O vídeo destacado permanece ao fundo e não entra na resolução de colisões.

Para a câmera, o layout obtém a proporção de `HTMLVideoElement.videoWidth/videoHeight`, com `MediaStreamTrack.getSettings()` como alternativa antes de receber metadados. Eventos `loadedmetadata` e `resize` atualizam automaticamente o formato. A moldura da câmera (miniatura ou destaque) é centralizada/ajustada sem cortar imagem nem criar faixas internas. Ao redimensionar por mouse ou teclado, largura e altura variam juntas. Os vídeos compartilhados de tela mantêm o comportamento anterior (`object-fit: contain`), pois sua proporção pode variar conforme a fonte.

## Convites sem senha

O host autenticado com o token da própria sessão pode solicitar um novo convite em `POST /api/rooms/:code/invite`, enviando o token no header `Authorization: Bearer`. O servidor gera um segredo aleatório de 256 bits e guarda somente seu SHA-256 na sala em memória. O convite expira em 30 minutos (ou antes, se a sala expirar), é **de uso único** e gerar outro invalida o anterior.

O botão **Copiar convite** cria um endereço curto `/<CÓDIGO>#invite=<SEGREDO>`. O fragmento `#invite` não é incluído na requisição HTTP inicial; a página usa o segredo exclusivamente no POST de entrada, no corpo JSON. O convidado só precisa preencher o nome. O servidor distingue `inviteToken` de `password`, valida a credencial e só então cria a sessão guest; não compartilha a senha nem o token de sessão do host. A entrada convencional por código/senha continua inalterada, e as proteções de sala trancada, sala cheia e encerramento continuam aplicadas. Quem possuir o link ainda válido pode tentar entrar, portanto ele deve ser tratado como uma credencial secreta.

## Janela flutuante (PiP)

Cada transmissão tem um controle para abrir **um único vídeo** em Document Picture-in-Picture (Chromium compatível e contexto seguro HTTPS/localhost). A cópia visual contém apenas uma trilha de vídeo, está sempre sem áudio e não substitui o elemento original da sala. Alterar a fonte reutiliza a mesma janela; alterar o foco no palco não altera a escolha da janela PiP. O PiP é fechado ao encerrar a sala ou deixar de existir o vídeo escolhido; navegadores sem suporte ocultam os controles. A janela não é um novo servidor e não fornece capturas adicionais.

## Limites de rede

Cloudflare Quick Tunnel publica o site HTTP e a sinalização HTTPS/WebSocket. O tráfego de mídia permanece WebRTC P2P; o túnel não fornece relay TURN. STUN ajuda a descobrir caminhos de rede, mas certas redes/NAT podem impedir a conexão. O endereço público temporário muda quando o túnel reinicia.

## Não incluído nesta versão

Navegador remoto sincronizado, WPE/WebKit integrado, filtros DeepAR e controle remoto do computador. Esses experimentos não fazem parte do projeto publicado.
