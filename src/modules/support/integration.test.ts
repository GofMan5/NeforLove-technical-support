/**
 * Integration Tests for Support Module
 * Tests complete user flows and interactions between components
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createDatabase, type DatabaseConnection } from '../../database';
import { tickets, users, messages, bannedUsers, auditLogs } from '../../database/schema';
import { eq, and } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';

const TEST_DB_PATH = './data/test-integration.sqlite';

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

describe('Complete User Flow', () => {
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

  it('should complete full ticket lifecycle: create -> message -> close', async () => {
    const userId = getUniqueId(12345);
    const topicId = getUniqueId(99999);

    // 1. User registration
    db.db.insert(users).values({
      telegramId: userId,
      username: 'testuser',
      firstName: 'Test',
      role: 'user',
      locale: 'ru',
      createdAt: new Date(),
    }).run();

    // 2. Create ticket
    const ticketResult = db.db.insert(tickets).values({
      telegramId: userId,
      topicId,
      subject: 'Help needed',
      status: 'open',
      createdAt: new Date(),
    }).run();

    const ticketId = ticketResult.lastInsertRowid as number;

    // 3. User sends messages
    for (let i = 0; i < 3; i++) {
      db.db.insert(messages).values({
        ticketId,
        telegramId: userId,
        userMessageId: 100 + i,
        topicMessageId: 200 + i,
        mediaType: 'text',
        text: `User message ${i + 1}`,
        isAdmin: false,
        createdAt: new Date(),
      }).run();
    }

    // 4. Admin replies
    const adminId = getUniqueId(67890);
    db.db.insert(users).values({
      telegramId: adminId,
      role: 'support',
      createdAt: new Date(),
    }).run();

    db.db.insert(messages).values({
      ticketId,
      telegramId: adminId,
      userMessageId: 300,
      topicMessageId: 400,
      mediaType: 'text',
      text: 'Admin response',
      isAdmin: true,
      createdAt: new Date(),
    }).run();

    // 5. Close ticket
    db.db.update(tickets)
      .set({ status: 'closed', closedAt: new Date() })
      .where(eq(tickets.id, ticketId))
      .run();

    // Verify final state
    const finalTicket = db.db.select().from(tickets)
      .where(eq(tickets.id, ticketId)).get();

    expect(finalTicket?.status).toBe('closed');
    expect(finalTicket?.closedAt).toBeDefined();

    const allMessages = db.db.select().from(messages)
      .where(eq(messages.ticketId, ticketId)).all();

    expect(allMessages.length).toBe(4); // 3 user + 1 admin
    expect(allMessages.filter(m => m.isAdmin).length).toBe(1);
  });

  it('should handle user ban flow correctly', async () => {
    const userId = getUniqueId(12345);
    const adminId = getUniqueId(67890);

    // Setup users
    db.db.insert(users).values({ telegramId: userId, role: 'user', createdAt: new Date() }).run();
    db.db.insert(users).values({ telegramId: adminId, role: 'support', createdAt: new Date() }).run();

    // User creates multiple tickets
    for (let i = 0; i < 3; i++) {
      db.db.insert(tickets).values({
        telegramId: userId,
        topicId: getUniqueId(i),
        subject: `Ticket ${i + 1}`,
        status: 'open',
        createdAt: new Date(),
      }).run();
    }

    // Verify 3 open tickets
    let openTickets = db.db.select().from(tickets)
      .where(and(eq(tickets.telegramId, userId), eq(tickets.status, 'open'))).all();
    expect(openTickets.length).toBe(3);

    // Admin bans user
    db.db.insert(bannedUsers).values({ telegramId: userId, bannedAt: new Date() }).run();

    // Close all user's tickets
    db.db.update(tickets)
      .set({ status: 'closed', closedAt: new Date() })
      .where(and(eq(tickets.telegramId, userId), eq(tickets.status, 'open')))
      .run();

    // Verify all tickets closed
    openTickets = db.db.select().from(tickets)
      .where(and(eq(tickets.telegramId, userId), eq(tickets.status, 'open'))).all();
    expect(openTickets.length).toBe(0);

    // Verify user is banned
    const isBanned = !!db.db.select().from(bannedUsers)
      .where(eq(bannedUsers.telegramId, userId)).get();
    expect(isBanned).toBe(true);
  });

  it('should handle role promotion flow', async () => {
    const userId = getUniqueId(12345);
    const ownerId = getUniqueId(67890);

    // Setup
    db.db.insert(users).values({ telegramId: userId, role: 'user', createdAt: new Date() }).run();
    db.db.insert(users).values({ telegramId: ownerId, role: 'owner', createdAt: new Date() }).run();

    // Verify initial role
    let user = db.db.select().from(users).where(eq(users.telegramId, userId)).get();
    expect(user?.role).toBe('user');

    // Owner promotes user to support
    db.db.update(users)
      .set({ role: 'support' })
      .where(eq(users.telegramId, userId))
      .run();

    // Verify new role
    user = db.db.select().from(users).where(eq(users.telegramId, userId)).get();
    expect(user?.role).toBe('support');

    // Owner demotes back to user
    db.db.update(users)
      .set({ role: 'user' })
      .where(eq(users.telegramId, userId))
      .run();

    user = db.db.select().from(users).where(eq(users.telegramId, userId)).get();
    expect(user?.role).toBe('user');
  });
});

describe('Multi-User Scenarios', () => {
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

  it('should handle multiple users with concurrent tickets', async () => {
    const userIds = [getUniqueId(1), getUniqueId(2), getUniqueId(3)];

    // Create users
    for (const userId of userIds) {
      db.db.insert(users).values({
        telegramId: userId,
        role: 'user',
        createdAt: new Date(),
      }).run();
    }

    // Each user creates a ticket
    for (const userId of userIds) {
      db.db.insert(tickets).values({
        telegramId: userId,
        topicId: getUniqueId(userId),
        subject: `Ticket from user ${userId}`,
        status: 'open',
        createdAt: new Date(),
      }).run();
    }

    // Verify each user has exactly one ticket
    for (const userId of userIds) {
      const userTickets = db.db.select().from(tickets)
        .where(eq(tickets.telegramId, userId)).all();
      expect(userTickets.length).toBe(1);
    }

    // Total tickets should be 3
    const allTickets = db.db.select().from(tickets).all();
    expect(allTickets.length).toBe(3);
  });

  it('should handle support team with multiple agents', async () => {
    const userId = getUniqueId(12345);
    const supportIds = [getUniqueId(1), getUniqueId(2), getUniqueId(3)];

    // Create user and support agents
    db.db.insert(users).values({ telegramId: userId, role: 'user', createdAt: new Date() }).run();
    for (const supportId of supportIds) {
      db.db.insert(users).values({
        telegramId: supportId,
        role: 'support',
        createdAt: new Date(),
      }).run();
    }

    // User creates ticket
    const ticketResult = db.db.insert(tickets).values({
      telegramId: userId,
      topicId: getUniqueId(99999),
      subject: 'Need help',
      status: 'open',
      createdAt: new Date(),
    }).run();

    const ticketId = ticketResult.lastInsertRowid as number;

    // Multiple support agents reply
    for (let i = 0; i < supportIds.length; i++) {
      db.db.insert(messages).values({
        ticketId,
        telegramId: supportIds[i],
        userMessageId: 100 + i,
        topicMessageId: 200 + i,
        mediaType: 'text',
        text: `Response from support ${i + 1}`,
        isAdmin: true,
        createdAt: new Date(),
      }).run();
    }

    // Verify all messages are linked to ticket
    const ticketMessages = db.db.select().from(messages)
      .where(eq(messages.ticketId, ticketId)).all();

    expect(ticketMessages.length).toBe(3);
    expect(ticketMessages.every(m => m.isAdmin)).toBe(true);
  });
});

describe('Audit Log Integration', () => {
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

  it('should log ticket creation', async () => {
    const userId = getUniqueId(12345);

    db.db.insert(users).values({ telegramId: userId, role: 'user', createdAt: new Date() }).run();

    const ticketResult = db.db.insert(tickets).values({
      telegramId: userId,
      topicId: 123,
      subject: 'Test',
      status: 'open',
      createdAt: new Date(),
    }).run();

    const ticketId = ticketResult.lastInsertRowid as number;

    // Log the action
    db.db.insert(auditLogs).values({
      action: 'ticket_created',
      actorId: userId,
      entityType: 'ticket',
      entityId: ticketId,
      metadata: { subject: 'Test' },
      createdAt: new Date(),
    }).run();

    const logs = db.db.select().from(auditLogs)
      .where(eq(auditLogs.entityId, ticketId)).all();

    expect(logs.length).toBe(1);
    expect(logs[0].action).toBe('ticket_created');
  });

  it('should log ticket closure by admin', async () => {
    const userId = getUniqueId(12345);
    const adminId = getUniqueId(67890);

    db.db.insert(users).values({ telegramId: userId, role: 'user', createdAt: new Date() }).run();
    db.db.insert(users).values({ telegramId: adminId, role: 'support', createdAt: new Date() }).run();

    const ticketResult = db.db.insert(tickets).values({
      telegramId: userId,
      topicId: 123,
      subject: 'Test',
      status: 'open',
      createdAt: new Date(),
    }).run();

    const ticketId = ticketResult.lastInsertRowid as number;

    // Admin closes ticket
    db.db.update(tickets)
      .set({ status: 'closed', closedAt: new Date() })
      .where(eq(tickets.id, ticketId))
      .run();

    // Log the action
    db.db.insert(auditLogs).values({
      action: 'ticket_closed_by_admin',
      actorId: adminId,
      targetId: userId,
      entityType: 'ticket',
      entityId: ticketId,
      createdAt: new Date(),
    }).run();

    const logs = db.db.select().from(auditLogs)
      .where(eq(auditLogs.action, 'ticket_closed_by_admin')).all();

    expect(logs.length).toBe(1);
    expect(logs[0].actorId).toBe(adminId);
    expect(logs[0].targetId).toBe(userId);
  });

  it('should log user ban', async () => {
    const userId = getUniqueId(12345);
    const adminId = getUniqueId(67890);

    db.db.insert(users).values({ telegramId: userId, role: 'user', createdAt: new Date() }).run();
    db.db.insert(users).values({ telegramId: adminId, role: 'support', createdAt: new Date() }).run();

    // Ban user
    db.db.insert(bannedUsers).values({ telegramId: userId, bannedAt: new Date() }).run();

    // Log the action
    db.db.insert(auditLogs).values({
      action: 'user_banned',
      actorId: adminId,
      targetId: userId,
      entityType: 'user',
      createdAt: new Date(),
    }).run();

    const logs = db.db.select().from(auditLogs)
      .where(eq(auditLogs.action, 'user_banned')).all();

    expect(logs.length).toBe(1);
    expect(logs[0].targetId).toBe(userId);
  });
});

describe('Error State Recovery', () => {
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

  it('should recover from orphaned ticket (no topic)', async () => {
    const userId = getUniqueId(12345);

    db.db.insert(users).values({ telegramId: userId, role: 'user', createdAt: new Date() }).run();

    // Ticket created without topic (topic creation failed)
    db.db.insert(tickets).values({
      telegramId: userId,
      topicId: null, // No topic!
      subject: 'Orphaned ticket',
      status: 'open',
      createdAt: new Date(),
    }).run();

    // User should still be able to close their ticket
    const ticket = db.db.select().from(tickets)
      .where(and(eq(tickets.telegramId, userId), eq(tickets.status, 'open'))).get();

    expect(ticket).toBeDefined();
    expect(ticket?.topicId).toBeNull();

    // Close it
    db.db.update(tickets)
      .set({ status: 'closed', closedAt: new Date() })
      .where(eq(tickets.id, ticket!.id))
      .run();

    const closedTicket = db.db.select().from(tickets)
      .where(eq(tickets.id, ticket!.id)).get();

    expect(closedTicket?.status).toBe('closed');
  });

  it('should handle user profile update during active ticket', async () => {
    const userId = getUniqueId(12345);

    db.db.insert(users).values({
      telegramId: userId,
      username: 'oldusername',
      firstName: 'OldName',
      role: 'user',
      createdAt: new Date(),
    }).run();

    // Create ticket
    const ticketResult = db.db.insert(tickets).values({
      telegramId: userId,
      topicId: 123,
      subject: 'Test',
      status: 'open',
      createdAt: new Date(),
    }).run();

    const ticketId = ticketResult.lastInsertRowid as number;

    // User changes their Telegram profile
    db.db.update(users)
      .set({ username: 'newusername', firstName: 'NewName' })
      .where(eq(users.telegramId, userId))
      .run();

    // Ticket should still be linked correctly
    const ticket = db.db.select().from(tickets)
      .where(eq(tickets.id, ticketId)).get();

    expect(ticket?.telegramId).toBe(userId);

    // User info should be updated
    const user = db.db.select().from(users)
      .where(eq(users.telegramId, userId)).get();

    expect(user?.username).toBe('newusername');
    expect(user?.firstName).toBe('NewName');
  });
});
