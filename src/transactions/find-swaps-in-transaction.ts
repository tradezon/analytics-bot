import { AbiCoder, getAddress, zeroPadValue } from 'ethers';
import type { TransactionReceipt, TransactionResponse, Log } from 'ethers';
import logger from '../logger';
import { retry } from '../utils/promise-retry';
import { ratelimit } from '../utils/promise-ratelimit';

export interface TransactionSwap {
  wallet: string;
  fee: bigint;
  tokenIn: string[];
  tokenOut: string[];
  amountIn: bigint[];
  amountOut: bigint[];
}

const TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const abiCoder = AbiCoder.defaultAbiCoder();

const UNISWAP_ROUTERS = new Set([
  '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
  '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD',
  '0xE592427A0AEce92De3Edee1F18E0157C05861564',
  '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45'
]);

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
    limit: 3,
    delayMs: 1_000
  }),
  { limit: 4, delayMs: 1_000 }
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

export async function findSwapsInTransaction(
  transaction: TransactionResponse,
  receipt: TransactionReceipt,
  etherscanApi: any
): Promise<TransactionSwap | null> {
  if (!transaction.to) return null;
  if (
    UNISWAP_ROUTERS.has(transaction.to) ||
    UNISWAP_ROUTERS.has(transaction.from)
  )
    return findUniswapsInTransaction(transaction, receipt);
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

  if (swap.tokenIn.length === 0) return null;

  let ethers = 0n;

  try {
    ethers = await getTransferredEtherWithRetry(
      etherscanApi,
      getAddress(transaction.from),
      transaction.hash
    );
    logger.trace(`Got ${ethers} wei txhash=${transaction.hash}`);
  } catch (e) {
    logger.error(e);
  }

  if (ethers > 0n) {
    let i = swap.tokenOut.findIndex((t) => t === WETH_ADDRESS);
    if (i > -1) {
      swap.amountOut[i] += ethers;
    } else {
      swap.tokenOut.push(WETH_ADDRESS);
      swap.amountOut.push(ethers);
    }
  }

  if (swap.tokenOut.length === 0) return null;

  return swap;
}
