#!/usr/bin/env bash
# Bounded environment setup; the native acceptance tests remain mandatory.
set -euo pipefail
python -m pip install --disable-pip-version-check --timeout 20 --retries 2 -r scripts/browser-requirements.txt
packages=()
if ! fc-list :lang=zh family | grep -Eq 'Noto.*CJK'; then
  packages+=(fonts-noto-cjk)
fi
if ! command -v xvfb-run >/dev/null || ! command -v Xvfb >/dev/null; then
  packages+=(xvfb)
fi
if ! command -v xauth >/dev/null; then
  packages+=(xauth)
fi
if ! command -v google-chrome >/dev/null && ! command -v google-chrome-stable >/dev/null; then
  # GitHub Ubuntu runners normally already provide Google's official Chrome
  # package and repository. Do not substitute a browser download or an unsigned
  # third-party installer if that runner prerequisite changes.
  packages+=(google-chrome-stable)
fi
if ((${#packages[@]})); then
  sudo apt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=20 -o Acquire::https::Timeout=20 update -qq
  sudo apt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=20 -o Acquire::https::Timeout=20 install -y "${packages[@]}"
fi
python -c 'from playwright.sync_api import sync_playwright; print("Playwright import verified")'
fc-list :lang=zh family | grep -E 'Noto.*CJK' | sort -u
command -v xvfb-run
command -v Xvfb
command -v xauth
chrome=$(command -v google-chrome || command -v google-chrome-stable)
"$chrome" --version
