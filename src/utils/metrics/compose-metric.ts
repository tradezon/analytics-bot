import { Metric } from './metric';

export class ComposeMetric<
  T extends number | bigint,
  K extends any = any
> extends Metric<T, T, K> {
  private metrics: Array<Metric<T, T, K>>;
  constructor(...metrics: Array<Metric<T, T, K>>) {
    super('compose');
    this.metrics = metrics;
  }

  add(value: T, mark: K) {
    this.metrics.forEach((m) => m.add(value, mark));
  }
}
