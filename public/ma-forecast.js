export const MA_FORECAST_PERIODS=[5,20,60,120,220];
export const MA_FORECAST_COLORS=['#d4a83e','#d76082','#5584c6','#49a38e','#9375b9'];
export const MA_FORECAST_TYPES=[['SMA','SMA'],['EMA','EMA'],['VWMA','VWMA'],['KAMA','KAMA (2·30)'],['HMA','Hull MA']];
export const forecastStyle=(color,projection=false)=>({color,negative:'#d98e9a',width:1,lineStyle:projection?2:0,visible:true});

// Upgrade the saved two-average study without changing either original series.
export function migrateMaForecast(value){
 if(value?.type!=='MA_FORECAST'||!value.params)return value;
 const old=value.params;
 if(Object.keys(old).some(key=>/^(type|period|enabled)\d+$/.test(key))||!['fastType','fast','slowType','slow'].every(key=>Object.hasOwn(old,key)))return value;
 const params={horizon:old.horizon,slopeBars:old.slopeBars,anchor:old.anchor},styles={};
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
