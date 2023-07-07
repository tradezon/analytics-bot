import type { WebSocketProvider, JsonRpcProvider } from 'ethers';

export async function isContract(
  addr: string,
  provider: WebSocketProvider | JsonRpcProvider
) {
  try {
    const code = await provider.getCode(addr);
    if (code !== '0x') return true;
  } catch {}
  return false;
}
