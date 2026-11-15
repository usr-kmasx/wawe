# Testes e validação da versão V14.11.26

## Pré-requisitos

Node.js 18.17+, `npm ci` e, para o teste de navegador, Chromium disponível no sistema.

## Testes automáticos

```bash
npm test
npm run test:browser
npm audit --omit=dev --audit-level=moderate
```

`npm test` cobre rotas, cabeçalhos de segurança, validação de salas, sessão, autorização, rate limits, áudio, trilhas, perfis de qualidade, layout local e miniaturas. `npm run test:browser` abre dois participantes em **Chromium headless**, com câmera e microfone **simulados**. Usa um servidor em porta aleatória, sem túnel externo e com perfil de navegador temporário, para verificar vídeo, áudio, chat, câmera, compartilhamento e a tela cheia do palco inteiro com miniaturas.

## Testes manuais recomendados

1. Iniciar `TUNNEL=0 ./start.sh`, criar sala, confirmar que o host pode iniciar a câmera e o microfone.
2. Entrar como convidado em outro navegador, verificar áudio bidirecional, vídeo e chat.
3. Alternar qualidade de câmera e tela e observar resolução/FPS conforme dispositivo.
4. Compartilhar uma aba com áudio, depois uma fonte sem áudio; confirmar que o vídeo segue funcionando.
5. Abrir tela cheia após mover miniaturas para os cantos e para posições intermediárias; confirmar que as primeiras acompanham as bordas e as outras preservam a posição proporcional. Sair do fullscreen e conferir que retornam aos lugares correspondentes. Também arrastar/redimensionar, verificar o mínimo de 120 px quando houver espaço e trocar o vídeo destacado.
5b. Alternar o tema com o botão à direita da qualidade; conferir contrastes no chat, nos painéis, nos botões e na página inicial. Atualizar a página para confirmar a persistência e verificar que o vídeo não teve suas cores alteradas.
5a. Em um Chromium compatível, abrir PiP do vídeo remoto, trocar para o vídeo local na mesma janela, mudar o destaque na sala sem alterar a fonte do PiP, fechar o PiP e confirmar que o áudio e o vídeo da sala continuam ativos.
6. Trancar/destrancar a sala, expulsar o convidado, testar reconexão e encerramento.
7. Para acesso pela internet, validar em dispositivos em **redes diferentes** e verificar que o link de túnel funciona; isso não é simulado pelo teste headless local.

## Privacidade da publicação

Antes do push, conferir `git status`, arquivos rastreados, documentação, histórico público, `.gitignore`, caminhos locais, dados de teste, segredos e binários. Um novo commit com arquivos revisados não elimina dados eventualmente presentes no histórico Git anterior; a limpeza retroativa exige tratamento separado do histórico e das referências remotas.

## Resultado da auditoria final (13/11/2026)

- `npm ci`: instalação limpa das dependências concluída.
- `npm test`: **28 testes aprovados, zero falhas**.
- `npm run test:browser`: **aprovado** com dois participantes simulados no Chromium, incluindo áudio recebido por WebRTC, chat, câmera, compartilhamento de tela e miniaturas em tela cheia.
- `npm audit --omit=dev --audit-level=moderate`: **0 vulnerabilidades reportadas**.
- `node --check`: arquivos JavaScript verificados sem erro de sintaxe.
- `git diff --check`: sem erros de formatação.

Não houve teste de chamada externa em duas redes nem verificação manual de todos os modelos de câmera. Os resultados não garantem compatibilidade universal.

## Validação do PiP individual (14/11/2026)

- `npm test`: **53 testes aprovados**, incluindo PiP, colisões, proporções de câmera, largura mínima de 120 px, layout compacto e ancoragem em cantos/posições intermediárias durante entrada e saída do fullscreen, inclusive após redimensionar a miniatura.
- `npm run test:browser`: **aprovado** em Chromium, com abertura/troca/fechamento do PiP, continuidade da chamada, separação visual das miniaturas, enquadramento proporcional, limite de 120 px quando há espaço e ancoragem real no canto ao entrar e sair da tela cheia.
- O teste headless não substitui conferência manual da janela flutuante sobre outros aplicativos no desktop.

## Convites autorizados (14/11/2026)

- `npm test`: testa emissão exclusiva pelo host, links criptograficamente aleatórios, invalidação do convite anterior, uso único, expiração, senha convencional obrigatória e bloqueios de sala trancada/cheia.
- `npm run test:browser`: testa o clique **Copiar convite**, o link curto com fragmento, formulário contendo somente o campo de nome, entrada real sem senha e preservação do modo convencional com senha.
- Teste manual: abrir o convite em outro navegador/dispositivo e conferir que apenas o nome é solicitado; clicar novamente em Copiar convite deve invalidar o anterior; não encaminhar o link para pessoas não autorizadas.

## Tema claro/escuro (14/11/2026)

- `npm test` verifica a entrega dos arquivos de tema e do botão nas páginas da sala e inicial, preservando a política CSP sem código inline.
- `npm run test:browser` verifica tema escuro padrão, posição do botão, troca para tema claro com aplicação real das cores no chat e na barra superior, persistência em `localStorage`, aplicação na tela inicial e sincronização entre abas ao voltar para o escuro.


## Publicação V14.11.26 (14/11/2026)

- Testes completos de servidor/API, chamadas WebRTC e interface em Chromium antes do push.
- Novidades: convite autenticado sem senha, PiP por transmissão, layout com prevenção de sobreposição e ancoragem em fullscreen, proporções de câmera preservadas, largura mínima preferencial de 120 px e tema claro/escuro com persistência.
- Auditoria de arquivos publicados: verificar arquivos locais, segredos, caminhos absolutos, e-mails, binários e dados de sessão. Verificar também o histórico Git separadamente, pois versões antigas podem conservar dados que já haviam sido publicados.

## Observação

Testes automatizados aprovados não provam compatibilidade com todos os navegadores, redes, câmeras ou sistemas operacionais. Registre problemas manuais separadamente.
