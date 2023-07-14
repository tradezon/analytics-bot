import convertHrtime from 'convert-hrtime';
import logger from '../../logger';

export async function withTimingsAsync(
  fn: () => Promise<void>,
  callback: (seconds: number, ms: number) => string
) {
  const before = process.hrtime.bigint();
  await fn();
  const { seconds, milliseconds } = convertHrtime(
    process.hrtime.bigint() - before
  );
  logger.debug(callback(seconds, milliseconds));
}

export function withTimings(
  fn: () => void,
  callback: (seconds: number, ms: number) => string
) {
  const before = process.hrtime.bigint();
  fn();
  const { seconds, milliseconds } = convertHrtime(
    process.hrtime.bigint() - before
  );
  logger.debug(callback(seconds, milliseconds));
}
