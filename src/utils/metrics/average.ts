import { Accumulate } from './accumulate';

export class Average extends Accumulate {
  compute() {
    const sum = super.compute();
    return sum / this.values.length;
  }
}
