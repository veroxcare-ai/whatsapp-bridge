#!/usr/bin/env bash
# VEROX WhatsApp bridge — run on Linux / Raspberry Pi / Android-Termux.
cd "$(dirname "$0")" || exit 1
command -v node >/dev/null 2>&1 || { echo "[!] Node.js not found. On Termux: pkg install nodejs. On PC: install from nodejs.org"; exit 1; }
[ -d node_modules ] || npm install
[ -f .env ] || { echo "[!] Create a .env file first (cp .env.example .env, then fill your keys)."; exit 1; }
# keep the phone/PC awake on Termux (harmless elsewhere)
command -v termux-wake-lock >/dev/null 2>&1 && termux-wake-lock
echo "Starting VEROX WhatsApp bridge on http://localhost:8787 ..."
node server.js
