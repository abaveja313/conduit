export function getOptimalConcurrency(): number {
  // Default to 4 cores if we can't detect (e.g., during SSR/build)
  const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
  const optimalConcurrency = Math.min(cores * 2, 16);
  return optimalConcurrency;
}
