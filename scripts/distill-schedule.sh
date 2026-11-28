#!/bin/sh
# 로컬 공고 모델 학습(pnpm distill)을 이 Mac에서 매주 자동으로 돌리는 launchd 예약(사용자 결정 2026-11-28).
# 매일 10:00에 깨어 확인하고, 지난 실행에서 6일이 지났을 때만 실제로 돈다. 그 시각에 Mac이 잠자고 있으면 깨어날 때 돌고,
# 꺼져 있었으면 다음 날 10:00에 돈다. 오래 못 돌았으면 언제든 `pnpm distill`로 직접 실행한다.
# 사용: sh scripts/distill-schedule.sh install | uninstall | status
set -eu
LABEL=com.nextstep.distill
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
REPO=$(cd "$(dirname "$0")/.." && pwd)
LOG="$REPO/apps/server/.data/distill/distill.log"

case "${1:-status}" in
  install)
    mkdir -p "$(dirname "$PLIST")" "$(dirname "$LOG")"
    cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>/bin/zsh</string><string>-lc</string><string>cd '$REPO' &amp;&amp; pnpm distill --scheduled &gt;&gt; '$LOG' 2&gt;&amp;1</string></array>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>10</integer><key>Minute</key><integer>0</integer></dict>
  <key>ProcessType</key><string>Background</string>
</dict>
</plist>
EOF
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST"
    echo "예약함: 매일 10:00 확인(6일마다 실행), 기록 $LOG" ;;
  uninstall)
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "예약을 지웠습니다." ;;
  status)
    if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then echo "예약됨: $PLIST"; else echo "예약 없음"; fi
    [ -f "$REPO/apps/server/.data/distill/state.json" ] && cat "$REPO/apps/server/.data/distill/state.json" || true ;;
  *) echo "사용: sh scripts/distill-schedule.sh install | uninstall | status"; exit 1 ;;
esac
