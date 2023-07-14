import { Accumulate } from './accumulate';

function isBigint(s: number | bigint): s is bigint {
  return typeof s === 'bigint';
}

export class Average<
  T extends number | bigint,
  K extends any = any
> extends Accumulate<T, K> {
  compute(filter?: (mark: K) => boolean): T {
    if (this.values.length === 0) return 0 as T;
    const sum = super.compute(filter);
    const newArr = this.filter(filter);
    if (isBigint(sum)) {
      return (sum / BigInt(newArr.length)) as T;
    }

    return (sum / newArr.length) as T;
  }
}
