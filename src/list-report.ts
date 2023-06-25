import fs from 'fs';
// @ts-expect-error
import EtherscanApi from 'etherscan-api';
import { getAddress, JsonRpcProvider, WebSocketProvider } from 'ethers';
import { readConfig } from './config';
import path from 'path';
import logger, { LogLevel } from './logger';
import { AnalyticsEngine } from './analytics';
import { getAllSwaps } from './transactions';
import { Report } from './types';

const AVERAGE_ETH_BLOCKTIME_SECONDS = 12;
const _10Days = 10 * 24 * 60 * 60;
const _3Weeks = 3 * 7 * 24 * 60 * 60;
const blocksIn10Days = Math.ceil(_10Days / AVERAGE_ETH_BLOCKTIME_SECONDS);
const blocksIn3Weeks = Math.ceil(_3Weeks / AVERAGE_ETH_BLOCKTIME_SECONDS);

async function main() {
  const t = setTimeout(() => {}, 2 * 60 * 60 * 1000);
  const config = await readConfig(
    process.argv[2] || path.resolve(__dirname, 'config.json')
  );
  const dataDir = path.resolve(__dirname, 'data');
  const provider = config.etherium_mainnet.match(/^https?\:/)
    ? new JsonRpcProvider(config.etherium_mainnet, 'mainnet', {
        batchStallTime: 80
      })
    : new WebSocketProvider(config.etherium_mainnet);
  const etherscanApi = EtherscanApi.init('QMW2MPMAM4T9HWH3STPPK836GRWQX1QW3Q');
  const analyticEngine = new AnalyticsEngine(provider, async () => {
    const { result } = await etherscanApi.stats.ethprice();
    return result.ethusd;
  });
  logger.level = LogLevel.debug;
  const latest = await provider.getBlock('latest');
  if (!latest) throw new Error('no latest block');
  const blockEnd = latest?.number;
  const block10DaysStart = blockEnd - blocksIn10Days;
  const block3WeeksStart = blockEnd - blocksIn3Weeks;

  const data = fs.readFileSync(0, 'utf-8');
  const addrs = data.split('\n').filter((s) => s);
  const reports = new Set<string>();

  const shutdown = () => {
    process.exit(1);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  let csv = '';
  const csvEntries10Days: string[] = [];
  const csvEntriesLatest: string[] = [];

  for (let i = 0; i < addrs.length; i++) {
    const addr = addrs[i];
    try {
      const wallet = getAddress(addr);
      if (reports.has(wallet)) continue;
      logger.info(`${i} Preparing report for ${wallet}`);
      const reportsArr: [Report, Report] = [null, null] as any;
      const allSwaps10Days = await getAllSwaps(
        wallet,
        etherscanApi,
        provider,
        block10DaysStart,
        blockEnd
      );
      if (!allSwaps10Days) {
        logger.debug(`Did not found swaps in 10 days for ${wallet}`);
        continue;
      }
      if (allSwaps10Days.swaps.length > 0) {
        reportsArr[0] = await analyticEngine.execute(
          wallet,
          [(latest.timestamp - _10Days) * 1000, latest.timestamp * 1000],
          allSwaps10Days
        );
      }

      const allSwaps = await getAllSwaps(
        wallet,
        etherscanApi,
        provider,
        block3WeeksStart
      );
      if (!allSwaps) {
        logger.debug(`Did not found swaps ${wallet}`);
        continue;
      }

      if (allSwaps.swaps.length > 0) {
        reportsArr[1] = await analyticEngine.execute(
          wallet,
          [allSwaps.start, latest.timestamp * 1000],
          allSwaps
        );
      }

      logger.info(`Preparing report for ${wallet} was done.`);

      reports.add(wallet);
      if (!csv) {
        csv = `WALLET,${reportsArr[0].metrics.join(',')}`;
      }
      csvEntries10Days.push(
        [wallet, ...reportsArr[0].metricValues.map((v) => v.toFixed(2))].join(
          ','
        )
      );
      csvEntriesLatest.push(
        [wallet, ...reportsArr[1].metricValues.map((v) => v.toFixed(2))].join(
          ','
        )
      );
    } catch (e: any) {
      logger.error(e);
    }
  }

  logger.info('Saving csv files');
  const csv10 = [csv, ...csvEntries10Days].join('\n');
  csv = [csv, ...csvEntriesLatest].join('\n');
  await fs.promises.writeFile(path.resolve(dataDir, `latest.csv`), csv);
  await fs.promises.writeFile(path.resolve(dataDir, `10days.csv`), csv10);
  clearTimeout(t);
  provider.destroy();
}

main();
