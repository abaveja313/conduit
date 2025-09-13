import { createConsola } from 'consola';
import type { ConsolaInstance } from 'consola';
import { isDevelopment, isTest, isCI } from 'std-env';

export type Logger = ConsolaInstance;

export function createLogger(packageName: string): Logger {
  const getLogLevel = () => {
    if (isTest) return 1;
    if (isDevelopment) return 4;
    if (isCI) return 2;
    return 3;
  };

  const logger = createConsola({
    level: getLogLevel(),
    formatOptions: {
      date: isDevelopment,
      colors: !isCI && !isTest,
    },
  });

  return logger.withTag(packageName);
}
