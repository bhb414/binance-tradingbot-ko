export const MA_FORECAST_PERIODS=[5,20,60,120,220];
export const MA_FORECAST_COLORS=['#d4a83e','#d76082','#5584c6','#49a38e','#9375b9'];
export const MA_FORECAST_TYPES=[['SMA','SMA'],['EMA','EMA'],['VWMA','VWMA'],['KAMA','KAMA (2·30)'],['HMA','Hull MA']];
export const FORECAST_CANDIDATES=[['useSlope','slope','기울기 유지'],['useClose','close','현재 종가'],['useLow','low','최근 최저가'],['useHigh','high','최근 최고가'],['useShort','short','단기 이평 현재값'],['useLong','long','장기 이평 현재값'],['useCrossClose','cross-close','마지막 교차 종가']];
export const FORECAST_METHODS=[['slope','현재 이평 기울기 유지'],['close','현재 종가 반복'],['low','최근 N봉 최저가 반복'],['high','최근 N봉 최고가 반복'],['short','비교 단기 이평의 현재값 반복'],['long','비교 장기 이평의 현재값 반복'],['cross-close','마지막 교차 당시 종가 반복'],['fastest-range','최근 고가·저가 중 최단 교차'],['fastest','선택 후보 중 최단 교차'],['mean-price','선택한 가정 종가의 평균으로 재계산'],['mean-bars','선택 후보의 교차 봉수 평균']];
export const FORECAST_DEFAULTS={method:'slope',showCrossing:false,searchBars:120,rangeBars:26,crossA:'0',crossB:'1',ratioBasis:'full',...Object.fromEntries(FORECAST_CANDIDATES.map(([key])=>[key,true]))};
export const forecastStyle=(color,projection=false)=>({color,negative:'#d98e9a',width:1,lineStyle:projection?2:0,visible:true});

// Upgrade the saved two-average study without changing either original series.
export function migrateMaForecast(value){
 if(value?.type!=='MA_FORECAST'||!value.params)return value;
 const old=value.params;
 if(Object.keys(old).some(key=>/^(type|period|enabled)\d+$/.test(key))||!['fastType','fast','slowType','slow'].every(key=>Object.hasOwn(old,key)))return {...value,params:{...FORECAST_DEFAULTS,...old}};
 const params={...FORECAST_DEFAULTS,horizon:old.horizon,slopeBars:old.slopeBars,anchor:old.anchor},styles={};
 for(let i=0;i<MA_FORECAST_PERIODS.length;i++){
  const legacy=i<2,key=i===0?'fast':'slow';
  params['type'+i]=legacy?old[key+'Type']:'SMA';
  params['period'+i]=legacy?old[key]:MA_FORECAST_PERIODS[i];
  params['enabled'+i]=legacy;
  styles['ma'+i]=legacy?value.styles?.[key]:forecastStyle(MA_FORECAST_COLORS[i]);
  styles['forecast'+i]=legacy?value.styles?.[key+'Forecast']:forecastStyle(MA_FORECAST_COLORS[i],true);
 }
 return {...value,params,styles};
}
