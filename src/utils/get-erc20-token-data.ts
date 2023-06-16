import { Contract, JsonRpcProvider, WebSocketProvider } from 'ethers';
import erc20Abi from '../abi/erc20.json';

export interface TokenData {
  token: string;
  symbol: string;
  decimals: number;
}

export async function getErc20TokenData(
  token: string,
  provider: WebSocketProvider | JsonRpcProvider
): Promise<TokenData> {
  const contract = new Contract(token, erc20Abi, { provider });
  const [symbol, decimals]: [string, number] = await Promise.all([
    contract.symbol(),
    contract.decimals()
  ]);
  return { token, symbol, decimals: Number(decimals) };
}
