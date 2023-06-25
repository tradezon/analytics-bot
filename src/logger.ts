import { getLogger as getLog4jsLogger, Logger } from 'log4js';

export enum LogLevel {
  warn = 'warn',
  error = 'error',
  fatal = 'fatal',
  info = 'info',
  debug = 'debug',
  trace = 'trace'
}

export function isLogLevel(level: string): level is LogLevel {
  switch (level) {
    case LogLevel.trace:
    case LogLevel.debug:
    case LogLevel.info:
    case LogLevel.warn:
    case LogLevel.error:
    case LogLevel.fatal:
      return true;
    default:
      return false;
  }
}

const logger = getLog4jsLogger();

export default logger;

function formatLog<T extends string | number | boolean>(
  obj: Record<string, T>
): string[] {
  return Object.keys(obj).map((k: string) => `${k}=${obj[k]}`);
}
