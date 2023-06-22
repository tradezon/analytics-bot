import invariant from 'invariant';

export function retry<T extends any[], R>(
  fn: (...args: T) => Promise<R>,
  { limit, delayMs }: { limit: number; delayMs: number }
): (...args: T) => Promise<R> {
  invariant(limit > 0, 'Limit should be greater than 0');
  invariant(delayMs > 0, 'Delay should be greater than 0');
  return (...args) => {
    let tries = 0;
    const innerFunction: (...args: T) => Promise<R> = async (...args) => {
      tries++;
      try {
        const r = await fn(...args);
        tries = 0;
        return r;
      } catch (e: any) {
        if (tries === limit) throw e;
        return new Promise<R>((res, rej) => {
          setTimeout(() => {
            innerFunction(...args)
              .then(res)
              .catch(rej);
          }, delayMs).unref();
        });
      }
    };
    return innerFunction(...args);
  };
}
