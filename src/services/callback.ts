/**
 * Callback Data Serializer
 * Serialize/deserialize callback data with Telegram's 64-byte limit validation
 */

/** Telegram callback data byte limit */
export const TELEGRAM_CALLBACK_DATA_LIMIT = 64;

/** Parsed callback data structure */
export interface CallbackData<T = unknown> {
  action: string;
  payload: T;
}

/** Error thrown when callback data exceeds size limit */
export class CallbackDataSizeError extends Error {
  constructor(size: number) {
    super(`Callback data exceeds ${TELEGRAM_CALLBACK_DATA_LIMIT} byte limit: ${size} bytes`);
    this.name = 'CallbackDataSizeError';
  }
}

/** Error thrown when callback data is invalid */
export class CallbackDataParseError extends Error {
  constructor(message: string) {
    super(`Invalid callback data: ${message}`);
    this.name = 'CallbackDataParseError';
  }
}

/**
 * Callback data serializer with validation
 */
export class CallbackDataSerializer {
  /**
   * Serialize action and payload to callback data string
   * @throws CallbackDataSizeError if result exceeds 64 bytes
   */
  serialize<T>(action: string, payload: T): string {
    const data: CallbackData<T> = { action, payload };
    const serialized = JSON.stringify(data);
    const byteLength = Buffer.byteLength(serialized, 'utf8');
    
    if (byteLength > TELEGRAM_CALLBACK_DATA_LIMIT) {
      throw new CallbackDataSizeError(byteLength);
    }
    
    return serialized;
  }

  /**
   * Deserialize callback data string to action and payload
   * @throws CallbackDataParseError if data is invalid
   */
  deserialize<T>(data: string): CallbackData<T> {
    try {
      const parsed = JSON.parse(data) as CallbackData<T>;
      
      if (typeof parsed.action !== 'string') {
        throw new CallbackDataParseError('missing or invalid action field');
      }
      
      return parsed;
    } catch (error) {
      if (error instanceof CallbackDataParseError) {
        throw error;
      }
      throw new CallbackDataParseError('invalid JSON format');
    }
  }

  /**
   * Validate callback data string
   * Returns true if valid, false otherwise
   */
  validate(data: string): boolean {
    try {
      const byteLength = Buffer.byteLength(data, 'utf8');
      if (byteLength > TELEGRAM_CALLBACK_DATA_LIMIT) {
        return false;
      }
      
      const parsed = JSON.parse(data);
      return typeof parsed.action === 'string';
    } catch {
      return false;
    }
  }

  /**
   * Get byte length of a string
   */
  getByteLength(data: string): number {
    return Buffer.byteLength(data, 'utf8');
  }
}

/** Default serializer instance */
export const callbackSerializer = new CallbackDataSerializer();
