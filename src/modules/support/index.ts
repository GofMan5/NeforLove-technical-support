/**
 * Support Module - Full ticket system with all media types
 */

import { InlineKeyboard } from 'grammy';
import { eq, and } from 'drizzle-orm';
import { BotModule } from '../loader.js';
import { tickets, messages, bannedUsers, users, type MediaType, type UserRole } from '../../database/schema.js';
import type { BotContext } from '../../bot/context.js';

const CB = {
  NEW_TICKET: 'ticket:new',
  CLOSE_TICKET: 'ticket:close',
  CANCEL_TICKET: 'ticket:cancel',
  ADMIN_CLOSE: 'admin:close:',
  ADMIN_BAN: 'admin:ban:',
  ADMIN_BAN_CONFIRM: 'admin:ban_confirm:',
  ADMIN_BAN_CANCEL: 'admin:ban_cancel',
  ADMIN_DELETE_TOPIC: 'admin:delete_topic:',
  // Admin panel
  ADMIN_PANEL: 'admin:panel',
  ADMIN_SET_SUPPORT: 'admin:set_support:',
  ADMIN_REMOVE_SUPPORT: 'admin:remove_support:',
} as const;

// Topic icon colors (used at creation time)
// 0x6FB9F0 - Blue (open), 0x8EEE98 - Green (closed)
const TOPIC_ICON_COLOR_OPEN = 0x6FB9F0;

// Helper to get or create user with role - uses cached user from context
function getOrCreateUser(ctx: BotContext, _telegramId: number): { role: UserRole } {
  const user = ctx.getUser();
  return { role: user?.role || 'user' };
}

function isUserBanned(ctx: BotContext, telegramId: number): boolean {
  return !!ctx.db.select().from(bannedUsers).where(eq(bannedUsers.telegramId, telegramId)).get();
}

function getActiveTicket(ctx: BotContext, telegramId: number) {
  return ctx.db.select().from(tickets)
    .where(and(eq(tickets.telegramId, telegramId), eq(tickets.status, 'open'))).get();
}

function getTicketByTopicId(ctx: BotContext, topicId: number) {
  return ctx.db.select().from(tickets)
    .where(and(eq(tickets.topicId, topicId), eq(tickets.status, 'open'))).get();
}



function getMessageByUserMessageId(ctx: BotContext, ticketId: number, userMessageId: number) {
  return ctx.db.select().from(messages)
    .where(and(eq(messages.ticketId, ticketId), eq(messages.userMessageId, userMessageId))).get();
}

function getMessageByTopicMessageId(ctx: BotContext, ticketId: number, topicMessageId: number) {
  return ctx.db.select().from(messages)
    .where(and(eq(messages.ticketId, ticketId), eq(messages.topicMessageId, topicMessageId))).get();
}

function getAdminKeyboard(ticketId: number, telegramId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text('❌ Закрыть', CB.ADMIN_CLOSE + ticketId)
    .text('🚫 Бан', CB.ADMIN_BAN + telegramId);
}

function getClosedTicketKeyboard(topicId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text('🗑 Удалить топик', CB.ADMIN_DELETE_TOPIC + topicId);
}

// Helper to update topic name with status indicator
async function updateTopicStatus(ctx: BotContext, topicId: number, originalName: string, isClosed: boolean): Promise<void> {
  try {
    const statusPrefix = isClosed ? '✅ ' : '';
    const newName = statusPrefix + originalName.replace(/^✅ /, '');
    await ctx.api.editForumTopic(ctx.config.bot.supportGroupId, topicId, {
      name: newName.slice(0, 128),
    });
  } catch (e) {
    ctx.logger.warn('Failed to update topic status', { topicId, error: e });
  }
}

/**
 * Helper function to send messages with error feedback
 * Wraps message sending with try-catch and provides feedback on failure
 */
export async function sendWithFeedback(
  ctx: BotContext,
  sendFn: () => Promise<unknown>,
  errorMessageKey: string,
  feedbackChatId?: number,
  feedbackThreadId?: number
): Promise<boolean> {
  try {
    await sendFn();
    return true;
  } catch (error) {
    // Log the error with context
    ctx.logger.warn('Message delivery failed', {
      error: error instanceof Error ? error.message : String(error),
      errorMessageKey,
      feedbackChatId,
      feedbackThreadId,
    });
    
    // Send feedback notification to the sender
    try {
      const targetChatId = feedbackChatId ?? ctx.chat?.id;
      if (targetChatId) {
        const errorMessage = ctx.t(errorMessageKey);
        if (feedbackThreadId) {
          await ctx.api.sendMessage(targetChatId, errorMessage, { message_thread_id: feedbackThreadId });
        } else {
          await ctx.api.sendMessage(targetChatId, errorMessage);
        }
      }
    } catch (feedbackError) {
      // Log secondary error but don't propagate
      ctx.logger.warn('Failed to send error feedback', {
        feedbackError: feedbackError instanceof Error ? feedbackError.message : String(feedbackError),
      });
    }
    
    return false;
  }
}

// Extract media info from message
function extractMedia(ctx: BotContext): { type: MediaType; fileId: string | null; text: string | null } {
  const msg = ctx.message!;
  
  if (msg.photo) {
    return { type: 'photo', fileId: msg.photo[msg.photo.length - 1].file_id, text: msg.caption || null };
  }
  if (msg.video) {
    return { type: 'video', fileId: msg.video.file_id, text: msg.caption || null };
  }
  if (msg.animation) {
    return { type: 'animation', fileId: msg.animation.file_id, text: msg.caption || null };
  }
  if (msg.sticker) {
    return { type: 'sticker', fileId: msg.sticker.file_id, text: null };
  }
  if (msg.voice) {
    return { type: 'voice', fileId: msg.voice.file_id, text: null };
  }
  if (msg.video_note) {
    return { type: 'video_note', fileId: msg.video_note.file_id, text: null };
  }
  if (msg.document) {
    return { type: 'document', fileId: msg.document.file_id, text: msg.caption || null };
  }
  return { type: 'text', fileId: null, text: msg.text || null };
}

// Send media to chat
async function sendMedia(
  ctx: BotContext,
  chatId: number,
  media: { type: MediaType; fileId: string | null; text: string | null },
  options: { 
    message_thread_id?: number; 
    reply_parameters?: { message_id: number };
    reply_markup?: InlineKeyboard;
  } = {}
): Promise<number | null> {
  try {
    let sent;
    const { type, fileId, text } = media;
    const replyParams = options.reply_parameters;
    const threadId = options.message_thread_id;
    const markup = options.reply_markup;

    switch (type) {
      case 'photo':
        sent = await ctx.api.sendPhoto(chatId, fileId!, { caption: text || undefined, message_thread_id: threadId, reply_parameters: replyParams, reply_markup: markup });
        break;
      case 'video':
        sent = await ctx.api.sendVideo(chatId, fileId!, { caption: text || undefined, message_thread_id: threadId, reply_parameters: replyParams, reply_markup: markup });
        break;
      case 'animation':
        sent = await ctx.api.sendAnimation(chatId, fileId!, { caption: text || undefined, message_thread_id: threadId, reply_parameters: replyParams, reply_markup: markup });
        break;
      case 'sticker':
        sent = await ctx.api.sendSticker(chatId, fileId!, { message_thread_id: threadId, reply_parameters: replyParams, reply_markup: markup });
        break;
      case 'voice':
        sent = await ctx.api.sendVoice(chatId, fileId!, { message_thread_id: threadId, reply_parameters: replyParams, reply_markup: markup });
        break;
      case 'video_note':
        sent = await ctx.api.sendVideoNote(chatId, fileId!, { message_thread_id: threadId, reply_parameters: replyParams, reply_markup: markup });
        break;
      case 'document':
        sent = await ctx.api.sendDocument(chatId, fileId!, { caption: text || undefined, message_thread_id: threadId, reply_parameters: replyParams, reply_markup: markup });
        break;
      default:
        if (text) {
          sent = await ctx.api.sendMessage(chatId, text, { message_thread_id: threadId, reply_parameters: replyParams, reply_markup: markup });
        }
    }
    return sent?.message_id || null;
  } catch (e) {
    ctx.logger.warn('Failed to send media', { error: e });
    return null;
  }
}

async function showMainScreen(ctx: BotContext, edit = false): Promise<void> {
  const telegramId = ctx.from!.id;
  const ticket = getActiveTicket(ctx, telegramId);
  getOrCreateUser(ctx, telegramId);

  let text: string;
  let keyboard: InlineKeyboard;

  if (ticket) {
    const date = ticket.createdAt.toLocaleDateString(ctx.locale === 'ru' ? 'ru-RU' : 'en-US');
    text = ctx.t('ticket.active', { id: String(ticket.id), subject: ticket.subject, date });
    keyboard = new InlineKeyboard().text(ctx.t('buttons.close_ticket'), CB.CLOSE_TICKET);
  } else {
    text = ctx.t('start.welcome', { name: ctx.from?.first_name || 'User' });
    keyboard = new InlineKeyboard().text(ctx.t('buttons.new_ticket'), CB.NEW_TICKET);
  }



  if (edit && ctx.callbackQuery) {
    await ctx.editMessageText(text, { reply_markup: keyboard });
  } else {
    await ctx.reply(text, { reply_markup: keyboard });
  }
}

async function showLanguageSelect(ctx: BotContext): Promise<void> {
  const keyboard = new InlineKeyboard()
    .text('🇷🇺 Русский', 'lang:ru')
    .text('🇬🇧 English', 'lang:en');
  
  await ctx.reply('🌐 Выберите язык / Select language:', { reply_markup: keyboard });
}

async function handleLang(ctx: BotContext): Promise<void> {
  await showLanguageSelect(ctx);
}

async function handleStart(ctx: BotContext): Promise<void> {
  const telegramId = ctx.from!.id;
  const chatId = ctx.chat!.id;
  
  // User is already created/cached in context middleware via ctx.getUser()
  
  if (isUserBanned(ctx, telegramId)) {
    await ctx.reply(ctx.t('ticket.banned'));
    return;
  }
  
  // Check if user has explicitly set locale (means they've completed onboarding)
  // locale must be a non-empty string to be considered "set"
  const existingUser = ctx.db.select().from(users).where(eq(users.telegramId, telegramId)).get();
  const hasCompletedOnboarding = !!existingUser?.locale && existingUser.locale.length > 0;
  
  // First time user or user without locale - show language selection
  if (!hasCompletedOnboarding) {
    await ctx.sessionManager.set(telegramId, chatId, { state: { awaiting_lang: true } });
    await showLanguageSelect(ctx);
    return;
  }
  
  // Returning user - always reset state for clean UX
  await ctx.sessionManager.set(telegramId, chatId, { state: {} });
  await showMainScreen(ctx);
}

async function handleCallback(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data) return;

  // Noop button - just answer callback
  if (data === 'noop') {
    await ctx.answerCallbackQuery();
    return;
  }

  const telegramId = ctx.from!.id;
  const chatId = ctx.chat!.id;
  const { role } = getOrCreateUser(ctx, telegramId);

  // Language selection
  if (data === 'lang:ru' || data === 'lang:en') {
    const newLocale = data === 'lang:ru' ? 'ru' : 'en';
    
    // Save to session and DB
    await ctx.sessionManager.set(telegramId, chatId, { locale: newLocale, state: {} });
    ctx.locale = newLocale;
    
    await ctx.answerCallbackQuery({ text: newLocale === 'ru' ? '✅ Русский' : '✅ English' });
    await ctx.deleteMessage();
    await showMainScreen(ctx);
    return;
  }

  // User: create ticket
  if (data === CB.NEW_TICKET) {
    if (isUserBanned(ctx, telegramId)) {
      await ctx.answerCallbackQuery({ text: ctx.t('ticket.banned'), show_alert: true });
      return;
    }
    if (getActiveTicket(ctx, telegramId)) {
      await ctx.answerCallbackQuery({ text: ctx.t('ticket.already_exists'), show_alert: true });
      return;
    }
    await ctx.sessionManager.set(telegramId, chatId, { state: { awaiting_subject: true } });
    const cancelKeyboard = new InlineKeyboard().text(ctx.t('buttons.cancel'), CB.CANCEL_TICKET);
    await ctx.editMessageText(ctx.t('ticket.enter_subject'), { reply_markup: cancelKeyboard });
    await ctx.answerCallbackQuery();
    return;
  }

  // User: cancel ticket creation
  if (data === CB.CANCEL_TICKET) {
    await ctx.sessionManager.set(telegramId, chatId, { state: {} });
    await ctx.answerCallbackQuery();
    await showMainScreen(ctx, true);
    return;
  }

  // User: close ticket
  if (data === CB.CLOSE_TICKET) {
    const ticket = getActiveTicket(ctx, telegramId);
    if (ticket) {
      ctx.db.update(tickets).set({ status: 'closed', closedAt: new Date() }).where(eq(tickets.id, ticket.id)).run();
      
      try {
        await ctx.auditLogger.log({
          action: 'ticket_closed_by_user',
          actorId: telegramId,
          entityType: 'ticket',
          entityId: ticket.id,
        });
      } catch (e) {
        ctx.logger.warn('Failed to log ticket closure', { error: e });
      }
      
      if (ticket.topicId) {
        // Update topic name with closed status
        await updateTopicStatus(ctx, ticket.topicId, ticket.subject, true);
        
        // Notify support group that user closed the ticket with delete button for owners
        try {
          const closedKeyboard = getClosedTicketKeyboard(ticket.topicId);
          await ctx.api.sendMessage(ctx.config.bot.supportGroupId, ctx.t('ticket.closed_by_user'), {
            message_thread_id: ticket.topicId,
            reply_markup: closedKeyboard,
          });
        } catch {}
        try { await ctx.api.closeForumTopic(ctx.config.bot.supportGroupId, ticket.topicId); } catch {}
      }
    }
    await ctx.sessionManager.set(telegramId, chatId, { state: {} });
    await ctx.answerCallbackQuery({ text: ctx.t('ticket.closed') });
    await showMainScreen(ctx, true);
    return;
  }

  // Admin panel
  if (data === CB.ADMIN_PANEL) {
    if (role !== 'support' && role !== 'owner') {
      await ctx.answerCallbackQuery({ text: 'Нет доступа' });
      return;
    }
    const keyboard = new InlineKeyboard()
      .text('👥 Управление ролями', 'admin:roles')
      .row()
      .text('◀️ Назад', 'admin:back');
    await ctx.editMessageText('⚙️ Админ-панель\n\nВаша роль: ' + role, { reply_markup: keyboard });
    await ctx.answerCallbackQuery();
    return;
  }

  if (data === 'admin:back') {
    await showMainScreen(ctx, true);
    await ctx.answerCallbackQuery();
    return;
  }

  if (data === 'admin:roles') {
    if (role !== 'owner') {
      await ctx.answerCallbackQuery({ text: 'Только owner может управлять ролями' });
      return;
    }
    await ctx.editMessageText(
      '👥 Управление ролями\n\nОтправьте ID пользователя для изменения роли.\nФормат: /setrole USER_ID ROLE\n\nРоли: user, support',
      { reply_markup: new InlineKeyboard().text('◀️ Назад', CB.ADMIN_PANEL) }
    );
    await ctx.answerCallbackQuery();
    return;
  }

  // Admin: close ticket (in support group)
  if (data.startsWith(CB.ADMIN_CLOSE)) {
    // Security: check role
    if (role !== 'support' && role !== 'owner') {
      await ctx.answerCallbackQuery({ text: ctx.t('admin.no_access'), show_alert: true });
      return;
    }
    
    const ticketId = parseInt(data.replace(CB.ADMIN_CLOSE, ''));
    if (isNaN(ticketId)) {
      await ctx.answerCallbackQuery({ text: 'Invalid ticket ID' });
      return;
    }
    
    const ticket = ctx.db.select().from(tickets).where(eq(tickets.id, ticketId)).get();
    if (ticket?.status === 'open') {
      ctx.db.update(tickets).set({ status: 'closed', closedAt: new Date() }).where(eq(tickets.id, ticketId)).run();
      
      try {
        await ctx.auditLogger.log({
          action: 'ticket_closed_by_admin',
          actorId: ctx.from!.id,
          targetId: ticket.telegramId,
          entityType: 'ticket',
          entityId: ticketId,
        });
      } catch (e) {
        ctx.logger.warn('Failed to log ticket closure by admin', { error: e });
      }
      
      // Get user's locale for notification - send without close button (ticket is closed)
      const ticketUser = ctx.db.select().from(users).where(eq(users.telegramId, ticket.telegramId)).get();
      const userLocale = ticketUser?.locale || 'ru';
      try { 
        await ctx.api.sendMessage(ticket.telegramId, ctx.i18n.t('ticket.closed_by_admin', userLocale)); 
      } catch {}
      
      if (ticket.topicId) {
        // Update topic name with closed status
        await updateTopicStatus(ctx, ticket.topicId, ticket.subject, true);
        
        const adminName = ctx.from?.first_name || 'Admin';
        // Send notification with delete topic button for owners
        const closedKeyboard = getClosedTicketKeyboard(ticket.topicId);
        try {
          await ctx.api.sendMessage(ctx.config.bot.supportGroupId, ctx.t('system.ticket_closed_by_admin', { admin: adminName }), {
            message_thread_id: ticket.topicId,
            reply_markup: closedKeyboard,
          });
        } catch {}
        try { await ctx.api.closeForumTopic(ctx.config.bot.supportGroupId, ticket.topicId); } catch {}
      }
      
      // Remove action buttons from info message, replace with delete topic button
      if (ticket.topicId) {
        try {
          await ctx.editMessageReplyMarkup({ reply_markup: getClosedTicketKeyboard(ticket.topicId) });
        } catch {}
      } else {
        try {
          await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() });
        } catch {}
      }
      await ctx.answerCallbackQuery({ text: ctx.t('admin.ticket_closed') });
    } else {
      await ctx.answerCallbackQuery({ text: ctx.t('admin.ticket_already_closed') });
    }
    return;
  }

  // Admin: ban - send confirmation as NEW message, don't edit ticket info
  if (data.startsWith(CB.ADMIN_BAN) && !data.includes('confirm') && !data.includes('cancel')) {
    // Security: check role
    if (role !== 'support' && role !== 'owner') {
      await ctx.answerCallbackQuery({ text: ctx.t('admin.no_access'), show_alert: true });
      return;
    }
    
    const targetId = data.replace(CB.ADMIN_BAN, '');
    if (isNaN(parseInt(targetId))) {
      await ctx.answerCallbackQuery({ text: 'Invalid user ID' });
      return;
    }
    
    // Get message_id of info message to edit later
    const infoMessageId = ctx.callbackQuery?.message?.message_id;
    
    const keyboard = new InlineKeyboard()
      .text('✅ Да', CB.ADMIN_BAN_CONFIRM + targetId + ':' + infoMessageId)
      .text('❌ Нет', CB.ADMIN_BAN_CANCEL + ':' + infoMessageId);
    
    // Send NEW message for confirmation, don't edit ticket info
    const topicId = ctx.callbackQuery?.message?.message_thread_id;
    await ctx.api.sendMessage(ctx.chat!.id, '⚠️ Заблокировать пользователя?', { 
      reply_markup: keyboard,
      message_thread_id: topicId,
    });
    await ctx.answerCallbackQuery();
    return;
  }

  if (data.startsWith(CB.ADMIN_BAN_CONFIRM)) {
    // Security: check role
    if (role !== 'support' && role !== 'owner') {
      await ctx.answerCallbackQuery({ text: ctx.t('admin.no_access'), show_alert: true });
      return;
    }
    
    // Parse format: admin:ban_confirm:USER_ID:INFO_MSG_ID
    const parts = data.replace(CB.ADMIN_BAN_CONFIRM, '').split(':');
    const targetUserId = parseInt(parts[0]);
    const infoMessageId = parseInt(parts[1]);
    
    if (isNaN(targetUserId)) {
      await ctx.answerCallbackQuery({ text: 'Invalid user ID' });
      return;
    }
    
    // Prevent self-ban
    if (targetUserId === ctx.from!.id) {
      await ctx.answerCallbackQuery({ text: ctx.t('admin.cannot_ban_self'), show_alert: true });
      return;
    }
    
    // Prevent banning owner
    const targetUser = ctx.db.select().from(users).where(eq(users.telegramId, targetUserId)).get();
    if (targetUser?.role === 'owner' || ctx.config.bot.adminIds.includes(targetUserId)) {
      await ctx.answerCallbackQuery({ text: ctx.t('admin.cannot_ban_owner'), show_alert: true });
      return;
    }
    
    if (!ctx.db.select().from(bannedUsers).where(eq(bannedUsers.telegramId, targetUserId)).get()) {
      // Get active ticket before banning (for system message and topic update)
      const activeTicket = getActiveTicket(ctx, targetUserId);
      
      ctx.db.insert(bannedUsers).values({ telegramId: targetUserId, bannedAt: new Date() }).run();
      ctx.db.update(tickets).set({ status: 'closed', closedAt: new Date() })
        .where(and(eq(tickets.telegramId, targetUserId), eq(tickets.status, 'open'))).run();
      
      try {
        await ctx.auditLogger.log({
          action: 'user_banned',
          actorId: ctx.from!.id,
          targetId: targetUserId,
          entityType: 'user',
        });
      } catch (e) {
        ctx.logger.warn('Failed to log user ban', { error: e });
      }
      
      if (activeTicket?.topicId) {
        // Update topic name with closed status (consistency with ADMIN_CLOSE)
        await updateTopicStatus(ctx, activeTicket.topicId, activeTicket.subject, true);
        
        try {
          await ctx.api.sendMessage(ctx.config.bot.supportGroupId, ctx.t('system.user_banned_in_topic'), {
            message_thread_id: activeTicket.topicId,
          });
        } catch {}
        
        // Close the forum topic
        try { await ctx.api.closeForumTopic(ctx.config.bot.supportGroupId, activeTicket.topicId); } catch {}
        
        // Remove buttons from info message, replace with delete topic button
        if (!isNaN(infoMessageId)) {
          try {
            await ctx.api.editMessageReplyMarkup(ctx.chat!.id, infoMessageId, {
              reply_markup: getClosedTicketKeyboard(activeTicket.topicId),
            });
          } catch {}
        }
      }
      
      // Get user's locale for notification
      const bannedUser = ctx.db.select().from(users).where(eq(users.telegramId, targetUserId)).get();
      const userLocale = bannedUser?.locale || 'ru';
      try { 
        await ctx.api.sendMessage(targetUserId, ctx.i18n.t('user.banned', userLocale)); 
      } catch {}
    }
    
    await ctx.answerCallbackQuery({ text: ctx.t('admin.user_banned') });
    // Delete confirmation message
    await ctx.deleteMessage();
    return;
  }

  if (data.startsWith(CB.ADMIN_BAN_CANCEL)) {
    await ctx.answerCallbackQuery({ text: 'Отменено' });
    // Delete confirmation message
    await ctx.deleteMessage();
    return;
  }

  // Admin: delete topic (only for owners)
  if (data.startsWith(CB.ADMIN_DELETE_TOPIC)) {
    // Check if user is owner
    if (role !== 'owner') {
      await ctx.answerCallbackQuery({ text: ctx.t('admin.no_access'), show_alert: true });
      return;
    }
    
    const topicId = parseInt(data.replace(CB.ADMIN_DELETE_TOPIC, ''));
    if (isNaN(topicId)) {
      await ctx.answerCallbackQuery({ text: 'Invalid topic ID' });
      return;
    }
    
    try {
      // deleteForumTopic deletes the topic and all its messages
      const result = await ctx.api.deleteForumTopic(ctx.config.bot.supportGroupId, topicId);
      ctx.logger.info('Delete topic result', { topicId, result });
      await ctx.answerCallbackQuery({ text: '✅ Топик удалён' });
    } catch (e) {
      // Log full error for debugging
      ctx.logger.error('Failed to delete topic', e instanceof Error ? e : new Error(String(e)), { topicId });
      await ctx.answerCallbackQuery({ text: '❌ Не удалось удалить топик', show_alert: true });
    }
    return;
  }

  await ctx.answerCallbackQuery();
}

async function handleMessage(ctx: BotContext): Promise<void> {
  const msg = ctx.message;
  if (!msg) return;
  if (ctx.chat?.id === ctx.config.bot.supportGroupId) return;

  // Skip all commands - they are handled by command registry
  if (msg.text?.startsWith('/')) {
    return;
  }

  const hasContent = msg.text || msg.photo || msg.video || msg.animation || msg.sticker || msg.voice || msg.video_note || msg.document;
  if (!hasContent) return;

  const telegramId = ctx.from!.id;
  const chatId = ctx.chat!.id;
  const userMessageId = msg.message_id;

  getOrCreateUser(ctx, telegramId);

  if (isUserBanned(ctx, telegramId)) {
    await ctx.reply(ctx.t('ticket.banned'));
    return;
  }

  const session = await ctx.sessionManager.get(telegramId, chatId);
  const state = (session.state || {}) as Record<string, unknown>;

  // Skip if admin is adding support (handled by admin module)
  if (state.awaiting_support_id === true) {
    return;
  }

  // Creating ticket
  if (state.awaiting_subject === true && msg.text) {
    const subject = msg.text.trim().slice(0, 100);
    
    // Validate non-empty subject
    if (!subject) {
      await ctx.reply(ctx.t('ticket.empty_subject'));
      return;
    }
    const userName = ctx.from?.first_name || 'User';
    const username = ctx.from?.username ? `@${ctx.from.username}` : '';

    let topicId: number | null = null;
    try {
      const topic = await ctx.api.createForumTopic(ctx.config.bot.supportGroupId, `${userName} | ${subject.slice(0, 40)}`, {
        icon_color: TOPIC_ICON_COLOR_OPEN,
      });
      topicId = topic.message_thread_id;
    } catch (e) {
      ctx.logger.error('Failed to create topic', e instanceof Error ? e : new Error(String(e)));
    }

    const result = ctx.db.insert(tickets).values({
      telegramId, topicId, subject, status: 'open', createdAt: new Date(),
    }).run();

    const ticketId = result.lastInsertRowid as number;

    try {
      await ctx.auditLogger.log({
        action: 'ticket_created',
        actorId: telegramId,
        entityType: 'ticket',
        entityId: ticketId,
        metadata: { subject },
      });
    } catch (e) {
      ctx.logger.warn('Failed to log ticket creation', { error: e });
    }

    // Send admin buttons - this is critical for ticket management
    const adminKeyboard = getAdminKeyboard(ticketId, telegramId);
    let adminButtonsSent = false;

    if (topicId) {
      // Escape underscores in username for Markdown
      const safeUsername = username.replace(/_/g, '\\_');
      const safeUserName = userName.replace(/_/g, '\\_');
      const info = `📋 #${ticketId}\n👤 ${safeUserName} ${safeUsername}\n🆔 \`${telegramId}\`\n📝 ${subject}`;
      try {
        const infoMsg = await ctx.api.sendMessage(ctx.config.bot.supportGroupId, info, {
          message_thread_id: topicId,
          parse_mode: 'Markdown',
          reply_markup: adminKeyboard,
        });
        adminButtonsSent = true;
        // Pin the info message in the topic
        try {
          await ctx.api.pinChatMessage(ctx.config.bot.supportGroupId, infoMsg.message_id);
        } catch (pinError) {
          ctx.logger.warn('Failed to pin ticket info message', { ticketId, error: pinError });
        }
      } catch (infoError) {
        ctx.logger.error('Failed to send ticket info with admin buttons', infoError instanceof Error ? infoError : new Error(String(infoError)));
        // Retry without Markdown in case of parse error
        try {
          const plainInfo = `📋 #${ticketId}\n👤 ${userName} ${username}\n🆔 ${telegramId}\n📝 ${subject}`;
          await ctx.api.sendMessage(ctx.config.bot.supportGroupId, plainInfo, {
            message_thread_id: topicId,
            reply_markup: adminKeyboard,
          });
          adminButtonsSent = true;
        } catch (retryError) {
          ctx.logger.error('Failed to send ticket info even without Markdown', retryError instanceof Error ? retryError : new Error(String(retryError)));
        }
      }
    }

    // FALLBACK: If topic wasn't created or admin buttons weren't sent, send to main group chat
    if (!adminButtonsSent) {
      ctx.logger.warn('Admin buttons not sent to topic, sending fallback to main group', { ticketId, topicId });
      try {
        const fallbackInfo = `⚠️ Новый тикет без топика!\n📋 #${ticketId}\n👤 ${userName} ${username}\n🆔 ${telegramId}\n📝 ${subject}`;
        await ctx.api.sendMessage(ctx.config.bot.supportGroupId, fallbackInfo, {
          reply_markup: adminKeyboard,
        });
        adminButtonsSent = true;
      } catch (fallbackError) {
        ctx.logger.error('Failed to send fallback admin buttons', fallbackError instanceof Error ? fallbackError : new Error(String(fallbackError)));
      }
    }

    // CRITICAL: If we couldn't notify support group at all, rollback the ticket
    if (!adminButtonsSent) {
      ctx.logger.error('Support group unreachable, rolling back ticket', new Error(`ticketId: ${ticketId}`));
      ctx.db.delete(tickets).where(eq(tickets.id, ticketId)).run();
      await ctx.sessionManager.set(telegramId, chatId, { state: {} });
      await ctx.reply(ctx.t('ticket.creation_failed'));
      await showMainScreen(ctx);
      return;
    }

    await ctx.sessionManager.set(telegramId, chatId, { state: {} });
    await ctx.reply(ctx.t('ticket.created', { id: String(ticketId) }));
    await showMainScreen(ctx);
    return;
  }

  // Send to ticket
  const ticket = getActiveTicket(ctx, telegramId);
  if (!ticket) {
    await ctx.reply(ctx.t('ticket.no_active'));
    await showMainScreen(ctx);
    return;
  }

  const media = extractMedia(ctx);

  // Check reply
  const replyToMsgId = msg.reply_to_message?.message_id;
  let replyToTopicMessageId: number | undefined;
  if (replyToMsgId) {
    const originalMsg = getMessageByUserMessageId(ctx, ticket.id, replyToMsgId);
    if (originalMsg?.topicMessageId) replyToTopicMessageId = originalMsg.topicMessageId;
  }

  // Forward to topic
  let topicMessageId: number | null = null;
  if (ticket.topicId) {
    // For text, add prefix
    const mediaToSend = media.type === 'text' && media.text 
      ? { ...media, text: `💬 ${media.text}` } 
      : media;
    
    topicMessageId = await sendMedia(ctx, ctx.config.bot.supportGroupId, mediaToSend, {
      message_thread_id: ticket.topicId,
      reply_parameters: replyToTopicMessageId ? { message_id: replyToTopicMessageId } : undefined,
    });
    
    if (!topicMessageId) {
      try {
        await ctx.reply(ctx.t('system.message_forward_failed'));
      } catch {}
      return;
    }
  }

  // Save message
  ctx.db.insert(messages).values({
    ticketId: ticket.id,
    telegramId,
    userMessageId,
    topicMessageId,
    mediaType: media.type,
    text: media.text,
    fileId: media.fileId,
    isAdmin: false,
    createdAt: new Date(),
  }).run();
}

async function handleAdminReply(ctx: BotContext): Promise<void> {
  // Only process messages in support group
  if (ctx.chat?.id !== ctx.config.bot.supportGroupId) return;
  
  const msg = ctx.message;
  if (!msg) return;
  
  // Get topic ID - messages in forum topics have message_thread_id
  const topicId = msg.message_thread_id;
  if (!topicId) return;
  
  // Security: check role - only support/owner can reply to tickets
  const { role } = getOrCreateUser(ctx, ctx.from!.id);
  if (role !== 'support' && role !== 'owner') {
    return; // Silently ignore messages from non-support users
  }
  
  const hasContent = msg.text || msg.photo || msg.video || msg.animation || msg.sticker || msg.voice || msg.video_note || msg.document;
  if (!hasContent) return;

  const topicMessageId = msg.message_id;
  const ticket = getTicketByTopicId(ctx, topicId);
  
  // Notify admin if ticket is closed or not found
  if (!ticket) {
    try {
      await ctx.reply(ctx.t('system.ticket_not_found'), { message_thread_id: topicId });
    } catch {}
    return;
  }

  const media = extractMedia(ctx);

  // Check reply - find the original message to reply to
  const replyToMsgId = msg.reply_to_message?.message_id;
  let replyToUserMessageId: number | undefined;
  if (replyToMsgId) {
    const originalMsg = getMessageByTopicMessageId(ctx, ticket.id, replyToMsgId);
    if (originalMsg?.userMessageId) {
      replyToUserMessageId = originalMsg.userMessageId;
    }
  }

  // Get support agent name for the button
  const supportName = ctx.from?.first_name || ctx.from?.username || 'Support';
  const supportButton = new InlineKeyboard().text(`👤 ${supportName}`, 'noop');

  // Send to user with prefix for text only
  const mediaToSend = media.type === 'text' && media.text 
    ? { ...media, text: `📩 ${media.text}` } 
    : media;

  const userMessageId = await sendMedia(ctx, ticket.telegramId, mediaToSend, {
    reply_parameters: replyToUserMessageId ? { message_id: replyToUserMessageId } : undefined,
    reply_markup: supportButton,
  });

  // Notify support if delivery to user failed
  if (!userMessageId) {
    try {
      await ctx.reply(ctx.t('system.message_delivery_failed'), { message_thread_id: topicId });
    } catch {}
    return;
  }

  // Save admin message for future reply tracking
  ctx.db.insert(messages).values({
    ticketId: ticket.id,
    telegramId: ctx.from!.id,
    userMessageId,
    topicMessageId,
    mediaType: media.type,
    text: media.text,
    fileId: media.fileId,
    isAdmin: true,
    createdAt: new Date(),
  }).run();
}

// Command handler for /close - manual ticket closure from topic
async function handleClose(ctx: BotContext): Promise<void> {
  // Only works in support group
  if (ctx.chat?.id !== ctx.config.bot.supportGroupId) return;
  
  const topicId = ctx.message?.message_thread_id;
  if (!topicId) {
    await ctx.reply(ctx.t('admin.use_in_topic'));
    return;
  }
  
  // Check role
  const { role } = getOrCreateUser(ctx, ctx.from!.id);
  if (role !== 'support' && role !== 'owner') {
    await ctx.reply(ctx.t('admin.no_access'));
    return;
  }
  
  // Find ticket by topicId (any status to give proper feedback)
  const ticket = ctx.db.select().from(tickets).where(eq(tickets.topicId, topicId)).get();
  if (!ticket) {
    await ctx.reply(ctx.t('admin.ticket_not_found'));
    return;
  }
  
  if (ticket.status === 'closed') {
    await ctx.reply(ctx.t('admin.ticket_already_closed'));
    return;
  }
  
  // Close ticket
  ctx.db.update(tickets).set({ status: 'closed', closedAt: new Date() }).where(eq(tickets.id, ticket.id)).run();
  
  try {
    await ctx.auditLogger.log({
      action: 'ticket_closed_by_admin',
      actorId: ctx.from!.id,
      targetId: ticket.telegramId,
      entityType: 'ticket',
      entityId: ticket.id,
    });
  } catch (e) {
    ctx.logger.warn('Failed to log ticket closure', { error: e });
  }
  
  // Notify user
  const ticketUser = ctx.db.select().from(users).where(eq(users.telegramId, ticket.telegramId)).get();
  const userLocale = ticketUser?.locale || 'ru';
  try {
    await ctx.api.sendMessage(ticket.telegramId, ctx.i18n.t('ticket.closed_by_admin', userLocale));
  } catch {}
  
  // Update topic
  await updateTopicStatus(ctx, topicId, ticket.subject, true);
  
  const adminName = ctx.from?.first_name || 'Admin';
  const closedKeyboard = getClosedTicketKeyboard(topicId);
  await ctx.reply(ctx.t('system.ticket_closed_by_admin', { admin: adminName }), { reply_markup: closedKeyboard });
  
  try { await ctx.api.closeForumTopic(ctx.config.bot.supportGroupId, topicId); } catch {}
}

// Command handler for /ban - manual user ban from topic
async function handleBan(ctx: BotContext): Promise<void> {
  // Only works in support group
  if (ctx.chat?.id !== ctx.config.bot.supportGroupId) return;
  
  const topicId = ctx.message?.message_thread_id;
  if (!topicId) {
    await ctx.reply(ctx.t('admin.use_in_topic'));
    return;
  }
  
  // Check role
  const { role } = getOrCreateUser(ctx, ctx.from!.id);
  if (role !== 'support' && role !== 'owner') {
    await ctx.reply(ctx.t('admin.no_access'));
    return;
  }
  
  // Find ticket by topicId
  const ticket = ctx.db.select().from(tickets).where(eq(tickets.topicId, topicId)).get();
  if (!ticket) {
    await ctx.reply(ctx.t('admin.ticket_not_found'));
    return;
  }
  
  const targetUserId = ticket.telegramId;
  
  // Prevent self-ban
  if (targetUserId === ctx.from!.id) {
    await ctx.reply(ctx.t('admin.cannot_ban_self'));
    return;
  }
  
  // Prevent banning owner
  const targetUser = ctx.db.select().from(users).where(eq(users.telegramId, targetUserId)).get();
  if (targetUser?.role === 'owner' || ctx.config.bot.adminIds.includes(targetUserId)) {
    await ctx.reply(ctx.t('admin.cannot_ban_owner'));
    return;
  }
  
  // Check if already banned
  if (ctx.db.select().from(bannedUsers).where(eq(bannedUsers.telegramId, targetUserId)).get()) {
    await ctx.reply(ctx.t('admin.user_already_banned'));
    return;
  }
  
  // Ban user
  ctx.db.insert(bannedUsers).values({ telegramId: targetUserId, bannedAt: new Date() }).run();
  ctx.db.update(tickets).set({ status: 'closed', closedAt: new Date() })
    .where(and(eq(tickets.telegramId, targetUserId), eq(tickets.status, 'open'))).run();
  
  try {
    await ctx.auditLogger.log({
      action: 'user_banned',
      actorId: ctx.from!.id,
      targetId: targetUserId,
      entityType: 'user',
    });
  } catch (e) {
    ctx.logger.warn('Failed to log user ban', { error: e });
  }
  
  // Update topic
  await updateTopicStatus(ctx, topicId, ticket.subject, true);
  await ctx.reply(ctx.t('system.user_banned_in_topic'));
  
  try { await ctx.api.closeForumTopic(ctx.config.bot.supportGroupId, topicId); } catch {}
  
  // Notify user
  const userLocale = targetUser?.locale || 'ru';
  try {
    await ctx.api.sendMessage(targetUserId, ctx.i18n.t('user.banned', userLocale));
  } catch {}
}

export const supportModule: BotModule<BotContext, BotContext> = {
  name: 'support',
  enabled: true,
  commands: [
    { name: 'start', description: 'Запустить бота 🤍', handler: handleStart },
    { name: 'lang', description: 'Сменить язык 🌐', handler: handleLang },
    { name: 'close', description: 'Закрыть тикет', handler: handleClose, hidden: true },
    { name: 'ban', description: 'Забанить пользователя', handler: handleBan, hidden: true },
  ],
  handlers: [
    { name: 'support-callback', event: 'callback_query', handler: handleCallback as (ctx: unknown) => Promise<void> },
    { name: 'support-message', event: 'message', handler: handleMessage as (ctx: unknown) => Promise<void> },
    { name: 'admin-reply', event: 'message', handler: handleAdminReply as (ctx: unknown) => Promise<void> },
  ],
};

export default supportModule;
