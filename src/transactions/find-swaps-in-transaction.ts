import { AbiCoder, getAddress, zeroPadValue } from 'ethers';
import type { TransactionReceipt, TransactionResponse, Log } from 'ethers';
import logger from '../logger';
import { retry } from '../utils/promise-retry';

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

function getAmount(log: Log): bigint {
  const data = log.topics.length > 3 ? log.topics[3] : log.data;
  return abiCoder.decode(['uint256'], data)[0];
}

async function getTransferredEther(
  etherscanApi: any,
  wallet: string,
  txhash: string
): Promise<bigint> {
  try {
    const internalTxs = await etherscanApi.account.txlistinternal(txhash);
    let value = 0n;
    for (const tx of internalTxs.result) {
      if (tx.isError === '0' && getAddress(tx.to) === wallet) {
        value += BigInt(tx.value);
      }
    }
    return value;
  } catch (e: any) {
    logger.error(e);
    return 0n;
  }
}

const getTransferredEtherWithRetry = retry(getTransferredEther, {
  limit: 5,
  delayMs: 1_000
});

export async function findSwapsInTransaction(
  transaction: TransactionResponse,
  receipt: TransactionReceipt,
  etherscanApi: any
): Promise<TransactionSwap | null> {
  if (!transaction.to) return null;
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

  const ether = await getTransferredEtherWithRetry(
    etherscanApi,
    getAddress(transaction.from),
    transaction.hash
  );

  if (ether > 0n) {
    let i = swap.tokenOut.findIndex((t) => t === WETH_ADDRESS);
    if (i > -1) {
      swap.amountOut[i] += ether;
    } else {
      swap.tokenOut.push(WETH_ADDRESS);
      swap.amountOut.push(ether);
    }
  }

  if (swap.tokenOut.length === 0) return null;

  return swap;
}
