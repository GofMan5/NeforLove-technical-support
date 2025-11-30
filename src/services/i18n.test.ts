/**
 * Property-based tests for i18n System
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { I18nSystem, type TranslationFile } from './i18n';

// Arbitrary for generating valid locale codes (2-letter)
const localeArbitrary = fc.stringMatching(/^[a-z]{2}$/);

// Arbitrary for generating valid translation keys (dot notation)
const keyPartArbitrary = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_]{0,9}$/);
const translationKeyArbitrary = fc.array(keyPartArbitrary, { minLength: 1, maxLength: 3 })
  .map(parts => parts.join('.'));

// Arbitrary for generating translation values (non-empty strings)
const translationValueArbitrary = fc.string({ minLength: 1, maxLength: 50 })
  .filter(s => s.trim().length > 0);

// Helper to create nested translation object from key and value
function createNestedTranslation(key: string, value: string): TranslationFile {
  const parts = key.split('.');
  if (parts.length === 1) {
    return { [parts[0]]: value };
  }
  
  const result: TranslationFile = {};
  let current = result;
  
  for (let i = 0; i < parts.length - 1; i++) {
    current[parts[i]] = {};
    current = current[parts[i]] as TranslationFile;
  }
  current[parts[parts.length - 1]] = value;
  
  return result;
}

// Helper to merge translation objects
function mergeTranslations(base: TranslationFile, addition: TranslationFile): TranslationFile {
  const result = { ...base };
  
  for (const [key, value] of Object.entries(addition)) {
    if (typeof value === 'object' && typeof result[key] === 'object') {
      result[key] = mergeTranslations(result[key] as TranslationFile, value as TranslationFile);
    } else {
      result[key] = value;
    }
  }
  
  return result;
}

describe('i18n System Property Tests', () => {
  let i18n: I18nSystem;
  const defaultLocale = 'en';

  beforeEach(() => {
    i18n = new I18nSystem({
      defaultLocale,
      localesPath: './locales',
    });
  });

  describe('Translation Fallback', () => {
    it('should return translation from target locale when it exists', async () => {
      await fc.assert(
        fc.asyncProperty(
          localeArbitrary.filter(l => l !== defaultLocale),
          translationKeyArbitrary,
          translationValueArbitrary,
          async (locale, key, value) => {
            // Setup: add translation to target locale
            const translations = createNestedTranslation(key, value);
            i18n.setTranslations(locale, translations);
            
            // Also set default locale with different value
            const defaultValue = `default_${value}`;
            const defaultTranslations = createNestedTranslation(key, defaultValue);
            i18n.setTranslations(defaultLocale, defaultTranslations);

            // Act: get translation for target locale
            const result = i18n.t(key, locale);

            // Assert: should return target locale value
            expect(result).toBe(value);

            // Cleanup
            i18n.clear();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should fallback to default locale when key missing in target locale', async () => {
      await fc.assert(
        fc.asyncProperty(
          localeArbitrary.filter(l => l !== defaultLocale),
          translationKeyArbitrary,
          translationValueArbitrary,
          async (locale, key, value) => {
            // Setup: add translation only to default locale
            const defaultTranslations = createNestedTranslation(key, value);
            i18n.setTranslations(defaultLocale, defaultTranslations);
            
            // Set target locale with empty translations (no key)
            i18n.setTranslations(locale, {});

            // Act: get translation for target locale
            const result = i18n.t(key, locale);

            // Assert: should fallback to default locale value
            expect(result).toBe(value);

            // Cleanup
            i18n.clear();
          }
        ),
        { numRuns: 100 }
      );
    });


    it('should return key when translation missing in both locales', async () => {
      await fc.assert(
        fc.asyncProperty(
          localeArbitrary.filter(l => l !== defaultLocale),
          translationKeyArbitrary,
          async (locale, key) => {
            // Setup: set both locales with empty translations
            i18n.setTranslations(defaultLocale, {});
            i18n.setTranslations(locale, {});

            // Act: get translation for missing key
            const result = i18n.t(key, locale);

            // Assert: should return the key itself
            expect(result).toBe(key);

            // Cleanup
            i18n.clear();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should return key when locale does not exist and key missing in default', async () => {
      await fc.assert(
        fc.asyncProperty(
          localeArbitrary.filter(l => l !== defaultLocale),
          translationKeyArbitrary,
          async (locale, key) => {
            // Setup: only set default locale with empty translations
            i18n.setTranslations(defaultLocale, {});
            // Don't set target locale at all

            // Act: get translation for non-existent locale
            const result = i18n.t(key, locale);

            // Assert: should return the key itself
            expect(result).toBe(key);

            // Cleanup
            i18n.clear();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle nested keys correctly with fallback', async () => {
      await fc.assert(
        fc.asyncProperty(
          localeArbitrary.filter(l => l !== defaultLocale),
          fc.array(keyPartArbitrary, { minLength: 2, maxLength: 3 }),
          translationValueArbitrary,
          async (locale, keyParts, value) => {
            const key = keyParts.join('.');
            
            // Setup: add nested translation only to default locale
            const defaultTranslations = createNestedTranslation(key, value);
            i18n.setTranslations(defaultLocale, defaultTranslations);
            i18n.setTranslations(locale, {});

            // Act: get translation for target locale
            const result = i18n.t(key, locale);

            // Assert: should fallback to default locale value
            expect(result).toBe(value);

            // Cleanup
            i18n.clear();
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Translation Loading and Validation', () => {
    it('should validate correct translation file structure', () => {
      fc.assert(
        fc.property(
          fc.dictionary(
            keyPartArbitrary,
            fc.oneof(
              translationValueArbitrary,
              fc.dictionary(keyPartArbitrary, translationValueArbitrary, { minKeys: 1, maxKeys: 3 })
            ),
            { minKeys: 1, maxKeys: 5 }
          ),
          (translations) => {
            const isValid = i18n['validateTranslationFile'](translations);
            expect(isValid).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should reject invalid translation file structures', () => {
      // Arrays are not valid
      expect(i18n['validateTranslationFile']([])).toBe(false);
      // Null is not valid
      expect(i18n['validateTranslationFile'](null)).toBe(false);
      // Primitives are not valid
      expect(i18n['validateTranslationFile']('string')).toBe(false);
      expect(i18n['validateTranslationFile'](123)).toBe(false);
      // Objects with array values are not valid
      expect(i18n['validateTranslationFile']({ key: ['array'] })).toBe(false);
    });
  });

  describe('Locale Detection', () => {
    it('should detect available locale from context', () => {
      fc.assert(
        fc.property(
          localeArbitrary,
          (locale) => {
            // Setup: add locale
            i18n.setTranslations(locale, { test: 'value' });

            // Act: detect locale from context
            const detected = i18n.detectLocale({ from: { language_code: locale } });

            // Assert: should return the available locale
            expect(detected).toBe(locale);

            // Cleanup
            i18n.clear();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should fallback to default locale when user locale not available', () => {
      fc.assert(
        fc.property(
          localeArbitrary.filter(l => l !== defaultLocale),
          (locale) => {
            // Setup: only add default locale
            i18n.setTranslations(defaultLocale, { test: 'value' });

            // Act: detect locale from context with unavailable locale
            const detected = i18n.detectLocale({ from: { language_code: locale } });

            // Assert: should return default locale
            expect(detected).toBe(defaultLocale);

            // Cleanup
            i18n.clear();
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
