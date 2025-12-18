/**
 * i18n System
 * Internationalization support with translation loading, lookup, and fallback
 */

import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';

export interface TranslationFile {
  [key: string]: string | TranslationFile;
}

export interface I18nOptions {
  defaultLocale: string;
  localesPath: string;
}

export class I18nError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'I18nError';
  }
}

export class I18nSystem {
  private translations: Map<string, TranslationFile> = new Map();
  private defaultLocale: string;
  private localesPath: string;
  private missingKeyWarnings: Set<string> = new Set();

  constructor(options: I18nOptions) {
    this.defaultLocale = options.defaultLocale;
    this.localesPath = options.localesPath;
  }

  loadTranslations(localesPath?: string): void {
    const targetPath = localesPath || this.localesPath;

    if (!fs.existsSync(targetPath)) {
      throw new I18nError(`Locales directory not found: ${targetPath}`);
    }

    const files = fs.readdirSync(targetPath);
    const jsonFiles = files.filter(f => f.endsWith('.json'));

    if (jsonFiles.length === 0) {
      throw new I18nError(`No translation files found in: ${targetPath}`);
    }

    for (const file of jsonFiles) {
      const locale = path.basename(file, '.json');
      const filePath = path.join(targetPath, file);
      
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const translations = JSON.parse(content);
        
        if (!this.validateTranslationFile(translations)) {
          throw new I18nError(`Invalid translation file format: ${file}`);
        }
        
        this.translations.set(locale, translations);
      } catch (error) {
        if (error instanceof SyntaxError) {
          throw new I18nError(`Invalid JSON in translation file: ${file}`);
        }
        throw error;
      }
    }
  }

  /**
   * Load translations asynchronously (non-blocking)
   */
  async loadTranslationsAsync(localesPath?: string): Promise<void> {
    const targetPath = localesPath || this.localesPath;

    try {
      await fsp.access(targetPath);
    } catch {
      throw new I18nError(`Locales directory not found: ${targetPath}`);
    }

    const files = await fsp.readdir(targetPath);
    const jsonFiles = files.filter(f => f.endsWith('.json'));

    if (jsonFiles.length === 0) {
      throw new I18nError(`No translation files found in: ${targetPath}`);
    }

    // Load all files in parallel
    await Promise.all(jsonFiles.map(async (file) => {
      const locale = path.basename(file, '.json');
      const filePath = path.join(targetPath, file);
      
      try {
        const content = await fsp.readFile(filePath, 'utf-8');
        const translations = JSON.parse(content);
        
        if (!this.validateTranslationFile(translations)) {
          throw new I18nError(`Invalid translation file format: ${file}`);
        }
        
        this.translations.set(locale, translations);
      } catch (error) {
        if (error instanceof SyntaxError) {
          throw new I18nError(`Invalid JSON in translation file: ${file}`);
        }
        throw error;
      }
    }));
  }

  validateTranslationFile(obj: unknown): obj is TranslationFile {
    if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
      return false;
    }

    for (const value of Object.values(obj)) {
      if (typeof value === 'string') {
        continue;
      }
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        if (!this.validateTranslationFile(value)) {
          return false;
        }
        continue;
      }
      return false;
    }

    return true;
  }

  /**
   * Get nested value from translation object using dot notation
   */
  private getNestedValue(obj: TranslationFile, key: string): string | undefined {
    const parts = key.split('.');
    let current: TranslationFile | string = obj;

    for (const part of parts) {
      if (typeof current !== 'object' || current === null) {
        return undefined;
      }
      current = current[part];
      if (current === undefined) {
        return undefined;
      }
    }

    return typeof current === 'string' ? current : undefined;
  }

  /**
   * Interpolate parameters into translation string
   */
  private interpolate(text: string, params?: Record<string, string>): string {
    if (!params) {
      return text;
    }

    return text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      return params[key] !== undefined ? params[key] : match;
    });
  }


  /**
   * Translate a key with optional locale and parameters
   * Implements fallback: locale -> defaultLocale -> key
   */
  t(key: string, locale?: string, params?: Record<string, string>): string {
    const targetLocale = locale || this.defaultLocale;

    // Try target locale first
    const targetTranslations = this.translations.get(targetLocale);
    if (targetTranslations) {
      const value = this.getNestedValue(targetTranslations, key);
      if (value !== undefined) {
        return this.interpolate(value, params);
      }
    }

    // Fallback to default locale if different
    if (targetLocale !== this.defaultLocale) {
      const defaultTranslations = this.translations.get(this.defaultLocale);
      if (defaultTranslations) {
        const value = this.getNestedValue(defaultTranslations, key);
        if (value !== undefined) {
          return this.interpolate(value, params);
        }
      }
    }

    // Log warning for missing key (only once per key)
    const warningKey = `${targetLocale}:${key}`;
    if (!this.missingKeyWarnings.has(warningKey)) {
      this.missingKeyWarnings.add(warningKey);
      console.warn(`[i18n] Missing translation key: "${key}" for locale: "${targetLocale}"`);
    }

    // Return the key itself as last resort
    return key;
  }

  detectLocale(ctx: { from?: { language_code?: string } }): string {
    const userLocale = ctx.from?.language_code;
    
    if (userLocale && this.translations.has(userLocale)) {
      return userLocale;
    }

    // Try base language (e.g., 'en' from 'en-US')
    if (userLocale && userLocale.includes('-')) {
      const baseLocale = userLocale.split('-')[0];
      if (this.translations.has(baseLocale)) {
        return baseLocale;
      }
    }

    return this.defaultLocale;
  }

  /**
   * Get list of available locales
   */
  getAvailableLocales(): string[] {
    return Array.from(this.translations.keys());
  }

  /**
   * Check if a translation exists for a key in a specific locale
   */
  hasTranslation(key: string, locale: string): boolean {
    const translations = this.translations.get(locale);
    if (!translations) {
      return false;
    }
    return this.getNestedValue(translations, key) !== undefined;
  }

  /**
   * Get the default locale
   */
  getDefaultLocale(): string {
    return this.defaultLocale;
  }

  /**
   * Set translations directly (useful for testing)
   */
  setTranslations(locale: string, translations: TranslationFile): void {
    if (!this.validateTranslationFile(translations)) {
      throw new I18nError('Invalid translation file format');
    }
    this.translations.set(locale, translations);
  }

  /**
   * Clear all loaded translations
   */
  clear(): void {
    this.translations.clear();
    this.missingKeyWarnings.clear();
  }
}
