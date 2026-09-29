#!/bin/zsh
set -e
cd "${0:A:h}"
if ! command -v node >/dev/null || ! command -v npm >/dev/null; then
  print 'Install Node.js 22.12 or newer from https://nodejs.org, then run this installer again.'
  read '?Press Return to close.'
  exit 1
fi
npm ci
npm run install:slack
read '?Press Return to close.'
