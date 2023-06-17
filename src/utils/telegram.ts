import dayjs from 'dayjs';
import type { Report, TokenInfo } from '../types';
import { formatUnits } from 'ethers';

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

function renderX(x?: string) {
  if (!x) return '';
  return `${escape(x)}x ${xValue(x)}`;
}

function renderInlineTokens(tokens: TokenInfo[]) {
  return tokens
    .map(({ token, symbol }) => hyperLink(etherscanAddressLink(token), symbol))
    .join('\\, ');
}

function divideTokensWithLossThreshold(tokens: TokenInfo[], threshold: number) {
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

export function reportToMarkdownV2(report: Report) {
  const allTokensLength = report.tokens.length;
  let [profitableCoins, nonprofitableCoins] = divideTokensWithLossThreshold(
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

  //#region non-profitable tokens
  let lost = 0;
  let nonprofitableCoinsWithLessThan350DollarsLost: TokenInfo[] = [];
  if (allTokensLength > 18) {
    [nonprofitableCoinsWithLessThan350DollarsLost, nonprofitableCoins] =
      divideTokensWithLossThreshold(nonprofitableCoins, -349);
    for (const token of nonprofitableCoinsWithLessThan350DollarsLost) {
      lost += token.profitUSD;
    }
  }
  nonprofitableCoins = nonprofitableCoins.reverse();
  //#endregion

  //#region current balance
  let currentLossing = 0;
  let walletTokens: TokenInfo[] = report.wallet;
  let currentTokensThatLossingLessThan350Dollars: TokenInfo[] = [];
  if (walletTokens.length > 14) {
    [walletTokens, currentTokensThatLossingLessThan350Dollars] =
      divideTokensWithLossThreshold(walletTokens, -349);
    for (const token of currentTokensThatLossingLessThan350Dollars) {
      currentLossing += token.profitUSD;
    }
  }
  //#endregion

  return `Report for address ${address(report.address)}
From ${escape(formatDate(report.period[0]))} to ${escape(
    formatDate(report.period[1])
  )}
*PNL ${escape(report.pnlUSD.toFixed(0))}$* \\| *Winrate ${escape(
    report.winrate / 1000
  )}*

*Profitable tokens*:\n${profitableCoins
    .map(
      ({ token, symbol, profitUSD, profitETH }) =>
        `${hyperLink(etherscanAddressLink(token), symbol)} ${escape(
          profitUSD.toFixed(0)
        )}$ ${
          profitETH
            ? `${escape(profitETH.value.toFixed(2))}ETH ${renderX(profitETH.x)}`
            : ''
        }`
    )
    .join('\n')}

${
  walletTokens.length > 0
    ? `*Current tokens in wallet*: \\( not in PNL \\)\n${walletTokens
        .map(
          ({ token, decimals, symbol, profitUSD, profitETH, balance }) =>
            `${hyperLink(etherscanAddressLink(token), symbol)} ${escape(
              profitUSD.toFixed(0)
            )}$ ${
              profitUSD >= 300_000
                ? '⚠️ __price estimation maybe wrong__'
                : profitETH
                ? `${escape(profitETH.value.toFixed(2))}ETH ${renderX(
                    profitETH.x
                  )}`
                : ''
            } ${
              balance
                ? `${Number(formatUnits(balance.value, decimals)).toFixed(
                    1
                  )} tokens`
                : ''
            }`
        )
        .join('\n')}${
        currentTokensThatLossingLessThan350Dollars.length > 0
          ? `\nCoins with more than 350$ loss \\( Total of ${escape(
              currentLossing.toFixed(0)
            )}$ \\):
${renderInlineTokens(currentTokensThatLossingLessThan350Dollars)}`
          : ''
      }`
    : ''
}

Rest tokens:\n${nonprofitableCoins
    .map(
      ({ token, symbol, profitUSD, profitETH }) =>
        `${hyperLink(etherscanAddressLink(token), symbol)} ${escape(
          profitUSD.toFixed(0)
        )}$ ${profitETH ? `${escape(profitETH.value.toFixed(3))}ETH` : ''}`
    )
    .join('\n')}${
    nonprofitableCoinsWithLessThan350DollarsLost.length > 0
      ? `\nCoins with less than 350$ loss \\( Total of ${escape(
          lost.toFixed(0)
        )}$ \\):
${renderInlineTokens(nonprofitableCoinsWithLessThan350DollarsLost)}`
      : ''
  }`;
}
