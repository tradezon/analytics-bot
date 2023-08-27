import { LRUCache } from 'lru-cache';
import type { JsonRpcProvider, WebSocketProvider } from 'ethers';
import { listen, Swap } from './listen';
import { createPrefixTrie } from './address-prefix-trie';

export interface Signal {
  token: string;
  userId: number;
  swaps: Swap[];
}

interface FollowTradesEngine {
  addAll(addresses: string[], id: number): void;
  add(address: string, id: number): void;
  remove(address: string, id: number): void;
}

export async function followTradesEngine(
  provider: JsonRpcProvider | WebSocketProvider,
  onSignal: (signal: Signal) => void
): Promise<FollowTradesEngine> {
  const signaled = new WeakSet<Swap>();
  const tradesCache = new LRUCache<string, Swap[]>({
    max: 4000,
    ttl: 7 * 24 * 60 * 60 * 1000, // 7 day,
    ttlAutopurge: true,
    allowStale: false,
    updateAgeOnGet: false,
    updateAgeOnHas: false
  });
  const trie = createPrefixTrie();
  const formSignalIfAny = (token: string, swaps: Swap[]) => {
    // no extra logic for now
    for (const swap of swaps) {
      if (signaled.has(swap)) continue;
      signaled.add(swap);
      for (const id of swap.ids) {
        onSignal({
          token,
          userId: id,
          swaps
        });
      }
    }
  };

  await listen(provider, trie, (swap) => {
    for (const token of swap.tokenOut) {
      const swaps = tradesCache.get(token);
      if (!swaps) {
        tradesCache.set(token, [swap]);
        formSignalIfAny(token, [swap]);
        continue;
      }

      swaps.push(swap);
      formSignalIfAny(token, swaps);
    }
  });

  return {
    addAll(addresses: string[], id: number) {
      for (const address of addresses) {
        trie.add(address, id);
      }
    },
    add(address: string, id: number) {
      trie.add(address, id);
    },
    remove(address: string, id: number) {
      trie.remove(address, id);
    }
  };
}
