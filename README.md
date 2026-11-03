# 바이낸스 자동매매

바이낸스 상품 조회와 USDT 무기한 선물 자동매매를 위한 독립 로컬 앱입니다. Windows에서 실행하며 수식 조건·행동, 봇별 예산, 직접 주문, TP/SL 보호 주문, 손익·수수료·펀딩 조회와 메타버스 작업실을 제공합니다.

저장소: [bhb414/binance-tradingbot-ko](https://github.com/bhb414/binance-tradingbot-ko)

## 설치와 실행

Windows, Node.js 20 이상, Git for Windows가 필요합니다. 별도 npm 패키지는 사용하지 않습니다.

```powershell
git clone https://github.com/bhb414/binance-tradingbot-ko.git "바이낸스 자동매매"
cd "바이낸스 자동매매"
.\run.cmd
```

또는 폴더의 **run.cmd**를 더블클릭합니다. 기본 주소는 [http://127.0.0.1:8896](http://127.0.0.1:8896)이며 이 PC에서만 접속할 수 있습니다. API 키는 앱의 설정 화면에서 직접 등록합니다.

## 업데이트

1. 실행 중인 서버 창에서 Ctrl+C로 프로그램을 종료합니다. 종료 중에는 봇 조건 감시가 멈춥니다.
2. 폴더의 **update.cmd**를 더블클릭합니다.
3. 완료 후 **run.cmd**로 실행하고 필요한 주문 허용·봇 시작을 선택합니다.

설정의 **업데이트 확인**으로 새 버전 유무를 조회할 수 있습니다. 명령줄에서는 `npm run update:check` 또는 `node tools/update.mjs --check`를 사용합니다.

업데이터는 실행 중인 서버·중복 업데이트·로컬 소스 변경·갈라진 Git 기록을 확인합니다. GitHub main의 새 버전을 별도 임시 폴더에서 테스트한 뒤 현재 버전을 앞으로만 이동합니다. 검증이 실패하면 현재 소스를 유지합니다. 적용 전 매매 원장을 로컬에 백업하고 이전 코드 커밋도 로컬 참조에 보관합니다. API 키는 읽거나 변경하지 않습니다.

## 저장되는 데이터

- `.runtime/state.json`: 봇 설정·주문 의도·체결 기록.
- `.runtime/credentials.dpapi`: Windows 사용자 계정으로 암호화한 API 키.
- `.runtime/backups/`: 업데이트 전 매매 원장 백업.
- 브라우저 저장소: 관심종목·차트·지표·캐릭터 외형.

이 데이터와 검증 캡처는 GitHub에 포함하지 않습니다. 업데이트로 삭제하지 않으며, 프로그램 폴더의 `.runtime`까지 삭제하면 로컬 저장본도 삭제됩니다. `WORKROOM_DATA_DIR`로 데이터 폴더를 별도로 지정할 수 있습니다. 브라우저 설정은 같은 브라우저·주소에서 유지됩니다.

서버를 새로 실행하면 저장된 키로 조회 연결을 복원하지만 주문 실행과 봇 시작은 자동으로 켜지지 않습니다.

## 사용법과 검증

- [상세 기능·수식·예산·포지션 관리](docs/USAGE.md)
- [변경 기록](CHANGELOG.md)
- 전체 테스트: `npm test`

작업실 에셋의 출처와 이용 조건은 [CREDITS](public/room-assets/CREDITS.txt)에 있습니다. Kenney 타일은 CC0, Pipoya 캐릭터 파츠는 제작물 내 상업 이용 허용 조건으로 사용합니다.

