import dayjs from 'dayjs';
import type { Report, TokenInfo } from '../types';
import { formatUnits } from 'ethers';
import {
  AMOUNT_IN_USD_AVG,
  AMOUNT_IN_USD_MEDIAN,
  FEES,
  PNL_AVERAGE_PERCENT,
  PNL_OF_TOKENS_WITH_AMOUNT_IN_MORE_THAN_AVG,
  PNL_USD,
  WIN_RATE
} from './const';
import { saveBalance } from './save-balance';

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

function xValue(x: string) {
  const v = parseFloat(x);

  if (v < 3.0) return '';
  if (v < 5.0) return '🔥';
  if (v < 8) return '🔥🔥';
  if (v < 10.1) return '🔥🔥🔥';
  return '🔥️🔝️🔥️️️️';
}

export function markdownUserLink(text: string, username: string) {
  return `[${escape(text)}](tg://resolve?domain=${username})`;
}

function renderX(x?: string) {
  if (!x) return '';
  return `${escape(x)}x ${xValue(x)}`;
}

function renderInlineTokens(tokens: TokenInfo[]) {
  return tokens
    .map(({ token, symbol }) => hyperLink(etherscanAddressLink(token), symbol))
    .join('\\, ');
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
    case FEES:
      return `*fees ${escape(values[0].toFixed(0))}$*`;
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
    if (a.profitETH?.x) {
      if (b.profitETH?.x) {
        const aValue = parseFloat(a.profitETH.x);
        const bValue = parseFloat(b.profitETH.x);
        return bValue - aValue;
      }
      return -1;
    } else if (b.profitETH?.x) {
      return 1;
    }
    return b.profitUSD - a.profitUSD;
  });
  for (const coin of lossCoins) loss += coin.profitUSD;
  for (const coin of profitableCoins) profit += coin.profitUSD;

  return [
    `${header(report)}
${
  profitableCoins.length > 0
    ? `\n📈 *Profitable coins* \\(${escape(
        profit.toFixed(0)
      )}$\\):\n${profitableCoins
        .map(
          ({ token, symbol, profitUSD, profitETH }) =>
            `${hyperLink(etherscanAddressLink(token), escape(symbol))} ${escape(
              profitUSD.toFixed(0)
            )}$ ${
              profitETH
                ? `\\| ${escape(profitETH.value.toFixed(2))}ETH ${renderX(
                    profitETH.x
                  )}`
                : ''
            }`
        )
        .join('\n')}`
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
  return `Report for address ${address(report.address)} From ${escape(
    formatDate(report.period[0])
  )} to ${escape(formatDate(report.period[1]))}\n${metrics}`;
}

export function renderLosses(report: Report) {
  const [, nonprofitableCoins] = divideTokensWithLossThreshold(
    report.tokens,
    0
  );

  return renderTokensList('📉 *Losses*\\:', report, nonprofitableCoins);
}

export function renderTokensList(
  title: string,
  report: Report,
  tokens: TokenInfo[],
  current: boolean = false
) {
  return `${header(report)}\n\n${title}\n${tokens
    .map(
      ({ token, decimals, symbol, profitUSD, profitETH, balance }) =>
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
        )}$ ${
          profitETH && !current
            ? `\\| ${escape(profitETH.value.toFixed(2))}ETH ${renderX(
                profitETH.x
              )}`
            : ''
        }`
    )
    .join('\n')}`;
}
