import {
  getAddress,
  JsonRpcProvider,
  TransactionReceipt,
  TransactionResponse,
  WebSocketProvider
} from 'ethers';
import { findSwapInTransactionReceipt } from '@tradezon/txswaps';
import type { TransactionSwap } from '@tradezon/txswaps/dist/types';

export async function getAllSwaps(
  wallet: string,
  etherscanApi: any,
  provider: JsonRpcProvider | WebSocketProvider,
  blockNumber: number
): Promise<TransactionSwap[] | null> {
  const response = await etherscanApi.account.txlist(
    wallet,
    blockNumber,
    'latest',
    1,
    4000
  );
  const txs = response.result;
  if (!txs || txs.length === 0) return null;

  const promises: Promise<null | [TransactionResponse, TransactionReceipt]>[] =
    [];
  for (const tx of txs) {
    if (tx.txreceipt_status !== '1') continue;
    if (
      !tx.functionName.startsWith('execute(') &&
      !tx.functionName.startsWith('swap')
    )
      continue;
    promises.push(
      new Promise(async (res) => {
        const ts = {
          hash: tx.hash,
          from: wallet,
          to: getAddress(tx.to),
          value: BigInt(tx.value)
        } as unknown as TransactionResponse;
        try {
          const receipt = await provider.getTransactionReceipt(tx.hash);
          if (!receipt) {
            res(null);
            return;
          }
          res([ts, receipt]);
        } catch {
          res(null);
        }
      })
    );
  }

  const swaps: TransactionSwap[] = [];
  for (const res of await Promise.all(promises)) {
    if (!res) continue;
    const [ts, tr] = res;
    const swap = findSwapInTransactionReceipt(ts, tr);
    if (swap) swaps.push(swap);
  }

  return swaps.length ? swaps : null;
}
