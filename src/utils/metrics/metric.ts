export abstract class Metric<T, R> {
  protected values: T[];
  constructor(public name: string) {}

  add(value: T) {
    this.values.push(value);
  }

  compute(): R {
    return;
  }
}
