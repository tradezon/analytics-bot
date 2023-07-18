// @ts-expect-error
import EtherscanApi from 'etherscan-api';
import {
  formatEther,
  formatUnits,
  JsonRpcProvider,
  parseEther,
  TransactionReceipt,
  TransactionResponse,
  WebSocketProvider
} from 'ethers';
import { LRUCache } from 'lru-cache';
import { readConfig } from './config';
import path from 'path';
import logger, { LogLevel } from './logger';
import { AnalyticsEngine } from './analytics';
import { getAllSwaps } from './transactions';
import { Report } from './types';
import {
  AMOUNT_IN_USD_AVG,
  AMOUNT_IN_USD_MEDIAN,
  AMOUNT_OF_TOKENS,
  PNL2_USD,
  PNL_AVERAGE_PERCENT,
  PNL_USD,
  WIN_RATE
} from './utils/const';
import { findSwapsInTransaction } from './transactions/find-swaps-in-transaction';
import {
  DAI_ADDRESS,
  STABLES,
  USDC_ADDRESS,
  USDT_ADDRESS,
  WETH_ADDRESS
} from './analytics/const';
import { sendMessage } from './utils/telegram-send-message';
import { escape, header } from './utils/telegram';
import { isContract } from './transactions/is-contract';

type WindowWalletEntry = [
  token: string,
  amount: { eth?: number; usd: number },
  report: Report,
  timestamp: number,
  reason: string
];

const SIGNALED = new Set<string>();
const WINDOW_SIZE = 26;
const MIN_WINDOW_ENTRIES = 3;
const AVERAGE_ETH_BLOCKTIME_SECONDS = 12;
const _20Days = 20 * 24 * 60 * 60;
const blocksIn20Days = Math.ceil(_20Days / AVERAGE_ETH_BLOCKTIME_SECONDS);

const cache = new LRUCache<string, Report>({
  max: 4000,
  ttl: 24 * 60 * 60 * 1000, // 1 day,
  ttlAutopurge: false,
  allowStale: false,
  updateAgeOnGet: false,
  updateAgeOnHas: false
});

const SETTINGS = {
  MIN_ETH: parseEther('1'),
  MIN_USD: 1800,
  MAX_ETH: parseEther('8'),
  MAX_USD: 20000,
  MAX_AMOUNT_OF_TOKENS: 30,
  BLOCKS: blocksIn20Days,
  MIN_TOKEN_PNL: 13,
  MIN_AVG_IN_USD: 1800,
  MIN_MEDIAN_IN_USD: 1800,
  MIN_WINRATE: 0.4,
  MIN_PNL: 15000,
  MAX_SWAPS: 120
};

const pnl2FromReport = (report: Report): number | null => {
  const i = report.metrics.indexOf(PNL2_USD);
  if (i > -1) return report.metricValues[i];
  return null;
};

const pnlFromReport = (report: Report): number | null => {
  const i = report.metrics.indexOf(PNL_USD);
  if (i > -1) return report.metricValues[i];
  return null;
};

const tokenPnlFromReport = (report: Report): number | null => {
  const i = report.metrics.indexOf(PNL_AVERAGE_PERCENT);
  if (i > -1) return report.metricValues[i];
  return null;
};

const winrateFromReport = (report: Report): number | null => {
  const i = report.metrics.indexOf(WIN_RATE);
  if (i > -1) return report.metricValues[i];
  return null;
};

const avgInFromReport = (report: Report): number | null => {
  const i = report.metrics.indexOf(AMOUNT_IN_USD_AVG);
  if (i > -1) return report.metricValues[i];
  return null;
};

const medianInFromReport = (report: Report): number | null => {
  const i = report.metrics.indexOf(AMOUNT_IN_USD_MEDIAN);
  if (i > -1) return report.metricValues[i];
  return null;
};

const amountOfTokensReport = (report: Report): number | null => {
  const i = report.metrics.indexOf(AMOUNT_OF_TOKENS);
  if (i > -1) return report.metricValues[i];
  return null;
};

const windowEntryToView = (entry: WindowWalletEntry) =>
  `Wallet \`${entry[2].address}\` buy ${
    entry[1].eth
      ? `${escape(entry[1].eth.toFixed(2))}ETH`
      : `${escape(entry[1].usd.toFixed(0))}\\$`
  }\\. Reason \\"${escape(entry[4])}\\"\n${header(entry[2])}`;

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

const passFilters = (
  report: Report,
  token: string,
  amount: WindowWalletEntry[1],
  timestamp: number
): false | WindowWalletEntry => {
  const honeypots = report.honeypots?.tokens.length || 0;
  if (honeypots && honeypots / (honeypots + report.tokens.length) > 0.79)
    return false;
  const pnl2 = pnl2FromReport(report);
  const pnl = pnlFromReport(report);
  const winrate = winrateFromReport(report);
  const tokenPnl = tokenPnlFromReport(report);
  const medianIn = medianInFromReport(report);
  const avgIn = avgInFromReport(report);
  if (pnl2 === 0 && pnl !== pnl2) return false;
  if (!pnl2 || pnl2 < SETTINGS.MIN_PNL) return false;
  const amountOfTokens = amountOfTokensReport(report);
  if (!amountOfTokens || amountOfTokens < 2) return false;
  if (winrate && winrate < SETTINGS.MIN_WINRATE) return false;
  if (tokenPnl && tokenPnl < SETTINGS.MIN_TOKEN_PNL) return false;
  if (amountOfTokens > SETTINGS.MAX_AMOUNT_OF_TOKENS)
    return [token, amount, report, timestamp, 'max_tokens'];
  if (avgIn && avgIn < SETTINGS.MIN_AVG_IN_USD)
    return [token, amount, report, timestamp, 'min_avg_in'];
  if (medianIn && medianIn < SETTINGS.MIN_MEDIAN_IN_USD)
    return [token, amount, report, timestamp, 'min_median_in'];
  return [token, amount, report, timestamp, 'pass'];
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
  const signals = new Map<string, WindowWalletEntry[]>();
  const window: Array<WindowWalletEntry[] | null> = new Array<
    WindowWalletEntry[] | null
  >(WINDOW_SIZE).fill(null);

  const logWindowState = (blockNumber: number) => {
    logger.info(
      `block=${blockNumber}. window ${window
        .map((w) => (w ? '█' : '░'))
        .join('')}. Possible signals ${signals.size}.`
    );
  };

  const sliceWindow = () => {
    const first = window[0];
    for (let i = 1; i < WINDOW_SIZE; i++) window[i - 1] = window[i];
    window[WINDOW_SIZE - 1] = null;
    if (first === null) return;
    for (const entry of first) {
      const signal = signals.get(entry[0]);
      if (!signal) {
        continue;
      }
      const i = signal.indexOf(entry);
      if (i > -1) {
        if (signal.length === 1) {
          signals.delete(entry[0]);
        } else {
          signal.splice(i, 1);
        }
      }
    }
  };

  const alertSignalIfAny = async (tokens: Iterable<string>) => {
    const promises: Promise<void>[] = [];
    for (const token of tokens) {
      let signal = signals.get(token);
      if (!signal || signal.length < MIN_WINDOW_ENTRIES - 1) continue;
      logger.debug(`Possible signal for ${token}.`);
      signal = signal.sort((a, b) => b[3] - a[3]);
      const wallets = new Set(signal.map((s) => s[2].address));
      signal = signal.filter((s) => {
        const addr = s[2].address;
        if (wallets.has(addr)) {
          wallets.delete(addr);
          return true;
        }
        return false;
      });
      if (signal.length < MIN_WINDOW_ENTRIES - 1) {
        //         promises.push(
        //           new Promise(async (res) => {
        //             try {
        //               await sendMessage(
        //                 '-1001879517869',
        //                 config.token,
        //                 `подозрительный памп монеты\nCA \`${token}\`\nКошелек
        // ${signalOriginal.slice(0, 5).map(windowEntryToView).join('\n')}`
        //               );
        //             } catch (e: any) {
        //               logger.error(e);
        //             }
        //             res();
        //           })
        //         );
        continue;
      }
      if (!SIGNALED.has(token)) {
        SIGNALED.add(token);
        promises.push(
          new Promise(async (res) => {
            try {
              await sendMessage('-1001615457203', config.token, token);
            } catch (e: any) {
              logger.error(e);
            }
            res();
          })
        );
      }
      if (signal.length < MIN_WINDOW_ENTRIES) {
        promises.push(
          new Promise(async (res) => {
            const sgn = (signal as WindowWalletEntry[]).sort((a, b) => {
              const tokenPnl1 = tokenPnlFromReport(a[2]);
              if (!tokenPnl1) return 1;
              const tokenPnl2 = tokenPnlFromReport(b[2]);
              if (!tokenPnl2) return -1;
              return tokenPnl2 - tokenPnl1;
            });
            try {
              await sendMessage(
                '-1001879517869',
                config.token,
                `*Новый minor сигнал*\nCA \`${token}\`\nКошельки\\:\n
${sgn.slice(0, 5).map(windowEntryToView).join('\n\n')}`
              );
            } catch (e: any) {
              logger.error(e);
            }
            res();
          })
        );
        continue;
      }
      signals.delete(token);
      logger.debug(`Creating signal for ${token}`);
      promises.push(
        new Promise(async (res) => {
          const sgn = (signal as WindowWalletEntry[]).sort((a, b) => {
            const tokenPnl1 = tokenPnlFromReport(a[2]);
            if (!tokenPnl1) return 1;
            const tokenPnl2 = tokenPnlFromReport(b[2]);
            if (!tokenPnl2) return -1;
            return tokenPnl2 - tokenPnl1;
          });
          try {
            await sendMessage(
              '-1001879517869',
              config.token,
              `*Новый 🚨 MAJOR сигнал*\nCA \`${token}\`\nКошельки\\:\n
${sgn.slice(0, 5).map(windowEntryToView).join('\n\n')}`
            );
          } catch (e: any) {
            logger.error(e);
          }
          res();
        })
      );
    }
    await Promise.all(promises);
  };

  const addBlockEntriesInWindow = (
    entries: WindowWalletEntry[],
    blockNumber: number
  ) => {
    sliceWindow();
    if (entries.length === 0) {
      logWindowState(blockNumber);
      return;
    }
    window[WINDOW_SIZE - 1] = entries;

    const tokens: Set<string> = new Set<string>();
    for (const entry of entries) {
      const token = entry[0];
      tokens.add(token);
      let signal = signals.get(token);
      if (!signal) {
        signal = [];
        signals.set(token, signal);
      }
      signal.push(entry);
    }

    alertSignalIfAny(tokens);
    logWindowState(blockNumber);
  };

  const processTransaction = async (
    txhash: string,
    timestamp: number
  ): Promise<WindowWalletEntry | undefined> => {
    const [tx, receipt]: [
      TransactionResponse | null,
      TransactionReceipt | null
    ] = await Promise.all([
      provider.getTransaction(txhash),
      provider.getTransactionReceipt(txhash)
    ]);
    if (!receipt || !tx || !tx.to || !tx.blockNumber) return;
    if (receipt.logs.length < 3) return;
    if (await isContract(tx.from, provider)) return;
    const swap = await findSwapsInTransaction(tx, receipt, etherscanApi);
    if (!swap || swap.tokenOut.length > 1 || swap.tokenIn.length > 1) return;
    const tokenIn = swap.tokenIn[0];
    const tokenOut = swap.tokenOut[0];
    const amountIn = swap.amountIn[0];
    // if token in is not stable/weth or token out is stable/weth skip it
    if (!STABLES.has(tokenIn) || STABLES.has(tokenOut)) return;

    let amount: { eth?: number; usd: number };

    /* check amount in */
    if (tokenIn === WETH_ADDRESS) {
      if (amountIn < SETTINGS.MIN_ETH || amountIn > SETTINGS.MAX_ETH) return;
      amount = { eth: Number(formatEther(amountIn)), usd: 0 };
    } else {
      const input = getInputUSD(amountIn, tokenIn);
      if (input < SETTINGS.MIN_USD || input > SETTINGS.MAX_USD) return;
      amount = { usd: input };
    }

    /* ready for analytics */
    const wallet = tx.from;

    if (cache.has(wallet)) {
      const report = cache.get(wallet)!;
      const result = passFilters(report, tokenOut, amount, timestamp);
      if (result !== false) return result;
      return;
    }
    if (onFly.has(wallet)) return;
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
      tx.blockNumber,
      SETTINGS.MAX_SWAPS
    );
    if (!allSwaps) return;
    const report = await analyticEngine.execute(
      wallet,
      [(timestamp - _20Days) * 1000, timestamp * 1000],
      allSwaps
    );

    logger.debug(
      `block=${tx.blockNumber}. Report for address ${wallet} is ready`
    );

    cache.set(wallet, report);
    onFly.delete(wallet);

    const result = passFilters(report, tokenOut, amount, timestamp);
    if (result === false) return;
    if (result[4] === 'pass') {
      try {
        await sendMessage(
          '-1001714973372',
          config.token,
          `новый кошелек ${wallet}\n${header(report)}`
        );
      } catch (e: any) {
        logger.error(e);
      }
    }
    return result;
  };

  provider.on('block', async (blockNumber: number) => {
    const block = await provider.getBlock(blockNumber);
    if (!block) return;

    const now = Date.now();
    const promises: Promise<void>[] = [];
    const entries: WindowWalletEntry[] = [];

    for (const txhash of block.transactions)
      promises.push(
        processTransaction(txhash, block.timestamp).then((entry) => {
          if (!entry) return;
          entries.push(entry);
        })
      );
    await Promise.all(promises);
    addBlockEntriesInWindow(entries, blockNumber);
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
