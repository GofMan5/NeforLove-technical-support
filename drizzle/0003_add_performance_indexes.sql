-- Performance indexes for frequently queried columns
CREATE INDEX IF NOT EXISTS `tickets_telegram_status_idx` ON `tickets` (`telegram_id`, `status`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `tickets_topic_status_idx` ON `tickets` (`topic_id`, `status`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `messages_ticket_user_msg_idx` ON `messages` (`ticket_id`, `user_message_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `messages_ticket_topic_msg_idx` ON `messages` (`ticket_id`, `topic_message_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `sessions_user_chat_idx` ON `sessions` (`user_id`, `chat_id`);
