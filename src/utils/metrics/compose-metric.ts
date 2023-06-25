import { Metric } from './metric';

export class ComposeMetric<T extends number | bigint> extends Metric<T, T> {
  private metrics: Array<Metric<T, T>>;
  constructor(...metrics: Array<Metric<T, T>>) {
    super('compose');
    this.metrics = metrics;
  }

  add(value: T) {
    this.metrics.forEach((m) => m.add(value));
  }
}
