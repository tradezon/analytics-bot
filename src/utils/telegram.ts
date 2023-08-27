import dayjs from 'dayjs';
import type { Report, TokenInfo } from '../types';
import { formatUnits } from 'ethers';
import {
  AMOUNT_IN_USD_AVG,
  AMOUNT_IN_USD_MEDIAN,
  AMOUNT_OF_SWAPS,
  AMOUNT_OF_TOKENS,
  FEES,
  PNL2_USD,
  PNL_AVERAGE_PERCENT,
  PNL_OF_TOKENS_WITH_AMOUNT_IN_MORE_THAN_AVG,
  PNL_USD,
  WIN_RATE
} from './const';
import { saveBalance } from './save-balance';

const LOWER_PERCENT = -15;
const HIGHER_PERCENT = 15;

export const escape = (str: any) =>
  str
    .toString()
    .replaceAll(/(_|\*|\[|\]|\(|\)|~|`|>|#|\+|-|=|\||\{|\}|\.|\!)/g, '\\$1');

export function prettyAddress(addr: string) {
  return `${addr.slice(0, 5)}...${addr.slice(-3)}`;
}

export function hyperLink(url: string, title: string) {
  return `[${title}](${url})`;
}

export function etherscanAddressLink(addr: string) {
  return `https://etherscan.io/address/${addr}`;
}

export function etherscanBlockLink(blockNumber: number) {
  return `https://etherscan.io/block/${blockNumber}`;
}

export function etherscanTransactionLink(txhash: string) {
  return `https://etherscan.io/tx/${txhash}`;
}

function address(addr: string) {
  return hyperLink(etherscanAddressLink(addr), escape(prettyAddress(addr)));
}

function financial(x: string): string {
  return Number.parseFloat(x).toFixed(2);
}

function xValue(x: number) {
  if (x < 300) return '';
  if (x < 500) return '🔥';
  if (x < 800) return '🔥🔥';
  if (x <= 1000) return '🔥🔥🔥';
  return '🔥️🔝️🔥️️️️';
}

export function markdownUserLink(text: string, username: string) {
  return `[${escape(text)}](tg://resolve?domain=${username})`;
}

function divideTokensWithLossThreshold(
  tokens: TokenInfo[],
  threshold: number
): [TokenInfo[], TokenInfo[]] {
  const idx = tokens.findIndex((t) => t.profitUSD < threshold);
  return idx === -1 ? [tokens, []] : [tokens.slice(0, idx), tokens.slice(idx)];
}

function divideTokensWithProfitThreshold(
  tokens: TokenInfo[],
  threshold: number
) {
  const idx = tokens.findIndex((t) => t.profitUSD > threshold);
  return idx === -1 ? [tokens, []] : [tokens.slice(0, idx), tokens.slice(idx)];
}

function formatDate(date: number) {
  return dayjs(date).format('DD.MM.YYYY');
}

function sum(tokens: TokenInfo[]): number {
  return tokens.reduce((acc, t) => acc + t.profitUSD, 0 as number);
}

function mapMetricsTypeToName(type: string, ...values: number[]) {
  switch (type) {
    case WIN_RATE:
      return `*winrate ${escape(values[0].toFixed(2))}*`;
    case PNL_AVERAGE_PERCENT:
      return `*TOKEN PNL ${escape(values[0].toFixed(0))}%*`;
    case AMOUNT_IN_USD_AVG:
      return `*AVG IN ${escape(values[0].toFixed(0))}$ \\(${escape(
        values[1].toFixed(0)
      )}$ PNL\\)*`;
    case AMOUNT_IN_USD_MEDIAN:
      return `*MEDIAN IN ${escape(values[0].toFixed(0))}$*`;
    case PNL_USD:
      return `*PNL ${escape(values[0].toFixed(0))}$*`;
    case PNL2_USD:
      return `*PNL2 ${escape(values[0].toFixed(0))}$*`;
    case FEES:
      return `*fees ${escape(values[0].toFixed(0))}$*`;
    case AMOUNT_OF_TOKENS:
      return `*TOKENS ${values[0]}*`;
    case AMOUNT_OF_SWAPS:
      return `*SWAPS ${values[0]}*`;
    default:
      return null;
  }
}

export function renderShort(report: Report): [string, number] {
  let loss = 0;
  let profit = 0;
  let [profitableCoins, lossCoins] = divideTokensWithLossThreshold(
    report.tokens,
    0
  );

  profitableCoins = profitableCoins.sort((a, b) => {
    return b.percent - a.percent;
  });
  for (const coin of lossCoins) loss += coin.profitUSD;
  for (const coin of profitableCoins) profit += coin.profitUSD;

  const [lower, higher] = filterTokensByPercent(
    profitableCoins,
    HIGHER_PERCENT
  );
  const restProfit = lower.reduce((acc, t) => acc + t.profitUSD, 0);

  return [
    `${header(report)}
${
  profitableCoins.length > 0
    ? `\n📈 *Profitable coins* \\(${escape(profit.toFixed(0))}$\\):\n${higher
        .map(
          ({ token, symbol, profitUSD, profitETH, percent }) =>
            `${hyperLink(etherscanAddressLink(token), escape(symbol))} ${escape(
              profitUSD.toFixed(0)
            )}$ \\| \\+${escape(percent)}\\%${xValue(percent)} ${
              (profitETH && `\\| ${escape(profitETH.toFixed(2))}ETH`) || ''
            }`
        )
        .join('\n')}`
    : ''
}${`\n🧩 *Tokens with \\<\\+${escape(
      HIGHER_PERCENT
    )}\\% TOKEN\\_PNL \\(${escape(restProfit.toFixed(0))}\\$\\)*\\:\n${lower
      .map(({ token, symbol }) =>
        hyperLink(etherscanAddressLink(token), escape(symbol))
      )
      .join('\\, ')}`}${
      report.tokensInMultiTokensSwaps.length > 0
        ? `\n🧮 *Tokens in multitokens swaps*:\n${report.tokensInMultiTokensSwaps
            .map(({ token, symbol }) =>
              hyperLink(etherscanAddressLink(token), escape(symbol))
            )
            .join('\\, ')}`
        : ''
    }`,
    -loss
  ];
}

export function header(report: Report) {
  const metrics = report.metrics
    .map((m, i) =>
      m === AMOUNT_IN_USD_AVG
        ? mapMetricsTypeToName(
            m,
            report.metricValues[i],
            report.metricValues[i + 1]
          )
        : mapMetricsTypeToName(m, report.metricValues[i])
    )
    .filter((m) => m)
    .join(' \\| ');
  return `Report for address \`${report.address}\` From ${escape(
    formatDate(report.period[0])
  )} to ${escape(formatDate(report.period[1]))}\n${metrics}`;
}

export function renderLosses(report: Report) {
  let [, nonprofitableCoins] = divideTokensWithLossThreshold(report.tokens, 0);
  const tokens = nonprofitableCoins.reverse();
  const [lower, higher] = filterTokensByPercent(tokens, LOWER_PERCENT);

  const str = renderTokensList('📉 *Losses*\\:', report, lower);

  if (higher.length === 0) return str;

  const restLosses = higher.reduce((acc, t) => acc + t.profitUSD, 0);

  return (
    str +
    `\n🧩 *Tokens with \\>${escape(LOWER_PERCENT)}\\% TOKEN\\_PNL \\(${escape(
      restLosses.toFixed(0)
    )}\\$\\)*\\:\n${higher
      .map(({ token, symbol }) =>
        hyperLink(etherscanAddressLink(token), escape(symbol))
      )
      .join('\\, ')}`
  );
}

export function renderTokensList(
  title: string,
  report: Report,
  tokens: TokenInfo[],
  current: boolean = false
) {
  return `${header(report)}\n\n${title}\n${tokens
    .map(
      ({ token, decimals, symbol, profitUSD, profitETH, balance, percent }) =>
        `${
          balance
            ? `${escape(saveBalance(balance.value, decimals).toFixed(0))}`
            : ''
        }${hyperLink(etherscanAddressLink(token), escape(symbol))} ${escape(
          current
            ? balance
              ? balance.usd.toFixed(0)
              : ''
            : profitUSD.toFixed(0)
        )}$ \\| ${escape(percent)}\\% ${
          (profitETH && `\\| ${escape(profitETH.toFixed(2))}ETH`) || ''
        }`
    )
    .join('\n')}`;
}

const filterTokensByPercent = (tokens: TokenInfo[], percent: number) => {
  const filtered: TokenInfo[] = [];
  const other: TokenInfo[] = [];
  for (const t of tokens) {
    const arr = t.percent > percent ? other : filtered;
    arr.push(t);
  }

  return [filtered, other];
};
