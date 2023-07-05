import invariant from 'invariant';

export function ratelimit<T extends any[], R>(
  fn: (...args: T) => Promise<R>,
  { limit, delayMs }: { limit: number; delayMs: number }
): (...args: T) => Promise<R> {
  invariant(limit > 0, 'Limit should be greater than 0');
  invariant(delayMs > 0, 'Delay should be greater than 0');
  let onFly = false;
  const startWindow = () => new Promise((res) => setTimeout(res, delayMs));

  let stack: [T, (arg: R) => void, (error: any) => void][] = [];

  const run_ = async () => {
    let promises = [];
    for (let i = 0; i < stack.length; i++) {
      const [args, res, rej] = stack[i];
      promises.push(
        fn(...args)
          .then(res)
          .catch(rej)
      );
      if (promises.length === limit || stack.length === i + 1) {
        await Promise.all([...promises, startWindow()]);
        promises = [];
      }
    }

    stack = [];
    onFly = false;
  };

  return (...args) =>
    new Promise<R>((res, rej) => {
      stack.push([args, res, rej]);
      if (!onFly) {
        onFly = true;
        setImmediate(run_);
      }
    });
}
