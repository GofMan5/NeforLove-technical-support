/**
 * Telegram Bot Modular Architecture
 * Main entry point
 */

import 'dotenv/config';
import { createBot } from './bot/index.js';
import { supportModule } from './modules/support/index.js';
import { adminModule } from './modules/admin/index.js';

async function main() {
  console.log('Telegram Bot Modular - Starting...');
  
  try {
    const bot = createBot();
    
    // Register modules
    bot.registerModule(supportModule);
    bot.registerModule(adminModule);
    
    // Handle graceful shutdown
    const shutdown = async () => {
      console.log('\nShutting down...');
      await bot.stop();
      process.exit(0);
    };
    
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    
    // Start the bot
    await bot.start();
  } catch (error) {
    console.error('Failed to start bot:', error);
    process.exit(1);
  }
}

main();
