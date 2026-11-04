export const CHART_TYPES=Object.freeze([
 {id:'standard',label:'캔들',group:'가격 봉',series:'CandlestickSeries',icon:'M6 2v20m12-20v20M3 6h6v10H3zM15 9h6v9h-6z',description:'시가·고가·저가·종가를 캔들로 표시'},
 {id:'bar',label:'바',group:'가격 봉',series:'BarSeries',icon:'M6 2v20M1 8h5m0 9h5M18 3v19m-5-10h5m0-5h5',description:'시가·고가·저가·종가를 OHLC 바로 표시'},
 {id:'heikin',label:'하이킨아시',group:'가격 봉',series:'CandlestickSeries',icon:'M6 2v20m12-20v20M3 6h6v10H3zM15 9h6v9h-6zM3 6l6 10m6-7l6 9',description:'하이킨아시 합성 가격으로 추세를 표시'},
 {id:'line',label:'라인',group:'가격 선',series:'LineSeries',icon:'M2 19l6-8 5 4 9-12',description:'각 봉의 실제 종가를 선으로 연결'},
 {id:'line-markers',label:'마커 라인',group:'가격 선',series:'LineSeries',icon:'M2 19l6-8 5 4 9-12M8 8a3 3 0 1 0 0 6 3 3 0 0 0 0-6m5 4a3 3 0 1 0 0 6 3 3 0 0 0 0-6',description:'실제 종가를 연결하고 각 값에 점을 표시'},
 {id:'step',label:'스텝 라인',group:'가격 선',series:'LineSeries',icon:'M2 20h6v-7h7V5h7',description:'실제 종가를 계단 모양으로 연결'},
 {id:'area',label:'영역',group:'영역',series:'AreaSeries',icon:'M2 19l6-8 5 4 9-12v19H2z',description:'실제 종가선 아래를 색으로 채워 표시'},
 {id:'baseline',label:'베이스라인',group:'영역',series:'BaselineSeries',icon:'M2 13h20M2 18l6-9 5 8 9-14',description:'화면에 보이는 종가 범위의 중간값 위·아래를 색으로 구분'}
]);
export const CHART_TYPE_IDS=Object.freeze(CHART_TYPES.map(t=>t.id));
export const chartType=id=>CHART_TYPES.find(t=>t.id===id)||CHART_TYPES[0];
export const chartTypeLabel=id=>chartType(id).label;
export const chartTypeCaption=id=>id==='heikin'?'하이킨아시 · 합성가격':id==='standard'?'일반 캔들':id==='bar'?'바 · OHLC':id==='baseline'?'베이스라인 · 표시 구간 중간값 기준':chartTypeLabel(id)+' · 실제 종가';
export const chartTypeIcon=id=>'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="'+chartType(id).icon+'"/></svg>';
