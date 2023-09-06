import {
  AbiCoder,
  getAddress,
  JsonRpcProvider,
  WebSocketProvider,
  zeroPadValue
} from 'ethers';
import type { TransactionReceipt, TransactionResponse, Log } from 'ethers';
import logger from '../logger';

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

const alchemyProvider = new JsonRpcProvider(
  'https://eth-mainnet.g.alchemy.com/v2/Xd1fcc8Vtvp_5ZbACZnFt09fL6vJgIus',
  'mainnet',
  { batchMaxCount: 1 }
);
const isProd = process.env.NODE_ENV !== 'development';

function getAmount(log: Log): bigint {
  const data = log.topics.length > 3 ? log.topics[3] : log.data;
  return abiCoder.decode(['uint256'], data)[0];
}

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

export async function findSwapsInTransactionFollowTrades(
  transaction: TransactionResponse,
  receipt: TransactionReceipt,
  provider: JsonRpcProvider | WebSocketProvider
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

  if (inOut.size === 0) return null;

  const swap: TransactionSwap = {
    fee: receipt.fee,
    wallet: transaction.from,
    tokenIn: [],
    tokenOut: [],
    amountIn: [],
    amountOut: []
  };

  const result = inOutToTokens(inOut);
  swap.tokenIn = result[0];
  swap.tokenOut = result[2];
  swap.amountOut = result[3];
  swap.amountIn = result[1];

  if (swap.tokenIn.length === 0) return null;

  let ethers = 0n;

  try {
    const result = await (isProd ? provider : alchemyProvider).send(
      'debug_traceTransaction',
      [
        transaction.hash,
        {
          tracer: 'callTracer'
        }
      ]
    );
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

  return swap;
}
