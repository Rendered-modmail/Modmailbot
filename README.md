# Austrian Airlines Modmail Bot

A Discord modmail bot with an Austrian Airlines-style support theme, designed for GitHub + Railway deployment.

## Features

- Users message the bot in DMs to open support tickets
- Automatic ticket channel creation in your server
- Austrian Airlines themed embeds and wording
- Staff can reply by typing in the ticket channel or using `/reply`
- `/setup`, `/reply`, `/close`, `/rename`
- No database required

## Setup

1. Create a Discord bot in the Discord Developer Portal.
2. Turn on **Message Content Intent**.
3. Invite the bot with these scopes:
   - `bot`
   - `applications.commands`
4. Give it permissions:
   - View Channels
   - Send Messages
   - Manage Channels
   - Read Message History
   - Embed Links
   - Attach Files
5. In your Discord server, create:
   - a category for modmail tickets
   - a logs channel
   - a public panel channel
   - a staff role
6. Copy `.env.example` to `.env` and fill in your real IDs.
7. Push the project to GitHub.
8. Deploy the repo to Railway.
9. Run `/setup` once.
10. Users can then message the bot directly in DMs.

## Railway

Add the environment variables from `.env.example` into your Railway project.

## Notes

- This version is DM-based, so the user messages the bot directly.
- Tickets are linked using the channel topic.
- No database is needed.
