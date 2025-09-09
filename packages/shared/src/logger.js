"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createLogger = createLogger;
var consola_1 = require("consola");
var std_env_1 = require("std-env");
function createLogger(packageName) {
    var getLogLevel = function () {
        if (std_env_1.isTest)
            return 1; // Warnings/errors only in tests
        if (std_env_1.isCI)
            return 2; // Normal logs in CI  
        if (std_env_1.isDevelopment)
            return 4; // Debug level for local dev
        return 3; // Info level for production
    };
    var logger = (0, consola_1.createConsola)({
        level: getLogLevel(),
        fancy: false,
        formatOptions: {
            date: std_env_1.isDevelopment,
            colors: !std_env_1.isCI && !std_env_1.isTest,
        }
    });
    return logger.withTag(packageName);
}
