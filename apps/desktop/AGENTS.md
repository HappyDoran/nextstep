# 지역 작업 규칙

서버를 자식 프로세스로 띄우거나 로컬 타이머로 자동화하지 않는다. renderer에 Node·파일·전체 IPC를 노출하지 않는다. navigation과 외부 링크 변경 시 security 테스트와 Electron 실제 실행을 확인한다. 트레이·OS 알림·자동 업데이트는 1차에 추가하지 않는다. 앱 종료와 서버 자동 OFF를 혼동하지 않는다.

ESM main의 최상위에서 app.whenReady()를 await하면 시작이 대기 상태에 머물 수 있다. 초기화는 app.whenReady().then 콜백 안에 둔다. macOS 창 닫기는 프로세스를 유지하고 종료 메뉴는 app.quit()을 호출한다.
