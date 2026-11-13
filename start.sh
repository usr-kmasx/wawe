#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "$0")"

PORT="${PORT:-3000}"
TUNNEL="${TUNNEL:-1}"

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "erro: '$1' não encontrado no PATH." >&2
    exit 1
  }
}

need node
need npm
need curl

if [ ! -d node_modules/express ] || [ ! -d node_modules/socket.io ]; then
  echo "› instalando dependências locais (express, socket.io)..."
  npm install --no-audit --no-fund
fi

if [ "$TUNNEL" != "0" ] && [ -z "${PUBLIC_URL:-}" ] && [ ! -x bin/cloudflared ]; then
  os="$(uname -s)"
  arch="$(uname -m)"

  case "$arch" in
    x86_64 | amd64) cf_arch="amd64" ;;
    aarch64 | arm64) cf_arch="arm64" ;;
    *) cf_arch="" ;;
  esac

  mkdir -p bin

  if [ "$os" = "Linux" ] && [ -n "$cf_arch" ]; then
    echo "› baixando cloudflared (linux-$cf_arch) para ./bin..."
    if curl -fsSL \
      "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${cf_arch}" \
      -o bin/cloudflared.tmp; then
      chmod +x bin/cloudflared.tmp
      mv bin/cloudflared.tmp bin/cloudflared
    else
      rm -f bin/cloudflared.tmp
      echo "› não foi possível baixar o cloudflared. Seguindo apenas local (TUNNEL=0)." >&2
      TUNNEL=0
    fi
  elif [ "$os" = "Darwin" ] && [ -n "$cf_arch" ]; then
    echo "› baixando cloudflared (darwin-$cf_arch) para ./bin..."
    if curl -fsSL \
      "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-${cf_arch}.tgz" \
      -o bin/cloudflared.tgz; then
      tar -xzf bin/cloudflared.tgz -C bin cloudflared
      rm -f bin/cloudflared.tgz
      chmod +x bin/cloudflared
    else
      rm -f bin/cloudflared.tgz
      echo "› não foi possível baixar o cloudflared. Seguindo apenas local (TUNNEL=0)." >&2
      TUNNEL=0
    fi
  else
    echo "› instalação automática indisponível para $os/$arch." >&2
    echo "  baixe o cloudflared para ./bin/cloudflared ou rode com TUNNEL=0." >&2
    TUNNEL=0
  fi
fi

if [ "$TUNNEL" = "0" ]; then
  export TUNNEL=0
else
  export TUNNEL=1
fi

export PORT
exec node server/index.js