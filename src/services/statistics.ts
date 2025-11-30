/**
 * Statistics Service
 * Provides statistics for support agents
 */

import { eq, and, sql, inArray } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { messages, tickets, users } from '../database/schema.js';
import * as schema from '../database/schema.js';

export interface PersonalStats {
  ticketsHandled: number;  // Tickets where agent sent at least one response
  messagesSent: number;    // Total admin messages sent by agent
  ticketsClosed: number;   // Closed tickets where agent was last responder
}

export interface TeamStats {
  totalTickets: number;        // Total tickets in system
  openTickets: number;         // Currently open tickets
  closedTickets: number;       // Closed tickets
  activeSupportAgents: number; // Users with support/owner role
}

export interface LeaderboardEntry {
  telegramId: number;
  name: string;
  messageCount: number;
  ticketsHandled: number;
  rank: number;
}

export interface LeaderboardResult {
  top10: LeaderboardEntry[];
  userPosition: LeaderboardEntry | null; // If not in top 10
}


/**
 * Statistics service interface
 */
export interface StatisticsService {
  getPersonalStats(agentTelegramId: number): Promise<PersonalStats>;
  getTeamStats(): Promise<TeamStats>;
  getLeaderboard(requestingAgentId: number): Promise<LeaderboardResult>;
}

/**
 * Creates a statistics service instance
 * @param db - Drizzle database instance
 * @returns StatisticsService instance
 */
export function createStatisticsService(
  db: BetterSQLite3Database<typeof schema>
): StatisticsService {
  return {
    async getPersonalStats(agentTelegramId: number): Promise<PersonalStats> {
      const ticketsHandledResult = db
        .select({ count: sql<number>`COUNT(DISTINCT ${messages.ticketId})` })
        .from(messages)
        .where(
          and(
            eq(messages.telegramId, agentTelegramId),
            eq(messages.isAdmin, true)
          )
        )
        .get();

      const messagesSentResult = db
        .select({ count: sql<number>`COUNT(*)` })
        .from(messages)
        .where(
          and(
            eq(messages.telegramId, agentTelegramId),
            eq(messages.isAdmin, true)
          )
        )
        .get();

      // Find closed tickets where agent was last responder
      const closedTicketsResult = db.all(sql`
        SELECT COUNT(*) as count FROM (
          SELECT t.id
          FROM ${tickets} t
          INNER JOIN ${messages} m ON m.ticket_id = t.id
          WHERE t.status = 'closed' AND m.is_admin = 1
          GROUP BY t.id
          HAVING m.telegram_id = ${agentTelegramId}
            AND m.created_at = MAX(m.created_at)
        )
      `) as { count: number }[];

      return {
        ticketsHandled: ticketsHandledResult?.count ?? 0,
        messagesSent: messagesSentResult?.count ?? 0,
        ticketsClosed: closedTicketsResult[0]?.count ?? 0,
      };
    },

    async getTeamStats(): Promise<TeamStats> {
      const totalResult = db
        .select({ count: sql<number>`COUNT(*)` })
        .from(tickets)
        .get();

      const openResult = db
        .select({ count: sql<number>`COUNT(*)` })
        .from(tickets)
        .where(eq(tickets.status, 'open'))
        .get();

      const closedResult = db
        .select({ count: sql<number>`COUNT(*)` })
        .from(tickets)
        .where(eq(tickets.status, 'closed'))
        .get();

      const agentsResult = db
        .select({ count: sql<number>`COUNT(*)` })
        .from(users)
        .where(inArray(users.role, ['support', 'owner']))
        .get();

      return {
        totalTickets: totalResult?.count ?? 0,
        openTickets: openResult?.count ?? 0,
        closedTickets: closedResult?.count ?? 0,
        activeSupportAgents: agentsResult?.count ?? 0,
      };
    },

    async getLeaderboard(requestingAgentId: number): Promise<LeaderboardResult> {
      // Get all support agents with their stats, sorted by message count
      const allAgentsStats = db.all(sql`
        SELECT 
          u.telegram_id as telegramId,
          COALESCE(u.first_name, u.username, 'Unknown') as name,
          COUNT(m.id) as messageCount,
          COUNT(DISTINCT m.ticket_id) as ticketsHandled
        FROM ${users} u
        LEFT JOIN ${messages} m ON m.telegram_id = u.telegram_id AND m.is_admin = 1
        WHERE u.role IN ('support', 'owner')
        GROUP BY u.telegram_id
        ORDER BY messageCount DESC
      `) as { telegramId: number; name: string; messageCount: number; ticketsHandled: number }[];

      // Add ranks
      const rankedAgents: LeaderboardEntry[] = allAgentsStats.map((agent, index) => ({
        telegramId: agent.telegramId,
        name: agent.name,
        messageCount: agent.messageCount,
        ticketsHandled: agent.ticketsHandled,
        rank: index + 1,
      }));

      const top10 = rankedAgents.slice(0, 10);

      // Find requesting agent's position if not in top 10
      let userPosition: LeaderboardEntry | null = null;
      const userInTop10 = top10.some(entry => entry.telegramId === requestingAgentId);
      
      if (!userInTop10) {
        const userEntry = rankedAgents.find(entry => entry.telegramId === requestingAgentId);
        if (userEntry) {
          userPosition = userEntry;
        }
      }

      return {
        top10,
        userPosition,
      };
    },
  };
}
