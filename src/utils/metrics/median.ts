import { Metric } from './metric';

export class Median<K extends any = any> extends Metric<number, number, K> {
  compute(filter?: (mark: K) => boolean) {
    if (this.values.length === 0) return 0;
    const newArr = this.filter(filter);
    const idx = Math.floor(newArr.length / 2);
    return newArr.slice().sort()[idx];
  }
}
