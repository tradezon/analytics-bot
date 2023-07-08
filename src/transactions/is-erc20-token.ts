import { Contract } from 'ethers';
import type { WebSocketProvider, JsonRpcProvider } from 'ethers';
import abi from '../abi/erc20.json';

export async function isErc20Token(
  addr: string,
  provider: WebSocketProvider | JsonRpcProvider
) {
  try {
    const contract = new Contract(addr, abi, { provider });
    await contract.totalSupply();
    return true;
  } catch {}
  return false;
}
