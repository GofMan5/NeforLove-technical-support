/**
 * Language Module
 * /lang command for language switching
 */

import { InlineKeyboard } from 'grammy';
import { BotModule } from '../loader.js';
import type { BotContext } from '../../bot/context.js';

const LANG_CB = {
  EN: 'lang:en',
  RU: 'lang:ru',
} as const;

/**
 * /lang command handler
 */
async function handleLang(ctx: BotContext): Promise<void> {
  const keyboard = new InlineKeyboard()
    .text(ctx.t('buttons.english'), LANG_CB.EN)
    .text(ctx.t('buttons.russian'), LANG_CB.RU);

  await ctx.reply(ctx.t('lang.title'), { reply_markup: keyboard });
}

/**
 * Callback handler for language selection
 */
async function handleLangCallback(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data?.startsWith('lang:')) return;

  const newLocale = data === LANG_CB.RU ? 'ru' : 'en';
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;

  if (userId && chatId) {
    await ctx.sessionManager.set(userId, chatId, { locale: newLocale });
    ctx.locale = newLocale;
  }

  const confirmMessage = ctx.i18n.t('lang.changed', newLocale);
  await ctx.answerCallbackQuery({ text: confirmMessage });

  const keyboard = new InlineKeyboard()
    .text(ctx.i18n.t('buttons.english', newLocale), LANG_CB.EN)
    .text(ctx.i18n.t('buttons.russian', newLocale), LANG_CB.RU);

  await ctx.editMessageText(ctx.i18n.t('lang.title', newLocale), { reply_markup: keyboard });
}

export const langModule: BotModule<BotContext, BotContext> = {
  name: 'lang',
  enabled: true,
  commands: [
    {
      name: 'lang',
      description: 'Сменить язык 🌐',
      handler: handleLang,
    },
  ],
  handlers: [
    {
      name: 'lang-callback',
      event: 'callback_query',
      handler: handleLangCallback as (ctx: unknown) => Promise<void>,
    },
  ],
};

export default langModule;
