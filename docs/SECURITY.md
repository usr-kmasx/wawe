# Segurança e privacidade

**Release:** V13-2.11.26

## Superfície pública

Por padrão, o servidor escuta em `127.0.0.1`. Quando ativado, Cloudflare Quick Tunnel fornece um URL HTTPS público para acessar o site. Esse endereço não é uma garantia de anonimato: a conexão WebRTC pode revelar o IP público dos participantes entre si.

Apenas uma pessoa pode ser convidada por sala. Os controles de host (trancar, expulsar, encerrar) são validados no servidor. A autenticação usa tokens aleatórios de sessão; senhas de salas são verificadas com hash `scrypt` e salt.

## Dados e retenção

- As salas, mensagens, sessões e hashes de senha ficam em memória, não em banco de dados.
- O aplicativo não possui recurso de gravação de chamadas ou histórico persistente.
- Microfone, câmera e compartilhamento de tela dependem de permissão do navegador.
- O software não fornece acesso aos arquivos, ao terminal ou ao controle remoto da máquina do host.
- O tráfego de mídia é negociado por WebRTC entre os participantes; o aplicativo não implementa servidor TURN.

## Medidas no servidor

Validação de dados, limites de tamanho e tentativas, CSP, cabeçalhos de segurança e políticas de permissão de mídia. O código fonte de páginas públicas é servido a partir de `public/`; binários baixados, dependências locais e dados privados são ignorados no Git.

## Publicação sem dados locais

Não inclua `.env`, chaves, licenças de SDK, tokens, arquivos de credenciais, logs, diretórios `node_modules/`, binários `cloudflared`, perfis de navegador, configurações pessoais ou capturas de tela em commits públicos. Os exemplos da documentação devem usar nomes e caminhos genéricos.

A auditoria antes do lançamento procura caminhos absolutos de usuário, e-mails particulares, endereços de rede, chaves e credenciais em **todos os arquivos publicados e no histórico Git público**. Uma revisão de código diminui o risco, mas não substitui a proteção dos segredos no ambiente local.

## Limitações e recomendações

- Não envie a senha da sala no mesmo canal do link se o objetivo é reduzir o risco de acesso não autorizado.
- Não compartilhe uma janela ou aba que mostre conteúdo confidencial.
- Mantenha o navegador e o Node.js atualizados.
- Em redes restritivas, a ausência de TURN pode impedir conexões.
- Para relatos de segurança, informe detalhes de reprodução sem publicar credenciais ou dados pessoais.
