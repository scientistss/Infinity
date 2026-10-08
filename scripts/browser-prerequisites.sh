#!/usr/bin/env bash
# Bounded environment setup; the native acceptance tests remain mandatory.
set -euo pipefail
python -m pip install --disable-pip-version-check --timeout 20 --retries 2 -r scripts/browser-requirements.txt
if ! fc-list :lang=zh family | grep -Eq 'Noto.*CJK'; then
  sudo apt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=20 -o Acquire::https::Timeout=20 update -qq
  sudo apt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=20 -o Acquire::https::Timeout=20 install -y fonts-noto-cjk
fi
python -c 'from playwright.sync_api import sync_playwright; print("Playwright import verified")'
fc-list :lang=zh family | grep -E 'Noto.*CJK' | sort -u
