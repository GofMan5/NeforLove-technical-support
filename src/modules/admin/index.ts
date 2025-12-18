/**
 * Admin Module - Admin panel with statistics and user management
 */

import { InlineKeyboard } from 'grammy';
import { eq, count, and } from 'drizzle-orm';
import { BotModule } from '../loader.js';
import { tickets, users, bannedUsers, messages, type UserRole } from '../../database/schema.js';
import { desc } from 'drizzle-orm';
import type { BotContext } from '../../bot/context.js';
import { createStatisticsService } from '../../services/statistics.js';

// Helper to get active ticket for a user
function getActiveTicketForUser(ctx: BotContext, telegramId: number) {
  return ctx.db.select().from(tickets)
    .where(and(eq(tickets.telegramId, telegramId), eq(tickets.status, 'open'))).get();
}

const CB = {
  STATS: 'adm:stats',
  STATS_MENU: 'adm:stats_menu',
  STATS_PERSONAL: 'adm:stats_my',
  STATS_TEAM: 'adm:stats_team',
  STATS_TOP: 'adm:stats_top',
  USERS: 'adm:users',
  SUPPORT_LIST: 'adm:support_list',
  BANNED_LIST: 'adm:banned',
  ADD_SUPPORT: 'adm:add_support',
  REMOVE_SUPPORT: 'adm:rm_support:',
  UNBAN: 'adm:unban:',
  BACK: 'adm:back',
  // Ticket management
  TICKETS_LIST: 'adm:tickets',
  TICKETS_PAGE: 'adm:tickets_p:',
  TICKET_VIEW: 'adm:ticket:',
  TICKET_HISTORY: 'adm:t_hist:',
  TICKET_HISTORY_PAGE: 'adm:t_hist_p:',
  TICKET_CLOSE: 'adm:t_close:',
  TICKET_BAN: 'adm:t_ban:',
} as const;

const TICKETS_PER_PAGE = 5;
const MESSAGES_PER_PAGE = 10;

function getUserRole(ctx: BotContext, telegramId: number): UserRole {
  // Always check ADMIN_IDS first - they are always owners
  if (ctx.config.bot.adminIds.includes(telegramId)) {
    // Update DB if needed
    const user = ctx.db.select().from(users).where(eq(users.telegramId, telegramId)).get();
    if (user && user.role !== 'owner') {
      ctx.db.update(users).set({ role: 'owner' }).where(eq(users.telegramId, telegramId)).run();
    }
    return 'owner';
  }
  
  const user = ctx.db.select().from(users).where(eq(users.telegramId, telegramId)).get();
  if (!user) {
    return 'user';
  }
  return user.role as UserRole;
}

function hasAccess(role: UserRole): boolean {
  return role === 'support' || role === 'owner';
}

function isOwner(role: UserRole): boolean {
  return role === 'owner';
}

// Get statistics
function getStats(ctx: BotContext) {
  const totalUsers = ctx.db.select({ count: count() }).from(users).get()?.count || 0;
  const totalTickets = ctx.db.select({ count: count() }).from(tickets).get()?.count || 0;
  const openTickets = ctx.db.select({ count: count() }).from(tickets).where(eq(tickets.status, 'open')).get()?.count || 0;
  const bannedCount = ctx.db.select({ count: count() }).from(bannedUsers).get()?.count || 0;
  const supportCount = ctx.db.select({ count: count() }).from(users).where(eq(users.role, 'support')).get()?.count || 0;
  
  return { totalUsers, totalTickets, openTickets, bannedCount, supportCount };
}

// Main admin panel
function getAdminKeyboard(role: UserRole): InlineKeyboard {
  const kb = new InlineKeyboard()
    .text('📊 Статистика', CB.STATS_MENU)
    .text('📋 Тикеты', CB.TICKETS_LIST)
    .row();
  
  if (isOwner(role)) {
    kb.text('👥 Саппорты', CB.SUPPORT_LIST)
      .text('➕ Добавить саппорта', CB.ADD_SUPPORT)
      .row();
  }
  
  kb.text('🚫 Заблокированные', CB.BANNED_LIST);
  
  return kb;
}

async function handleAdmin(ctx: BotContext): Promise<void> {
  const telegramId = ctx.from!.id;
  const role = getUserRole(ctx, telegramId);
  
  if (!hasAccess(role)) {
    await ctx.reply('❌ Нет доступа');
    return;
  }
  
  const stats = getStats(ctx);
  const text = `⚙️ *Админ-панель*\n\n` +
    `👤 Ваша роль: \`${role}\`\n\n` +
    `📊 Быстрая статистика:\n` +
    `├ Пользователей: ${stats.totalUsers}\n` +
    `├ Обращений: ${stats.totalTickets}\n` +
    `├ Открытых: ${stats.openTickets}\n` +
    `└ Заблокировано: ${stats.bannedCount}`;
  
  await ctx.reply(text, { 
    parse_mode: 'Markdown',
    reply_markup: getAdminKeyboard(role) 
  });
}

async function handleCallback(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data?.startsWith('adm:')) return;
  
  const telegramId = ctx.from!.id;
  const role = getUserRole(ctx, telegramId);
  
  if (!hasAccess(role)) {
    await ctx.answerCallbackQuery({ text: 'Нет доступа' });
    return;
  }
  
  // Statistics Menu
  if (data === CB.STATS_MENU) {
    const text = ctx.t('stats.menu_title');
    const kb = new InlineKeyboard()
      .text(ctx.t('stats.personal_btn'), CB.STATS_PERSONAL)
      .row()
      .text(ctx.t('stats.team_btn'), CB.STATS_TEAM)
      .row()
      .text(ctx.t('stats.top_btn'), CB.STATS_TOP)
      .row()
      .text('◀️ ' + ctx.t('stats.back'), CB.BACK);
    
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      reply_markup: kb
    });
    await ctx.answerCallbackQuery();
    return;
  }

  // Personal Statistics
  if (data === CB.STATS_PERSONAL) {
    const statisticsService = createStatisticsService(ctx.db);
    const personalStats = await statisticsService.getPersonalStats(telegramId);
    
    const text = ctx.t('stats.personal_title') + '\n\n' +
      ctx.t('stats.tickets_handled', { count: String(personalStats.ticketsHandled) }) + '\n' +
      ctx.t('stats.messages_sent', { count: String(personalStats.messagesSent) }) + '\n' +
      ctx.t('stats.tickets_closed', { count: String(personalStats.ticketsClosed) });
    
    const kb = new InlineKeyboard()
      .text('◀️ ' + ctx.t('stats.back'), CB.STATS_MENU);
    
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      reply_markup: kb
    });
    await ctx.answerCallbackQuery();
    return;
  }

  // Team Statistics
  if (data === CB.STATS_TEAM) {
    const statisticsService = createStatisticsService(ctx.db);
    const teamStats = await statisticsService.getTeamStats();
    
    const text = ctx.t('stats.team_title') + '\n\n' +
      ctx.t('stats.total_tickets', { count: String(teamStats.totalTickets) }) + '\n' +
      ctx.t('stats.open_tickets', { count: String(teamStats.openTickets) }) + '\n' +
      ctx.t('stats.closed_tickets', { count: String(teamStats.closedTickets) }) + '\n' +
      ctx.t('stats.active_agents', { count: String(teamStats.activeSupportAgents) });
    
    const kb = new InlineKeyboard()
      .text('◀️ ' + ctx.t('stats.back'), CB.STATS_MENU);
    
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      reply_markup: kb
    });
    await ctx.answerCallbackQuery();
    return;
  }

  // Leaderboard
  if (data === CB.STATS_TOP) {
    const statisticsService = createStatisticsService(ctx.db);
    const leaderboard = await statisticsService.getLeaderboard(telegramId);
    
    let text = ctx.t('stats.top_title') + '\n\n';
    
    if (leaderboard.top10.length === 0) {
      text += ctx.t('stats.no_data');
    } else {
      for (const entry of leaderboard.top10) {
        const medal = entry.rank === 1 ? '🥇' : entry.rank === 2 ? '🥈' : entry.rank === 3 ? '🥉' : `${entry.rank}.`;
        text += `${medal} ${entry.name}\n`;
        text += `   ${ctx.t('stats.lb_messages', { count: String(entry.messageCount) })} | ${ctx.t('stats.lb_tickets', { count: String(entry.ticketsHandled) })}\n`;
      }
      
      // Show user's position if not in top 10
      if (leaderboard.userPosition) {
        text += '\n' + ctx.t('stats.your_position') + '\n';
        text += `${leaderboard.userPosition.rank}. ${leaderboard.userPosition.name}\n`;
        text += `   ${ctx.t('stats.lb_messages', { count: String(leaderboard.userPosition.messageCount) })} | ${ctx.t('stats.lb_tickets', { count: String(leaderboard.userPosition.ticketsHandled) })}`;
      }
    }
    
    const kb = new InlineKeyboard()
      .text('◀️ ' + ctx.t('stats.back'), CB.STATS_MENU);
    
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      reply_markup: kb
    });
    await ctx.answerCallbackQuery();
    return;
  }

  // Legacy Statistics (keeping for backward compatibility)
  if (data === CB.STATS) {
    const stats = getStats(ctx);
    const text = `📊 *Статистика*\n\n` +
      `👥 Пользователей: ${stats.totalUsers}\n` +
      `🎫 Всего обращений: ${stats.totalTickets}\n` +
      `📬 Открытых: ${stats.openTickets}\n` +
      `📪 Закрытых: ${stats.totalTickets - stats.openTickets}\n` +
      `🛡 Саппортов: ${stats.supportCount}\n` +
      `🚫 Заблокировано: ${stats.bannedCount}`;
    
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard().text('◀️ Назад', CB.BACK)
    });
    await ctx.answerCallbackQuery();
    return;
  }
  
  // Support list (owner only)
  if (data === CB.SUPPORT_LIST) {
    if (!isOwner(role)) {
      await ctx.answerCallbackQuery({ text: 'Только для owner' });
      return;
    }
    
    const supports = ctx.db.select().from(users).where(eq(users.role, 'support')).all();
    
    let text = '👥 *Список саппортов*\n\n';
    const kb = new InlineKeyboard();
    
    if (supports.length === 0) {
      text += '_Пусто_';
    } else {
      for (const s of supports) {
        const name = s.firstName || 'Без имени';
        const uname = s.username ? `@${s.username}` : '';
        const link = `[${name}](tg://user?id=${s.telegramId})`;
        text += `• ${link} ${uname}\n  ID: \`${s.telegramId}\`\n`;
        kb.text(`❌ ${name}`, CB.REMOVE_SUPPORT + s.telegramId).row();
      }
    }
    
    kb.text('◀️ Назад', CB.BACK);
    
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: kb });
    await ctx.answerCallbackQuery();
    return;
  }
  
  // Add support prompt
  if (data === CB.ADD_SUPPORT) {
    if (!isOwner(role)) {
      await ctx.answerCallbackQuery({ text: 'Только для owner' });
      return;
    }
    
    await ctx.sessionManager.set(telegramId, ctx.chat!.id, { state: { awaiting_support_id: true } });
    
    await ctx.editMessageText(
      '➕ *Добавить саппорта*\n\nОтправьте Telegram ID пользователя:',
      { parse_mode: 'Markdown', reply_markup: new InlineKeyboard().text('❌ Отмена', CB.BACK) }
    );
    await ctx.answerCallbackQuery();
    return;
  }
  
  // Remove support
  if (data.startsWith(CB.REMOVE_SUPPORT)) {
    if (!isOwner(role)) {
      await ctx.answerCallbackQuery({ text: 'Только для owner' });
      return;
    }
    
    const targetId = parseInt(data.replace(CB.REMOVE_SUPPORT, ''));
    if (isNaN(targetId)) {
      await ctx.answerCallbackQuery({ text: 'Invalid user ID' });
      return;
    }
    
    // Get user's locale before removing role
    const targetUser = ctx.db.select().from(users).where(eq(users.telegramId, targetId)).get();
    const userLocale = targetUser?.locale || 'ru';
    const oldRole = targetUser?.role || 'support';
    
    ctx.db.update(users).set({ role: 'user' }).where(eq(users.telegramId, targetId)).run();
    
    try {
      await ctx.auditLogger.log({
        action: 'role_revoked',
        actorId: telegramId,
        targetId: targetId,
        entityType: 'user',
        metadata: { oldRole, newRole: 'user' },
      });
    } catch (e) {
      ctx.logger.warn('Failed to log role revoke', { error: e });
    }
    
    // Notify user about role removal
    try {
      await ctx.api.sendMessage(targetId, ctx.i18n.t('role.support_revoked', userLocale));
    } catch {}
    
    await ctx.answerCallbackQuery({ text: '✅ Роль снята' });
    
    // Refresh list
    const supports = ctx.db.select().from(users).where(eq(users.role, 'support')).all();
    let text = '👥 *Список саппортов*\n\n';
    const kb = new InlineKeyboard();
    
    if (supports.length === 0) {
      text += '_Пусто_';
    } else {
      for (const s of supports) {
        const name = s.firstName || 'Без имени';
        const uname = s.username ? `@${s.username}` : '';
        const link = `[${name}](tg://user?id=${s.telegramId})`;
        text += `• ${link} ${uname}\n  ID: \`${s.telegramId}\`\n`;
        kb.text(`❌ ${name}`, CB.REMOVE_SUPPORT + s.telegramId).row();
      }
    }
    kb.text('◀️ Назад', CB.BACK);
    
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: kb });
    return;
  }
  
  // Banned list
  if (data === CB.BANNED_LIST) {
    const banned = ctx.db.select().from(bannedUsers).all();
    
    let text = '🚫 *Заблокированные*\n\n';
    const kb = new InlineKeyboard();
    
    if (banned.length === 0) {
      text += '_Пусто_';
    } else {
      for (const b of banned) {
        const user = ctx.db.select().from(users).where(eq(users.telegramId, b.telegramId)).get();
        const name = user?.firstName || 'Без имени';
        const uname = user?.username ? `@${user.username}` : '';
        const link = `[${name}](tg://user?id=${b.telegramId})`;
        text += `• ${link} ${uname}\n  ID: \`${b.telegramId}\`\n`;
        kb.text(`✅ ${name}`, CB.UNBAN + b.telegramId).row();
      }
    }
    kb.text('◀️ Назад', CB.BACK);
    
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: kb });
    await ctx.answerCallbackQuery();
    return;
  }
  
  // Unban
  if (data.startsWith(CB.UNBAN)) {
    const targetId = parseInt(data.replace(CB.UNBAN, ''));
    if (isNaN(targetId)) {
      await ctx.answerCallbackQuery({ text: 'Invalid user ID' });
      return;
    }
    
    // Get user's locale before deleting from banned list
    const targetUser = ctx.db.select().from(users).where(eq(users.telegramId, targetId)).get();
    const userLocale = targetUser?.locale || 'ru';
    
    // Get active ticket before unban (for system message)
    const activeTicket = getActiveTicketForUser(ctx, targetId);
    
    ctx.db.delete(bannedUsers).where(eq(bannedUsers.telegramId, targetId)).run();
    
    try {
      await ctx.auditLogger.log({
        action: 'user_unbanned',
        actorId: telegramId,
        targetId: targetId,
        entityType: 'user',
      });
    } catch (e) {
      ctx.logger.warn('Failed to log user unban', { error: e });
    }
    
    // Send system message to topic if there was an active ticket
    if (activeTicket?.topicId) {
      try {
        await ctx.api.sendMessage(ctx.config.bot.supportGroupId, ctx.t('system.user_unbanned_in_topic'), {
          message_thread_id: activeTicket.topicId,
        });
      } catch {}
    }
    
    // Notify user about unban
    try {
      await ctx.api.sendMessage(targetId, ctx.i18n.t('user.unbanned', userLocale));
    } catch {}
    
    await ctx.answerCallbackQuery({ text: ctx.t('admin.user_unbanned') });
    
    // Refresh list
    const banned = ctx.db.select().from(bannedUsers).all();
    let text = '🚫 *Заблокированные*\n\n';
    const kb = new InlineKeyboard();
    
    if (banned.length === 0) {
      text += '_Пусто_';
    } else {
      for (const b of banned) {
        const user = ctx.db.select().from(users).where(eq(users.telegramId, b.telegramId)).get();
        const name = user?.firstName || 'Без имени';
        const uname = user?.username ? `@${user.username}` : '';
        const link = `[${name}](tg://user?id=${b.telegramId})`;
        text += `• ${link} ${uname}\n  ID: \`${b.telegramId}\`\n`;
        kb.text(`✅ ${name}`, CB.UNBAN + b.telegramId).row();
      }
    }
    kb.text('◀️ Назад', CB.BACK);
    
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: kb });
    return;
  }
  
  // Tickets list
  if (data === CB.TICKETS_LIST || data.startsWith(CB.TICKETS_PAGE)) {
    const page = data === CB.TICKETS_LIST ? 0 : parseInt(data.replace(CB.TICKETS_PAGE, ''));
    if (isNaN(page)) {
      await ctx.answerCallbackQuery({ text: 'Invalid page' });
      return;
    }
    
    const openTickets = ctx.db.select().from(tickets)
      .where(eq(tickets.status, 'open'))
      .orderBy(desc(tickets.createdAt))
      .limit(TICKETS_PER_PAGE)
      .offset(page * TICKETS_PER_PAGE)
      .all();
    
    const totalCount = ctx.db.select({ count: count() }).from(tickets)
      .where(eq(tickets.status, 'open')).get()?.count || 0;
    const totalPages = Math.ceil(totalCount / TICKETS_PER_PAGE);
    
    let text = ctx.t('admin.tickets_title') + '\n\n';
    const kb = new InlineKeyboard();
    
    if (openTickets.length === 0) {
      text += ctx.t('admin.tickets_empty');
    } else {
      for (const t of openTickets) {
        const user = ctx.db.select().from(users).where(eq(users.telegramId, t.telegramId)).get();
        const name = user?.firstName || 'Без имени';
        const subj = t.subject.length > 30 ? t.subject.slice(0, 30) + '...' : t.subject;
        const date = t.createdAt ? new Date(t.createdAt).toLocaleDateString('ru-RU') : '';
        text += `#${t.id} | ${name}\n📝 ${subj}\n📅 ${date}\n\n`;
        kb.text(`#${t.id} ${name}`, CB.TICKET_VIEW + t.id).row();
      }
      
      // Pagination
      const navRow: string[][] = [];
      if (page > 0) navRow.push(['◀️', CB.TICKETS_PAGE + (page - 1)]);
      if (page < totalPages - 1) navRow.push(['▶️', CB.TICKETS_PAGE + (page + 1)]);
      if (navRow.length > 0) {
        for (const [label, cb] of navRow) kb.text(label, cb);
        kb.row();
      }
    }
    
    kb.text('◀️ Назад', CB.BACK);
    
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: kb });
    await ctx.answerCallbackQuery();
    return;
  }
  
  // View single ticket
  if (data.startsWith(CB.TICKET_VIEW)) {
    const ticketId = parseInt(data.replace(CB.TICKET_VIEW, ''));
    if (isNaN(ticketId)) {
      await ctx.answerCallbackQuery({ text: 'Invalid ticket ID' });
      return;
    }
    
    const ticket = ctx.db.select().from(tickets).where(eq(tickets.id, ticketId)).get();
    if (!ticket) {
      await ctx.answerCallbackQuery({ text: ctx.t('admin.ticket_not_found') });
      return;
    }
    
    const user = ctx.db.select().from(users).where(eq(users.telegramId, ticket.telegramId)).get();
    const msgCount = ctx.db.select({ count: count() }).from(messages)
      .where(eq(messages.ticketId, ticketId)).get()?.count || 0;
    
    const name = user?.firstName || 'Без имени';
    const uname = user?.username ? `@${user.username}` : '';
    const link = `[${name}](tg://user?id=${ticket.telegramId})`;
    const date = ticket.createdAt ? new Date(ticket.createdAt).toLocaleString('ru-RU') : '';
    const status = ticket.status === 'open' ? '🟢 Открыт' : '🔴 Закрыт';
    
    let text = ctx.t('admin.ticket_info_title', { id: String(ticketId) }) + '\n\n' +
      `👤 ${link} ${uname}\n` +
      `🆔 \`${ticket.telegramId}\`\n` +
      `📝 ${ticket.subject}\n` +
      `💬 ${ctx.t('admin.messages_count', { count: String(msgCount) })}\n` +
      `📅 ${date}\n` +
      `📊 ${status}`;
    
    const kb = new InlineKeyboard()
      .text('💬 ' + ctx.t('admin.history_btn'), CB.TICKET_HISTORY + ticketId + ':0')
      .row();
    
    // Topic link
    if (ticket.topicId) {
      const chatId = String(ctx.config.bot.supportGroupId).replace('-100', '');
      kb.url('🔗 ' + ctx.t('admin.topic_link'), `https://t.me/c/${chatId}/${ticket.topicId}`).row();
    }
    
    // Actions only for open tickets
    if (ticket.status === 'open') {
      kb.text('❌ ' + ctx.t('admin.close_btn'), CB.TICKET_CLOSE + ticketId)
        .text('🚫 ' + ctx.t('admin.ban_btn'), CB.TICKET_BAN + ticketId)
        .row();
    }
    
    kb.text('◀️ Назад', CB.TICKETS_LIST);
    
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: kb });
    await ctx.answerCallbackQuery();
    return;
  }
  
  // Ticket message history
  if (data.startsWith(CB.TICKET_HISTORY)) {
    const parts = data.replace(CB.TICKET_HISTORY, '').split(':');
    const ticketId = parseInt(parts[0]);
    const page = parseInt(parts[1] || '0');
    
    if (isNaN(ticketId) || isNaN(page)) {
      await ctx.answerCallbackQuery({ text: 'Invalid params' });
      return;
    }
    
    const ticket = ctx.db.select().from(tickets).where(eq(tickets.id, ticketId)).get();
    if (!ticket) {
      await ctx.answerCallbackQuery({ text: ctx.t('admin.ticket_not_found') });
      return;
    }
    
    const ticketMessages = ctx.db.select().from(messages)
      .where(eq(messages.ticketId, ticketId))
      .orderBy(desc(messages.createdAt))
      .limit(MESSAGES_PER_PAGE)
      .offset(page * MESSAGES_PER_PAGE)
      .all();
    
    const totalMsgs = ctx.db.select({ count: count() }).from(messages)
      .where(eq(messages.ticketId, ticketId)).get()?.count || 0;
    const totalPages = Math.ceil(totalMsgs / MESSAGES_PER_PAGE);
    
    let text = ctx.t('admin.history_title', { id: String(ticketId) }) + '\n\n';
    
    if (ticketMessages.length === 0) {
      text += ctx.t('admin.history_empty');
    } else {
      // Reverse to show oldest first on page
      for (const m of ticketMessages.reverse()) {
        const sender = m.isAdmin ? '🛡️' : '👤';
        const time = m.createdAt ? new Date(m.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '';
        const content = m.text 
          ? (m.text.length > 50 ? m.text.slice(0, 50) + '...' : m.text)
          : `[${m.mediaType || 'media'}]`;
        text += `${sender} ${time}: ${content}\n`;
      }
    }
    
    const kb = new InlineKeyboard();
    
    // Pagination
    const navRow: string[][] = [];
    if (page < totalPages - 1) navRow.push(['⬆️ Старые', CB.TICKET_HISTORY + ticketId + ':' + (page + 1)]);
    if (page > 0) navRow.push(['⬇️ Новые', CB.TICKET_HISTORY + ticketId + ':' + (page - 1)]);
    if (navRow.length > 0) {
      for (const [label, cb] of navRow) kb.text(label, cb);
      kb.row();
    }
    
    kb.text('◀️ К тикету', CB.TICKET_VIEW + ticketId);
    
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: kb });
    await ctx.answerCallbackQuery();
    return;
  }
  
  // Close ticket from admin panel
  if (data.startsWith(CB.TICKET_CLOSE)) {
    const ticketId = parseInt(data.replace(CB.TICKET_CLOSE, ''));
    if (isNaN(ticketId)) {
      await ctx.answerCallbackQuery({ text: 'Invalid ticket ID' });
      return;
    }
    
    const ticket = ctx.db.select().from(tickets).where(eq(tickets.id, ticketId)).get();
    if (!ticket) {
      await ctx.answerCallbackQuery({ text: ctx.t('admin.ticket_not_found') });
      return;
    }
    
    if (ticket.status !== 'open') {
      await ctx.answerCallbackQuery({ text: ctx.t('admin.ticket_already_closed') });
      return;
    }
    
    // Close ticket
    ctx.db.update(tickets).set({ status: 'closed', closedAt: new Date() })
      .where(eq(tickets.id, ticketId)).run();
    
    // Get user locale
    const targetUser = ctx.db.select().from(users).where(eq(users.telegramId, ticket.telegramId)).get();
    const userLocale = targetUser?.locale || 'ru';
    
    // Notify user
    try {
      await ctx.api.sendMessage(ticket.telegramId, ctx.i18n.t('ticket.closed_by_admin', userLocale));
    } catch {}
    
    // Send system message to topic and close it
    if (ticket.topicId) {
      const admin = ctx.from!;
      const adminName = admin.first_name || admin.username || String(admin.id);
      try {
        await ctx.api.sendMessage(ctx.config.bot.supportGroupId, 
          ctx.t('system.ticket_closed_by_admin', { admin: adminName }), {
          message_thread_id: ticket.topicId,
        });
      } catch {}
      // Close the forum topic
      try { await ctx.api.closeForumTopic(ctx.config.bot.supportGroupId, ticket.topicId); } catch {}
    }
    
    try {
      await ctx.auditLogger.log({
        action: 'ticket_closed_by_admin',
        actorId: telegramId,
        targetId: ticket.telegramId,
        entityType: 'ticket',
        entityId: ticketId,
      });
    } catch {}
    
    await ctx.answerCallbackQuery({ text: ctx.t('admin.ticket_closed') });
    
    // Refresh ticket view
    const msgCount = ctx.db.select({ count: count() }).from(messages)
      .where(eq(messages.ticketId, ticketId)).get()?.count || 0;
    
    const name = targetUser?.firstName || 'Без имени';
    const uname = targetUser?.username ? `@${targetUser.username}` : '';
    const link = `[${name}](tg://user?id=${ticket.telegramId})`;
    const date = ticket.createdAt ? new Date(ticket.createdAt).toLocaleString('ru-RU') : '';
    
    let text = ctx.t('admin.ticket_info_title', { id: String(ticketId) }) + '\n\n' +
      `👤 ${link} ${uname}\n` +
      `🆔 \`${ticket.telegramId}\`\n` +
      `📝 ${ticket.subject}\n` +
      `💬 ${ctx.t('admin.messages_count', { count: String(msgCount) })}\n` +
      `📅 ${date}\n` +
      `📊 🔴 Закрыт`;
    
    const kb = new InlineKeyboard()
      .text('💬 ' + ctx.t('admin.history_btn'), CB.TICKET_HISTORY + ticketId + ':0')
      .row();
    
    if (ticket.topicId) {
      const chatId = String(ctx.config.bot.supportGroupId).replace('-100', '');
      kb.url('🔗 ' + ctx.t('admin.topic_link'), `https://t.me/c/${chatId}/${ticket.topicId}`).row();
    }
    
    kb.text('◀️ Назад', CB.TICKETS_LIST);
    
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: kb });
    return;
  }
  
  // Ban user from admin panel
  if (data.startsWith(CB.TICKET_BAN)) {
    const ticketId = parseInt(data.replace(CB.TICKET_BAN, ''));
    if (isNaN(ticketId)) {
      await ctx.answerCallbackQuery({ text: 'Invalid ticket ID' });
      return;
    }
    
    const ticket = ctx.db.select().from(tickets).where(eq(tickets.id, ticketId)).get();
    if (!ticket) {
      await ctx.answerCallbackQuery({ text: ctx.t('admin.ticket_not_found') });
      return;
    }
    
    // Check if already banned
    const alreadyBanned = ctx.db.select().from(bannedUsers)
      .where(eq(bannedUsers.telegramId, ticket.telegramId)).get();
    if (alreadyBanned) {
      await ctx.answerCallbackQuery({ text: ctx.t('admin.user_already_banned') });
      return;
    }
    
    // Self-ban protection
    if (ticket.telegramId === telegramId) {
      await ctx.answerCallbackQuery({ text: ctx.t('admin.cannot_ban_self') });
      return;
    }
    
    // Owner protection
    if (ctx.config.bot.adminIds.includes(ticket.telegramId)) {
      await ctx.answerCallbackQuery({ text: ctx.t('admin.cannot_ban_owner') });
      return;
    }
    
    // Ban user
    ctx.db.insert(bannedUsers).values({
      telegramId: ticket.telegramId,
      bannedAt: new Date(),
    }).run();
    
    // Close ticket
    ctx.db.update(tickets).set({ status: 'closed', closedAt: new Date() })
      .where(eq(tickets.id, ticketId)).run();
    
    // Get user locale
    const targetUser = ctx.db.select().from(users).where(eq(users.telegramId, ticket.telegramId)).get();
    const userLocale = targetUser?.locale || 'ru';
    
    // Notify user
    try {
      await ctx.api.sendMessage(ticket.telegramId, ctx.i18n.t('user.banned', userLocale));
    } catch {}
    
    // Send system message to topic and close it
    if (ticket.topicId) {
      try {
        await ctx.api.sendMessage(ctx.config.bot.supportGroupId, ctx.t('system.user_banned_in_topic'), {
          message_thread_id: ticket.topicId,
        });
      } catch {}
      // Close the forum topic
      try { await ctx.api.closeForumTopic(ctx.config.bot.supportGroupId, ticket.topicId); } catch {}
    }
    
    try {
      await ctx.auditLogger.log({
        action: 'user_banned',
        actorId: telegramId,
        targetId: ticket.telegramId,
        entityType: 'user',
      });
    } catch {}
    
    await ctx.answerCallbackQuery({ text: ctx.t('admin.user_banned') });
    
    // Go back to tickets list
    const openTickets = ctx.db.select().from(tickets)
      .where(eq(tickets.status, 'open'))
      .orderBy(desc(tickets.createdAt))
      .limit(TICKETS_PER_PAGE)
      .all();
    
    let text = ctx.t('admin.tickets_title') + '\n\n';
    const kb = new InlineKeyboard();
    
    if (openTickets.length === 0) {
      text += ctx.t('admin.tickets_empty');
    } else {
      for (const t of openTickets) {
        const user = ctx.db.select().from(users).where(eq(users.telegramId, t.telegramId)).get();
        const name = user?.firstName || 'Без имени';
        const subj = t.subject.length > 30 ? t.subject.slice(0, 30) + '...' : t.subject;
        const date = t.createdAt ? new Date(t.createdAt).toLocaleDateString('ru-RU') : '';
        text += `#${t.id} | ${name}\n📝 ${subj}\n📅 ${date}\n\n`;
        kb.text(`#${t.id} ${name}`, CB.TICKET_VIEW + t.id).row();
      }
    }
    
    kb.text('◀️ Назад', CB.BACK);
    
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: kb });
    return;
  }
  
  // Back to main
  if (data === CB.BACK) {
    await ctx.sessionManager.set(telegramId, ctx.chat!.id, { state: {} });
    
    const stats = getStats(ctx);
    const text = `⚙️ *Админ-панель*\n\n` +
      `👤 Ваша роль: \`${role}\`\n\n` +
      `📊 Быстрая статистика:\n` +
      `├ Пользователей: ${stats.totalUsers}\n` +
      `├ Обращений: ${stats.totalTickets}\n` +
      `├ Открытых: ${stats.openTickets}\n` +
      `└ Заблокировано: ${stats.bannedCount}`;
    
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: getAdminKeyboard(role) });
    await ctx.answerCallbackQuery();
    return;
  }
  
  await ctx.answerCallbackQuery();
}

// Handle adding support by ID
async function handleMessage(ctx: BotContext): Promise<void> {
  if (!ctx.message?.text) return;
  if (ctx.chat?.id === ctx.config.bot.supportGroupId) return;
  
  const telegramId = ctx.from!.id;
  const role = getUserRole(ctx, telegramId);
  
  if (!isOwner(role)) return;
  
  const session = await ctx.sessionManager.get(telegramId, ctx.chat!.id);
  const state = (session.state || {}) as Record<string, unknown>;
  
  if (state.awaiting_support_id === true) {
    const targetId = parseInt(ctx.message.text.trim());
    
    if (isNaN(targetId)) {
      await ctx.reply('❌ Неверный ID. Отправьте число.');
      return;
    }
    
    // Try to get user info from Telegram API
    let userName: string | null = null;
    let userUsername: string | null = null;
    try {
      const chat = await ctx.api.getChat(targetId);
      if (chat.type === 'private') {
        userName = chat.first_name || null;
        userUsername = chat.username || null;
      }
    } catch {
      // User hasn't started the bot yet - that's ok
    }
    
    // Check if user exists in DB
    let targetUser = ctx.db.select().from(users).where(eq(users.telegramId, targetId)).get();
    const userLocale = targetUser?.locale || 'ru';
    const oldRole = targetUser?.role || 'user';
    
    if (!targetUser) {
      ctx.db.insert(users).values({
        telegramId: targetId,
        firstName: userName,
        username: userUsername,
        role: 'support',
        createdAt: new Date(),
      }).run();
    } else if (targetUser.role === 'owner') {
      await ctx.reply('❌ Нельзя изменить роль owner');
      return;
    } else {
      ctx.db.update(users).set({ 
        role: 'support',
        firstName: userName || targetUser.firstName,
        username: userUsername || targetUser.username,
      }).where(eq(users.telegramId, targetId)).run();
    }
    
    try {
      await ctx.auditLogger.log({
        action: 'role_granted',
        actorId: telegramId,
        targetId: targetId,
        entityType: 'user',
        metadata: { oldRole, newRole: 'support' },
      });
    } catch (e) {
      ctx.logger.warn('Failed to log role grant', { error: e });
    }
    
    // Notify user about support role
    try {
      await ctx.api.sendMessage(targetId, ctx.i18n.t('role.support_granted', userLocale));
    } catch {}
    
    await ctx.sessionManager.set(telegramId, ctx.chat!.id, { state: {} });
    
    const displayName = userName || userUsername || String(targetId);
    await ctx.reply(`✅ ${displayName} назначен саппортом`);
    
    // Show admin panel
    const stats = getStats(ctx);
    const text = `⚙️ *Админ-панель*\n\n` +
      `👤 Ваша роль: \`${role}\`\n\n` +
      `📊 Быстрая статистика:\n` +
      `├ Пользователей: ${stats.totalUsers}\n` +
      `├ Обращений: ${stats.totalTickets}\n` +
      `├ Открытых: ${stats.openTickets}\n` +
      `└ Заблокировано: ${stats.bannedCount}`;
    
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: getAdminKeyboard(role) });
  }
}

export const adminModule: BotModule<BotContext, BotContext> = {
  name: 'admin',
  enabled: true,
  commands: [
    {
      name: 'admin',
      description: 'Админ-панель',
      handler: handleAdmin as (ctx: unknown) => Promise<void>,
      hidden: true, // Hide from menu, but command still works
    },
  ],
  handlers: [
    { name: 'admin-callback', event: 'callback_query', handler: handleCallback as (ctx: unknown) => Promise<void> },
    { name: 'admin-message', event: 'message', handler: handleMessage as (ctx: unknown) => Promise<void> },
  ],
};

export default adminModule;
