import Axios, { AxiosError, CreateAxiosDefaults, isAxiosError } from 'axios';
import logger from '../logger';
import chains from './chains.json';
import { retry } from '../utils/promise-retry';

export type PriceOracle = (
  chainId: number,
  token: string
) => Promise<number | null>;

export function createPriceOracle(apiKey?: string) {
  const ids = new Map<number, string>();
  for (const data of chains) {
    if (data.chain_identifier !== null) {
      ids.set(data.chain_identifier, data.id);
    }
  }
  const axios = Axios.create({
    baseURL: 'https://pro-api.coingecko.com/api/v3'
  } as CreateAxiosDefaults);
  const getData = (id: string, token: string) =>
    axios.get(`/simple/token_price/${id}`, {
      params: {
        contract_addresses: token,
        vs_currencies: 'usd',
        x_cg_pro_api_key: apiKey
      }
    });
  const getDataWithRetry = retry(getData, { limit: 3, delayMs: 1_050 });
  return async (chainId: number, token: string) => {
    const id = ids.get(chainId);
    if (!id) return null;
    try {
      const response = await getDataWithRetry(id, token);
      if (!response.data) throw new Error('No coin gecko data');
      const values = Object.values(response.data);
      if (values.length === 0) {
        logger.trace(`Price for ${token} was not observed`);
        return null;
      }
      const { usd } = values[0] as any;
      return usd === undefined ? null : usd;
    } catch (e: AxiosError | any) {
      if (isAxiosError(e) && e.response) {
        if (e.response.status === 429) {
          logger.warn('rate limit reached for coin gecko api');
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
