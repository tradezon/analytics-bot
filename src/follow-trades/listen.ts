import {
  JsonRpcProvider,
  TransactionReceipt,
  TransactionResponse,
  WebSocketProvider
} from 'ethers';
import { STABLES } from './const';
import logger from '../logger';
import { Trie } from './address-prefix-trie';
import { findSwapsInTransactionFollowTrades } from './find-swaps-in-transaction';

export interface Swap {
  wallet: string;
  ids: number[];
  tokenIn: string;
  tokenOut: string[];
  amountIn: bigint;
  amountOut: bigint[];
}

export async function listen(
  provider: JsonRpcProvider | WebSocketProvider,
  trie: Trie,
  onSwap: (swap: Swap) => void
) {
  const processTransaction = async (txhash: string): Promise<void> => {
    const [tx, receipt]: [
      TransactionResponse | null,
      TransactionReceipt | null
    ] = await Promise.all([
      provider.getTransaction(txhash),
      provider.getTransactionReceipt(txhash)
    ]);
    if (!receipt || !tx || !tx.to || !tx.blockNumber) return;
    if (receipt.logs.length < 3) return;
    const ids = trie.get(tx.from);
    if (ids.length === 0) return;
    const swap = await findSwapsInTransactionFollowTrades(
      tx,
      receipt,
      provider
    );
    if (!swap || swap.tokenIn.length > 1) return;
    const tokenIn = swap.tokenIn[0];
    const tokenOut = swap.tokenOut[0];
    const amountIn = swap.amountIn[0];
    // if token in is not stable/weth or token out is stable/weth skip it
    if (!STABLES.has(tokenIn) || STABLES.has(tokenOut)) return;
    onSwap({
      wallet: tx.from,
      ids,
      tokenIn,
      tokenOut: swap.tokenOut,
      amountIn,
      amountOut: swap.amountOut
    });
  };

  return provider.on('block', async (blockNumber: number) => {
    const block = await provider.getBlock(blockNumber);
    if (!block) return;

    const now = Date.now();
    const promises: Promise<any>[] = [];

    for (const txhash of block.transactions)
      promises.push(processTransaction(txhash));
    await Promise.all(promises);
    const end = Date.now();
    let mseconds = end - now;
    const seconds = Math.floor(mseconds / 1000);
    mseconds %= 1000;
    logger.info(
      `Elapsed time for block=${blockNumber} ${seconds}s ${mseconds}ms`
    );
  });
}
