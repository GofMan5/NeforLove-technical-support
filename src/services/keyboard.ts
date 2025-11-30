/**
 * Keyboard Builder
 * Fluent API for building Telegram inline and reply keyboards
 */

/** Telegram inline keyboard button */
export interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

/** Telegram inline keyboard markup */
export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

/** Telegram reply keyboard button */
export interface ReplyKeyboardButton {
  text: string;
  request_contact?: boolean;
  request_location?: boolean;
}

/** Telegram reply keyboard markup */
export interface ReplyKeyboardMarkup {
  keyboard: ReplyKeyboardButton[][];
  resize_keyboard?: boolean;
  one_time_keyboard?: boolean;
  selective?: boolean;
}

/**
 * Builder for inline keyboards with fluent API
 */
export class InlineKeyboardBuilder {
  private rows: InlineKeyboardButton[][] = [];
  private currentRow: InlineKeyboardButton[] = [];

  /**
   * Add a callback button to current row
   */
  button(text: string, callbackData: string): this {
    this.currentRow.push({ text, callback_data: callbackData });
    return this;
  }

  /**
   * Add a URL button to current row
   */
  url(text: string, url: string): this {
    this.currentRow.push({ text, url });
    return this;
  }

  /**
   * Complete current row and start a new one
   */
  row(): this {
    if (this.currentRow.length > 0) {
      this.rows.push(this.currentRow);
      this.currentRow = [];
    }
    return this;
  }

  /**
   * Build the final keyboard markup
   */
  build(): InlineKeyboardMarkup {
    // Add any remaining buttons in current row
    if (this.currentRow.length > 0) {
      this.rows.push(this.currentRow);
    }
    return { inline_keyboard: this.rows };
  }
}

/**
 * Builder for reply keyboards with fluent API
 */
export class ReplyKeyboardBuilder {
  private rows: ReplyKeyboardButton[][] = [];
  private currentRow: ReplyKeyboardButton[] = [];
  private options: {
    resize_keyboard?: boolean;
    one_time_keyboard?: boolean;
    selective?: boolean;
  } = {};

  /**
   * Add a text button to current row
   */
  button(text: string): this {
    this.currentRow.push({ text });
    return this;
  }

  /**
   * Add a contact request button to current row
   */
  requestContact(text: string): this {
    this.currentRow.push({ text, request_contact: true });
    return this;
  }

  /**
   * Add a location request button to current row
   */
  requestLocation(text: string): this {
    this.currentRow.push({ text, request_location: true });
    return this;
  }

  /**
   * Complete current row and start a new one
   */
  row(): this {
    if (this.currentRow.length > 0) {
      this.rows.push(this.currentRow);
      this.currentRow = [];
    }
    return this;
  }

  /**
   * Set resize_keyboard option
   */
  resize(value: boolean = true): this {
    this.options.resize_keyboard = value;
    return this;
  }

  /**
   * Set one_time_keyboard option
   */
  oneTime(value: boolean = true): this {
    this.options.one_time_keyboard = value;
    return this;
  }

  /**
   * Set selective option
   */
  selective(value: boolean = true): this {
    this.options.selective = value;
    return this;
  }

  /**
   * Build the final keyboard markup
   */
  build(): ReplyKeyboardMarkup {
    // Add any remaining buttons in current row
    if (this.currentRow.length > 0) {
      this.rows.push(this.currentRow);
    }
    return {
      keyboard: this.rows,
      ...this.options,
    };
  }
}

/**
 * Factory for creating keyboard builders
 */
export class KeyboardBuilder {
  /**
   * Create a new inline keyboard builder
   */
  static inline(): InlineKeyboardBuilder {
    return new InlineKeyboardBuilder();
  }

  /**
   * Create a new reply keyboard builder
   */
  static reply(): ReplyKeyboardBuilder {
    return new ReplyKeyboardBuilder();
  }
}
