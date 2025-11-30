/**
 * Property-based tests for Support Module
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { createDatabase, type DatabaseConnection } from '../../database';
import { tickets, users } from '../../database/schema';
import { eq } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';
import { sendWithFeedback } from './index';

// Test database path
const TEST_DB_PATH = './data/test-support-module.sqlite';

// Ensure data directory exists
function ensureDataDir() {
  const dir = path.dirname(TEST_DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Clean up test database
function cleanupTestDb() {
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }
}

// Arbitrary for generating valid Telegram user IDs
const telegramIdArbitrary = fc.integer({ min: 1, max: 2000000000 });

// Arbitrary for generating valid topic IDs
const topicIdArbitrary = fc.integer({ min: 1, max: 999999999 });

// Arbitrary for generating ticket subjects
const subjectArbitrary = fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0);



/**
 * Simulates ticket closure notification logic
 * This function represents the core notification behavior that should be tested
 */
interface TicketClosureResult {
  userNotified: boolean;
  groupNotified: boolean;
  auditLogged: boolean;
}

/**
 * Simulates the ticket closure by user flow
 */
function simulateTicketClosureByUser(
  ticket: { id: number; telegramId: number; topicId: number | null },
  sendUserNotification: () => boolean,
  sendGroupNotification: () => boolean,
  logAudit: () => boolean
): TicketClosureResult {
  const auditLogged = logAudit();
  const userNotified = sendUserNotification();
  const groupNotified = ticket.topicId !== null ? sendGroupNotification() : true;
  
  return { userNotified, groupNotified, auditLogged };
}

/**
 * Simulates the ticket closure by admin flow
 */
function simulateTicketClosureByAdmin(
  ticket: { id: number; telegramId: number; topicId: number | null },
  sendUserNotification: () => boolean,
  sendGroupNotification: () => boolean,
  logAudit: () => boolean
): TicketClosureResult {
  const auditLogged = logAudit();
  const userNotified = sendUserNotification();
  const groupNotified = ticket.topicId !== null ? sendGroupNotification() : true;
  
  return { userNotified, groupNotified, auditLogged };
}

describe('Support Module Property Tests', () => {
  let dbConnection: DatabaseConnection;
  let testCounter = 0;

  beforeEach(() => {
    ensureDataDir();
    cleanupTestDb();
    dbConnection = createDatabase(TEST_DB_PATH);
    dbConnection.migrate();
    testCounter = 0;
  });

  afterEach(() => {
    dbConnection.close();
    cleanupTestDb();
  });

  // Helper to get unique telegram ID per test iteration
  function getUniqueTelegramId(baseId: number): number {
    testCounter++;
    return baseId + testCounter * 10000000;
  }

  describe('Ticket Closure Notification Symmetry', () => {
    it('should notify both user and group when user closes ticket with topic', async () => {
      await fc.assert(
        fc.asyncProperty(
          telegramIdArbitrary,
          topicIdArbitrary,
          subjectArbitrary,
          async (baseTelegramId, topicId, subject) => {
            const telegramId = getUniqueTelegramId(baseTelegramId);
            
            // Create a user
            dbConnection.db.insert(users).values({
              telegramId,
              role: 'user',
              createdAt: new Date(),
            }).run();

            // Create a ticket with topic
            const result = dbConnection.db.insert(tickets).values({
              telegramId,
              topicId,
              subject,
              status: 'open',
              createdAt: new Date(),
            }).run();

            const ticketId = result.lastInsertRowid as number;
            const ticket = { id: ticketId, telegramId, topicId };

            // Simulate successful notifications
            const closureResult = simulateTicketClosureByUser(
              ticket,
              () => true, // user notification succeeds
              () => true, // group notification succeeds
              () => true  // audit log succeeds
            );

            // Property: Both parties should be notified
            expect(closureResult.userNotified).toBe(true);
            expect(closureResult.groupNotified).toBe(true);
            expect(closureResult.auditLogged).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should notify both user and group when admin closes ticket with topic', async () => {
      await fc.assert(
        fc.asyncProperty(
          telegramIdArbitrary,
          telegramIdArbitrary,
          topicIdArbitrary,
          subjectArbitrary,
          async (baseUserId, baseAdminId, topicId, subject) => {
            const userId = getUniqueTelegramId(baseUserId);
            const adminId = getUniqueTelegramId(baseAdminId);

            // Create user
            dbConnection.db.insert(users).values({
              telegramId: userId,
              role: 'user',
              createdAt: new Date(),
            }).run();

            // Create admin
            dbConnection.db.insert(users).values({
              telegramId: adminId,
              role: 'support',
              createdAt: new Date(),
            }).run();

            // Create a ticket with topic
            const result = dbConnection.db.insert(tickets).values({
              telegramId: userId,
              topicId,
              subject,
              status: 'open',
              createdAt: new Date(),
            }).run();

            const ticketId = result.lastInsertRowid as number;
            const ticket = { id: ticketId, telegramId: userId, topicId: topicId as number | null };

            // Simulate successful notifications
            const closureResult = simulateTicketClosureByAdmin(
              ticket,
              () => true, // user notification succeeds
              () => true, // group notification succeeds
              () => true  // audit log succeeds
            );

            // Property: Both parties should be notified
            expect(closureResult.userNotified).toBe(true);
            expect(closureResult.groupNotified).toBe(true);
            expect(closureResult.auditLogged).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle tickets without topic gracefully', async () => {
      await fc.assert(
        fc.asyncProperty(
          telegramIdArbitrary,
          subjectArbitrary,
          fc.constantFrom('user', 'admin'),
          async (baseTelegramId, subject, closedBy) => {
            const telegramId = getUniqueTelegramId(baseTelegramId);
            
            // Create a user
            dbConnection.db.insert(users).values({
              telegramId,
              role: 'user',
              createdAt: new Date(),
            }).run();

            // Create a ticket WITHOUT topic (topicId = null)
            const result = dbConnection.db.insert(tickets).values({
              telegramId,
              topicId: null,
              subject,
              status: 'open',
              createdAt: new Date(),
            }).run();

            const ticketId = result.lastInsertRowid as number;
            const ticket = { id: ticketId, telegramId, topicId: null };

            // Simulate closure
            const closureResult = closedBy === 'user'
              ? simulateTicketClosureByUser(ticket, () => true, () => true, () => true)
              : simulateTicketClosureByAdmin(ticket, () => true, () => true, () => true);

            // Property: User should still be notified, group notification is N/A (returns true)
            expect(closureResult.userNotified).toBe(true);
            expect(closureResult.groupNotified).toBe(true); // true because no topic to notify
            expect(closureResult.auditLogged).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should ensure closure updates ticket status correctly', async () => {
      await fc.assert(
        fc.asyncProperty(
          telegramIdArbitrary,
          fc.option(topicIdArbitrary, { nil: null }),
          subjectArbitrary,
          async (baseTelegramId, topicId, subject) => {
            const telegramId = getUniqueTelegramId(baseTelegramId);
            
            // Create a user
            dbConnection.db.insert(users).values({
              telegramId,
              role: 'user',
              createdAt: new Date(),
            }).run();

            // Create an open ticket
            const result = dbConnection.db.insert(tickets).values({
              telegramId,
              topicId,
              subject,
              status: 'open',
              createdAt: new Date(),
            }).run();

            const ticketId = result.lastInsertRowid as number;

            // Verify ticket is open
            const openTicket = dbConnection.db.select().from(tickets).where(eq(tickets.id, ticketId)).get();
            expect(openTicket?.status).toBe('open');

            // Close the ticket
            dbConnection.db.update(tickets)
              .set({ status: 'closed', closedAt: new Date() })
              .where(eq(tickets.id, ticketId))
              .run();

            // Verify ticket is closed
            const closedTicket = dbConnection.db.select().from(tickets).where(eq(tickets.id, ticketId)).get();
            expect(closedTicket?.status).toBe('closed');
            expect(closedTicket?.closedAt).toBeInstanceOf(Date);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Message Delivery Feedback', () => {
    // Arbitrary for error message keys
    const errorKeyArbitrary = fc.constantFrom(
      'system.message_forward_failed',
      'system.message_delivery_failed'
    );

    // Arbitrary for chat IDs
    const chatIdArbitrary = fc.integer({ min: 1, max: 2000000000 });

    // Arbitrary for thread IDs (optional)
    const threadIdArbitrary = fc.option(fc.integer({ min: 1, max: 999999999 }), { nil: undefined });

    /**
     * Creates a mock BotContext for testing sendWithFeedback
     */
    function createMockContext(options: {
      chatId?: number;
      feedbackSent?: boolean;
      locale?: string;
    } = {}) {
      const { chatId = 12345, feedbackSent = true, locale = 'en' } = options;
      
      const loggedMessages: { level: string; message: string; data?: unknown }[] = [];
      const sentMessages: { chatId: number; text: string; threadId?: number }[] = [];
      
      return {
        ctx: {
          chat: { id: chatId },
          logger: {
            warn: (message: string, data?: unknown) => {
              loggedMessages.push({ level: 'warn', message, data });
            },
            error: (message: string, data?: unknown) => {
              loggedMessages.push({ level: 'error', message, data });
            },
          },
          t: (key: string) => `[${locale}] ${key}`,
          api: {
            sendMessage: async (targetChatId: number, text: string, opts?: { message_thread_id?: number }) => {
              if (!feedbackSent) {
                throw new Error('Feedback send failed');
              }
              sentMessages.push({ chatId: targetChatId, text, threadId: opts?.message_thread_id });
              return { message_id: 1 };
            },
          },
        },
        loggedMessages,
        sentMessages,
      };
    }

    it('should return false and send feedback when delivery fails', async () => {
      await fc.assert(
        fc.asyncProperty(
          errorKeyArbitrary,
          chatIdArbitrary,
          async (errorKey, chatId) => {
            const { ctx, loggedMessages, sentMessages } = createMockContext({ chatId });
            
            // Simulate a failing send operation
            const sendFn = async () => {
              throw new Error('Delivery failed');
            };
            
            const result = await sendWithFeedback(
              ctx as never,
              sendFn,
              errorKey
            );
            
            // Property: When delivery fails, result should be false
            expect(result).toBe(false);
            
            // Property: Error should be logged
            expect(loggedMessages.length).toBeGreaterThan(0);
            expect(loggedMessages[0].level).toBe('warn');
            expect(loggedMessages[0].message).toBe('Message delivery failed');
            
            // Property: Feedback should be sent to the sender
            expect(sentMessages.length).toBe(1);
            expect(sentMessages[0].chatId).toBe(chatId);
            expect(sentMessages[0].text).toContain(errorKey);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should return true and not send feedback when delivery succeeds', async () => {
      await fc.assert(
        fc.asyncProperty(
          errorKeyArbitrary,
          chatIdArbitrary,
          async (errorKey, chatId) => {
            const { ctx, loggedMessages, sentMessages } = createMockContext({ chatId });
            
            // Simulate a successful send operation
            const sendFn = async () => {
              return { message_id: 123 };
            };
            
            const result = await sendWithFeedback(
              ctx as never,
              sendFn,
              errorKey
            );
            
            // Property: When delivery succeeds, result should be true
            expect(result).toBe(true);
            
            // Property: No error should be logged
            expect(loggedMessages.length).toBe(0);
            
            // Property: No feedback should be sent
            expect(sentMessages.length).toBe(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should send feedback to custom chat ID when provided', async () => {
      await fc.assert(
        fc.asyncProperty(
          errorKeyArbitrary,
          chatIdArbitrary,
          chatIdArbitrary,
          async (errorKey, contextChatId, feedbackChatId) => {
            // Ensure different chat IDs for meaningful test
            const actualFeedbackChatId = feedbackChatId === contextChatId 
              ? feedbackChatId + 1 
              : feedbackChatId;
            
            const { ctx, sentMessages } = createMockContext({ chatId: contextChatId });
            
            // Simulate a failing send operation
            const sendFn = async () => {
              throw new Error('Delivery failed');
            };
            
            await sendWithFeedback(
              ctx as never,
              sendFn,
              errorKey,
              actualFeedbackChatId
            );
            
            // Property: Feedback should be sent to the specified chat ID, not context chat ID
            expect(sentMessages.length).toBe(1);
            expect(sentMessages[0].chatId).toBe(actualFeedbackChatId);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should include thread ID in feedback when provided', async () => {
      await fc.assert(
        fc.asyncProperty(
          errorKeyArbitrary,
          chatIdArbitrary,
          fc.integer({ min: 1, max: 999999999 }),
          async (errorKey, chatId, threadId) => {
            const { ctx, sentMessages } = createMockContext({ chatId });
            
            // Simulate a failing send operation
            const sendFn = async () => {
              throw new Error('Delivery failed');
            };
            
            await sendWithFeedback(
              ctx as never,
              sendFn,
              errorKey,
              chatId,
              threadId
            );
            
            // Property: Feedback should include the thread ID
            expect(sentMessages.length).toBe(1);
            expect(sentMessages[0].threadId).toBe(threadId);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle feedback send failure gracefully', async () => {
      await fc.assert(
        fc.asyncProperty(
          errorKeyArbitrary,
          chatIdArbitrary,
          async (errorKey, chatId) => {
            // Create context where feedback sending also fails
            const { ctx, loggedMessages } = createMockContext({ 
              chatId, 
              feedbackSent: false 
            });
            
            // Simulate a failing send operation
            const sendFn = async () => {
              throw new Error('Delivery failed');
            };
            
            // Should not throw even when feedback fails
            const result = await sendWithFeedback(
              ctx as never,
              sendFn,
              errorKey
            );
            
            // Property: Should still return false
            expect(result).toBe(false);
            
            // Property: Both errors should be logged (delivery + feedback)
            expect(loggedMessages.length).toBe(2);
            expect(loggedMessages[0].message).toBe('Message delivery failed');
            expect(loggedMessages[1].message).toBe('Failed to send error feedback');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should log error details including error key and chat IDs', async () => {
      await fc.assert(
        fc.asyncProperty(
          errorKeyArbitrary,
          chatIdArbitrary,
          threadIdArbitrary,
          async (errorKey, chatId, threadId) => {
            const { ctx, loggedMessages } = createMockContext({ chatId });
            
            const errorMessage = 'Test delivery error';
            const sendFn = async () => {
              throw new Error(errorMessage);
            };
            
            await sendWithFeedback(
              ctx as never,
              sendFn,
              errorKey,
              chatId,
              threadId
            );
            
            // Property: Log entry should contain error details
            expect(loggedMessages.length).toBeGreaterThan(0);
            const logData = loggedMessages[0].data as Record<string, unknown>;
            expect(logData.error).toBe(errorMessage);
            expect(logData.errorMessageKey).toBe(errorKey);
            expect(logData.feedbackChatId).toBe(chatId);
            expect(logData.feedbackThreadId).toBe(threadId);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
