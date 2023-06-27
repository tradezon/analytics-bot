import { JsonRpcProvider, WebSocketProvider, Contract } from 'ethers';
import _1inchSpotPriceAggregatorAbi from '../abi/1inch-spot-price-aggregator.json';
const _1inchSpotPriceAggregatorAddress =
  '0x07D91f5fb9Bf7798734C3f606dB065549F6893bb';

export type PriceOracle = (token: string, decimals: number) => Promise<bigint>;

export function createPriceOracle(
  provider: JsonRpcProvider | WebSocketProvider
): PriceOracle {
  const priceOracleContract = new Contract(
    _1inchSpotPriceAggregatorAddress,
    _1inchSpotPriceAggregatorAbi,
    { provider }
  );
  return async (token: string, decimals: number) => {
    const rate = await priceOracleContract.getRateToEth(token, true);
    return decimals === 18 ? rate : rate / 10n ** BigInt(18 - decimals);
  };
}
