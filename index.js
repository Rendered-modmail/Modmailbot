require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  REST,
  Routes,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const express = require('express');

// ── Express health-check server (required for Railway) ──────────────────────
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (_req, res) => res.send('Austrian Airlines Modmail Bot is running.'));
app.listen(PORT, () => console.log(`Health-check server listening on port ${PORT}`));

// ── Discord client ───────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel, Partials.Message],
});

// ── Slash command definitions ────────────────────────────────────────────────
const commands = [
  new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Set up the modmail system (admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),

  new SlashCommandBuilder()
    .setName('reply')
    .setDescription('Reply to the user in this ticket')
    .addStringOption((opt) =>
      opt.setName('message').setDescription('Your reply message').setRequired(true)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName('close')
    .setDescription('Close this modmail ticket')
    .addStringOption((opt) =>
      opt.setName('reason').setDescription('Reason for closing').setRequired(false)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName('rename')
    .setDescription('Rename this ticket channel')
    .addStringOption((opt) =>
      opt.setName('name').setDescription('New channel name').setRequired(true)
    )
    .toJSON(),
];

// ── Register slash commands on ready ────────────────────────────────────────
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('Slash commands registered globally.');
  } catch (err) {
    console.error('Failed to register slash commands:', err);
  }
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Return the ticket channel for a given user ID, or null. */
function findTicketChannel(guild, userId) {
  return (
    guild.channels.cache.find(
      (ch) =>
        ch.type === ChannelType.GuildText &&
        ch.topic &&
        ch.topic.includes(`modmail-user:${userId}`)
    ) || null
  );
}

/** Austrian Airlines brand colour */
const BRAND_COLOR = 0xcc0000;

function ticketEmbed(title, description, fields = []) {
  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(title)
    .setDescription(description)
    .setTimestamp();
  if (fields.length) embed.addFields(fields);
  return embed;
}

// ── DM → ticket channel ──────────────────────────────────────────────────────
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // Only handle DMs here
  if (message.channel.type !== ChannelType.DM) return;

  const guildId = process.env.GUILD_ID;
  const categoryId = process.env.CATEGORY_ID;
  const logsChannelId = process.env.LOGS_CHANNEL_ID;
  const staffRoleId = process.env.STAFF_ROLE_ID;

  if (!guildId || !categoryId) {
    return message.reply(
      'The modmail system has not been configured yet. Please ask an administrator to run `/setup`.'
    );
  }

  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;

  let ticketChannel = findTicketChannel(guild, message.author.id);

  // ── Create a new ticket if one doesn't exist ──
  if (!ticketChannel) {
    const username = message.author.username.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const channelName = `ticket-${username}`;

    try {
      ticketChannel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: categoryId,
        topic: `modmail-user:${message.author.id} | Opened by ${message.author.tag}`,
        permissionOverwrites: [
          { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
          ...(staffRoleId
            ? [{ id: staffRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }]
            : []),
        ],
      });

      // Opening embed in ticket channel
      const openEmbed = ticketEmbed(
        '✈️ New Support Ticket — Austrian Airlines',
        `A new modmail ticket has been opened by **${message.author.tag}** (<@${message.author.id}>).`,
        [{ name: 'User ID', value: message.author.id, inline: true }]
      );
      await ticketChannel.send({ embeds: [openEmbed] });

      // Log to logs channel
      if (logsChannelId) {
        const logsChannel = guild.channels.cache.get(logsChannelId);
        if (logsChannel) {
          await logsChannel.send({
            embeds: [
              ticketEmbed(
                '📋 Ticket Opened',
                `**${message.author.tag}** opened a new ticket.`,
                [
                  { name: 'Channel', value: `<#${ticketChannel.id}>`, inline: true },
                  { name: 'User ID', value: message.author.id, inline: true },
                ]
              ),
            ],
          });
        }
      }

      // Confirm to user
      await message.author.send({
        embeds: [
          ticketEmbed(
            '✈️ Austrian Airlines Support',
            'Thank you for contacting Austrian Airlines Support. A member of our team will be with you shortly.\n\nPlease describe your issue and we will assist you as soon as possible.'
          ),
        ],
      });
    } catch (err) {
      console.error('Failed to create ticket channel:', err);
      return;
    }
  }

  // ── Forward the DM to the ticket channel ──
  const forwardEmbed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setAuthor({
      name: `${message.author.tag} (${message.author.id})`,
      iconURL: message.author.displayAvatarURL(),
    })
    .setDescription(message.content || '*[no text content]*')
    .setTimestamp();

  if (message.attachments.size > 0) {
    const urls = message.attachments.map((a) => a.url).join('\n');
    forwardEmbed.addFields({ name: 'Attachments', value: urls });
  }

  await ticketChannel.send({ embeds: [forwardEmbed] });
});

// ── Ticket channel → DM (staff messages) ────────────────────────────────────
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (message.channel.type !== ChannelType.GuildText) return;
  if (!message.channel.topic || !message.channel.topic.includes('modmail-user:')) return;

  // Extract user ID from channel topic
  const match = message.channel.topic.match(/modmail-user:(\d+)/);
  if (!match) return;
  const userId = match[1];

  // Don't auto-forward slash command invocations
  if (message.content.startsWith('/')) return;

  let user;
  try {
    user = await client.users.fetch(userId);
  } catch {
    return;
  }

  const replyEmbed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setAuthor({
      name: `Austrian Airlines Support — ${message.author.tag}`,
      iconURL: client.user.displayAvatarURL(),
    })
    .setDescription(message.content || '*[no text content]*')
    .setTimestamp();

  if (message.attachments.size > 0) {
    const urls = message.attachments.map((a) => a.url).join('\n');
    replyEmbed.addFields({ name: 'Attachments', value: urls });
  }

  try {
    await user.send({ embeds: [replyEmbed] });
    await message.react('✅');
  } catch (err) {
    await message.reply('⚠️ Could not send the message to the user (they may have DMs disabled).');
  }
});

// ── Slash command handler ────────────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  // ── /setup ──
  if (commandName === 'setup') {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '❌ You need Administrator permission to run this command.', ephemeral: true });
    }

    const panelChannelId = process.env.PANEL_CHANNEL_ID;
    if (!panelChannelId) {
      return interaction.reply({ content: '⚠️ `PANEL_CHANNEL_ID` is not set in environment variables.', ephemeral: true });
    }

    const panelChannel = interaction.guild.channels.cache.get(panelChannelId);
    if (!panelChannel) {
      return interaction.reply({ content: '⚠️ Panel channel not found. Check `PANEL_CHANNEL_ID`.', ephemeral: true });
    }

    const panelEmbed = new EmbedBuilder()
      .setColor(BRAND_COLOR)
      .setTitle('✈️ Austrian Airlines — Passenger Support')
      .setDescription(
        'Welcome to Austrian Airlines Passenger Support.\n\n' +
        'To open a support ticket, simply **send a direct message** to this bot.\n\n' +
        'Our support team will respond as soon as possible. Thank you for flying with Austrian Airlines.'
      )
      .setFooter({ text: 'Austrian Airlines Support System' })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('Open a Ticket via DM')
        .setStyle(ButtonStyle.Link)
        .setURL(`https://discord.com/users/${client.user.id}`)
        .setEmoji('✉️')
    );

    await panelChannel.send({ embeds: [panelEmbed], components: [row] });
    await interaction.reply({ content: '✅ Modmail panel posted successfully.', ephemeral: true });
  }

  // ── /reply ──
  else if (commandName === 'reply') {
    if (!interaction.channel.topic || !interaction.channel.topic.includes('modmail-user:')) {
      return interaction.reply({ content: '❌ This command can only be used in a modmail ticket channel.', ephemeral: true });
    }

    const match = interaction.channel.topic.match(/modmail-user:(\d+)/);
    if (!match) return interaction.reply({ content: '❌ Could not find the user for this ticket.', ephemeral: true });

    const userId = match[1];
    const replyText = interaction.options.getString('message');

    let user;
    try {
      user = await client.users.fetch(userId);
    } catch {
      return interaction.reply({ content: '❌ Could not fetch the user.', ephemeral: true });
    }

    const replyEmbed = new EmbedBuilder()
      .setColor(BRAND_COLOR)
      .setAuthor({
        name: `Austrian Airlines Support — ${interaction.user.tag}`,
        iconURL: client.user.displayAvatarURL(),
      })
      .setDescription(replyText)
      .setTimestamp();

    try {
      await user.send({ embeds: [replyEmbed] });
    } catch {
      return interaction.reply({ content: '⚠️ Could not send the message to the user (they may have DMs disabled).', ephemeral: true });
    }

    // Echo in ticket channel
    const echoEmbed = new EmbedBuilder()
      .setColor(BRAND_COLOR)
      .setAuthor({
        name: `Reply sent by ${interaction.user.tag}`,
        iconURL: interaction.user.displayAvatarURL(),
      })
      .setDescription(replyText)
      .setTimestamp();

    await interaction.channel.send({ embeds: [echoEmbed] });
    await interaction.reply({ content: '✅ Reply sent.', ephemeral: true });
  }

  // ── /close ──
  else if (commandName === 'close') {
    if (!interaction.channel.topic || !interaction.channel.topic.includes('modmail-user:')) {
      return interaction.reply({ content: '❌ This command can only be used in a modmail ticket channel.', ephemeral: true });
    }

    const match = interaction.channel.topic.match(/modmail-user:(\d+)/);
    const userId = match ? match[1] : null;
    const reason = interaction.options.getString('reason') || 'No reason provided';

    // Notify user
    if (userId) {
      try {
        const user = await client.users.fetch(userId);
        await user.send({
          embeds: [
            ticketEmbed(
              '✈️ Ticket Closed — Austrian Airlines Support',
              `Your support ticket has been closed.\n\n**Reason:** ${reason}\n\nThank you for contacting Austrian Airlines. If you need further assistance, feel free to open a new ticket.`
            ),
          ],
        });
      } catch {
        // User may have DMs disabled — continue closing anyway
      }
    }

    // Log closure
    const logsChannelId = process.env.LOGS_CHANNEL_ID;
    if (logsChannelId) {
      const logsChannel = interaction.guild.channels.cache.get(logsChannelId);
      if (logsChannel) {
        await logsChannel.send({
          embeds: [
            ticketEmbed(
              '📋 Ticket Closed',
              `Ticket **${interaction.channel.name}** was closed by **${interaction.user.tag}**.`,
              [
                { name: 'Reason', value: reason, inline: false },
                { name: 'User ID', value: userId || 'Unknown', inline: true },
              ]
            ),
          ],
        });
      }
    }

    await interaction.reply({ content: `🔒 Closing ticket... Reason: ${reason}` });
    setTimeout(() => interaction.channel.delete().catch(console.error), 3000);
  }

  // ── /rename ──
  else if (commandName === 'rename') {
    if (!interaction.channel.topic || !interaction.channel.topic.includes('modmail-user:')) {
      return interaction.reply({ content: '❌ This command can only be used in a modmail ticket channel.', ephemeral: true });
    }

    const newName = interaction.options
      .getString('name')
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .slice(0, 100);

    try {
      await interaction.channel.setName(newName);
      await interaction.reply({ content: `✅ Channel renamed to **${newName}**.`, ephemeral: true });
    } catch (err) {
      await interaction.reply({ content: '❌ Failed to rename the channel.', ephemeral: true });
    }
  }
});

// ── Login ────────────────────────────────────────────────────────────────────
client.login(process.env.DISCORD_TOKEN);
