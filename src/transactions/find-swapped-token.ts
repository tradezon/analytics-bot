import {
  JsonRpcProvider,
  Log,
  TransactionReceipt,
  WebSocketProvider,
  Contract
} from 'ethers';
import uniswapV2PairAbi from '../abi/uniswapV2-pair.json';

type Provider = JsonRpcProvider | WebSocketProvider;

const UNISWAPV2_SWAP =
  '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822';
const UNISWAPV3_SWAP =
  '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67';

const cache = new Map<string, [string, string]>();

const findTokensForUniswap =
  (provider: Provider, onError: () => void) =>
  async (pair: string): Promise<[string, string] | null> => {
    const contract = new Contract(pair, uniswapV2PairAbi, { provider });
    try {
      return Promise.all([contract.token0(), contract.token1()]);
    } catch {
      onError();
      return null;
    }
  };

const createPairHandler =
  (
    addresses: Set<string>,
    tokens: Set<string>,
    handler: (addr: string) => Promise<[string, string] | null>
  ) =>
  async (log: Log) => {
    const addr = log.address;

    const entry = cache.get(addr);
    if (entry) {
      tokens.add(entry[0]);
      tokens.add(entry[1]);
      return;
    }

    if (addresses.has(addr)) return;
    addresses.add(addr);

    const pairTokens = await handler(addr);

    if (pairTokens) {
      cache.set(addr, pairTokens);
      tokens.add(pairTokens[0]);
      tokens.add(pairTokens[1]);
    }
  };

export async function findSwappedToken(
  receipt: TransactionReceipt,
  provider: Provider
): Promise<Set<string> | null> {
  const addresses = new Set<string>();
  const tokens = new Set<string>();
  const promises: Promise<void>[] = [];
  let error = false;
  const uniswap = createPairHandler(
    addresses,
    tokens,
    findTokensForUniswap(provider, () => {
      error = true;
    })
  );
  for (const log of receipt.logs) {
    switch (log.topics[0]) {
      case UNISWAPV2_SWAP: {
        promises.push(uniswap(log));
        break;
      }
      case UNISWAPV3_SWAP: {
        promises.push(uniswap(log));
        break;
      }
      default:
        break;
    }
  }

  await Promise.all(promises);

  if (error) return null;

  return tokens;
}
