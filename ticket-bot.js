require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionsBitField,
  AttachmentBuilder,
  REST,
  Routes,
  SlashCommandBuilder
} = require("discord.js");

const fs = require("fs");
const path = require("path");

// ---------------- CONFIGURATION ----------------

const TOKEN = process.env.TICKET_BOT_TOKEN;
const CLIENT_ID = process.env.TICKET_CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const BRAND = process.env.BRAND_NAME || "JJSTUDIOS";
const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;

const ACCOUNTS_API_URL = process.env.ACCOUNTS_API_URL;
const ACCOUNTS_API_SECRET = process.env.ACCOUNTS_API_SECRET;

// Render persistent disk directory, or local directory
const DATA_DIR =
  process.env.TICKET_DATA_DIR ||
  process.env.RENDER_DISK_PATH ||
  __dirname;

fs.mkdirSync(DATA_DIR, { recursive: true });

const DATA_FILE = path.join(DATA_DIR, "ticket-data.json");

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error("Missing TICKET_BOT_TOKEN, TICKET_CLIENT_ID, or GUILD_ID.");
  process.exit(1);
}

// ---------------- CLIENT ----------------

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

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

// ---------------- DATABASE ----------------

function loadData() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));

    if (!parsed || typeof parsed !== "object") {
      return { tickets: {} };
    }

    if (!parsed.tickets || typeof parsed.tickets !== "object") {
      parsed.tickets = {};
    }

    return parsed;
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error("Ticket data could not be read:", error);
    }

    return { tickets: {} };
  }
}

function saveData(data) {
  const temporaryFile = `${DATA_FILE}.tmp`;

  fs.writeFileSync(
    temporaryFile,
    JSON.stringify(data, null, 2),
    "utf8"
  );

  fs.renameSync(temporaryFile, DATA_FILE);
}

// ---------------- SLASH COMMANDS ----------------

const commands = [
  new SlashCommandBuilder()
    .setName("ticket-setup")
    .setDescription("Post the JJSTUDIOS support ticket panel."),

  new SlashCommandBuilder()
    .setName("accounts")
    .setDescription("View the available JJSTUDIOS account listing.")
];

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands.map(command => command.toJSON()) }
  );

  console.log("Slash commands registered.");
}

// ---------------- TICKET PANEL ----------------

function makePanel() {
  const embed = new EmbedBuilder()
    .setColor(0xF4A6C1)
    .setTitle(`${BRAND} • Support Center`)
    .setDescription(
      "Welcome to JJSTUDIOS Support!\n\n" +
      "Select a category below to open a private support ticket.\n\n" +
      "Please provide as much detail as possible so our staff can assist you."
    )
    .setFooter({
      text: `${BRAND} • Support Department`
    });

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
    components: [
      new ActionRowBuilder().addComponents(menu)
    ]
  };
}

// ---------------- ACCOUNTS COMMAND ----------------

// The API will be added to your original bot later.
// The ticket bot never receives passwords, tokens, or HWIDs.

async function getAccounts() {
  if (!ACCOUNTS_API_URL || !ACCOUNTS_API_SECRET) {
    throw new Error("The accounts API has not been configured yet.");
  }

  const response = await fetch(ACCOUNTS_API_URL, {
    method: "GET",
    headers: {
      "x-api-secret": ACCOUNTS_API_SECRET,
      "Accept": "application/json"
    },
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    throw new Error(`Accounts API returned ${response.status}.`);
  }

  const result = await response.json();

  if (!Array.isArray(result.accounts)) {
    throw new Error("Invalid accounts API response.");
  }

  return result.accounts;
}

async function handleAccounts(interaction) {
  await interaction.deferReply();

  try {
    const accounts = await getAccounts();

    if (accounts.length === 0) {
      return interaction.editReply(
        "No accounts are currently available."
      );
    }

    const lines = accounts.map(account => {
      const username = String(account.username || "Unknown")
        .replace(/[`*_~|]/g, "");

      const status = String(account.status || "Active")
        .replace(/[`*_~|]/g, "");

      const scripts = Array.isArray(account.scripts)
        ? account.scripts.join(", ")
        : "Not specified";

      return (
        `**${username}**\n` +
        `Status: ${status}\n` +
        `Scripts: ${scripts}`
      );
    });

    const pages = [];
    let currentPage = "";

    for (const line of lines) {
      if ((currentPage + "\n\n" + line).length > 3500) {
        pages.push(currentPage);
        currentPage = line;
      } else {
        currentPage += currentPage ? "\n\n" + line : line;
      }
    }

    if (currentPage) pages.push(currentPage);

    const firstEmbed = new EmbedBuilder()
      .setColor(0xF4A6C1)
      .setTitle(`${BRAND} • Accounts`)
      .setDescription(pages[0])
      .setFooter({
        text: `${accounts.length} account(s) • Public listing`
      })
      .setTimestamp();

    await interaction.editReply({
      embeds: [firstEmbed]
    });

    for (let i = 1; i < pages.length; i++) {
      const embed = new EmbedBuilder()
        .setColor(0xF4A6C1)
        .setTitle(`${BRAND} • Accounts (${i + 1})`)
        .setDescription(pages[i]);

      await interaction.followUp({
        embeds: [embed]
      });
    }
  } catch (error) {
    console.error("Accounts command error:", error);

    await interaction.editReply(
      "The accounts listing is temporarily unavailable. Please try again later."
    );
  }
}

// ---------------- CREATE TICKET ----------------

async function createTicket(interaction, category) {
  const data = loadData();

  const existing = Object.entries(data.tickets).find(
    ([, ticket]) =>
      ticket.userId === interaction.user.id &&
      ticket.category === category &&
      ticket.guildId === interaction.guild.id
  );

  if (existing) {
    const existingChannel =
      await interaction.guild.channels.fetch(existing[0]).catch(() => null);

    if (existingChannel) {
      return interaction.editReply(
        `You already have a ticket for this category: ${existingChannel}`
      );
    }

    delete data.tickets[existing[0]];
    saveData(data);
  }

  const safeName = interaction.user.username
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 15) || "user";

  const channel = await interaction.guild.channels.create({
    name: `ticket-${safeName}-${interaction.user.id.slice(-4)}`,
    type: ChannelType.GuildText,
    topic: `${BRAND} | ${category} | Owner: ${interaction.user.id}`,
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
    ],
    allowedMentions: {
      users: [interaction.user.id],
      roles: STAFF_ROLE_ID ? [STAFF_ROLE_ID] : []
    }
  });

  return interaction.editReply(
    `Your ticket has been created: ${channel}`
  );
}

// ---------------- TRANSCRIPT ----------------

async function createTranscript(channel) {
  const messages = await channel.messages.fetch({ limit: 100 });

  const transcript = messages
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
    .map(message => {
      const attachments = [...message.attachments.values()]
        .map(file => file.url)
        .join(" ");

      return (
        `[${new Date(message.createdTimestamp).toISOString()}] ` +
        `${message.author.tag}: ${message.content}` +
        (attachments ? ` | Attachments: ${attachments}` : "")
      );
    })
    .join("\n");

  return new AttachmentBuilder(
    Buffer.from(transcript || "No messages found.", "utf8"),
    { name: `ticket-${channel.id}.txt` }
  );
}

// ---------------- CLOSE TICKET ----------------

async function closeTicket(interaction) {
  const data = loadData();
  const ticket = data.tickets[interaction.channel.id];

  if (!ticket) {
    return interaction.reply({
      content: "This ticket is not registered.",
      ephemeral: true
    });
  }

  const isOwner = interaction.user.id === ticket.userId;

  const isStaff = Boolean(
    STAFF_ROLE_ID &&
    interaction.member?.roles?.cache?.has(STAFF_ROLE_ID)
  );

  const canManage = interaction.memberPermissions?.has(
    PermissionsBitField.Flags.ManageChannels
  );

  if (!isOwner && !isStaff && !canManage) {
    return interaction.reply({
      content: "You do not have permission to close this ticket.",
      ephemeral: true
    });
  }

  await interaction.reply({
    content: "🔒 Closing ticket and saving transcript..."
  });

  const transcript = await createTranscript(interaction.channel);

  const logChannel = LOG_CHANNEL_ID
    ? await interaction.guild.channels.fetch(LOG_CHANNEL_ID).catch(() => null)
    : null;

  if (logChannel?.isTextBased()) {
    await logChannel.send({
      content:
        `Ticket closed: **${ticket.category}** | ` +
        `Owner: <@${ticket.userId}> | Closed by: ${interaction.user}`,
      files: [transcript]
    });
  }

  delete data.tickets[interaction.channel.id];
  saveData(data);

  await interaction.channel.delete("Ticket closed");
}

// ---------------- INTERACTIONS ----------------

client.on("interactionCreate", async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "ticket-setup") {
        if (!interaction.memberPermissions?.has(
          PermissionsBitField.Flags.ManageGuild
        )) {
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

      if (interaction.commandName === "accounts") {
        return handleAccounts(interaction);
      }
    }

    if (
      interaction.isStringSelectMenu() &&
      interaction.customId === "ticket_category"
    ) {
      await interaction.deferReply({ ephemeral: true });

      const categoryIndex = Number(
        interaction.values[0].replace("category_", "")
      );

      const category = CATEGORIES[categoryIndex];

      if (!category) {
        return interaction.editReply("Invalid ticket category.");
      }

      return createTicket(interaction, category);
    }

    if (
      interaction.isButton() &&
      interaction.customId === "ticket_close"
    ) {
      return closeTicket(interaction);
    }
  } catch (error) {
    console.error("Ticket bot error:", error);

    if (interaction.isRepliable()) {
      const message = {
        content: "Something went wrong. Please contact staff.",
        ephemeral: true
      };

      if (interaction.deferred) {
        await interaction.editReply(message).catch(() => {});
      } else if (!interaction.replied) {
        await interaction.reply(message).catch(() => {});
      }
    }
  }
});

// ---------------- START BOT ----------------

client.once("ready", async () => {
  console.log(`${BRAND} Ticket Bot online as ${client.user.tag}`);

  try {
    await registerCommands();
  } catch (error) {
    console.error("Slash command registration failed:", error);
  }
});

client.login(TOKEN);
