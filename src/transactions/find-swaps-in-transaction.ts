import {
  AbiCoder,
  getAddress,
  JsonRpcProvider,
  WebSocketProvider,
  zeroPadValue
} from 'ethers';
import type { TransactionReceipt, TransactionResponse, Log } from 'ethers';
import logger from '../logger';
import { ratelimit } from '../utils/promise-ratelimit';
import { retry } from '../utils/promise-retry';
import { findSwappedToken } from './find-swapped-token';

export interface TransactionSwap {
  wallet: string;
  fee: bigint;
  tokenIn: string[];
  tokenOut: string[];
  amountIn: bigint[];
  amountOut: bigint[];
}

const EMPTY_ARR = [] as any[];

const TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const abiCoder = AbiCoder.defaultAbiCoder();

const UNISWAP_ROUTERS = new Set([
  '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
  '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD'
]);
const alchemyProvider = new JsonRpcProvider(
  'https://eth-mainnet.g.alchemy.com/v2/Xd1fcc8Vtvp_5ZbACZnFt09fL6vJgIus',
  'mainnet',
  { batchMaxCount: 1 }
);

function inOutToTokens(
  inOut: Map<string, { in: bigint; out: bigint }>
): [
  tokenIn: string[],
  amountIn: bigint[],
  tokenOut: string[],
  amountOut: bigint[]
] {
  const tokenOut: string[] = [];
  const tokenIn: string[] = [];
  const amountIn: bigint[] = [];
  const amountOut: bigint[] = [];
  for (const [key, value] of inOut) {
    if (value.out > value.in) {
      tokenOut.push(key);
      amountOut.push(value.out - value.in);
    } else {
      tokenIn.push(key);
      amountIn.push(value.in - value.out);
    }
  }

  return [tokenIn, amountIn, tokenOut, amountOut];
}

function getAmount(log: Log): bigint {
  const data = log.topics.length > 3 ? log.topics[3] : log.data;
  return abiCoder.decode(['uint256'], data)[0];
}

async function getTransferredEther(
  etherscanApi: any,
  wallet: string,
  txhash: string
): Promise<bigint> {
  let internalTxs: any;
  try {
    internalTxs = await etherscanApi.account.txlistinternal(txhash);
  } catch (e: any) {
    if (e.toString() !== 'No transactions found') {
      throw e;
    } else {
      return 0n;
    }
  }
  let value = 0n;
  for (const tx of internalTxs.result) {
    if (tx.isError === '0' && getAddress(tx.to) === wallet) {
      value += BigInt(tx.value);
    }
  }
  return value;
}

const getTransferredEtherWithRetry = ratelimit(
  retry(getTransferredEther, {
    limit: 5,
    delayMs: 150
  }),
  { limit: 8, delayMs: 1_000 }
);

function findUniswapsInTransaction(
  transaction: TransactionResponse,
  receipt: TransactionReceipt
) {
  const inOut = new Map<string, { in: bigint; out: bigint }>();
  const wallet = zeroPadValue(transaction.from, 32);
  const routerAddress = zeroPadValue(transaction.to!, 32);
  if (transaction.value > 0n)
    inOut.set(WETH_ADDRESS, { in: transaction.value, out: 0n });
  let wasTransfer = false;
  for (const log of receipt) {
    if (log.topics[0] !== TRANSFER_TOPIC) continue;
    if (log.topics[1] === wallet) {
      // from wallet
      let entry = inOut.get(log.address);
      wasTransfer = true;
      if (!entry) {
        entry = { in: 0n, out: 0n };
        inOut.set(log.address, entry);
      }
      entry.in += getAmount(log);
    } else if (log.topics[2] === wallet) {
      // to address
      let entry = inOut.get(log.address);
      wasTransfer = true;
      if (!entry) {
        entry = { in: 0n, out: 0n };
        inOut.set(log.address, entry);
      }
      entry.out += getAmount(log);
    } else if (
      wasTransfer &&
      log.topics[1] !== log.topics[2] &&
      log.topics[2] === routerAddress &&
      log.address === WETH_ADDRESS
    ) {
      // transfer WETH to router. it happens only after swap to unwrap and safeTransferETH to recipient
      let entry = inOut.get(WETH_ADDRESS);
      if (!entry) {
        entry = { in: 0n, out: 0n };
        inOut.set(log.address, entry);
      }
      entry.out += getAmount(log);
      wasTransfer = false;
    }
  }

  logger.trace(
    `txhash=${transaction.hash}`,
    `found ${inOut.size} tokens transfers`
  );

  if (inOut.size === 0) return null;

  const swap: TransactionSwap = {
    fee: receipt.fee,
    wallet: transaction.from,
    tokenIn: [],
    tokenOut: [],
    amountIn: [],
    amountOut: []
  };

  for (const [key, value] of inOut) {
    if (value.out > value.in) {
      swap.tokenOut.push(key);
      swap.amountOut.push(value.out - value.in);
    } else {
      swap.tokenIn.push(key);
      swap.amountIn.push(value.in - value.out);
    }
  }

  if (swap.tokenIn.length === 0 || swap.tokenOut.length === 0) return null;

  return swap;
}

async function checkMultiswap(
  swap: TransactionSwap,
  receipt: TransactionReceipt,
  provider: JsonRpcProvider | WebSocketProvider
) {
  const swappedTokens = await findSwappedToken(receipt, provider);
  if (swappedTokens) {
    if (swap.tokenIn.length > 1) {
      const tokensSet = new Set(swap.tokenIn);
      for (const t of swap.tokenIn)
        if (!swappedTokens.has(t)) tokensSet.delete(t);
      swap.tokenIn = Array.from(tokensSet);
    }
    if (swap.tokenOut.length > 1) {
      const tokensSet = new Set(swap.tokenOut);
      for (const t of swap.tokenOut)
        if (!swappedTokens.has(t)) tokensSet.delete(t);
      swap.tokenOut = Array.from(tokensSet);
    }

    if (swap.tokenIn.length === 0) return null;
    if (swap.tokenOut.length === 0) return null;
  }
  return swap;
}

export async function findSwapsInTransaction(
  transaction: TransactionResponse,
  receipt: TransactionReceipt,
  provider: JsonRpcProvider | WebSocketProvider,
  etherscanApi?: any
): Promise<TransactionSwap | null> {
  if (!transaction.to) return null;
  if (
    UNISWAP_ROUTERS.has(transaction.to) ||
    UNISWAP_ROUTERS.has(transaction.from)
  ) {
    const swap = await findUniswapsInTransaction(transaction, receipt);
    if (!swap) return null;
    if (swap.tokenIn.length > 1 || swap.tokenOut.length > 1) {
      return checkMultiswap(swap, receipt, provider);
    }
    return swap;
  }
  const inOut = new Map<string, { in: bigint; out: bigint }>();
  const wallet = zeroPadValue(transaction.from, 32);
  if (transaction.value > 0n)
    inOut.set(WETH_ADDRESS, { in: transaction.value, out: 0n });
  for (const log of receipt) {
    if (log.topics[0] !== TRANSFER_TOPIC) continue;
    if (log.topics[1] === wallet) {
      // from wallet
      let entry = inOut.get(log.address);
      if (!entry) {
        entry = { in: 0n, out: 0n };
        inOut.set(log.address, entry);
      }
      entry.in += getAmount(log);
    } else if (log.topics[2] === wallet) {
      // to address
      let entry = inOut.get(log.address);
      if (!entry) {
        entry = { in: 0n, out: 0n };
        inOut.set(log.address, entry);
      }
      entry.out += getAmount(log);
    }
  }

  logger.trace(
    `txhash=${transaction.hash}`,
    `found ${inOut.size} tokens transfers`
  );

  if (inOut.size === 0) return null;

  const swap: TransactionSwap = {
    fee: receipt.fee,
    wallet: transaction.from,
    tokenIn: EMPTY_ARR,
    tokenOut: EMPTY_ARR,
    amountIn: EMPTY_ARR,
    amountOut: EMPTY_ARR
  };

  const result = inOutToTokens(inOut);
  swap.tokenIn = result[0];
  swap.tokenOut = result[2];
  swap.amountOut = result[3];
  swap.amountIn = result[1];

  if (swap.tokenIn.length === 0) return null;

  let ethers = 0n;

  try {
    const result = await alchemyProvider.send('debug_traceTransaction', [
      transaction.hash,
      {
        tracer: 'callTracer'
      }
    ]);
    if (!result || !result.calls) return null;
    const toVisit = result.calls;
    for (let i = 0; i < toVisit.length; i++) {
      const call = toVisit[i];
      if (call.calls) {
        for (const innerCall of call.calls) toVisit.push(innerCall);
      }
      if (call.type !== 'CALL') continue;
      if (call.value === '0x0') continue;
      if (getAddress(call.to) !== transaction.from) continue;
      ethers += BigInt(call.value);
    }
  } catch (e: any) {
    logger.error(e);
    try {
      ethers = await getTransferredEtherWithRetry(
        etherscanApi,
        getAddress(transaction.from),
        transaction.hash
      );
    } catch {}
  }

  if (ethers > 0n) {
    const entry = inOut.get(WETH_ADDRESS);
    if (entry) {
      entry.out += ethers;
    } else {
      inOut.set(WETH_ADDRESS, { in: 0n, out: ethers });
    }

    const result = inOutToTokens(inOut);
    swap.tokenIn = result[0];
    swap.tokenOut = result[2];
    swap.amountOut = result[3];
    swap.amountIn = result[1];
  }

  if (swap.tokenOut.length === 0) return null;
  if (swap.tokenIn.length > 1 || swap.tokenOut.length > 1) {
    return checkMultiswap(swap, receipt, provider);
  }

  return swap;
}
