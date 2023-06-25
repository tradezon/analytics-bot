export abstract class Metric<T, R extends any, K extends any> {
  protected values: T[] = [];
  protected marks: Array<K | undefined> = [];
  constructor(public name: string) {}

  add(value: T, mark?: K) {
    this.values.push(value);
    this.marks.push(mark);
  }

  protected filter(filter?: (mark: K) => boolean) {
    return filter
      ? this.values.filter(
          (v, i) => this.marks[i] && filter(this.marks[i] as K)
        )
      : this.values;
  }

  compute(filter?: (mark: K) => boolean): R {
    throw new Error('not implemented');
  }
}
