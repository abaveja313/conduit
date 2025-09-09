import { createConsola } from 'consola';
import { isDevelopment, isTest, isCI } from 'std-env';

export function createLogger(packageName: string) {
    const getLogLevel = () => {
        if (isTest) return 1;           // Warnings/errors only in tests
        if (isCI) return 2;             // Normal logs in CI  
        if (isDevelopment) return 4;    // Debug level for local dev
        return 3;                       // Info level for production
    };

    const logger = createConsola({
        level: getLogLevel(),
        formatOptions: {
            date: isDevelopment,
            colors: !isCI && !isTest,
        }
    });

    return logger.withTag(packageName);
}