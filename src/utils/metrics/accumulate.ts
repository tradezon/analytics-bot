import { Metric } from './metric';

export class Accumulate<T extends number | bigint> extends Metric<T, T> {
  compute(): T {
    const t = typeof this.values[0] === 'bigint';
    if (this.values.length === 0) return (t ? 0n : 0) as T;
    return this.values.reduce((a: any, b: any) => a + b, t ? 0n : 0) as T;
  }
}
