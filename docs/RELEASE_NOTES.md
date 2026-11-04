# 바이낸스 자동매매 v0.4.35

Node.js 24 이상이 필요한 Windows용 개인계좌 자동매매 앱입니다.

- run.cmd 실행 직후 창이 닫히던 Windows 줄바꿈 오류를 수정했습니다. update.cmd에도 같은 수정을 적용했습니다.
- 실행 시 버전을 표시하고, 오류 발생 시 창과 startup-error.log를 남깁니다.
- v0.4.34의 TP/SL 체결 대기로 인한 봇 오정지 수정과 v0.4.33의 미체결 취소·최소 예산 설정을 포함합니다.

첨부된 **binance-tradingbot-ko-v0.4.35-windows.zip**을 전부 압축 해제하고 **run.cmd**를 실행하세요. SHA256SUMS.txt는 ZIP의 검증값입니다. GitHub의 Source code ZIP과 구분해 버전이 표시된 첨부 파일을 사용하세요.

기존 사용자는 프로그램 종료 후 update.cmd로 업데이트합니다. 이전 update.cmd도 바로 닫히면 기존 폴더에서 터미널을 열고 node tools/update.mjs를 실행하세요. 개인 데이터와 API 키가 저장된 .runtime 폴더는 유지하세요.

개인계좌 매매만 허용하며 앱 판매·유료서비스·타인 계좌 운용은 금지합니다.
