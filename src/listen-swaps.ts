// @ts-expect-error
import EtherscanApi from 'etherscan-api';
import {
  formatUnits,
  JsonRpcProvider,
  parseEther,
  TransactionReceipt,
  TransactionResponse,
  WebSocketProvider
} from 'ethers';
import { readConfig } from './config';
import path from 'path';
import logger, { LogLevel } from './logger';
import { AnalyticsEngine } from './analytics';
import { getAllSwaps } from './transactions';
import { Report } from './types';
import { AMOUNT_OF_TOKENS, PNL2_USD } from './utils/const';
import { findSwapsInTransaction } from './transactions/find-swaps-in-transaction';
import {
  DAI_ADDRESS,
  STABLES,
  USDC_ADDRESS,
  USDT_ADDRESS,
  WETH_ADDRESS
} from './analytics/const';
import { sendMessage } from './utils/telegram-send-message';
import { header } from './utils/telegram';
import { LRUCache } from 'lru-cache';
import { isContract } from './transactions/is-contract';

const AVERAGE_ETH_BLOCKTIME_SECONDS = 12;
const _10Days = 10 * 24 * 60 * 60;
const blocksIn10Days = Math.ceil(_10Days / AVERAGE_ETH_BLOCKTIME_SECONDS);

const cache = new LRUCache<string, Report>({
  max: 4000,
  ttl: 24 * 60 * 60 * 1000, // 1 day,
  ttlAutopurge: false,
  allowStale: false,
  updateAgeOnGet: false,
  updateAgeOnHas: false
});

const SETTINGS = {
  MIN_ETH: parseEther('2'),
  MIN_USD: 3500,
  MAX_AMOUNT_OF_TOKENS: 50,
  BLOCKS: blocksIn10Days,
  MIN_PNL: 4900
};

const pnl2FromReport = (report: Report): number | null => {
  const i = report.metrics.indexOf(PNL2_USD);
  if (i > -1) return report.metricValues[i];
  return null;
};

const amountOfTokensReport = (report: Report): number | null => {
  const i = report.metrics.indexOf(AMOUNT_OF_TOKENS);
  if (i > -1) return report.metricValues[i];
  return null;
};

const getInputUSD = (amount: bigint, token: string) => {
  switch (token) {
    case DAI_ADDRESS:
      return Number(formatUnits(amount, 18));
    case USDC_ADDRESS:
    case USDT_ADDRESS:
      return Number(formatUnits(amount, 6));
    default:
      return 0;
  }
};

async function main() {
  const config = await readConfig(
    process.argv[2] || path.resolve(__dirname, 'config.json')
  );
  const provider = config.etherium_mainnet.match(/^https?\:/)
    ? new JsonRpcProvider(config.etherium_mainnet, 'mainnet', {
        batchStallTime: 80
      })
    : new WebSocketProvider(config.etherium_mainnet);
  const etherscanApi = EtherscanApi.init('QMW2MPMAM4T9HWH3STPPK836GRWQX1QW3Q');
  const analyticEngine = new AnalyticsEngine(
    provider,
    config.gecko,
    async () => {
      const { result } = await etherscanApi.stats.ethprice();
      return result.ethusd;
    }
  );
  logger.level = LogLevel.debug;
  const onFly = new Set<string>();

  const processTransaction = async (txhash: string, timestamp: number) => {
    const [tx, receipt]: [
      TransactionResponse | null,
      TransactionReceipt | null
    ] = await Promise.all([
      provider.getTransaction(txhash),
      provider.getTransactionReceipt(txhash)
    ]);
    if (!receipt || !tx || !tx.blockNumber) return;
    if (receipt.logs.length < 3) return;
    if (await isContract(tx.from, provider)) return;
    const swap = await findSwapsInTransaction(tx, receipt);
    if (!swap || swap.tokenOut.length > 1 || swap.tokenIn.length > 1) return;
    const tokenIn = swap.tokenIn[0];
    const tokenOut = swap.tokenOut[0];
    const amountIn = swap.amountIn[0];
    // if token in is not stable/weth or token out is stable/weth skip it
    if (!STABLES.has(tokenIn) || STABLES.has(tokenOut)) return;

    /* check amount in */
    if (tokenIn === WETH_ADDRESS && amountIn < SETTINGS.MIN_ETH) return;
    if (getInputUSD(amountIn, tokenIn) < SETTINGS.MIN_USD) return;

    /* ready for analytics */
    const wallet = tx.from;

    if (cache.has(wallet) || onFly.has(wallet)) return;
    onFly.add(wallet);

    const blockEnd = tx.blockNumber - SETTINGS.BLOCKS;
    logger.debug(
      `block=${tx.blockNumber}. Creating report for address ${wallet}`
    );
    const allSwaps = await getAllSwaps(
      wallet,
      etherscanApi,
      provider,
      blockEnd,
      tx.blockNumber
    );
    if (!allSwaps) return;
    const report = await analyticEngine.execute(
      wallet,
      [(timestamp - _10Days) * 1000, timestamp * 1000],
      allSwaps
    );

    logger.debug(
      `block=${tx.blockNumber}. Report for address ${wallet} is ready`
    );

    cache.set(wallet, report);
    onFly.delete(wallet);

    const pnl = pnl2FromReport(report);
    if (!pnl || pnl < SETTINGS.MIN_PNL) return;
    const amountOfTokens = amountOfTokensReport(report);
    if (!amountOfTokens || amountOfTokens > SETTINGS.MAX_AMOUNT_OF_TOKENS)
      return;
    if (amountOfTokens === 1) return;

    try {
      await sendMessage(
        '-1001714973372',
        config.token,
        `новый кошелек ${wallet}\nстатистика за 15 дней\n${header(report)}`
      );
    } catch (e: any) {
      logger.error(e);
    }
  };

  provider.on('block', async (blockNumber: number) => {
    const block = await provider.getBlock(blockNumber);
    if (!block) return;

    const now = Date.now();
    const promises: Promise<any>[] = [];

    for (const txhash of block.transactions)
      promises.push(processTransaction(txhash, block.timestamp));
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

main();
