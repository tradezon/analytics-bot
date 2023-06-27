import { formatUnits } from 'ethers';

export function saveBalance(balance: bigint, decimals: number) {
  try {
    return Number(formatUnits(balance, decimals));
  } catch {
    return Number(balance / 10n ** BigInt(decimals));
  }
}
