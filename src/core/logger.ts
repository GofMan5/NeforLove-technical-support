/**
 * Logger System
 * Provides configurable logging with level filtering
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: Date;
  context?: Record<string, unknown>;
}

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, error?: Error, context?: Record<string, unknown>): void;
  setLevel(level: LogLevel): void;
  getLevel(): LogLevel;
}

/**
 * Log level priority mapping
 * Higher number = higher priority
 */
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Checks if a log entry should be output based on current level
 */
export function shouldLog(entryLevel: LogLevel, configuredLevel: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[entryLevel] >= LOG_LEVEL_PRIORITY[configuredLevel];
}

/**
 * Output handler type for customizable log output
 */
export type LogOutput = (entry: LogEntry) => void;

/**
 * Default console output handler
 */
export const consoleOutput: LogOutput = (entry: LogEntry) => {
  const timestamp = entry.timestamp.toISOString();
  const contextStr = entry.context ? ` ${JSON.stringify(entry.context)}` : '';
  const message = `[${timestamp}] [${entry.level.toUpperCase()}] ${entry.message}${contextStr}`;

  switch (entry.level) {
    case 'debug':
      console.debug(message);
      break;
    case 'info':
      console.info(message);
      break;
    case 'warn':
      console.warn(message);
      break;
    case 'error':
      console.error(message);
      break;
  }
};

/**
 * Logger implementation with configurable levels
 * Supports debug, info, warn, error levels with filtering
 */
export class LoggerImpl implements Logger {
  private level: LogLevel;
  private output: LogOutput;

  constructor(level: LogLevel = 'info', output: LogOutput = consoleOutput) {
    this.level = level;
    this.output = output;
  }

  private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (!shouldLog(level, this.level)) {
      return;
    }

    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date(),
      context,
    };

    this.output(entry);
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log('debug', message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log('info', message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log('warn', message, context);
  }

  error(message: string, error?: Error, context?: Record<string, unknown>): void {
    const errorContext: Record<string, unknown> = {
      ...context,
    };

    if (error) {
      errorContext.errorMessage = error.message;
      errorContext.errorStack = error.stack;
    }

    this.log('error', message, Object.keys(errorContext).length > 0 ? errorContext : undefined);
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  getLevel(): LogLevel {
    return this.level;
  }
}

// Singleton instance
let loggerInstance: Logger | null = null;

export function getLogger(level?: LogLevel): Logger {
  if (!loggerInstance) {
    loggerInstance = new LoggerImpl(level);
  }
  return loggerInstance;
}

export function createLogger(level: LogLevel = 'info', output?: LogOutput): Logger {
  return new LoggerImpl(level, output);
}

export function resetLogger(): void {
  loggerInstance = null;
}
