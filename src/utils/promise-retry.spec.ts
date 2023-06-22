import { retry } from './promise-retry';

it('should validate arguments', () => {
  expect(() =>
    retry(() => Promise.resolve(2), { limit: 0, delayMs: 1000 })
  ).toThrow();
  expect(() =>
    retry(() => Promise.resolve(2), { limit: 1, delayMs: 0 })
  ).toThrow();
});

it('should resolve', async () => {
  const fn = retry(() => Promise.resolve(2), { limit: 2, delayMs: 1000 });
  expect(await fn()).toBe(2);
});

it('should catch error on limits #1', async () => {
  const fn = retry(() => Promise.reject(2), { limit: 3, delayMs: 1000 });
  const now = Date.now();
  let thrown = false;
  try {
    await fn();
  } catch (e: any) {
    expect(e).toBe(2);
    thrown = true;
  }
  expect(thrown).toBe(true);
  expect(Date.now() - now).toBeGreaterThan(2000);
}, 4000);

it('should catch error on limits #2', async () => {
  const fn = retry(() => Promise.reject(2), { limit: 1, delayMs: 1000 });
  const now = Date.now();
  let thrown = false;
  try {
    await fn();
  } catch (e: any) {
    expect(e).toBe(2);
    thrown = true;
  }
  expect(thrown).toBe(true);
  expect(Date.now() - now).toBeLessThan(1000);
}, 1500);

it('should resolve eventually', async () => {
  const fn = retry(
    (() => {
      let tries = 0;
      return () => (tries++ > 1 ? Promise.resolve(2) : Promise.reject(2));
    })(),
    { limit: 3, delayMs: 1000 }
  );
  const now = Date.now();
  let thrown = false;
  try {
    const r = await fn();
    expect(r).toBe(2);
  } catch {
    thrown = true;
  }
  expect(thrown).toBe(false);
  expect(Date.now() - now).toBeGreaterThan(2000);
}, 4000);

it('should have tries count per call', async () => {
  const fn = retry(
    (() => {
      let tries = 0;
      return () => (tries++ > 1 ? Promise.resolve(2) : Promise.reject(2));
    })(),
    { limit: 2, delayMs: 1000 }
  );
  let thrown = false;
  try {
    const [r0, r1] = await Promise.all([fn(), fn()]);
    expect(r0).toBe(2);
    expect(r1).toBe(2);
  } catch {
    thrown = true;
  }
  expect(thrown).toBe(false);
}, 2000);
