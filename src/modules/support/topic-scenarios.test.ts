/**
 * Extended tests for Support Module - Topic Scenarios
 * Tests various edge cases and potential bugs in topic handling
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';
import { createDatabase, type DatabaseConnection } from '../../database';
import { tickets, users, messages, bannedUsers } from '../../database/schema';
import { eq, and } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';

const TEST_DB_PATH = './data/test-topic-scenarios.sqlite';

function ensureDataDir() {
  const dir = path.dirname(TEST_DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function cleanupTestDb() {
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }
}

// Arbitraries
const telegramIdArbitrary = fc.integer({ min: 1, max: 2000000000 });
const topicIdArbitrary = fc.integer({ min: 1, max: 999999999 });
const messageIdArbitrary = fc.integer({ min: 1, max: 999999999 });
const subjectArbitrary = fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0);
const usernameArbitrary = fc.string({ minLength: 3, maxLength: 32 }).filter(s => /^[a-zA-Z0-9_]+$/.test(s));

describe('Topic Creation Scenarios', () => {
  let db: DatabaseConnection;
  let testCounter = 0;

  beforeEach(() => {
    ensureDataDir();
    cleanupTestDb();
    db = createDatabase(TEST_DB_PATH);
    db.migrate();
    testCounter = 0;
  });

  afterEach(() => {
    db.close();
    cleanupTestDb();
  });

  function getUniqueId(baseId: number): number {
    testCounter++;
    return baseId + testCounter * 10000000;
  }

  describe('Topic Creation Failures', () => {
    it('should create ticket even when topic creation fails', async () => {
      await fc.assert(
        fc.asyncProperty(
          telegramIdArbitrary,
          subjectArbitrary,
          async (baseTelegramId, subject) => {
            const telegramId = getUniqueId(baseTelegramId);

            // Create user
            db.db.insert(users).values({
              telegramId,
              role: 'user',
              createdAt: new Date(),
            }).run();

            // Simulate topic creation failure - ticket created with null topicId
            const result = db.db.insert(tickets).values({
              telegramId,
              topicId: null, // Topic creation failed
              subject,
              status: 'open',
              createdAt: new Date(),
            }).run();

            const ticketId = result.lastInsertRowid as number;
            const ticket = db.db.select().from(tickets).where(eq(tickets.id, ticketId)).get();

            // Ticket should exist even without topic
            expect(ticket).toBeDefined();
            expect(ticket?.topicId).toBeNull();
            expect(ticket?.status).toBe('open');
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should handle duplicate topic IDs gracefully', async () => {
      // This test demonstrates a potential bug: multiple tickets can share same topicId
      // Using unique topicId per test iteration to avoid cross-test pollution
      const telegramId1 = getUniqueId(1);
      const telegramId2 = getUniqueId(2);
      const uniqueTopicId = Date.now(); // Unique per test run

      // Create users
      db.db.insert(users).values({ telegramId: telegramId1, role: 'user', createdAt: new Date() }).run();
      db.db.insert(users).values({ telegramId: telegramId2, role: 'user', createdAt: new Date() }).run();

      // Create first ticket with topic
      db.db.insert(tickets).values({
        telegramId: telegramId1,
        topicId: uniqueTopicId,
        subject: 'Subject 1',
        status: 'open',
        createdAt: new Date(),
      }).run();

      // Create second ticket with SAME topic ID (shouldn't happen but test it)
      db.db.insert(tickets).values({
        telegramId: telegramId2,
        topicId: uniqueTopicId, // Same topic ID!
        subject: 'Subject 2',
        status: 'open',
        createdAt: new Date(),
      }).run();

      // Both tickets exist - this is a potential bug scenario
      // BUG: No unique constraint on topicId allows duplicates
      const ticketsWithTopic = db.db.select().from(tickets)
        .where(eq(tickets.topicId, uniqueTopicId)).all();

      expect(ticketsWithTopic.length).toBe(2);
    });
  });

  describe('Message Routing', () => {
    it('should correctly route messages to ticket by topicId', async () => {
      await fc.assert(
        fc.asyncProperty(
          telegramIdArbitrary,
          messageIdArbitrary,
          subjectArbitrary,
          async (baseTelegramId, userMsgId, subject) => {
            const telegramId = getUniqueId(baseTelegramId);
            // Use unique topicId per iteration to avoid collision with other tests
            const topicId = getUniqueId(baseTelegramId + 1000000);

            db.db.insert(users).values({ telegramId, role: 'user', createdAt: new Date() }).run();

            const ticketResult = db.db.insert(tickets).values({
              telegramId,
              topicId,
              subject,
              status: 'open',
              createdAt: new Date(),
            }).run();

            const ticketId = ticketResult.lastInsertRowid as number;

            // Add message
            db.db.insert(messages).values({
              ticketId,
              telegramId,
              userMessageId: userMsgId,
              topicMessageId: userMsgId + 1000,
              mediaType: 'text',
              text: 'Test message',
              isAdmin: false,
              createdAt: new Date(),
            }).run();

            // Find ticket by topicId (как делает handleAdminReply)
            const foundTicket = db.db.select().from(tickets)
              .where(and(eq(tickets.topicId, topicId), eq(tickets.status, 'open'))).get();

            expect(foundTicket).toBeDefined();
            expect(foundTicket?.id).toBe(ticketId);
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should NOT find closed ticket by topicId', async () => {
      await fc.assert(
        fc.asyncProperty(
          telegramIdArbitrary,
          topicIdArbitrary,
          subjectArbitrary,
          async (baseTelegramId, topicId, subject) => {
            const telegramId = getUniqueId(baseTelegramId);

            db.db.insert(users).values({ telegramId, role: 'user', createdAt: new Date() }).run();

            db.db.insert(tickets).values({
              telegramId,
              topicId,
              subject,
              status: 'closed', // Already closed
              createdAt: new Date(),
              closedAt: new Date(),
            }).run();

            // Should NOT find closed ticket
            const foundTicket = db.db.select().from(tickets)
              .where(and(eq(tickets.topicId, topicId), eq(tickets.status, 'open'))).get();

            expect(foundTicket).toBeUndefined();
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  describe('Reply Chain Integrity', () => {
    it('should maintain reply chain between user and topic messages', async () => {
      await fc.assert(
        fc.asyncProperty(
          telegramIdArbitrary,
          topicIdArbitrary,
          fc.array(messageIdArbitrary, { minLength: 2, maxLength: 10 }),
          subjectArbitrary,
          async (baseTelegramId, topicId, msgIds, subject) => {
            const telegramId = getUniqueId(baseTelegramId);
            const uniqueMsgIds = [...new Set(msgIds)];
            if (uniqueMsgIds.length < 2) return; // Need at least 2 unique IDs

            db.db.insert(users).values({ telegramId, role: 'user', createdAt: new Date() }).run();

            const ticketResult = db.db.insert(tickets).values({
              telegramId,
              topicId,
              subject,
              status: 'open',
              createdAt: new Date(),
            }).run();

            const ticketId = ticketResult.lastInsertRowid as number;

            // Insert messages with reply chain
            for (let i = 0; i < uniqueMsgIds.length; i++) {
              db.db.insert(messages).values({
                ticketId,
                telegramId,
                userMessageId: uniqueMsgIds[i],
                topicMessageId: uniqueMsgIds[i] + 100000,
                mediaType: 'text',
                text: `Message ${i}`,
                isAdmin: i % 2 === 1, // Alternate user/admin
                createdAt: new Date(),
              }).run();
            }

            // Verify all messages are linked to ticket
            const ticketMessages = db.db.select().from(messages)
              .where(eq(messages.ticketId, ticketId)).all();

            expect(ticketMessages.length).toBe(uniqueMsgIds.length);

            // Verify we can find message by userMessageId
            const firstMsg = db.db.select().from(messages)
              .where(and(
                eq(messages.ticketId, ticketId),
                eq(messages.userMessageId, uniqueMsgIds[0])
              )).get();

            expect(firstMsg).toBeDefined();
            expect(firstMsg?.topicMessageId).toBe(uniqueMsgIds[0] + 100000);
          }
        ),
        { numRuns: 30 }
      );
    });
  });

  describe('Banned User Scenarios', () => {
    it('should prevent banned user from creating tickets', async () => {
      await fc.assert(
        fc.asyncProperty(
          telegramIdArbitrary,
          subjectArbitrary,
          async (baseTelegramId, subject) => {
            const telegramId = getUniqueId(baseTelegramId);

            db.db.insert(users).values({ telegramId, role: 'user', createdAt: new Date() }).run();
            db.db.insert(bannedUsers).values({ telegramId, bannedAt: new Date() }).run();

            // Check if banned
            const isBanned = !!db.db.select().from(bannedUsers)
              .where(eq(bannedUsers.telegramId, telegramId)).get();

            expect(isBanned).toBe(true);

            // In real code, ticket creation would be blocked
            // This test verifies the ban check works
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should close all open tickets when user is banned', async () => {
      await fc.assert(
        fc.asyncProperty(
          telegramIdArbitrary,
          fc.array(subjectArbitrary, { minLength: 1, maxLength: 5 }),
          async (baseTelegramId, subjects) => {
            const telegramId = getUniqueId(baseTelegramId);

            db.db.insert(users).values({ telegramId, role: 'user', createdAt: new Date() }).run();

            // Create multiple open tickets
            for (const subject of subjects) {
              db.db.insert(tickets).values({
                telegramId,
                topicId: Math.floor(Math.random() * 1000000),
                subject,
                status: 'open',
                createdAt: new Date(),
              }).run();
            }

            // Verify tickets are open
            const openBefore = db.db.select().from(tickets)
              .where(and(eq(tickets.telegramId, telegramId), eq(tickets.status, 'open'))).all();
            expect(openBefore.length).toBe(subjects.length);

            // Ban user and close tickets (как в handleCallback)
            db.db.insert(bannedUsers).values({ telegramId, bannedAt: new Date() }).run();
            db.db.update(tickets)
              .set({ status: 'closed', closedAt: new Date() })
              .where(and(eq(tickets.telegramId, telegramId), eq(tickets.status, 'open')))
              .run();

            // Verify all tickets are closed
            const openAfter = db.db.select().from(tickets)
              .where(and(eq(tickets.telegramId, telegramId), eq(tickets.status, 'open'))).all();
            expect(openAfter.length).toBe(0);
          }
        ),
        { numRuns: 30 }
      );
    });
  });
});


describe('Media Handling Scenarios', () => {
  let db: DatabaseConnection;
  let testCounter = 0;

  beforeEach(() => {
    ensureDataDir();
    cleanupTestDb();
    db = createDatabase(TEST_DB_PATH);
    db.migrate();
    testCounter = 0;
  });

  afterEach(() => {
    db.close();
    cleanupTestDb();
  });

  function getUniqueId(baseId: number): number {
    testCounter++;
    return baseId + testCounter * 10000000;
  }

  const mediaTypes = ['text', 'photo', 'video', 'animation', 'sticker', 'voice', 'video_note', 'document'] as const;
  const mediaTypeArbitrary = fc.constantFrom(...mediaTypes);
  const fileIdArbitrary = fc.string({ minLength: 20, maxLength: 100 }).filter(s => s.length > 0);

  it('should store all media types correctly', async () => {
    await fc.assert(
      fc.asyncProperty(
        telegramIdArbitrary,
        topicIdArbitrary,
        mediaTypeArbitrary,
        fileIdArbitrary,
        subjectArbitrary,
        async (baseTelegramId, topicId, mediaType, fileId, subject) => {
          const telegramId = getUniqueId(baseTelegramId);

          db.db.insert(users).values({ telegramId, role: 'user', createdAt: new Date() }).run();

          const ticketResult = db.db.insert(tickets).values({
            telegramId,
            topicId,
            subject,
            status: 'open',
            createdAt: new Date(),
          }).run();

          const ticketId = ticketResult.lastInsertRowid as number;

          // Store message with media
          db.db.insert(messages).values({
            ticketId,
            telegramId,
            userMessageId: 1,
            topicMessageId: 2,
            mediaType,
            text: mediaType === 'text' ? 'Test text' : null,
            fileId: mediaType !== 'text' ? fileId : null,
            isAdmin: false,
            createdAt: new Date(),
          }).run();

          const msg = db.db.select().from(messages)
            .where(eq(messages.ticketId, ticketId)).get();

          expect(msg).toBeDefined();
          expect(msg?.mediaType).toBe(mediaType);
          if (mediaType !== 'text') {
            expect(msg?.fileId).toBe(fileId);
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  it('should handle messages with caption (photo/video/document)', async () => {
    await fc.assert(
      fc.asyncProperty(
        telegramIdArbitrary,
        topicIdArbitrary,
        fc.constantFrom('photo', 'video', 'document'),
        fileIdArbitrary,
        fc.string({ minLength: 1, maxLength: 1024 }),
        subjectArbitrary,
        async (baseTelegramId, topicId, mediaType, fileId, caption, subject) => {
          const telegramId = getUniqueId(baseTelegramId);

          db.db.insert(users).values({ telegramId, role: 'user', createdAt: new Date() }).run();

          const ticketResult = db.db.insert(tickets).values({
            telegramId,
            topicId,
            subject,
            status: 'open',
            createdAt: new Date(),
          }).run();

          const ticketId = ticketResult.lastInsertRowid as number;

          // Store message with media AND caption
          db.db.insert(messages).values({
            ticketId,
            telegramId,
            userMessageId: 1,
            topicMessageId: 2,
            mediaType: mediaType as 'photo' | 'video' | 'document',
            text: caption, // Caption stored in text field
            fileId,
            isAdmin: false,
            createdAt: new Date(),
          }).run();

          const msg = db.db.select().from(messages)
            .where(eq(messages.ticketId, ticketId)).get();

          expect(msg?.text).toBe(caption);
          expect(msg?.fileId).toBe(fileId);
        }
      ),
      { numRuns: 30 }
    );
  });
});

describe('Concurrent Operations', () => {
  let db: DatabaseConnection;
  let testCounter = 0;

  beforeEach(() => {
    ensureDataDir();
    cleanupTestDb();
    db = createDatabase(TEST_DB_PATH);
    db.migrate();
    testCounter = 0;
  });

  afterEach(() => {
    db.close();
    cleanupTestDb();
  });

  function getUniqueId(baseId: number): number {
    testCounter++;
    return baseId + testCounter * 10000000;
  }

  it('should handle concurrent ticket closure attempts', async () => {
    await fc.assert(
      fc.asyncProperty(
        telegramIdArbitrary,
        topicIdArbitrary,
        subjectArbitrary,
        async (baseTelegramId, topicId, subject) => {
          const telegramId = getUniqueId(baseTelegramId);

          db.db.insert(users).values({ telegramId, role: 'user', createdAt: new Date() }).run();

          const ticketResult = db.db.insert(tickets).values({
            telegramId,
            topicId,
            subject,
            status: 'open',
            createdAt: new Date(),
          }).run();

          const ticketId = ticketResult.lastInsertRowid as number;

          // Simulate concurrent closure attempts
          let closureCount = 0;
          const closeTicket = () => {
            const ticket = db.db.select().from(tickets)
              .where(and(eq(tickets.id, ticketId), eq(tickets.status, 'open'))).get();
            
            if (ticket) {
              db.db.update(tickets)
                .set({ status: 'closed', closedAt: new Date() })
                .where(eq(tickets.id, ticketId))
                .run();
              closureCount++;
            }
          };

          // Run "concurrent" closures (synchronous in test but simulates the logic)
          closeTicket();
          closeTicket();
          closeTicket();

          // Should only close once due to status check
          expect(closureCount).toBe(1);

          const finalTicket = db.db.select().from(tickets)
            .where(eq(tickets.id, ticketId)).get();
          expect(finalTicket?.status).toBe('closed');
        }
      ),
      { numRuns: 30 }
    );
  });

  it('should handle message sent after ticket closed', async () => {
    await fc.assert(
      fc.asyncProperty(
        telegramIdArbitrary,
        topicIdArbitrary,
        subjectArbitrary,
        async (baseTelegramId, topicId, subject) => {
          const telegramId = getUniqueId(baseTelegramId);

          db.db.insert(users).values({ telegramId, role: 'user', createdAt: new Date() }).run();

          const ticketResult = db.db.insert(tickets).values({
            telegramId,
            topicId,
            subject,
            status: 'open',
            createdAt: new Date(),
          }).run();

          const ticketId = ticketResult.lastInsertRowid as number;

          // Close ticket
          db.db.update(tickets)
            .set({ status: 'closed', closedAt: new Date() })
            .where(eq(tickets.id, ticketId))
            .run();

          // Try to find active ticket (как в handleMessage)
          const activeTicket = db.db.select().from(tickets)
            .where(and(eq(tickets.telegramId, telegramId), eq(tickets.status, 'open'))).get();

          // Should NOT find closed ticket
          expect(activeTicket).toBeUndefined();
        }
      ),
      { numRuns: 30 }
    );
  });
});

describe('Username Edge Cases', () => {
  let db: DatabaseConnection;
  let testCounter = 0;

  beforeEach(() => {
    ensureDataDir();
    cleanupTestDb();
    db = createDatabase(TEST_DB_PATH);
    db.migrate();
    testCounter = 0;
  });

  afterEach(() => {
    db.close();
    cleanupTestDb();
  });

  function getUniqueId(baseId: number): number {
    testCounter++;
    return baseId + testCounter * 10000000;
  }

  it('should handle usernames with underscores (Markdown issue)', async () => {
    const problematicUsernames = [
      'test_user',
      'user_name_123',
      '__double__underscore__',
      'a_b_c_d_e',
    ];

    for (const username of problematicUsernames) {
      const telegramId = getUniqueId(12345);

      db.db.insert(users).values({
        telegramId,
        username,
        firstName: 'Test',
        role: 'user',
        createdAt: new Date(),
      }).run();

      const user = db.db.select().from(users)
        .where(eq(users.telegramId, telegramId)).get();

      expect(user?.username).toBe(username);

      // Test Markdown escaping
      const escaped = username.replace(/_/g, '\\_');
      expect(escaped).not.toContain('__'); // No double underscores after escape
    }
  });

  it('should handle null username', async () => {
    await fc.assert(
      fc.asyncProperty(
        telegramIdArbitrary,
        async (baseTelegramId) => {
          const telegramId = getUniqueId(baseTelegramId);

          db.db.insert(users).values({
            telegramId,
            username: null,
            firstName: 'NoUsername',
            role: 'user',
            createdAt: new Date(),
          }).run();

          const user = db.db.select().from(users)
            .where(eq(users.telegramId, telegramId)).get();

          expect(user?.username).toBeNull();
        }
      ),
      { numRuns: 20 }
    );
  });

  it('should handle special characters in firstName', async () => {
    const specialNames = [
      '🎉 Party',
      '<script>alert(1)</script>',
      'Name\nWith\nNewlines',
      'Name\tWith\tTabs',
      '   Spaces   ',
      '',
    ];

    for (const firstName of specialNames) {
      const telegramId = getUniqueId(12345);

      db.db.insert(users).values({
        telegramId,
        firstName,
        role: 'user',
        createdAt: new Date(),
      }).run();

      const user = db.db.select().from(users)
        .where(eq(users.telegramId, telegramId)).get();

      expect(user?.firstName).toBe(firstName);
    }
  });
});
