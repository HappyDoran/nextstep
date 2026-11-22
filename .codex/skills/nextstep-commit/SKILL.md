---
name: nextstep-commit
description: 변경을 커밋·푸시할 때 변경 범위와 검증 근거를 정리한다.
---

# nextstep-commit

nextstep-review skill과 docs/DEVELOPMENT.md의 검증 명령을 확인한다. git status·diff·원격 대상·브랜치를 확인하고 명시한 파일만 stage한다. 원문·이력서·DB·자격정보가 포함되지 않았는지 확인한다. 한국어 커밋 제목과 본문에 변경 이유·실행한 검증·미검증을 적는다. hook 실패는 수정하고 다시 검증한다. 사용자 허가 없는 이력 재작성·강제 push를 하지 않는다. push 후 로컬 HEAD와 원격 추적 브랜치 일치를 확인한다.
