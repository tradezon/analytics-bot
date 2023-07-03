import { Contract, JsonRpcProvider, WebSocketProvider } from 'ethers';
import erc20Abi from '../abi/erc20.json';
import logger, { formatLog } from '../logger';

export async function getErc20TokenBalance(
  token: string,
  address: string,
  provider: WebSocketProvider | JsonRpcProvider
): Promise<bigint | null> {
  const contract = new Contract(token, erc20Abi, { provider });
  try {
    return await contract.balanceOf(address);
  } catch (e: any) {
    logger.warn(
      formatLog({ token, address, message: e.message || e.toString() })
    );
  }
  return null;
}
