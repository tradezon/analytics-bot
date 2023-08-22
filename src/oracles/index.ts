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
} from './dex-guru';
import logger from '../logger';

const cache = new LRUCache<string, number>({
  max: 1000,
  ttl: 30 * 60 * 1000, // 30 minutes,
  ttlAutopurge: false,
  allowStale: false,
  updateAgeOnGet: false,
  updateAgeOnHas: false
});

export class PriceOracle {
  private _1inchAggregator: _1inchAggregator;
  private dexguru?: CoinGecko;

  constructor(
    provider: JsonRpcProvider | WebSocketProvider,
    dexguruToken?: string
  ) {
    this.dexguru = dexguruToken ? createCoinGecko(dexguruToken) : undefined;
    this._1inchAggregator = create1inchAggregator(provider);
  }

  async getPriceUSD(
    chainId: number,
    token: string,
    decimals: number,
    tokenBalance: number,
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

    // TODO Should use liquidity to determine which check to perform
    if (priceUSD && priceUSD <= 1 && tokenBalance * priceUSD < 10_000) {
      cache.set(key, priceUSD);
      return priceUSD;
    }

    if (this.dexguru) {
      try {
        priceUSD = await this.dexguru(chainId, token);
        if (priceUSD) cache.set(key, priceUSD);
      } catch (e: any) {
        logger.error(e.toString());
      }
    }
    return priceUSD;
  }
}
