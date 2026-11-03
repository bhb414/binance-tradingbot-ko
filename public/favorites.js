export const FAVORITES_KEY='fw-market-favorites-v1';
const defaults=['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT','DOGEUSDT'].map(symbol=>'usdm:'+symbol);
const valid=key=>typeof key==='string'&&/^(usdm|coinm|spot|options):[A-Z0-9_-]{2,80}$/.test(key);
export function readFavorites(value){try{const keys=JSON.parse(value);if(!Array.isArray(keys)||keys.length>500||!keys.every(valid))throw new Error();return [...new Set(keys)];}catch{return [...defaults];}}
export function toggleFavorite(keys,key){if(!valid(key))throw new Error('즐겨찾기 종목을 확인해 주세요.');if(keys.includes(key))return keys.filter(value=>value!==key);if(keys.length>=500)throw new Error('즐겨찾기는 최대 500개까지 저장할 수 있습니다.');return [...keys,key];}
