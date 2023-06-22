export abstract class Metric<T, R extends any> {
  protected values: T[];
  constructor(public name: string) {
    this.values = [];
  }

  add(value: T) {
    this.values.push(value);
  }

  compute(): R {
    throw new Error('not implemented');
  }
}
