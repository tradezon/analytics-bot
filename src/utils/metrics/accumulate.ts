import { Metric } from './metric';

export class Accumulate extends Metric<number, number> {
  compute() {
    if (this.values.length === 0) return 0;
    return this.values.reduce((a, b) => a + b, 0);
  }
}
