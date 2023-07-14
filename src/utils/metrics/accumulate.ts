import { Metric } from './metric';

export class Accumulate<
  T extends number | bigint,
  K extends any = any
> extends Metric<T, T, K> {
  compute(filter?: (mark: K) => boolean): T {
    if (this.values.length === 0) return 0 as T;
    const t = typeof this.values[0] === 'bigint';
    const newArr = this.filter(filter);
    return newArr.reduce((a: any, b: any) => a + b, t ? 0n : 0) as T;
  }
}
