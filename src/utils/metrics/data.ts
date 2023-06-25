import { Metric } from './metric';

interface MetricConstructor<T extends bigint | number, K extends any = any> {
  new (name: string, values: T[], marks: Array<K | undefined>): Metric<T, T, K>;
}
export class MetricData<T extends bigint | number, K extends any = any> {
  private values: T[] = [];
  private marks: Array<K | undefined> = [];

  add(value: T, mark?: K) {
    this.values.push(value);
    this.marks.push(mark);
  }

  toMetric(Constructor: MetricConstructor<T, K>, name: string) {
    return new Constructor(name, this.values, this.marks);
  }
}
