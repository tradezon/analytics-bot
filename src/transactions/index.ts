import {
  getAddress,
  JsonRpcProvider,
  TransactionReceipt,
  TransactionResponse,
  WebSocketProvider
} from 'ethers';
import { findSwapInTransactionReceipt } from '@tradezon/txswaps';
import type { TransactionSwap } from '@tradezon/txswaps/dist/types';
import { retry } from '../utils/promise-retry';

const AVERAGE_ETH_BLOCKTIME_SECONDS = 12;
const blocksIn2Week = Math.ceil(
  (2 * 7 * 24 * 60 * 60) / AVERAGE_ETH_BLOCKTIME_SECONDS
);
const MAX_BLOCKS_FOR_STATS = blocksIn2Week * 7;
const MIN_POSSIBLE_SWAPS = 250;

export interface AllSwaps {
  swaps: TransactionSwap[];
  fees: number;
  start: number;
}

async function loadAllAccountTransactions(
  etherscanApi: any,
  wallet: string,
  blockStart: number,
  blockEnd?: number
) {
  try {
    const response = await etherscanApi.account.txlist(
      wallet,
      blockStart,
      blockEnd || 'latest',
      1,
      3999
    );
    return response.result;
  } catch (e: any) {
    if (e.toString() !== 'No transactions found') {
      throw e;
    } else {
      return [];
    }
  }
}

const txListWithRetry = retry(loadAllAccountTransactions, {
  limit: 5,
  delayMs: 2_000
});

export async function getAllSwaps(
  wallet: string,
  etherscanApi: any,
  provider: JsonRpcProvider | WebSocketProvider,
  blockStart: number,
  blockEnd?: number
): Promise<AllSwaps | null> {
  let txs: Array<any>;
  try {
    txs = await txListWithRetry(etherscanApi, wallet, blockStart, blockEnd);
  } catch (e: any) {
    console.log(e.message || e.toString());
    console.log(e.stack);
    return null;
  }
  if (!txs) return null;

  const promises: Promise<
    null | [TransactionResponse, TransactionReceipt, number]
  >[] = [];

  let approves = 0;
  const filteredTx = [];
  for (const tx of txs) {
    if (tx.txreceipt_status !== '1' || tx.methodId === '0x') continue;
    if (tx.functionName.startsWith('approve(')) {
      approves++;
      continue;
    }
    filteredTx.push(tx);
  }

  if (!blockEnd) {
    const latestBlock = await provider.getBlock('latest');
    if (!latestBlock) return null;

    // find more transactions if needed for statistic space
    // TODO optimize this, fetch only new blocks
    if (
      latestBlock.number - MAX_BLOCKS_FOR_STATS < blockStart &&
      filteredTx.length < MIN_POSSIBLE_SWAPS
    ) {
      // dig in a week
      return getAllSwaps(
        wallet,
        etherscanApi,
        provider,
        blockStart - blocksIn2Week
      );
    }
  }

  for (const tx of filteredTx) {
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
          res([ts, receipt, Number(tx.timeStamp) * 1000]);
        } catch {
          res(null);
        }
      })
    );
  }

  let start: number = 0;
  const swaps: TransactionSwap[] = [];
  for (const res of await Promise.all(promises)) {
    if (!res) continue;
    const [ts, tr, timestamp] = res;
    const swap = findSwapInTransactionReceipt(ts, tr);
    if (swap) {
      start = start ? Math.min(timestamp, start) : timestamp;
      swaps.push(swap);
    }
  }

  return { start: start!, fees: approves * 3, swaps };
}
