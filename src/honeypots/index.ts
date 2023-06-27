import Axios, { CreateAxiosDefaults } from 'axios';
import { LRUCache } from 'lru-cache';
import { retry } from '../utils/promise-retry';

export enum HoneypotResult {
  UNKNOWN = -1,
  NOT_A_HONEYPOT,
  HONEYPOT,
  LOW_LIQUIDITY
}

const cache = new LRUCache<string, [number, boolean]>({
  max: 400,
  ttl: 24 * 60 * 60 * 1000, // 1 day,
  ttlAutopurge: true,
  allowStale: false,
  updateAgeOnGet: true,
  updateAgeOnHas: false
});

const axios = Axios.create({
  baseURL: 'https://api.honeypot.is'
} as CreateAxiosDefaults);

// /v1/GetPairs?address=0x8da0e5b872aecc1d53633f540ae49a51d59007c9&chainID=1

const retryGet = retry(axios.get.bind(axios), { limit: 3, delayMs: 3000 });

export async function isHoneypot(
  token: string,
  minLiquidity: number
): Promise<HoneypotResult> {
  const entry = cache.get(token);
  if (entry) {
    if (!entry[1]) {
      return entry[0] >= minLiquidity
        ? HoneypotResult.NOT_A_HONEYPOT
        : HoneypotResult.LOW_LIQUIDITY;
    } else {
      return HoneypotResult.HONEYPOT;
    }
  }

  try {
    const response = await retryGet(`/v2/IsHoneypot?address=${token}`);
    if (!response.data) return HoneypotResult.UNKNOWN;
    const data = response.data;
    if (data.honeypotResult?.isHoneypot || data.simulationSuccess === false) {
      return HoneypotResult.HONEYPOT;
    }
    if (data.pair.liquidity < minLiquidity) {
      return HoneypotResult.LOW_LIQUIDITY;
    }
    return HoneypotResult.NOT_A_HONEYPOT;
  } catch (e: any) {
    console.log(e.message);
    return HoneypotResult.UNKNOWN;
  }
}
