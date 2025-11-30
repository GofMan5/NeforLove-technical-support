/**
 * Tests for admin keyboard button generation and callback handling
 * Investigating bug: buttons for close/ban sometimes not created
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InlineKeyboard } from 'grammy';

// Constants from support module
const CB = {
  ADMIN_CLOSE: 'admin:close:',
  ADMIN_BAN: 'admin:ban:',
  ADMIN_BAN_CONFIRM: 'admin:ban_confirm:',
  ADMIN_BAN_CANCEL: 'admin:ban_cancel',
} as const;

// Recreate getAdminKeyboard function for testing
function getAdminKeyboard(ticketId: number, telegramId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text('❌ Закрыть', CB.ADMIN_CLOSE + ticketId)
    .text('🚫 Бан', CB.ADMIN_BAN + telegramId);
}

// Telegram callback_data limit
const TELEGRAM_CALLBACK_LIMIT = 64;

describe('Admin Keyboard Generation', () => {
  describe('getAdminKeyboard', () => {
    it('should create keyboard with close and ban buttons', () => {
      const keyboard = getAdminKeyboard(1, 123456789);
      const markup = keyboard.inline_keyboard;
      
      expect(markup).toHaveLength(1); // One row
      expect(markup[0]).toHaveLength(2); // Two buttons
      expect(markup[0][0].text).toBe('❌ Закрыть');
      expect(markup[0][1].text).toBe('🚫 Бан');
    });

    it('should generate valid callback data for small IDs', () => {
      const keyboard = getAdminKeyboard(1, 100);
      const markup = keyboard.inline_keyboard;
      
      expect((markup[0][0] as { callback_data?: string }).callback_data).toBe('admin:close:1');
      expect((markup[0][1] as { callback_data?: string }).callback_data).toBe('admin:ban:100');
    });

    it('should generate valid callback data for large IDs', () => {
      // Max Telegram user ID is around 7 billion (10 digits)
      const largeTicketId = 999999999;
      const largeTelegramId = 9999999999;
      
      const keyboard = getAdminKeyboard(largeTicketId, largeTelegramId);
      const markup = keyboard.inline_keyboard;
      
      const closeCallback = (markup[0][0] as { callback_data?: string }).callback_data!;
      const banCallback = (markup[0][1] as { callback_data?: string }).callback_data!;
      
      // Check callback data is within Telegram limit
      expect(Buffer.byteLength(closeCallback, 'utf8')).toBeLessThanOrEqual(TELEGRAM_CALLBACK_LIMIT);
      expect(Buffer.byteLength(banCallback, 'utf8')).toBeLessThanOrEqual(TELEGRAM_CALLBACK_LIMIT);
    });

    it('should handle edge case with zero IDs', () => {
      const keyboard = getAdminKeyboard(0, 0);
      const markup = keyboard.inline_keyboard;
      
      expect((markup[0][0] as { callback_data?: string }).callback_data).toBe('admin:close:0');
      expect((markup[0][1] as { callback_data?: string }).callback_data).toBe('admin:ban:0');
    });
  });

  describe('Callback Data Parsing', () => {
    it('should correctly parse close callback', () => {
      const ticketId = 12345;
      const callbackData = CB.ADMIN_CLOSE + ticketId;
      
      expect(callbackData.startsWith(CB.ADMIN_CLOSE)).toBe(true);
      
      const parsedId = parseInt(callbackData.replace(CB.ADMIN_CLOSE, ''));
      expect(parsedId).toBe(ticketId);
      expect(Number.isNaN(parsedId)).toBe(false);
    });

    it('should correctly parse ban callback', () => {
      const telegramId = 123456789;
      const callbackData = CB.ADMIN_BAN + telegramId;
      
      expect(callbackData.startsWith(CB.ADMIN_BAN)).toBe(true);
      expect(callbackData.includes('confirm')).toBe(false);
      expect(callbackData.includes('cancel')).toBe(false);
      
      const parsedId = parseInt(callbackData.replace(CB.ADMIN_BAN, ''));
      expect(parsedId).toBe(telegramId);
      expect(Number.isNaN(parsedId)).toBe(false);
    });

    it('should correctly parse ban confirm callback', () => {
      const telegramId = 123456789;
      const callbackData = CB.ADMIN_BAN_CONFIRM + telegramId;
      
      expect(callbackData.startsWith(CB.ADMIN_BAN_CONFIRM)).toBe(true);
      
      const parsedId = parseInt(callbackData.replace(CB.ADMIN_BAN_CONFIRM, ''));
      expect(parsedId).toBe(telegramId);
    });

    // BUG TEST: What happens with very large IDs?
    it('should handle JavaScript number precision for large IDs', () => {
      // JavaScript safe integer max is 9007199254740991
      const veryLargeId = 9007199254740991;
      const callbackData = CB.ADMIN_BAN + veryLargeId;
      
      const parsedId = parseInt(callbackData.replace(CB.ADMIN_BAN, ''));
      expect(parsedId).toBe(veryLargeId);
    });

    // BUG TEST: What if callback data gets corrupted?
    it('should handle malformed callback data gracefully', () => {
      const malformedData = 'admin:ban:abc';
      const parsedId = parseInt(malformedData.replace(CB.ADMIN_BAN, ''));
      
      // parseInt returns NaN for non-numeric strings
      expect(Number.isNaN(parsedId)).toBe(true);
    });

    // BUG TEST: Empty ID
    it('should handle empty ID in callback', () => {
      const emptyIdData = 'admin:ban:';
      const parsedId = parseInt(emptyIdData.replace(CB.ADMIN_BAN, ''));
      
      expect(Number.isNaN(parsedId)).toBe(true);
    });
  });
});

describe('Ticket Creation Flow - Admin Buttons', () => {
  // Simulate the ticket creation flow
  interface MockApi {
    createForumTopic: ReturnType<typeof vi.fn>;
    sendMessage: ReturnType<typeof vi.fn>;
    pinChatMessage: ReturnType<typeof vi.fn>;
  }

  let mockApi: MockApi;
  let sentMessages: Array<{
    chatId: number;
    text: string;
    options: Record<string, unknown>;
  }>;

  beforeEach(() => {
    sentMessages = [];
    mockApi = {
      createForumTopic: vi.fn().mockResolvedValue({ message_thread_id: 123 }),
      sendMessage: vi.fn().mockImplementation((chatId, text, options) => {
        sentMessages.push({ chatId, text, options });
        return Promise.resolve({ message_id: 1 });
      }),
      pinChatMessage: vi.fn().mockResolvedValue(undefined),
    };
  });

  it('should send info message with admin keyboard when topic is created', async () => {
    const supportGroupId = -1001234567890;
    const topicId = 123;
    const ticketId = 1;
    const telegramId = 987654321;
    const userName = 'TestUser';
    const username = '@testuser';
    const subject = 'Test Subject';

    // Simulate the ticket creation flow
    const info = `📋 #${ticketId}\n👤 ${userName} ${username}\n🆔 \`${telegramId}\`\n📝 ${subject}`;
    const keyboard = getAdminKeyboard(ticketId, telegramId);

    await mockApi.sendMessage(supportGroupId, info, {
      message_thread_id: topicId,
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });

    expect(mockApi.sendMessage).toHaveBeenCalledTimes(1);
    expect(sentMessages[0].options.reply_markup).toBeDefined();
    
    const sentKeyboard = sentMessages[0].options.reply_markup as InlineKeyboard;
    expect(sentKeyboard.inline_keyboard[0]).toHaveLength(2);
  });

  // BUG SCENARIO 1: Topic creation fails
  it('should NOT send admin keyboard if topic creation fails', async () => {
    mockApi.createForumTopic.mockRejectedValue(new Error('Topic creation failed'));

    let topicId: number | null = null;
    try {
      const topic = await mockApi.createForumTopic(-1001234567890, 'Test') as { message_thread_id: number };
      topicId = topic.message_thread_id;
    } catch {
      // Topic creation failed, topicId remains null
    }

    // This is the bug - if topicId is null, admin buttons are never sent!
    if (topicId) {
      await mockApi.sendMessage(-1001234567890, 'info', {
        message_thread_id: topicId,
        reply_markup: getAdminKeyboard(1, 123),
      });
    }

    expect(mockApi.sendMessage).not.toHaveBeenCalled();
    // BUG: Ticket is created but admin has no way to close/ban!
  });

  // BUG SCENARIO 2: sendMessage fails due to Markdown parsing
  it('should handle Markdown parsing errors', async () => {
    // Username with underscore can break Markdown
    const userName = 'Test_User';
    const username = '@test_user_name';
    const subject = 'Test_Subject';
    
    const info = `📋 #1\n👤 ${userName} ${username}\n🆔 \`123456\`\n📝 ${subject}`;
    
    // First call fails due to Markdown
    mockApi.sendMessage
      .mockRejectedValueOnce(new Error("Can't parse entities"))
      .mockResolvedValueOnce({ message_id: 1 });

    let success = false;
    try {
      await mockApi.sendMessage(-1001234567890, info, {
        message_thread_id: 123,
        parse_mode: 'Markdown',
        reply_markup: getAdminKeyboard(1, 123456),
      });
      success = true;
    } catch {
      // Retry without Markdown
      const plainInfo = `📋 #1\n👤 ${userName} ${username}\n🆔 123456\n📝 ${subject}`;
      await mockApi.sendMessage(-1001234567890, plainInfo, {
        message_thread_id: 123,
        reply_markup: getAdminKeyboard(1, 123456),
      });
      success = true;
    }

    expect(success).toBe(true);
    expect(mockApi.sendMessage).toHaveBeenCalledTimes(2);
  });

  // BUG SCENARIO 3: Bot doesn't have permission to send to topic
  it('should handle permission errors when sending to topic', async () => {
    mockApi.sendMessage.mockRejectedValue(new Error('Forbidden: bot is not a member'));

    let adminButtonsSent = false;
    try {
      await mockApi.sendMessage(-1001234567890, 'info', {
        message_thread_id: 123,
        reply_markup: getAdminKeyboard(1, 123),
      });
      adminButtonsSent = true;
    } catch {
      // Error silently swallowed in original code!
      adminButtonsSent = false;
    }

    expect(adminButtonsSent).toBe(false);
    // BUG: No admin buttons, no error notification to anyone!
  });
});

describe('Ban Flow Edge Cases', () => {
  // Test the ban callback parsing logic
  it('should distinguish between ban, ban_confirm, and ban_cancel', () => {
    const banData = 'admin:ban:123456';
    const confirmData = 'admin:ban_confirm:123456';
    const cancelData = 'admin:ban_cancel';

    // Original logic from handleCallback
    const isBanInitial = banData.startsWith(CB.ADMIN_BAN) && 
                         !banData.includes('confirm') && 
                         !banData.includes('cancel');
    const isBanConfirm = confirmData.startsWith(CB.ADMIN_BAN_CONFIRM);
    const isBanCancel = cancelData === CB.ADMIN_BAN_CANCEL;

    expect(isBanInitial).toBe(true);
    expect(isBanConfirm).toBe(true);
    expect(isBanCancel).toBe(true);
  });

  // BUG: What if user ID contains 'confirm' or 'cancel' as substring?
  // This is unlikely but let's test
  it('should handle edge case where ID might look like keyword', () => {
    // This shouldn't happen with numeric IDs, but let's verify
    const numericId = 123456;
    const banData = CB.ADMIN_BAN + numericId;
    
    expect(banData.includes('confirm')).toBe(false);
    expect(banData.includes('cancel')).toBe(false);
  });
});

describe('Potential Race Conditions', () => {
  it('should handle rapid button clicks', async () => {
    // Simulate rapid clicks on close button
    const ticketId = 1;
    let ticketStatus = 'open';
    let closeCount = 0;

    const closeTicket = async () => {
      if (ticketStatus === 'open') {
        ticketStatus = 'closed';
        closeCount++;
      }
    };

    // Simulate 3 rapid clicks
    await Promise.all([
      closeTicket(),
      closeTicket(),
      closeTicket(),
    ]);

    // Should only close once
    expect(closeCount).toBe(1);
    expect(ticketStatus).toBe('closed');
  });
});
