#!/bin/sh
# 원격 저장소에 올린 코드를 홈서버(doran-server)에 배포한다: 받기 → 설치 → 서버·웹 빌드 → 서비스 재시작.
# 사용(Mac): sh scripts/home-deploy.sh   (먼저 git push. 서버 서비스·경로는 기술 설계 A절)
set -eu
ssh doran-server 'set -eu
cd /srv/nextstep/app
git pull --ff-only
export ELECTRON_SKIP_BINARY_DOWNLOAD=1
~/.local/bin/mise exec -- pnpm install --frozen-lockfile
~/.local/bin/mise exec -- pnpm turbo run build --filter=@nextstep/server --filter=@nextstep/web
sudo -n /usr/bin/systemctl restart nextstep-api
sudo -n /usr/bin/systemctl restart nextstep-web
git log --oneline -1'
echo '배포 완료: https://doran-server.tail70f0b3.ts.net'
