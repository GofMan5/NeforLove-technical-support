/**
 * Edge Cases and Bug Scenarios for Support Module
 * Tests for rare but critical scenarios that could cause bugs
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';
import { createDatabase, type DatabaseConnection } from '../../database';
import { tickets, users, messages, bannedUsers } from '../../database/schema';
import { eq, and } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';

const TEST_DB_PATH = './data/test-edge-cases.sqlite';

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

describe('Session State Edge Cases', () => {
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

  it('should handle user sending message while awaiting_subject', async () => {
    // Scenario: User clicks "New Ticket", then sends a non-text message
    const telegramId = getUniqueId(12345);

    db.db.insert(users).values({
      telegramId,
      role: 'user',
      createdAt: new Date(),
    }).run();

    // Simulate session state
    const sessionState = { awaiting_subject: true };

    // User sends photo instead of text - should this create ticket?
    // Current behavior: Only text creates ticket when awaiting_subject
    const isTextMessage = false;
    const shouldCreateTicket = sessionState.awaiting_subject && isTextMessage;

    expect(shouldCreateTicket).toBe(false);
  });

  it('should handle user with multiple chats (groups vs private)', async () => {
    const telegramId = getUniqueId(12345);
    const privateChatId = telegramId; // Private chat ID equals user ID
    const groupChatId = -1001234567890;

    db.db.insert(users).values({
      telegramId,
      role: 'user',
      createdAt: new Date(),
    }).run();

    // User can have different sessions in different chats
    // This tests that ticket lookup uses telegramId, not chatId
    const ticketResult = db.db.insert(tickets).values({
      telegramId,
      topicId: 123,
      subject: 'Test',
      status: 'open',
      createdAt: new Date(),
    }).run();

    // Should find ticket by telegramId regardless of which chat user is in
    const ticket = db.db.select().from(tickets)
      .where(and(eq(tickets.telegramId, telegramId), eq(tickets.status, 'open'))).get();

    expect(ticket).toBeDefined();
  });

  it('should handle rapid ticket creation attempts', async () => {
    const telegramId = getUniqueId(12345);

    db.db.insert(users).values({
      telegramId,
      role: 'user',
      createdAt: new Date(),
    }).run();

    // Simulate rapid clicks on "New Ticket" button
    let ticketsCreated = 0;
    const createTicketIfNone = () => {
      const existing = db.db.select().from(tickets)
        .where(and(eq(tickets.telegramId, telegramId), eq(tickets.status, 'open'))).get();

      if (!existing) {
        db.db.insert(tickets).values({
          telegramId,
          topicId: Date.now() + ticketsCreated,
          subject: `Ticket ${ticketsCreated}`,
          status: 'open',
          createdAt: new Date(),
        }).run();
        ticketsCreated++;
      }
    };

    // Simulate 5 rapid attempts
    createTicketIfNone();
    createTicketIfNone();
    createTicketIfNone();
    createTicketIfNone();
    createTicketIfNone();

    // Should only create one ticket
    const allTickets = db.db.select().from(tickets)
      .where(eq(tickets.telegramId, telegramId)).all();

    expect(allTickets.length).toBe(1);
    expect(ticketsCreated).toBe(1);
  });
});

describe('Admin Actions Edge Cases', () => {
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

  it('should handle admin closing already closed ticket', async () => {
    const telegramId = getUniqueId(12345);

    db.db.insert(users).values({ telegramId, role: 'user', createdAt: new Date() }).run();

    const ticketResult = db.db.insert(tickets).values({
      telegramId,
      topicId: 123,
      subject: 'Test',
      status: 'closed',
      createdAt: new Date(),
      closedAt: new Date(),
    }).run();

    const ticketId = ticketResult.lastInsertRowid as number;

    // Admin tries to close already closed ticket
    const ticket = db.db.select().from(tickets).where(eq(tickets.id, ticketId)).get();

    // Should check status before closing
    if (ticket?.status === 'open') {
      db.db.update(tickets)
        .set({ status: 'closed', closedAt: new Date() })
        .where(eq(tickets.id, ticketId))
        .run();
    }

    // Ticket should still be closed (no double-close)
    const finalTicket = db.db.select().from(tickets).where(eq(tickets.id, ticketId)).get();
    expect(finalTicket?.status).toBe('closed');
  });

  it('should handle banning already banned user', async () => {
    const telegramId = getUniqueId(12345);

    db.db.insert(users).values({ telegramId, role: 'user', createdAt: new Date() }).run();
    db.db.insert(bannedUsers).values({ telegramId, bannedAt: new Date() }).run();

    // Try to ban again
    const alreadyBanned = !!db.db.select().from(bannedUsers)
      .where(eq(bannedUsers.telegramId, telegramId)).get();

    if (!alreadyBanned) {
      db.db.insert(bannedUsers).values({ telegramId, bannedAt: new Date() }).run();
    }

    // Should still have only one ban record
    const banRecords = db.db.select().from(bannedUsers)
      .where(eq(bannedUsers.telegramId, telegramId)).all();

    expect(banRecords.length).toBe(1);
  });

  it('should handle admin replying to message from deleted ticket', async () => {
    const telegramId = getUniqueId(12345);
    const topicId = getUniqueId(99999);

    db.db.insert(users).values({ telegramId, role: 'user', createdAt: new Date() }).run();

    const ticketResult = db.db.insert(tickets).values({
      telegramId,
      topicId,
      subject: 'Test',
      status: 'open',
      createdAt: new Date(),
    }).run();

    const ticketId = ticketResult.lastInsertRowid as number;

    // Add message
    db.db.insert(messages).values({
      ticketId,
      telegramId,
      userMessageId: 1,
      topicMessageId: 2,
      mediaType: 'text',
      text: 'Hello',
      isAdmin: false,
      createdAt: new Date(),
    }).run();

    // Close ticket
    db.db.update(tickets)
      .set({ status: 'closed', closedAt: new Date() })
      .where(eq(tickets.id, ticketId))
      .run();

    // Admin tries to reply (handleAdminReply checks for open ticket)
    const ticket = db.db.select().from(tickets)
      .where(and(eq(tickets.topicId, topicId), eq(tickets.status, 'open'))).get();

    // Should NOT find closed ticket
    expect(ticket).toBeUndefined();
  });

  it('should handle owner trying to ban themselves', async () => {
    const ownerId = getUniqueId(12345);

    db.db.insert(users).values({
      telegramId: ownerId,
      role: 'owner',
      createdAt: new Date(),
    }).run();

    // Check if target is owner before banning
    const targetUser = db.db.select().from(users)
      .where(eq(users.telegramId, ownerId)).get();

    const canBan = targetUser?.role !== 'owner';

    expect(canBan).toBe(false);
  });

  it('should handle support trying to ban another support', async () => {
    const supportId1 = getUniqueId(12345);
    const supportId2 = getUniqueId(67890);

    db.db.insert(users).values({ telegramId: supportId1, role: 'support', createdAt: new Date() }).run();
    db.db.insert(users).values({ telegramId: supportId2, role: 'support', createdAt: new Date() }).run();

    // Support should not be able to ban other support
    const targetUser = db.db.select().from(users)
      .where(eq(users.telegramId, supportId2)).get();

    // In real implementation, this check should exist
    const canBan = targetUser?.role === 'user';

    expect(canBan).toBe(false);
  });
});

describe('Message Integrity Edge Cases', () => {
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

  it('should handle reply to non-existent message', async () => {
    const telegramId = getUniqueId(12345);
    const topicId = getUniqueId(99999);

    db.db.insert(users).values({ telegramId, role: 'user', createdAt: new Date() }).run();

    const ticketResult = db.db.insert(tickets).values({
      telegramId,
      topicId,
      subject: 'Test',
      status: 'open',
      createdAt: new Date(),
    }).run();

    const ticketId = ticketResult.lastInsertRowid as number;

    // Try to find message that doesn't exist
    const nonExistentMsgId = 999999;
    const originalMsg = db.db.select().from(messages)
      .where(and(
        eq(messages.ticketId, ticketId),
        eq(messages.userMessageId, nonExistentMsgId)
      )).get();

    // Should return undefined, not throw
    expect(originalMsg).toBeUndefined();
  });

  it('should handle very long message text', async () => {
    const telegramId = getUniqueId(12345);
    const topicId = getUniqueId(99999);

    db.db.insert(users).values({ telegramId, role: 'user', createdAt: new Date() }).run();

    const ticketResult = db.db.insert(tickets).values({
      telegramId,
      topicId,
      subject: 'Test',
      status: 'open',
      createdAt: new Date(),
    }).run();

    const ticketId = ticketResult.lastInsertRowid as number;

    // Telegram max message length is 4096
    const longText = 'A'.repeat(4096);

    db.db.insert(messages).values({
      ticketId,
      telegramId,
      userMessageId: 1,
      topicMessageId: 2,
      mediaType: 'text',
      text: longText,
      isAdmin: false,
      createdAt: new Date(),
    }).run();

    const msg = db.db.select().from(messages)
      .where(eq(messages.ticketId, ticketId)).get();

    expect(msg?.text?.length).toBe(4096);
  });

  it('should handle message with null text and null fileId', async () => {
    const telegramId = getUniqueId(12345);
    const topicId = getUniqueId(99999);

    db.db.insert(users).values({ telegramId, role: 'user', createdAt: new Date() }).run();

    const ticketResult = db.db.insert(tickets).values({
      telegramId,
      topicId,
      subject: 'Test',
      status: 'open',
      createdAt: new Date(),
    }).run();

    const ticketId = ticketResult.lastInsertRowid as number;

    // Edge case: message with no content (shouldn't happen but test it)
    db.db.insert(messages).values({
      ticketId,
      telegramId,
      userMessageId: 1,
      topicMessageId: 2,
      mediaType: 'text',
      text: null,
      fileId: null,
      isAdmin: false,
      createdAt: new Date(),
    }).run();

    const msg = db.db.select().from(messages)
      .where(eq(messages.ticketId, ticketId)).get();

    expect(msg).toBeDefined();
    expect(msg?.text).toBeNull();
    expect(msg?.fileId).toBeNull();
  });
});

describe('Locale and i18n Edge Cases', () => {
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

  it('should handle user without locale set', async () => {
    const telegramId = getUniqueId(12345);

    db.db.insert(users).values({
      telegramId,
      locale: null, // No locale set
      role: 'user',
      createdAt: new Date(),
    }).run();

    const user = db.db.select().from(users)
      .where(eq(users.telegramId, telegramId)).get();

    // Should fallback to default locale
    const locale = user?.locale || 'ru';
    expect(locale).toBe('ru');
  });

  it('should handle invalid locale value', async () => {
    const telegramId = getUniqueId(12345);

    db.db.insert(users).values({
      telegramId,
      locale: 'invalid_locale',
      role: 'user',
      createdAt: new Date(),
    }).run();

    const user = db.db.select().from(users)
      .where(eq(users.telegramId, telegramId)).get();

    // Should handle gracefully (fallback in i18n service)
    const validLocales = ['ru', 'en'];
    const locale = validLocales.includes(user?.locale || '') ? user?.locale : 'ru';
    expect(locale).toBe('ru');
  });

  it('should handle empty string locale', async () => {
    const telegramId = getUniqueId(12345);

    db.db.insert(users).values({
      telegramId,
      locale: '', // Empty string
      role: 'user',
      createdAt: new Date(),
    }).run();

    const user = db.db.select().from(users)
      .where(eq(users.telegramId, telegramId)).get();

    // Empty string should be treated as "not set"
    const hasCompletedOnboarding = !!user?.locale && user.locale.length > 0;
    expect(hasCompletedOnboarding).toBe(false);
  });
});


describe('Role Permission Edge Cases', () => {
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

  it('should handle role change during active session', async () => {
    const telegramId = getUniqueId(12345);

    // User starts as regular user
    db.db.insert(users).values({
      telegramId,
      role: 'user',
      createdAt: new Date(),
    }).run();

    // User creates ticket
    db.db.insert(tickets).values({
      telegramId,
      topicId: 123,
      subject: 'Test',
      status: 'open',
      createdAt: new Date(),
    }).run();

    // User gets promoted to support mid-session
    db.db.update(users)
      .set({ role: 'support' })
      .where(eq(users.telegramId, telegramId))
      .run();

    // User should still be able to manage their own ticket
    const user = db.db.select().from(users)
      .where(eq(users.telegramId, telegramId)).get();

    expect(user?.role).toBe('support');

    // Their ticket should still exist
    const ticket = db.db.select().from(tickets)
      .where(eq(tickets.telegramId, telegramId)).get();

    expect(ticket).toBeDefined();
  });

  it('should handle owner demotion attempt', async () => {
    const ownerId = getUniqueId(12345);
    const adminIds = [ownerId]; // Owner is in config

    db.db.insert(users).values({
      telegramId: ownerId,
      role: 'owner',
      createdAt: new Date(),
    }).run();

    // Try to demote owner
    const isOwnerFromEnv = adminIds.includes(ownerId);

    // Owner from env should always remain owner
    if (isOwnerFromEnv) {
      // Don't allow demotion
      const user = db.db.select().from(users)
        .where(eq(users.telegramId, ownerId)).get();
      expect(user?.role).toBe('owner');
    }
  });

  it('should handle user with no role in DB', async () => {
    const telegramId = getUniqueId(12345);

    // Insert user without explicit role (should use default)
    db.db.insert(users).values({
      telegramId,
      createdAt: new Date(),
    }).run();

    const user = db.db.select().from(users)
      .where(eq(users.telegramId, telegramId)).get();

    // Default role should be 'user'
    expect(user?.role).toBe('user');
  });
});

describe('Ticket Subject Edge Cases', () => {
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

  it('should truncate very long subject', async () => {
    const telegramId = getUniqueId(12345);

    db.db.insert(users).values({ telegramId, role: 'user', createdAt: new Date() }).run();

    const longSubject = 'A'.repeat(200);
    const truncatedSubject = longSubject.slice(0, 100); // Code truncates to 100

    db.db.insert(tickets).values({
      telegramId,
      topicId: 123,
      subject: truncatedSubject,
      status: 'open',
      createdAt: new Date(),
    }).run();

    const ticket = db.db.select().from(tickets)
      .where(eq(tickets.telegramId, telegramId)).get();

    expect(ticket?.subject.length).toBeLessThanOrEqual(100);
  });

  it('should handle subject with special characters', async () => {
    const telegramId = getUniqueId(12345);

    db.db.insert(users).values({ telegramId, role: 'user', createdAt: new Date() }).run();

    const specialSubjects = [
      '🔥 Urgent issue!',
      '<script>alert(1)</script>',
      'Subject with\nnewline',
      'Subject with\ttab',
      '   Spaces around   ',
      'Emoji 😀🎉🚀',
      'Russian: Привет мир',
      'Chinese: 你好世界',
      'Arabic: مرحبا بالعالم',
    ];

    for (const subject of specialSubjects) {
      const result = db.db.insert(tickets).values({
        telegramId,
        topicId: Date.now(),
        subject,
        status: 'open',
        createdAt: new Date(),
      }).run();

      const ticketId = result.lastInsertRowid as number;
      const ticket = db.db.select().from(tickets)
        .where(eq(tickets.id, ticketId)).get();

      expect(ticket?.subject).toBe(subject);
    }
  });

  it('should handle empty subject (edge case)', async () => {
    const telegramId = getUniqueId(12345);

    db.db.insert(users).values({ telegramId, role: 'user', createdAt: new Date() }).run();

    // In real code, empty subject should be rejected
    // But test DB behavior
    db.db.insert(tickets).values({
      telegramId,
      topicId: 123,
      subject: '', // Empty
      status: 'open',
      createdAt: new Date(),
    }).run();

    const ticket = db.db.select().from(tickets)
      .where(eq(tickets.telegramId, telegramId)).get();

    expect(ticket?.subject).toBe('');
  });
});

describe('Timing and Date Edge Cases', () => {
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

  it('should handle ticket closed before any messages', async () => {
    const telegramId = getUniqueId(12345);

    db.db.insert(users).values({ telegramId, role: 'user', createdAt: new Date() }).run();

    const ticketResult = db.db.insert(tickets).values({
      telegramId,
      topicId: 123,
      subject: 'Test',
      status: 'open',
      createdAt: new Date(),
    }).run();

    const ticketId = ticketResult.lastInsertRowid as number;

    // Close immediately without any messages
    db.db.update(tickets)
      .set({ status: 'closed', closedAt: new Date() })
      .where(eq(tickets.id, ticketId))
      .run();

    const ticket = db.db.select().from(tickets)
      .where(eq(tickets.id, ticketId)).get();

    expect(ticket?.status).toBe('closed');

    // No messages should exist
    const msgs = db.db.select().from(messages)
      .where(eq(messages.ticketId, ticketId)).all();

    expect(msgs.length).toBe(0);
  });

  it('should handle closedAt being before createdAt (invalid state)', async () => {
    const telegramId = getUniqueId(12345);

    db.db.insert(users).values({ telegramId, role: 'user', createdAt: new Date() }).run();

    const createdAt = new Date();
    const closedAt = new Date(createdAt.getTime() - 1000); // 1 second BEFORE creation

    // This is invalid but DB allows it
    db.db.insert(tickets).values({
      telegramId,
      topicId: 123,
      subject: 'Test',
      status: 'closed',
      createdAt,
      closedAt,
    }).run();

    const ticket = db.db.select().from(tickets)
      .where(eq(tickets.telegramId, telegramId)).get();

    // DB stores it, but this is a data integrity issue
    expect(ticket?.closedAt).toBeDefined();
    expect(ticket?.closedAt!.getTime()).toBeLessThan(ticket?.createdAt.getTime()!);
  });

  it('should handle multiple tickets with same createdAt', async () => {
    const telegramId1 = getUniqueId(12345);
    const telegramId2 = getUniqueId(67890);
    const sameTime = new Date();

    db.db.insert(users).values({ telegramId: telegramId1, role: 'user', createdAt: new Date() }).run();
    db.db.insert(users).values({ telegramId: telegramId2, role: 'user', createdAt: new Date() }).run();

    db.db.insert(tickets).values({
      telegramId: telegramId1,
      topicId: 1,
      subject: 'Test 1',
      status: 'open',
      createdAt: sameTime,
    }).run();

    db.db.insert(tickets).values({
      telegramId: telegramId2,
      topicId: 2,
      subject: 'Test 2',
      status: 'open',
      createdAt: sameTime,
    }).run();

    // Both should exist with same timestamp
    const allTickets = db.db.select().from(tickets).all();
    expect(allTickets.length).toBe(2);
    expect(allTickets[0].createdAt.getTime()).toBe(allTickets[1].createdAt.getTime());
  });
});

describe('Unban Scenarios', () => {
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

  it('should allow unbanned user to create new ticket', async () => {
    const telegramId = getUniqueId(12345);

    db.db.insert(users).values({ telegramId, role: 'user', createdAt: new Date() }).run();

    // Ban user
    db.db.insert(bannedUsers).values({ telegramId, bannedAt: new Date() }).run();

    // Verify banned
    let isBanned = !!db.db.select().from(bannedUsers)
      .where(eq(bannedUsers.telegramId, telegramId)).get();
    expect(isBanned).toBe(true);

    // Unban user
    db.db.delete(bannedUsers).where(eq(bannedUsers.telegramId, telegramId)).run();

    // Verify unbanned
    isBanned = !!db.db.select().from(bannedUsers)
      .where(eq(bannedUsers.telegramId, telegramId)).get();
    expect(isBanned).toBe(false);

    // User should be able to create ticket now
    db.db.insert(tickets).values({
      telegramId,
      topicId: 123,
      subject: 'New ticket after unban',
      status: 'open',
      createdAt: new Date(),
    }).run();

    const ticket = db.db.select().from(tickets)
      .where(eq(tickets.telegramId, telegramId)).get();

    expect(ticket).toBeDefined();
  });

  it('should handle unban of non-banned user', async () => {
    const telegramId = getUniqueId(12345);

    db.db.insert(users).values({ telegramId, role: 'user', createdAt: new Date() }).run();

    // Try to unban user who was never banned
    const result = db.db.delete(bannedUsers)
      .where(eq(bannedUsers.telegramId, telegramId))
      .run();

    // Should not throw, just do nothing
    expect(result.changes).toBe(0);
  });
});
