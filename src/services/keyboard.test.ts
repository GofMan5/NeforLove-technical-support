/**
 * Property-based tests for Keyboard Builder
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  KeyboardBuilder,
  InlineKeyboardBuilder,
  ReplyKeyboardBuilder,
  type InlineKeyboardMarkup,
  type ReplyKeyboardMarkup,
} from './keyboard.js';
import {
  CallbackDataSerializer,
  CallbackDataSizeError,
  TELEGRAM_CALLBACK_DATA_LIMIT,
} from './callback.js';

/**
 * Arbitrary for generating valid button text (non-empty strings)
 */
const buttonTextArbitrary = fc.string({ minLength: 1, maxLength: 50 });

/**
 * Arbitrary for generating valid URLs
 */
const urlArbitrary = fc.webUrl();

/**
 * Arbitrary for generating valid action names
 */
const actionArbitrary = fc.string({ minLength: 1, maxLength: 10 }).filter(s => s.trim().length > 0);

/**
 * Arbitrary for generating small payloads that fit within limit
 */
const smallPayloadArbitrary = fc.oneof(
  fc.string({ minLength: 0, maxLength: 10 }),
  fc.integer({ min: -1000, max: 1000 }),
  fc.boolean(),
  fc.constant(null)
);

/**
 * Arbitrary for generating payloads that will exceed the 64-byte limit
 */
const largePayloadArbitrary = fc.string({ minLength: 50, maxLength: 100 });

/**
 * Validates that an object is a valid InlineKeyboardMarkup
 */
function isValidInlineKeyboardMarkup(obj: unknown): obj is InlineKeyboardMarkup {
  if (typeof obj !== 'object' || obj === null) return false;
  const markup = obj as InlineKeyboardMarkup;
  
  if (!Array.isArray(markup.inline_keyboard)) return false;
  
  for (const row of markup.inline_keyboard) {
    if (!Array.isArray(row)) return false;
    for (const button of row) {
      if (typeof button !== 'object' || button === null) return false;
      if (typeof button.text !== 'string') return false;
      // Must have either callback_data or url (or neither for other button types)
      if (button.callback_data !== undefined && typeof button.callback_data !== 'string') return false;
      if (button.url !== undefined && typeof button.url !== 'string') return false;
    }
  }
  
  return true;
}

/**
 * Validates that an object is a valid ReplyKeyboardMarkup
 */
function isValidReplyKeyboardMarkup(obj: unknown): obj is ReplyKeyboardMarkup {
  if (typeof obj !== 'object' || obj === null) return false;
  const markup = obj as ReplyKeyboardMarkup;
  
  if (!Array.isArray(markup.keyboard)) return false;
  
  for (const row of markup.keyboard) {
    if (!Array.isArray(row)) return false;
    for (const button of row) {
      if (typeof button !== 'object' || button === null) return false;
      if (typeof button.text !== 'string') return false;
      if (button.request_contact !== undefined && typeof button.request_contact !== 'boolean') return false;
      if (button.request_location !== undefined && typeof button.request_location !== 'boolean') return false;
    }
  }
  
  // Optional fields validation
  if (markup.resize_keyboard !== undefined && typeof markup.resize_keyboard !== 'boolean') return false;
  if (markup.one_time_keyboard !== undefined && typeof markup.one_time_keyboard !== 'boolean') return false;
  if (markup.selective !== undefined && typeof markup.selective !== 'boolean') return false;
  
  return true;
}

describe('Keyboard Builder Property Tests', () => {
  describe('Keyboard Markup Validity', () => {
    it('should produce valid InlineKeyboardMarkup for any button configuration', async () => {
      type CallbackButton = { type: 'callback'; text: string; data: string };
      type UrlButton = { type: 'url'; text: string; url: string };
      type InlineButton = CallbackButton | UrlButton;

      const callbackButtonArb = fc.record({
        type: fc.constant('callback' as const),
        text: buttonTextArbitrary,
        data: fc.string({ minLength: 1, maxLength: 20 }),
      });

      const urlButtonArb = fc.record({
        type: fc.constant('url' as const),
        text: buttonTextArbitrary,
        url: urlArbitrary,
      });

      await fc.assert(
        fc.property(
          fc.array(
            fc.array(
              fc.oneof(callbackButtonArb, urlButtonArb) as fc.Arbitrary<InlineButton>,
              { minLength: 1, maxLength: 3 }
            ),
            { minLength: 1, maxLength: 5 }
          ),
          (rows) => {
            const builder = KeyboardBuilder.inline();
            
            for (const row of rows) {
              for (const button of row) {
                if (button.type === 'callback') {
                  builder.button(button.text, button.data);
                } else {
                  builder.url(button.text, button.url);
                }
              }
              builder.row();
            }
            
            const markup = builder.build();
            
            expect(isValidInlineKeyboardMarkup(markup)).toBe(true);
            expect(markup.inline_keyboard.length).toBeGreaterThan(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should produce valid ReplyKeyboardMarkup for any button configuration', async () => {
      await fc.assert(
        fc.property(
          fc.array(
            fc.array(
              fc.oneof(
                fc.record({ type: fc.constant('text'), text: buttonTextArbitrary }),
                fc.record({ type: fc.constant('contact'), text: buttonTextArbitrary }),
                fc.record({ type: fc.constant('location'), text: buttonTextArbitrary })
              ),
              { minLength: 1, maxLength: 3 }
            ),
            { minLength: 1, maxLength: 5 }
          ),
          fc.boolean(),
          fc.boolean(),
          fc.boolean(),
          (rows, resize, oneTime, selective) => {
            const builder = KeyboardBuilder.reply();
            
            for (const row of rows) {
              for (const button of row) {
                if (button.type === 'text') {
                  builder.button(button.text);
                } else if (button.type === 'contact') {
                  builder.requestContact(button.text);
                } else {
                  builder.requestLocation(button.text);
                }
              }
              builder.row();
            }
            
            if (resize) builder.resize();
            if (oneTime) builder.oneTime();
            if (selective) builder.selective();
            
            const markup = builder.build();
            
            expect(isValidReplyKeyboardMarkup(markup)).toBe(true);
            expect(markup.keyboard.length).toBeGreaterThan(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should produce valid markup even with single button', async () => {
      await fc.assert(
        fc.property(buttonTextArbitrary, fc.string({ minLength: 1, maxLength: 20 }), (text, data) => {
          const inlineMarkup = KeyboardBuilder.inline().button(text, data).build();
          const replyMarkup = KeyboardBuilder.reply().button(text).build();
          
          expect(isValidInlineKeyboardMarkup(inlineMarkup)).toBe(true);
          expect(isValidReplyKeyboardMarkup(replyMarkup)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('should produce valid empty keyboard when no buttons added', () => {
      const inlineMarkup = KeyboardBuilder.inline().build();
      const replyMarkup = KeyboardBuilder.reply().build();
      
      expect(isValidInlineKeyboardMarkup(inlineMarkup)).toBe(true);
      expect(isValidReplyKeyboardMarkup(replyMarkup)).toBe(true);
      expect(inlineMarkup.inline_keyboard).toEqual([]);
      expect(replyMarkup.keyboard).toEqual([]);
    });
  });
});

describe('Callback Data Serializer Property Tests', () => {
  const serializer = new CallbackDataSerializer();

  describe('Callback Data Round-Trip', () => {
    it('should round-trip action and payload correctly', async () => {
      await fc.assert(
        fc.property(actionArbitrary, smallPayloadArbitrary, (action, payload) => {
          try {
            const serialized = serializer.serialize(action, payload);
            const deserialized = serializer.deserialize(serialized);
            
            expect(deserialized.action).toBe(action);
            expect(deserialized.payload).toEqual(payload);
          } catch (error) {
            // If serialization fails due to size, that's acceptable
            if (error instanceof CallbackDataSizeError) {
              return;
            }
            throw error;
          }
        }),
        { numRuns: 100 }
      );
    });

    it('should round-trip with object payloads', async () => {
      await fc.assert(
        fc.property(
          actionArbitrary,
          fc.record({
            id: fc.integer({ min: 0, max: 999 }),
            flag: fc.boolean(),
          }),
          (action, payload) => {
            try {
              const serialized = serializer.serialize(action, payload);
              const deserialized = serializer.deserialize<typeof payload>(serialized);
              
              expect(deserialized.action).toBe(action);
              expect(deserialized.payload).toEqual(payload);
            } catch (error) {
              if (error instanceof CallbackDataSizeError) {
                return;
              }
              throw error;
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should validate serialized data correctly', async () => {
      await fc.assert(
        fc.property(actionArbitrary, smallPayloadArbitrary, (action, payload) => {
          try {
            const serialized = serializer.serialize(action, payload);
            expect(serializer.validate(serialized)).toBe(true);
          } catch (error) {
            if (error instanceof CallbackDataSizeError) {
              return;
            }
            throw error;
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Callback Data Size Validation', () => {
    it('should throw error when serialized data exceeds 64 bytes', async () => {
      await fc.assert(
        fc.property(largePayloadArbitrary, (payload) => {
          // Use a long action to ensure we exceed the limit
          const action = 'action';
          
          expect(() => serializer.serialize(action, payload)).toThrow(CallbackDataSizeError);
        }),
        { numRuns: 100 }
      );
    });

    it('should accept data exactly at or below 64 bytes', async () => {
      // Create data that's exactly at the limit
      const action = 'a';
      // {"action":"a","payload":""} = 27 bytes, leaving 37 for payload
      const payload = 'x'.repeat(35); // Should be just under limit
      
      expect(() => serializer.serialize(action, payload)).not.toThrow();
      
      const serialized = serializer.serialize(action, payload);
      expect(serializer.getByteLength(serialized)).toBeLessThanOrEqual(TELEGRAM_CALLBACK_DATA_LIMIT);
    });

    it('should validate returns false for oversized data', async () => {
      await fc.assert(
        fc.property(
          fc.string({ minLength: 65, maxLength: 100 }),
          (data) => {
            expect(serializer.validate(data)).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should validate returns false for invalid JSON', async () => {
      await fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 60 }).filter(s => {
            try {
              JSON.parse(s);
              return false; // Valid JSON, skip
            } catch {
              return true; // Invalid JSON, keep
            }
          }),
          (data) => {
            expect(serializer.validate(data)).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should report correct byte length', async () => {
      await fc.assert(
        fc.property(fc.string({ minLength: 0, maxLength: 100 }), (data) => {
          const byteLength = serializer.getByteLength(data);
          const expectedLength = Buffer.byteLength(data, 'utf8');
          
          expect(byteLength).toBe(expectedLength);
        }),
        { numRuns: 100 }
      );
    });
  });
});
