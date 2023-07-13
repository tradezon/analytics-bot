import {
  getAddress,
  JsonRpcProvider,
  TransactionReceipt,
  TransactionResponse,
  WebSocketProvider
} from 'ethers';
import { retry } from '../utils/promise-retry';
import logger from '../logger';
import {
  findSwapsInTransaction,
  TransactionSwap
} from './find-swaps-in-transaction';
import { isContract } from './is-contract';
import invariant from 'invariant';

const AVERAGE_ETH_BLOCKTIME_SECONDS = 12;
const blocksIn2Weeks = Math.ceil(
  (2 * 7 * 24 * 60 * 60) / AVERAGE_ETH_BLOCKTIME_SECONDS
);
const blocksIn3Weeks = Math.ceil(
  (3 * 7 * 24 * 60 * 60) / AVERAGE_ETH_BLOCKTIME_SECONDS
);
const MAX_BLOCKS_FOR_STATS = blocksIn2Weeks * 7;
const MIN_POSSIBLE_SWAPS = 201;

interface Swap extends TransactionSwap {
  index: number;
}

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
  blockEnd?: number,
  maxSwaps?: number
): Promise<AllSwaps | null> {
  invariant(
    !maxSwaps || blockEnd !== undefined,
    'max swaps could work only with fix range'
  );
  let txs: Array<any>;
  try {
    txs = await txListWithRetry(etherscanApi, wallet, blockStart, blockEnd);
  } catch (e: any) {
    logger.error(e);
    return null;
  }
  if (!txs) return null;

  const promises: Promise<void>[] = [];

  let approves = 0;
  const filteredTx = [];
  for (const tx of txs) {
    if (tx.txreceipt_status !== '1' || tx.methodId === '0x') continue;
    if (tx.functionName.startsWith('approve(')) {
      approves++;
      continue;
    }
    if (!tx.to) continue;
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
      const newStart = blockStart - blocksIn3Weeks;
      logger.debug(
        `Increasing swaps range for ${wallet} from ${blockStart} to ${newStart}`
      );
      // dig in a week
      return getAllSwaps(wallet, etherscanApi, provider, newStart);
    }
  }

  if (maxSwaps && filteredTx.length > maxSwaps) return null;

  let start: number = 0;
  const swaps: Swap[] = [];

  for (let i = 0; i < filteredTx.length; i++) {
    const tx = filteredTx[i];
    promises.push(
      new Promise(async (res) => {
        const to = getAddress(tx.to);
        /* check is target a contract */
        if (tx.functionName === '' && !(await isContract(to, provider))) {
          res();
          return;
        }

        const ts = {
          hash: tx.hash,
          from: wallet,
          to,
          value: BigInt(tx.value)
        } as unknown as TransactionResponse;
        try {
          const receipt = await provider.getTransactionReceipt(tx.hash);
          if (!receipt) {
            res();
            return;
          }
          const timestamp = Number(tx.timeStamp) * 1000;
          logger.trace(`Finding swap for ${ts.hash}`);
          const swap = await findSwapsInTransaction(ts, receipt, etherscanApi);
          if (swap) {
            start = start ? Math.min(timestamp, start) : timestamp;
            (swap as any).index = i;
            swaps.push(swap as any);
          }
          res();
        } catch {
          res();
        }
      })
    );
  }

  await Promise.all(promises);

  return {
    start: start!,
    fees: approves * 3,
    swaps: swaps.sort((a, b) => a.index - b.index)
  };
}
