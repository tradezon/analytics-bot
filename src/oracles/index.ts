import { formatUnits } from 'ethers';
import type { JsonRpcProvider, WebSocketProvider } from 'ethers';
import { LRUCache } from 'lru-cache';
import {
  createPriceOracle as create1inchAggregator,
  PriceOracle as _1inchAggregator
} from './1ich-aggregator';
import {
  createPriceOracle as createCoinGecko,
  PriceOracle as CoinGecko
} from './coin-gecko';
import logger from '../logger';

const cache = new LRUCache<string, number>({
  max: 200,
  ttl: 5 * 60 * 1000, // 5 minutes,
  ttlAutopurge: false,
  allowStale: false,
  updateAgeOnGet: false,
  updateAgeOnHas: false
});

export class PriceOracle {
  private _1inchAggregator: _1inchAggregator;
  private coinGecko: CoinGecko;

  constructor(
    provider: JsonRpcProvider | WebSocketProvider,
    geckoTokenKey?: string
  ) {
    this.coinGecko = createCoinGecko(geckoTokenKey);
    this._1inchAggregator = create1inchAggregator(provider);
  }

  async getPrice(
    chainId: number,
    token: string,
    decimals: number,
    usdToEthPrice: number
  ): Promise<number | null> {
    const key = `${chainId}_${token}`;
    const value = cache.get(key);
    if (value) return value;
    let priceUSD: number | null = null;
    let priceRate: bigint = 0n;
    try {
      priceRate = await this._1inchAggregator(token, decimals);
    } catch (e: any) {
      logger.error(e.toString());
    }

    if (priceRate) {
      const priceETH = Number(formatUnits(priceRate, 18));
      priceUSD = priceETH * usdToEthPrice;
    }

    if (priceUSD && priceUSD <= 1) {
      cache.set(key, priceUSD);
      return priceUSD;
    }

    try {
      priceUSD = await this.coinGecko(chainId, token);
      if (priceUSD) cache.set(key, priceUSD);
    } catch (e: any) {
      logger.error(e.toString());
    }
    return priceUSD;
  }
}
