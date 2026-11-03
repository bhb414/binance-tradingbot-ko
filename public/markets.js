export const MARKET_FILTERS=[['all','전체'],['tradfi','주식·상품 선물'],['usdm','USDⓈ-M 선물'],['coinm','COIN-M 선물'],['spot','현물'],['options','옵션']];
const NAMES={BTC:'비트코인 Bitcoin',ETH:'이더리움 Ethereum',SOL:'솔라나 Solana',BNB:'비엔비 바이낸스코인',XRP:'리플',DOGE:'도지코인',SKHY:'SK하이닉스 SK Hynix',SKHYNIX:'SK하이닉스',INTC:'인텔 Intel',SPY:'S&P500 ETF',TSLA:'테슬라 Tesla',NVDA:'엔비디아 NVIDIA',AMZN:'아마존 Amazon',GOOGL:'알파벳 구글 Google',META:'메타',COIN:'코인베이스 Coinbase',XAU:'금 Gold',XAG:'은 Silver',NATGAS:'천연가스',CL:'원유',BZ:'브렌트유'};
export const isTradfi=instrument=>instrument.contractType==='TRADIFI_PERPETUAL'||instrument.contractType==='TRADFI_PERPETUAL';
export function productLabel(instrument){
  if(instrument.market==='spot')return '현물';
  if(instrument.market==='options')return (instrument.optionSide==='CALL'?'콜':instrument.optionSide==='PUT'?'풋':'')+' 옵션';
  if(isTradfi(instrument))return '주식·상품 무기한 선물';
  const type=instrument.contractType?.includes('PERPETUAL')?'무기한 선물':'만기 선물';return (instrument.market==='coinm'?'COIN-M ':instrument.marginAsset==='USDC'?'USDC ':'USDT ')+type;
}
export const instrumentName=instrument=>NAMES[instrument.baseAsset]||instrument.baseAsset||instrument.symbol;
export const matchesMarket=(instrument,filter)=>filter==='all'||filter==='tradfi'&&isTradfi(instrument)||instrument.market===filter;
export const marketKey=instrument=>instrument.market+':'+instrument.symbol;
