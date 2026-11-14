#!/bin/sh
# 홈서버 전까지 운영자 Mac에서 빌드한 API·웹을 상시 실행한다(launchd: 로그인 시 시작, 종료되면 재시작).
# 사용: sh scripts/mac-service.sh install | uninstall | restart   (install 전에 pnpm build)
# 로그: ~/Library/Logs/nextstep/{api,web}.log. Mac이 잠자거나 꺼지면 함께 멈춘다.
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
NODE=$(command -v node)
AGENTS="$HOME/Library/LaunchAgents"
LOGS="$HOME/Library/Logs/nextstep"
# OCR 도구(pdftoppm·tesseract)를 찾을 수 있게 Homebrew 경로를 포함한다.
PATH_VALUE="$(dirname "$NODE"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

plist() { # 이름 작업폴더 인자...
  name=$1; dir=$2; shift 2
  args=""; for a in "$NODE" "$@"; do args="$args<string>$a</string>"; done
  cat > "$AGENTS/com.nextstep.$name.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.nextstep.$name</string>
  <key>ProgramArguments</key><array>$args</array>
  <key>WorkingDirectory</key><string>$dir</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$PATH_VALUE</string><key>NODE_ENV</key><string>production</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOGS/$name.log</string>
  <key>StandardErrorPath</key><string>$LOGS/$name.log</string>
</dict></plist>
EOF
}

case "${1:-}" in
  install)
    [ -f "$ROOT/apps/server/dist/main.js" ] && [ -d "$ROOT/apps/web/.next" ] || { echo '먼저 pnpm build를 실행하세요.'; exit 1; }
    mkdir -p "$AGENTS" "$LOGS"
    plist api "$ROOT/apps/server" --env-file-if-exists=.env.local dist/main.js
    plist web "$ROOT/apps/web" node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3100
    for n in api web; do launchctl bootout "gui/$(id -u)/com.nextstep.$n" 2>/dev/null || true; launchctl bootstrap "gui/$(id -u)" "$AGENTS/com.nextstep.$n.plist"; done
    echo '실행: http://127.0.0.1:3100 (로그 ~/Library/Logs/nextstep)' ;;
  restart)
    for n in api web; do launchctl kickstart -k "gui/$(id -u)/com.nextstep.$n"; done ;;
  uninstall)
    for n in api web; do launchctl bootout "gui/$(id -u)/com.nextstep.$n" 2>/dev/null || true; rm -f "$AGENTS/com.nextstep.$n.plist"; done
    echo '중지하고 자동 시작을 지웠습니다.' ;;
  *) echo '사용: sh scripts/mac-service.sh install | uninstall | restart'; exit 1 ;;
esac
