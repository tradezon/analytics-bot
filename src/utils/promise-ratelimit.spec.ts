import { ratelimit } from './promise-ratelimit';

it('should validate arguments', () => {
  expect(() =>
    ratelimit(() => Promise.resolve(2), { limit: 0, delayMs: 1000 })
  ).toThrow();
  expect(() =>
    ratelimit(() => Promise.resolve(2), { limit: 1, delayMs: 0 })
  ).toThrow();
});

it('should resolve', async () => {
  const fn = ratelimit(() => Promise.resolve(2), { limit: 2, delayMs: 1000 });
  expect(await fn()).toBe(2);
});

it('should reject', async () => {
  const fn = ratelimit(() => Promise.reject(2), { limit: 2, delayMs: 1000 });
  expect(fn).rejects.toBe(2);
});

it('should respect settings #1', async () => {
  const fn = ratelimit(() => Promise.resolve(2), { limit: 2, delayMs: 1000 });
  const now = Date.now();

  const promises = [];

  for (let i = 0; i < 5; i++) {
    promises.push(fn().then((v) => expect(v).toBe(2)));
  }

  await Promise.all(promises);

  // promise resolves earlier then window
  expect(Date.now() - now).toBeGreaterThan(2000);
  expect(Date.now() - now).toBeLessThan(3000);
}, 5_000);

it('should respect settings #2', async () => {
  const fn = ratelimit(() => Promise.resolve(2), { limit: 2, delayMs: 1000 });
  const now = Date.now();

  const promises = [];

  for (let i = 0; i < 7; i++) {
    promises.push(fn().then((v) => expect(v).toBe(2)));
  }

  await Promise.all(promises);

  // promise resolves earlier then window
  expect(Date.now() - now).toBeGreaterThan(3000);
  expect(Date.now() - now).toBeLessThan(4000);
}, 5_000);

it('should wait of resolving promise', async () => {
  const fn = ratelimit(
    () => new Promise((res) => setTimeout(() => res(2), 2000)),
    { limit: 2, delayMs: 1000 }
  );
  const now = Date.now();
  const promises = [];

  for (let i = 0; i < 4; i++) {
    promises.push(fn().then((v) => expect(v).toBe(2)));
  }

  await Promise.all(promises);

  expect(Date.now() - now).toBeGreaterThan(4000);
}, 7_000);
