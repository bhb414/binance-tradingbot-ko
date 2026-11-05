export const FAVORITES_KEY='fw-market-favorites-v1';
const defaults=['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT','DOGEUSDT'].map(symbol=>'usdm:'+symbol);
export const validFavorite=key=>typeof key==='string'&&/^(usdm|coinm|spot|options):[A-Z0-9_-]{2,80}$/.test(key);
export const defaultFavorites=()=>[...defaults];
export function validateFavorites(keys){if(!Array.isArray(keys)||!keys.every(validFavorite))throw Error('즐겨찾기 목록 형식을 확인해 주세요.');if(keys.length>500)throw Error('즐겨찾기는 최대 500개까지 저장할 수 있습니다.');return [...new Set(keys)];}
export function decodeFavorites(value){return validateFavorites(JSON.parse(value));}
export function readFavorites(value){try{return decodeFavorites(value);}catch{return defaultFavorites();}}
export function toggleFavorite(keys,key){if(!validFavorite(key))throw new Error('즐겨찾기 종목을 확인해 주세요.');if(keys.includes(key))return keys.filter(value=>value!==key);if(keys.length>=500)throw new Error('즐겨찾기는 최대 500개까지 저장할 수 있습니다.');return [...keys,key];}

export function setFavorite(keys,key,enabled){if(!validFavorite(key)||typeof enabled!=='boolean')throw Error('즐겨찾기 종목과 선택 여부를 확인해 주세요.');const current=validateFavorites(keys);return current.includes(key)===enabled?current:toggleFavorite(current,key);}
