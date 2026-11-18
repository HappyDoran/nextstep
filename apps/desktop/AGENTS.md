# 지역 작업 규칙

데스크톱 상주 앱(P1-15)이다. 화면은 홈서버 웹을 그대로 열고 앱 안에 화면을 따로 만들지 않는다. 서버를 자식 프로세스로 띄우거나 로컬 타이머로 공고 수집·메일 처리를 하지 않는다. 앱은 서버의 마지막 갱신 결과를 조회해 알리기만 한다. renderer에 Node·파일·IPC를 노출하지 않는다(nodeIntegration=false, contextIsolation·sandbox·webSecurity=true, preload 없음). 서비스 출처 밖 이동·리다이렉트·webview를 막고 권한 요청을 거부한다. 외부 링크는 HTTPS만 기본 브라우저로 연다. 원격 서비스 주소는 HTTPS만, loopback은 HTTP도 허용한다. 알림에는 건수와 성공·실패만 넣고 공고·이력서 내용을 넣지 않는다.

ESM main의 최상위에서 app.whenReady()를 await하면 시작이 대기 상태에 머물 수 있다. 초기화는 app.whenReady().then 콜백 안에 둔다. 창 닫기는 숨기기이고 종료는 아이콘·앱 메뉴의 'NextStep 종료'로만 한다. 앱 종료와 서버 자동 갱신 OFF를 혼동하지 않는다. navigation·외부 링크·알림 판단을 바꾸면 tests와 Electron 실제 실행을 확인한다.
