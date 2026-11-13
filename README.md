# Wawe

**Versão final: V13-2.11.26**

Wawe é uma sala privada de voz, câmera, compartilhamento de tela e chat para **um host e um convidado**. O servidor roda na máquina do host; um túnel HTTPS temporário pode publicar o endereço de acesso sem abrir uma porta no roteador.

- Vídeo e áudio em **WebRTC P2P** (o servidor faz sinalização via Socket.IO).
- Microfone, câmera e compartilhamento de tela independentes.
- Áudio de aba/tela quando o navegador disponibiliza a captura.
- Visualização com vídeo em destaque, miniaturas móveis/redimensionáveis e **miniaturas também em tela cheia**.
- Configuração independente de resolução, FPS e bitrate de câmera/tela.
- Chat efêmero, senha para entrar, bloqueio de sala e controles do host.
- Identidade visual própria em SVG (símbolo de duas conversas).

## Requisitos

- Linux ou macOS com Node.js **18.17 ou superior**, npm e curl.
- Navegador moderno com WebRTC e acesso à câmera/microfone (Chromium recomendado).
- Para convidados pela internet, conexão de rede e túnel Cloudflare Quick Tunnel ou endereço HTTPS próprio.

O script de inicialização mantém dependências em `node_modules/` e o binário do túnel em `bin/cloudflared`. Ambos são ignorados pelo Git.

## Iniciar

Após clonar o projeto, abra um terminal dentro da pasta do Wawe:

```bash
npm ci
./start.sh
```

O `start.sh` também instala as dependências se necessário. Por padrão, inicia o servidor em `http://127.0.0.1:3000`, abre o navegador e tenta iniciar um túnel público `https://<endereco-aleatorio>.trycloudflare.com`. O link do túnel **muda em cada inicialização**.

Para uso exclusivamente local, sem túnel:

```bash
TUNNEL=0 ./start.sh
```

No site, crie uma sala com nome, apelido e senha (mínimo de seis caracteres). Envie ao convidado o **link de convite** e a senha separadamente. O convidado participa com câmera, microfone, chat e compartilhamento de tela, mas não recebe controle remoto do computador do host.

## Controles da sala

- **Mic**: liga/desliga o microfone.
- **Câmera**: liga/desliga o vídeo local.
- **Tela**: inicia/encerra o compartilhamento de tela; o áudio é solicitado automaticamente quando suportado.
- **Qualidade**: perfis Econômica (480p/15 FPS), Equilibrada (720p/30 FPS), Alta (1080p/60 FPS) e Máxima (1440p/60 FPS), além de ajustes independentes. Os valores reais dependem do dispositivo e da rede.
- **Vídeos**: clique/toque em uma miniatura para destacá-la. Use os controles para mover ou redimensionar; eles são ocultados após um período sem interação.
- **Tela cheia**: amplia todo o palco de vídeos, mantendo as miniaturas visíveis, mesmo ao alternar o destaque.
- **Host**: pode copiar o convite, trancar a sala, remover o convidado ou encerrar a sala para todos.

## Endereço público fixo (opcional)

Sem domínio próprio, use o túnel temporário. Para um endereço estável, configure um Cloudflare Tunnel nomeado ou outro proxy reverso HTTPS apontando para a porta local do servidor e defina `PUBLIC_URL`.

O Wawe **não depende** de um domínio fixo para criar salas ou compartilhar mídia. Um endereço permanente é necessário apenas se você quiser reutilizar o mesmo link após reiniciar o túnel.

## Configuração

| Variável | Padrão | Descrição |
|---|---|---|
| `HOST` | `127.0.0.1` | Endereço da interface local |
| `PORT` | `3000` | Porta inicial (tenta até 10 portas) |
| `TUNNEL` | `1` | `0` desativa o túnel rápido |
| `PUBLIC_URL` | — | URL pública definida pelo host |
| `NO_OPEN` | `0` | `1` não abre o navegador |
| `HOST_GRACE_SEC` | `60` | Tempo de reconexão do host |
| `GUEST_GRACE_SEC` | `30` | Reserva da vaga do convidado |
| `ROOM_TTL_MIN` | `720` | Tempo máximo da sala |
| `TRUST_CLOUDFLARE` | `1` | Confia no cabeçalho de IP apenas se a origem for loopback |

## Testes

```bash
npm test
npm run test:browser
npm audit --omit=dev --audit-level=moderate
```

`npm test` roda testes de HTTP, segurança, permissões, mídias, layout e qualidade. `npm run test:browser` abre **duas abas headless com dispositivos de câmera/microfone simulados**, em um servidor efêmero sem túnel, para validar sinalização WebRTC, vídeo, áudio, chat, compartilhamento de tela e miniaturas em tela cheia. Precisa de Chromium instalado. Esses testes não substituem o teste manual entre redes diferentes.

## Privacidade e limitações

- O servidor escuta em loopback por padrão; somente o link público expõe o site ao convidado.
- Senhas e tokens são mantidos em memória durante a sessão; **não há gravação ou persistência de chat**.
- O navegador precisa de permissão explícita para acessar microfone, câmera e tela.
- **P2P pode revelar os endereços IP públicos dos participantes entre si**, mesmo usando Cloudflare Tunnel. Não existe TURN configurado; algumas redes não conectam.
- O túnel HTTPS é usado para acesso ao site e sinalização; **não transmite o vídeo WebRTC**.
- O áudio de uma aba geralmente é capturável em Chromium, mas o áudio de janelas, jogos ou do sistema pode não ser disponibilizado no Linux.
- O host deve manter o processo do Wawe em execução. A sala tem limite de 12 horas e encerramento após a tolerância de desconexão.

Veja [Arquitetura](docs/ARCHITECTURE.md), [Segurança e privacidade](docs/SECURITY.md) e [Testes](docs/TESTING.md).

## Estrutura do projeto

```text
wawe/
├── public/      # interface web, CSS, JavaScript e logo SVG
├── server/      # Express, salas, segurança, Socket.IO e Cloudflare
├── scripts/     # teste de navegador real (Chromium headless)
├── test/        # testes automatizados
├── docs/        # documentação técnica e de segurança
├── start.sh     # inicialização do servidor e túnel opcional
└── package.json
```

**Licenciamento:** não há licença de redistribuição concedida neste repositório, salvo decisão posterior do autor.
