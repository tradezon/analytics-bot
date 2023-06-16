import type { Report } from '../types';

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
  return '🔥🔞️️️️️️';
}

export function markdownUserLink(text: string, username: string) {
  return `[${escape(text)}](tg://resolve?domain=${username})`;
}

export function reportToMarkdownV2(report: Report) {
  const firstNonProfitableCoins = report.tokens.findIndex(
    (t) => t.profitUSD < 0
  );
  const profitableCoins = report.tokens
    .slice(0, firstNonProfitableCoins)
    .sort((a, b) => {
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

  const nonprofitableCoins = report.tokens
    .slice(firstNonProfitableCoins)
    .reverse();
  return `Report for address ${address(report.address)}
*PNL ${escape(report.pnlUSD.toFixed(0))}$* \\| *Winrate ${escape(
    report.winrate / 1000
  )}*

Profitable tokens:\n${profitableCoins
    .map(
      ({ token, symbol, profitUSD, profitETH }) =>
        `${hyperLink(etherscanAddressLink(token), symbol)} ${escape(
          profitUSD.toFixed(0)
        )}$ ${
          profitETH
            ? `${escape(profitETH.value.toFixed(2))}ETH ${escape(profitETH.x)}x ${xValue(profitETH.x)}`
            : ''
        }`
    )
    .join('\n')}

Rest tokens:\n${nonprofitableCoins
    .map(
      ({ token, symbol, profitUSD, profitETH }) =>
        `${hyperLink(etherscanAddressLink(token), symbol)} ${escape(
          profitUSD.toFixed(0)
        )}$ ${profitETH ? `${escape(profitETH.value.toFixed(3))}ETH` : ''}`
    )
    .join('\n')}`;
}
