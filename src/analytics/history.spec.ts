import { to100Percents, to100PercentsBigInt } from './history';

it('should correctly measure percents', () => {
  expect(to100Percents(10, 100)).toBe(1000);
  expect(to100Percents(100, -10)).toBe(-10);
});

it('should correctly measure percents bigint', () => {
  expect(to100PercentsBigInt(10n, 100n)).toBe(1000);
  expect(to100PercentsBigInt(100n, -10n)).toBe(-10);
});
