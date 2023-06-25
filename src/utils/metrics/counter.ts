import { Accumulate } from './accumulate';

export class Counter extends Accumulate<number, never> {
  inc(num = 1) {
    this.values.push(num);
  }

  add(value: number) {
    throw new Error('Counter cant add');
  }
}
