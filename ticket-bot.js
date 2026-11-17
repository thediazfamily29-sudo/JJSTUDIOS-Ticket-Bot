
require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionsBitField,
  AttachmentBuilder
} = require("discord.js");

const fs = require("fs");
const path = require("path");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

const BRAND = process.env.BRAND_NAME || "JJSTUDIOS";
const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;
const DATA_FILE = path.join(__dirname, "ticket-data.json");

const CATEGORIES = [
  "Upgraded Main",
  "Main",
  "Mobile Main",
  "Key / HWID",
  "Bug Report",
  "Appeal",
  "Partnership",
  "General Help"
];

function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return { tickets: {} };
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function makePanel() {
  const embed = new EmbedBuilder()
    .setColor(0xF4A6C1)
    .setTitle(`${BRAND} • Support Center`)
    .setDescription(
      "Welcome to JJSTUDIOS Support!\n\n" +
      "Select a category below to open a private support ticket.\n\n" +
      "Please provide as much detail as possible so our staff can assist you."
    )
    .setFooter({ text: `${BRAND} • Support Department` });

  const menu = new StringSelectMenuBuilder()
    .setCustomId("ticket_category")
    .setPlaceholder("Select a ticket category...")
    .addOptions(
      CATEGORIES.map((category, index) => ({
        label: category,
        value: `category_${index}`,
        description: `Open a ${category} support ticket`
      }))
    );

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(menu)]
  };
}

client.once("ready", () => {
  console.log(`${BRAND} Ticket Bot online as ${client.user.tag}`);
});

client.on("interactionCreate", async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "ticket-setup") {
        if (!interaction.memberPermissions.has(PermissionsBitField.Flags.ManageGuild)) {
          return interaction.reply({
            content: "You need Manage Server permission to use this command.",
            ephemeral: true
          });
        }

        await interaction.channel.send(makePanel());

        return interaction.reply({
          content: "JJSTUDIOS ticket panel posted successfully!",
          ephemeral: true
        });
      }
    }

    if (interaction.isStringSelectMenu() && interaction.customId === "ticket_category") {
      await interaction.deferReply({ ephemeral: true });

      const categoryIndex = Number(interaction.values[0].replace("category_", ""));
      const category = CATEGORIES[categoryIndex];

      if (!category) {
        return interaction.editReply("Invalid ticket category.");
      }

      const data = loadData();

      const existing = Object.entries(data.tickets).find(
        ([, ticket]) =>
          ticket.userId === interaction.user.id &&
          ticket.category === category &&
          ticket.guildId === interaction.guild.id
      );

      if (existing) {
        const channel = interaction.guild.channels.cache.get(existing[0]);

        if (channel) {
          return interaction.editReply(`You already have a ticket for this category: ${channel}`);
        }

        delete data.tickets[existing[0]];
        saveData(data);
      }

      const safeName = interaction.user.username
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")
        .slice(0, 15) || "user";

      const channel = await interaction.guild.channels.create({
        name: `ticket-${safeName}`,
        type: ChannelType.GuildText,
        topic: `${BRAND} ticket | ${category} | User: ${interaction.user.id}`,
        permissionOverwrites: [
          {
            id: interaction.guild.id,
            deny: [PermissionsBitField.Flags.ViewChannel]
          },
          {
            id: interaction.user.id,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
              PermissionsBitField.Flags.ReadMessageHistory,
              PermissionsBitField.Flags.AttachFiles,
              PermissionsBitField.Flags.EmbedLinks
            ]
          },
          ...(STAFF_ROLE_ID ? [{
            id: STAFF_ROLE_ID,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
              PermissionsBitField.Flags.ReadMessageHistory,
              PermissionsBitField.Flags.ManageMessages
            ]
          }] : [])
        ]
      });

      data.tickets[channel.id] = {
        userId: interaction.user.id,
        category,
        guildId: interaction.guild.id,
        createdAt: new Date().toISOString()
      };

      saveData(data);

      const embed = new EmbedBuilder()
        .setColor(0xF4A6C1)
        .setTitle(`${BRAND} • ${category}`)
        .setDescription(
          `Welcome ${interaction.user}!\n\n` +
          "Please explain your issue below. A staff member will assist you soon."
        )
        .addFields(
          { name: "Category", value: category, inline: true },
          { name: "Ticket Owner", value: `${interaction.user}`, inline: true }
        )
        .setTimestamp();

      const closeButton = new ButtonBuilder()
        .setCustomId("ticket_close")
        .setLabel("Close Ticket")
        .setEmoji("🔒")
        .setStyle(ButtonStyle.Danger);

      await channel.send({
        content: `${interaction.user}${STAFF_ROLE_ID ? ` <@&${STAFF_ROLE_ID}>` : ""}`,
        embeds: [embed],
        components: [
          new ActionRowBuilder().addComponents(closeButton)
        ]
      });

      return interaction.editReply(`Your ticket has been created: ${channel}`);
    }

    if (interaction.isButton() && interaction.customId === "ticket_close") {
      const data = loadData();
      const ticket = data.tickets[interaction.channel.id];

      if (!ticket) {
        return interaction.reply({
          content: "This ticket is not registered.",
          ephemeral: true
        });
      }

      const isOwner = interaction.user.id === ticket.userId;
      const isStaff = STAFF_ROLE_ID &&
        interaction.member.roles.cache.has(STAFF_ROLE_ID);
      const canManage = interaction.memberPermissions.has(
        PermissionsBitField.Flags.ManageChannels
      );

      if (!isOwner && !isStaff && !canManage) {
        return interaction.reply({
          content: "You do not have permission to close this ticket.",
          ephemeral: true
        });
      }

      await interaction.reply("🔒 Closing ticket and saving transcript...");

      const messages = await interaction.channel.messages.fetch({ limit: 100 });
      const transcript = messages
        .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
        .map(message =>
          `[${new Date(message.createdTimestamp).toISOString()}] ` +
          `${message.author.tag}: ${message.content}`
        )
        .join("\n");

      const transcriptBuffer = Buffer.from(
        transcript || "No messages found.",
        "utf8"
      );

      const file = new AttachmentBuilder(transcriptBuffer, {
        name: `ticket-${interaction.channel.id}.txt`
      });

      const logChannel = LOG_CHANNEL_ID
        ? interaction.guild.channels.cache.get(LOG_CHANNEL_ID)
        : null;

      if (logChannel && logChannel.isTextBased()) {
        await logChannel.send({
          content: `Ticket closed: **${ticket.category}** | Owner: <@${ticket.userId}>`,
          files: [file]
        });
      }

      delete data.tickets[interaction.channel.id];
      saveData(data);

      await interaction.channel.delete("Ticket closed");
    }
  } catch (error) {
    console.error("Ticket bot error:", error);

    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: "Something went wrong. Please contact staff.",
        ephemeral: true
      }).catch(() => {});
    }
  }
});

client.login(process.env.TICKET_BOT_TOKEN);
