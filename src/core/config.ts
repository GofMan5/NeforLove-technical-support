/**
 * Config System
 * Loads and validates configuration from environment variables
 */

import 'dotenv/config';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface BotConfig {
  bot: {
    token: string;
    adminIds: number[];
    supportGroupId: number;
  };
  database: {
    path: string;
  };
  logging: {
    level: LogLevel;
  };
  i18n: {
    defaultLocale: string;
    localesPath: string;
  };
}

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

const LOG_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];

function isValidLogLevel(value: string): value is LogLevel {
  return LOG_LEVELS.includes(value as LogLevel);
}

function parseAdminIds(value: string | undefined): number[] {
  if (!value || value.trim() === '') {
    return [];
  }
  
  const ids = value.split(',').map(id => {
    const trimmed = id.trim();
    const parsed = parseInt(trimmed, 10);
    if (isNaN(parsed)) {
      throw new ConfigurationError(`Invalid admin ID: "${trimmed}" is not a valid number`);
    }
    return parsed;
  });
  
  return ids;
}


/**
 * Validates a raw config object against the BotConfig schema
 * Throws ConfigurationError if validation fails
 */
export function validateConfig(config: unknown): config is BotConfig {
  if (typeof config !== 'object' || config === null) {
    throw new ConfigurationError('Config must be an object');
  }

  const cfg = config as Record<string, unknown>;

  // Validate bot section
  if (typeof cfg.bot !== 'object' || cfg.bot === null) {
    throw new ConfigurationError('Missing required config section: bot');
  }
  const bot = cfg.bot as Record<string, unknown>;
  
  if (typeof bot.token !== 'string' || bot.token.trim() === '') {
    throw new ConfigurationError('Missing required config: bot.token must be a non-empty string');
  }
  
  if (!Array.isArray(bot.adminIds)) {
    throw new ConfigurationError('Invalid config: bot.adminIds must be an array');
  }
  
  for (const id of bot.adminIds) {
    if (typeof id !== 'number' || !Number.isInteger(id)) {
      throw new ConfigurationError('Invalid config: bot.adminIds must contain only integers');
    }
  }

  // Validate database section
  if (typeof cfg.database !== 'object' || cfg.database === null) {
    throw new ConfigurationError('Missing required config section: database');
  }
  const database = cfg.database as Record<string, unknown>;
  
  if (typeof database.path !== 'string' || database.path.trim() === '') {
    throw new ConfigurationError('Missing required config: database.path must be a non-empty string');
  }

  // Validate logging section
  if (typeof cfg.logging !== 'object' || cfg.logging === null) {
    throw new ConfigurationError('Missing required config section: logging');
  }
  const logging = cfg.logging as Record<string, unknown>;
  
  if (typeof logging.level !== 'string' || !isValidLogLevel(logging.level)) {
    throw new ConfigurationError(
      `Invalid config: logging.level must be one of: ${LOG_LEVELS.join(', ')}`
    );
  }

  // Validate i18n section
  if (typeof cfg.i18n !== 'object' || cfg.i18n === null) {
    throw new ConfigurationError('Missing required config section: i18n');
  }
  const i18n = cfg.i18n as Record<string, unknown>;
  
  if (typeof i18n.defaultLocale !== 'string' || i18n.defaultLocale.trim() === '') {
    throw new ConfigurationError('Missing required config: i18n.defaultLocale must be a non-empty string');
  }
  
  if (typeof i18n.localesPath !== 'string' || i18n.localesPath.trim() === '') {
    throw new ConfigurationError('Missing required config: i18n.localesPath must be a non-empty string');
  }

  return true;
}


/**
 * Loads configuration from environment variables
 * Returns a validated BotConfig object
 */
export function loadConfigFromEnv(env: Record<string, string | undefined> = process.env): BotConfig {
  const token = env.BOT_TOKEN;
  if (!token || token.trim() === '') {
    throw new ConfigurationError('Missing required environment variable: BOT_TOKEN');
  }

  const databasePath = env.DATABASE_PATH;
  if (!databasePath || databasePath.trim() === '') {
    throw new ConfigurationError('Missing required environment variable: DATABASE_PATH');
  }

  const logLevel = env.LOG_LEVEL || 'info';
  if (!isValidLogLevel(logLevel)) {
    throw new ConfigurationError(
      `Invalid LOG_LEVEL: "${logLevel}". Must be one of: ${LOG_LEVELS.join(', ')}`
    );
  }

  const defaultLocale = env.DEFAULT_LOCALE;
  if (!defaultLocale || defaultLocale.trim() === '') {
    throw new ConfigurationError('Missing required environment variable: DEFAULT_LOCALE');
  }

  const localesPath = env.LOCALES_PATH;
  if (!localesPath || localesPath.trim() === '') {
    throw new ConfigurationError('Missing required environment variable: LOCALES_PATH');
  }

  const supportGroupId = env.SUPPORT_GROUP_ID;
  if (!supportGroupId || supportGroupId.trim() === '') {
    throw new ConfigurationError('Missing required environment variable: SUPPORT_GROUP_ID');
  }

  const config: BotConfig = {
    bot: {
      token: token.trim(),
      adminIds: parseAdminIds(env.ADMIN_IDS),
      supportGroupId: parseInt(supportGroupId.trim(), 10),
    },
    database: {
      path: databasePath.trim(),
    },
    logging: {
      level: logLevel,
    },
    i18n: {
      defaultLocale: defaultLocale.trim(),
      localesPath: localesPath.trim(),
    },
  };

  return config;
}

/**
 * ConfigLoader class providing type-safe access to configuration
 */
export class ConfigLoader {
  private config: BotConfig | null = null;

  load(env: Record<string, string | undefined> = process.env): BotConfig {
    this.config = loadConfigFromEnv(env);
    return this.config;
  }

  validate(config: unknown): config is BotConfig {
    return validateConfig(config);
  }

  get<K extends keyof BotConfig>(key: K): BotConfig[K] {
    if (!this.config) {
      throw new ConfigurationError('Config not loaded. Call load() first.');
    }
    return this.config[key];
  }

  getConfig(): BotConfig {
    if (!this.config) {
      throw new ConfigurationError('Config not loaded. Call load() first.');
    }
    return this.config;
  }
}

// Singleton instance for convenience
let configInstance: ConfigLoader | null = null;

export function getConfigLoader(): ConfigLoader {
  if (!configInstance) {
    configInstance = new ConfigLoader();
  }
  return configInstance;
}

export function resetConfigLoader(): void {
  configInstance = null;
}
