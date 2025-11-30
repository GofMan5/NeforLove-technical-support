-- Remove default 'en' locale from users table
-- Set locale to NULL for users who haven't explicitly chosen a language
-- This allows the language selection screen to appear for new users

UPDATE `users` SET `locale` = NULL WHERE `locale` = 'en';
