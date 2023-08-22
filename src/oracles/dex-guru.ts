import Axios, { AxiosError, CreateAxiosDefaults, isAxiosError } from 'axios';
import logger from '../logger';
import { retry } from '../utils/promise-retry';

export type PriceOracle = (
  chainId: number,
  token: string
) => Promise<number | null>;

export function createPriceOracle(apiKey: string) {
  const axios = Axios.create({
    baseURL: 'https://api.dev.dex.guru',
    headers: {
      'api-key': apiKey,
      accept: 'application/json'
    }
  } as CreateAxiosDefaults);
  const getData = (id: number, token: string) =>
    axios.get(`/v1/chain/${id}/tokens/${token}/market`);
  const getDataWithRetry = retry(getData, { limit: 3, delayMs: 1_050 });
  return async (chainId: number, token: string) => {
    try {
      const response = await getDataWithRetry(chainId, token);
      if (!response.data) throw new Error('No dex guru data');
      return response.data.price_usd || null;
    } catch (e: AxiosError | any) {
      if (isAxiosError(e) && e.response) {
        if (e.response.status === 429) {
          logger.warn('rate limit reached for dex guru');
        } else if (e.response.data) {
          logger.warn(JSON.stringify(e.response.data));
        } else {
          logger.warn(e.toString());
        }
      } else {
        logger.warn(e.toString());
      }
      return null;
    }
  };
}
