import { Metric } from './metric';

export class Median extends Metric<number, number> {
  compute() {
    const idx = Math.floor(this.values.length / 2);
    return this.values[idx];
  }
}
