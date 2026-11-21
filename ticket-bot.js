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
const http = require("http");
const https = require("https");

// ---------------- CONFIGURATION ----------------

const TOKEN = process.env.TICKET_BOT_TOKEN;
const CLIENT_ID = process.env.TICKET_CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const BRAND = process.env.BRAND_NAME || "JJSTUDIOS";
const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;

const ACCOUNTS_API_URL = process.env.ACCOUNTS_API_URL;
const ACCOUNTS_API_SECRET = process.env.ACCOUNTS_API_SECRET;

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
    .setDescription("View your private JJSTUDIOS customer account.")
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

// ---------------- PRIVATE CUSTOMER ACCOUNTS ----------------

// ACCOUNTS_API_URL must end in /api/account.
// The Discord user ID is appended by this function.

async function getAccount(discordId) {
  if (!ACCOUNTS_API_URL || !ACCOUNTS_API_SECRET) {
    throw new Error("Accounts API is not configured.");
  }

  const baseUrl = ACCOUNTS_API_URL.replace(/\/+$/, "");

  const response = await fetch(
    `${baseUrl}/${encodeURIComponent(discordId)}`,
    {
      method: "GET",
      headers: {
        "x-api-secret": ACCOUNTS_API_SECRET,
        "Accept": "application/json"
      },
      signal: AbortSignal.timeout(15000)
    }
  );

  const result = await response.json();

  if (response.status === 404) {
    return null;
  }

  if (!response.ok || !result.success || !result.account) {
    throw new Error(
      result.message || `Accounts API returned ${response.status}.`
    );
  }

  return result.account;
}

async function handleAccounts(interaction) {
  await interaction.deferReply({ ephemeral: true });

  try {
    const account = await getAccount(interaction.user.id);

    if (!account) {
      return interaction.editReply(
        "You don't have a linked JJSTUDIOS account yet."
      );
    }

    const products = Array.isArray(account.scripts)
      ? account.scripts.map(script => {
          if (script === "main") return "Main";
          if (script === "mobile") return "Mobile Main";
          return String(script);
        }).join(", ")
      : "None";

    const embed = new EmbedBuilder()
      .setColor(0xF4A6C1)
      .setAuthor({
        name: BRAND,
        iconURL: interaction.user.displayAvatarURL({ size: 128 })
      })
      .setTitle("My JJSTUDIOS Account")
      .setDescription(
        `Private account profile for ${interaction.user}.`
      )
      .addFields(
        {
          name: "Username",
          value: `\`${String(account.username || "Unknown").slice(0, 100)}\``,
          inline: true
        },
        {
          name: "Status",
          value: String(account.status || "Unknown").slice(0, 100),
          inline: true
        },
        {
          name: "Products",
          value: products.slice(0, 1024) || "None",
          inline: false
        },
        {
          name: "Device Lock",
          value: account.hwidLocked ? "Locked" : "Open",
          inline: true
        },
        {
          name: "Executions",
          value: String(Number(account.executions) || 0),
          inline: true
        },
        {
          name: "Account Created",
          value: account.keyCreatedAt
            ? `<t:${Math.floor(account.keyCreatedAt / 1000)}:F>`
            : "Not available",
          inline: false
        },
        {
          name: "Expires",
          value: account.expiresAt
            ? `<t:${Math.floor(account.expiresAt / 1000)}:F>`
            : "Not available",
          inline: false
        }
      )
      .setFooter({
        text: `${BRAND} • Private Customer Account`
      })
      .setTimestamp();

    return interaction.editReply({
      embeds: [embed]
    });
  } catch (error) {
    console.error("[ACCOUNTS COMMAND ERROR]", error);

    return interaction.editReply(
      "Your account information is temporarily unavailable. Please try again later."
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

// ---------------- RENDER WEB SERVICE HEALTH SERVER ----------------

const PORT = Number(process.env.PORT) || 3000;

const healthServer = http.createServer((req, res) => {
  if (req.url === "/health" || req.url === "/") {
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    });

    res.end(JSON.stringify({
      success: true,
      service: "JJSTUDIOS Ticket Bot",
      discord: client.isReady() ? "online" : "connecting"
    }));

    return;
  }

  res.writeHead(404, {
    "Content-Type": "application/json; charset=utf-8"
  });

  res.end(JSON.stringify({
    success: false,
    message: "Not found"
  }));
});

healthServer.listen(PORT, "0.0.0.0", () => {
  console.log(`Health server listening on port ${PORT}`);
});

healthServer.on("error", error => {
  console.error("Health server error:", error);
  process.exit(1);
});

// ---------------- RENDER KEEP-ALIVE PING ----------------

const KEEP_ALIVE_INTERVAL = 5 * 60 * 1000;

function startKeepAlive() {
  const baseUrl =
    process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;

  const healthUrl = baseUrl.replace(/\/+$/, "") + "/health";

  const requestModule = healthUrl.startsWith("https://") ? https : http;

  setInterval(() => {
    requestModule.get(healthUrl, { timeout: 10000 }, response => {
      let body = "";

      response.on("data", chunk => {
        body += chunk;
      });

      response.on("end", () => {
        try {
          const result = JSON.parse(body);

          if (response.statusCode === 200 && result.success === true) {
            console.log(
              `[KEEP-ALIVE] Health check successful — ${new Date().toLocaleTimeString()}`
            );
          } else {
            console.warn(
              `[KEEP-ALIVE] Health check returned HTTP ${response.statusCode}`
            );
          }
        } catch (error) {
          console.warn(
            "[KEEP-ALIVE] Could not read health response:",
            error.message
          );
        }
      });
    }).on("error", error => {
      console.warn("[KEEP-ALIVE] Ping failed:", error.message);
    });
  }, KEEP_ALIVE_INTERVAL);
}

startKeepAlive();

// ---------------- START BOT ----------------

client.once("ready", async () => {
  console.log(`${BRAND} Ticket Bot online as ${client.user.tag}`);

  try {
    await registerCommands();
  } catch (error) {
    console.error("Slash command registration failed:", error);
  }
});

client.login(TOKEN).catch(error => {
  console.error(
    "Discord login failed. Check TICKET_BOT_TOKEN in Render:",
    error
  );

  process.exit(1);
});
