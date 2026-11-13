# Testes e validação da versão V13-2.11.26

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
5. Abrir tela cheia, arrastar/redimensionar as miniaturas, trocar o vídeo destacado e sair sem perder a organização.
6. Trancar/destrancar a sala, expulsar o convidado, testar reconexão e encerramento.
7. Para acesso pela internet, validar em dispositivos em **redes diferentes** e verificar que o link de túnel funciona; isso não é simulado pelo teste headless local.

## Privacidade da publicação

Antes do push, conferir `git status`, arquivos rastreados, documentação, histórico público, `.gitignore`, caminhos locais, dados de teste, segredos e binários. Publicar somente o commit raiz revisado evita incluir o README antigo com caminho absoluto em commits visíveis do GitHub.

## Resultado da auditoria final (13/11/2026)

- `npm ci`: instalação limpa das dependências concluída.
- `npm test`: **28 testes aprovados, zero falhas**.
- `npm run test:browser`: **aprovado** com dois participantes simulados no Chromium, incluindo áudio recebido por WebRTC, chat, câmera, compartilhamento de tela e miniaturas em tela cheia.
- `npm audit --omit=dev --audit-level=moderate`: **0 vulnerabilidades reportadas**.
- `node --check`: arquivos JavaScript verificados sem erro de sintaxe.
- `git diff --check`: sem erros de formatação.

Não houve teste de chamada externa em duas redes nem verificação manual de todos os modelos de câmera. Os resultados não garantem compatibilidade universal.

## Observação

Testes automatizados aprovados não provam compatibilidade com todos os navegadores, redes, câmeras ou sistemas operacionais. Registre problemas manuais separadamente.
