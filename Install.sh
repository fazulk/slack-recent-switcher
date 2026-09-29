#!/bin/sh
set -eu
cd -- "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  printf '%s\n' 'Install Node.js 22.12 or newer from https://nodejs.org, then run this installer again.'
  exit 1
fi
npm ci
npm run install:slack -- "$@"
