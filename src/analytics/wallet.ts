import { formatEther, formatUnits } from 'ethers';
import {
  DAI_ADDRESS,
  STABLES,
  USDC_ADDRESS,
  USDT_ADDRESS,
  WETH_ADDRESS
} from './const';

export class Wallet {
  private tokens = new Map<string, bigint>();

  deposit(token: string, value: bigint) {
    if (value === 0n) return;
    const entry = this.tokens.get(token) || 0n;
    this.tokens.set(token, entry + value);
  }

  hasBalance(token: string, value: bigint): boolean {
    if (value === 0n) return true;
    const entry = this.tokens.get(token);
    return entry ? entry >= value : false;
  }

  balance(token: string) {
    return this.tokens.get(token) || 0n;
  }

  withdraw(token: string, value: bigint) {
    if (value === 0n) return;
    const entry = this.tokens.get(token) || 0n;
    this.tokens.set(token, entry - value);
  }

  removeToken(token: string) {
    const t = this.tokens.get(token);
    this.tokens.delete(token);
    return t;
  }

  getStablesProfit(ethPrice: number) {
    let profit = 0;
    const eth = this.tokens.get(WETH_ADDRESS);
    if (eth) {
      profit += Number(formatEther(eth)) * ethPrice;
    }
    const usdt = this.tokens.get(USDT_ADDRESS);
    if (usdt) {
      profit += Number(formatUnits(usdt, 6));
    }

    const usdc = this.tokens.get(USDC_ADDRESS);
    if (usdc) {
      profit += Number(formatUnits(usdc, 6));
    }

    const dai = this.tokens.get(DAI_ADDRESS);
    if (dai) {
      profit += Number(formatUnits(dai, 18));
    }

    return profit;
  }
}
