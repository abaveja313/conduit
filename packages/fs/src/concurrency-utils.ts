import { createLogger } from '@conduit/shared';

const logger = createLogger('concurrency-utils');

export function getOptimalConcurrency(): number {
  const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
  const optimalConcurrency = Math.min(cores * 2, 16);
  logger.info(`Detected ${cores} CPU cores, using concurrency: ${optimalConcurrency}`);
  return optimalConcurrency;
}
