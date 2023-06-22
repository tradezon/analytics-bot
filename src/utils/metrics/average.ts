import { Accumulate } from './accumulate';

function isBigint(s: number | bigint): s is bigint {
  return typeof s === 'bigint';
}

export class Average<T extends number | bigint> extends Accumulate<T> {
  compute(): T {
    const sum = super.compute();

    if (isBigint(sum)) {
      return (sum / BigInt(this.values.length)) as T;
    }

    return (sum / this.values.length) as T;
  }
}
