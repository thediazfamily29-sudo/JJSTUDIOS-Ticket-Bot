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
  SlashCommandBuilder,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ChannelType: DiscordChannelType
} = require("discord.js");

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");

// ============================================================
// JJSTUDIOS TICKET BOT
// Discord.js v14 | Node.js 18+
// ============================================================

const TOKEN = process.env.TICKET_BOT_TOKEN;
const CLIENT_ID = process.env.TICKET_CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const BRAND = process.env.BRAND_NAME || "JJSTUDIOS";
const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID || "";
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID || "";
const ACCOUNTS_API_URL = process.env.ACCOUNTS_API_URL || "";
const ACCOUNTS_API_SECRET = process.env.ACCOUNTS_API_SECRET || "";
const PORT = Number(process.env.PORT) || 3000;

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

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const COLORS = {
  pink: 0xF4A6C1,
  dark: 0x17141A,
  green: 0x57C785,
  yellow: 0xF2C66D,
  red: 0xE46B75,
  gray: 0x96909A
};

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

const PRIORITIES = ["Low", "Normal", "High", "Urgent"];
const PRODUCT_STATUSES = ["Operational", "Degraded", "Partial Outage", "Major Outage", "Maintenance"];
const DEPARTMENTS = [
  { name: "General Support", value: "General Help" },
  { name: "Main Support", value: "Main" },
  { name: "Mobile Support", value: "Mobile Main" },
  { name: "Billing / Account", value: "Key / HWID" },
  { name: "Bug Reports", value: "Bug Report" },
  { name: "Appeals", value: "Appeal" },
  { name: "Partnerships", value: "Partnership" }
];

function defaultData() {
  return {
    tickets: {},
    nextTicketNumber: 1,
    moderation: {},
    productStatus: "Operational",
    statusMessage: "All systems are operating normally.",
    components: {},
    incidents: {},
    featureRequests: {},
    bugs: {},
    customerNotes: {},
    customerFlags: {},
    permissions: {},
    config: {
      statusChannelId: null,
      statusMessageId: null,
      staffRoleId: STAFF_ROLE_ID || null,
      departmentRoles: {}
    },
    releases: []
  };
}

function loadData() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    const base = defaultData();
    if (!parsed || typeof parsed !== "object") return base;
    for (const key of Object.keys(base)) {
      if (parsed[key] === undefined) parsed[key] = base[key];
    }
    if (!parsed.config || typeof parsed.config !== "object") parsed.config = base.config;
    return parsed;
  } catch (error) {
    if (error.code !== "ENOENT") console.error("Ticket database read error:", error);
    return defaultData();
  }
}

function saveData(data) {
  const temp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(temp, DATA_FILE);
}

function truncate(value, max = 1000) {
  return String(value ?? "").slice(0, max);
}

function isStaff(interaction) {
  const roleId = loadData().config.staffRoleId || STAFF_ROLE_ID;
  return Boolean(
    interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageChannels) ||
    interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator) ||
    (roleId && interaction.member?.roles?.cache?.has(roleId))
  );
}

async function requireStaff(interaction) {
  if (isStaff(interaction)) return true;
  const payload = { content: "This command is for JJSTUDIOS staff only.", ephemeral: true };
  if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
  else await interaction.reply(payload);
  return false;
}

function ticketByNumber(data, number) {
  return Object.entries(data.tickets).find(([, t]) => Number(t.number) === Number(number));
}

function makeEmbed(title, description, color = COLORS.pink) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(`${BRAND} â¢ ${title}`)
    .setDescription(description || " ")
    .setTimestamp();
}

function makePanel() {
  const embed = makeEmbed(
    "Support Center",
    "Welcome to JJSTUDIOS Support!\n\nSelect a category below to open a private support ticket.\n\nPlease include the details our team needs to help you."
  ).setFooter({ text: `${BRAND} â¢ Support Department` });

  const menu = new StringSelectMenuBuilder()
    .setCustomId("ticket_category")
    .setPlaceholder("Select a support category...")
    .addOptions(CATEGORIES.map((category, index) => ({
      label: category,
      value: `category_${index}`,
      description: `Open a ${category} support ticket`
    })));

  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] };
}

// ---------------- PRIVATE CUSTOMER ACCOUNT ----------------

async function getAccount(discordId) {
  if (!ACCOUNTS_API_URL || !ACCOUNTS_API_SECRET) {
    throw new Error("Customer account service is not configured.");
  }

  const base = ACCOUNTS_API_URL.replace(/\/+$/, "");
  const response = await fetch(`${base}/${encodeURIComponent(discordId)}`, {
    headers: { "x-api-secret": ACCOUNTS_API_SECRET, Accept: "application/json" },
    signal: AbortSignal.timeout(15000)
  });

  const result = await response.json().catch(() => ({}));
  if (response.status === 404) return null;
  if (!response.ok || !result.success || !result.account) {
    throw new Error(result.message || `Account service returned ${response.status}.`);
  }
  return result.account;
}

async function handleAccount(interaction) {
  await interaction.deferReply({ ephemeral: true });
  try {
    const account = await getAccount(interaction.user.id);
    if (!account) return interaction.editReply("You don't have a linked JJSTUDIOS account yet.");

    const products = Array.isArray(account.scripts)
      ? account.scripts.map(s => s === "main" ? "Main" : s === "mobile" ? "Mobile Main" : String(s)).join(", ")
      : "None";

    const embed = makeEmbed("My Customer Account", `Private account profile for ${interaction.user}.`)
      .addFields(
        { name: "Username", value: `\`${truncate(account.username || "Unknown", 90)}\``, inline: true },
        { name: "Status", value: truncate(account.status || "Unknown", 100), inline: true },
        { name: "Products", value: truncate(products || "None", 1024), inline: false },
        { name: "Device Lock", value: account.hwidLocked ? "Locked" : "Open", inline: true },
        { name: "Executions", value: String(Number(account.executions) || 0), inline: true },
        { name: "Created", value: account.keyCreatedAt ? `<t:${Math.floor(account.keyCreatedAt / 1000)}:F>` : "Not available", inline: false },
        { name: "Expires", value: account.expiresAt ? `<t:${Math.floor(account.expiresAt / 1000)}:F>` : "Not available", inline: false }
      )
      .setFooter({ text: `${BRAND} â¢ Private Customer Account` });
    return interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("[ACCOUNT COMMAND]", error);
    return interaction.editReply("Your account information is temporarily unavailable. Please try again later.");
  }
}

// ---------------- TICKET HELPERS ----------------

async function createTicket(interaction, category) {
  const data = loadData();
  const existing = Object.entries(data.tickets).find(([, t]) =>
    t.userId === interaction.user.id &&
    t.category === category &&
    t.guildId === interaction.guild.id &&
    !t.closedAt
  );

  if (existing) {
    const channel = await interaction.guild.channels.fetch(existing[0]).catch(() => null);
    if (channel) return interaction.editReply(`You already have an open ticket for this category: ${channel}`);
    delete data.tickets[existing[0]];
    saveData(data);
  }

  const number = data.nextTicketNumber++;
  const safeName = interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12) || "customer";
  const staffRole = data.config.staffRoleId || STAFF_ROLE_ID;

  const overwrites = [
    { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    {
      id: interaction.user.id,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.AttachFiles,
        PermissionsBitField.Flags.EmbedLinks
      ]
    }
  ];
  if (staffRole) overwrites.push({
    id: staffRole,
    allow: [
      PermissionsBitField.Flags.ViewChannel,
      PermissionsBitField.Flags.SendMessages,
      PermissionsBitField.Flags.ReadMessageHistory,
      PermissionsBitField.Flags.ManageMessages
    ]
  });

  const channel = await interaction.guild.channels.create({
    name: `ticket-${String(number).padStart(4, "0")}-${safeName}`.slice(0, 90),
    type: ChannelType.GuildText,
    topic: `${BRAND} | Ticket #${number} | ${category} | Owner: ${interaction.user.id}`,
    permissionOverwrites: overwrites
  });

  data.tickets[channel.id] = {
    number,
    userId: interaction.user.id,
    username: interaction.user.username,
    category,
    guildId: interaction.guild.id,
    createdAt: new Date().toISOString(),
    status: "Active",
    priority: "Normal",
    claimedBy: null,
    waitingSince: null,
    notes: [],
    messages: 0
  };
  saveData(data);

  const embed = makeEmbed(`Ticket #${number} â¢ ${category}`,
    `Welcome ${interaction.user}!\n\nPlease describe your issue below. A staff member will assist you soon.`)
    .addFields(
      { name: "Ticket owner", value: `${interaction.user}`, inline: true },
      { name: "Priority", value: "Normal", inline: true },
      { name: "Status", value: "Active", inline: true }
    );

  const close = new ButtonBuilder().setCustomId("ticket_close").setLabel("Close Ticket").setEmoji("ð").setStyle(ButtonStyle.Danger);
  const claim = new ButtonBuilder().setCustomId("ticket_claim").setLabel("Claim").setEmoji("ð").setStyle(ButtonStyle.Secondary);
  await channel.send({
    content: `${interaction.user}${staffRole ? ` <@&${staffRole}>` : ""}`,
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(claim, close)],
    allowedMentions: { users: [interaction.user.id], roles: staffRole ? [staffRole] : [] }
  });
  return interaction.editReply(`Your ticket has been created: ${channel}`);
}

async function createTranscript(channel) {
  const messages = await channel.messages.fetch({ limit: 100 });
  const body = messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp).map(m => {
    const files = [...m.attachments.values()].map(a => a.url).join(" ");
    return `[${new Date(m.createdTimestamp).toISOString()}] ${m.author.tag}: ${m.content}${files ? ` | Attachments: ${files}` : ""}`;
  }).join("\n");
  return new AttachmentBuilder(Buffer.from(body || "No messages found.", "utf8"), {
    name: `ticket-${channel.id}.txt`
  });
}

async function logTicket(guild, content, files = []) {
  const channel = LOG_CHANNEL_ID ? await guild.channels.fetch(LOG_CHANNEL_ID).catch(() => null) : null;
  if (channel?.isTextBased()) await channel.send({ content, files }).catch(console.error);
}

async function closeTicket(interaction) {
  const data = loadData();
  const ticket = data.tickets[interaction.channel.id];
  if (!ticket) return interaction.reply({ content: "This ticket is not registered.", ephemeral: true });

  const owner = interaction.user.id === ticket.userId;
  if (!owner && !isStaff(interaction)) return interaction.reply({ content: "You cannot close this ticket.", ephemeral: true });

  await interaction.deferReply({ ephemeral: true });
  const transcript = await createTranscript(interaction.channel).catch(() => null);
  if (transcript) await logTicket(interaction.guild, `Ticket #${ticket.number} closed by ${interaction.user}. Owner: <@${ticket.userId}>`, [transcript]);

  ticket.closedAt = new Date().toISOString();
  ticket.closedBy = interaction.user.id;
  ticket.status = "Closed";
  saveData(data);

  await interaction.channel.permissionOverwrites.edit(ticket.userId, {
    ViewChannel: false,
    SendMessages: false
  }).catch(() => {});
  await interaction.channel.setName(`closed-${String(ticket.number).padStart(4, "0")}`).catch(() => {});
  await interaction.channel.setTopic(`${BRAND} | Ticket #${ticket.number} | CLOSED | Owner: ${ticket.userId}`).catch(() => {});
  await interaction.channel.send({ embeds: [makeEmbed(`Ticket #${ticket.number} Closed`, `This ticket was closed by ${interaction.user}. Staff can reopen it with \`/ticket reopen\`.` , COLORS.gray)] }).catch(() => {});
  return interaction.editReply("Ticket closed and transcript saved. Staff can reopen it by ticket number.");
}

async function ticketChannel(interaction, ticket) {
  return interaction.guild.channels.fetch(ticket.channelId || Object.keys(loadData().tickets).find(id => loadData().tickets[id] === ticket)).catch(() => null);
}

async function updateTicketEmbed(channel, ticket) {
  const msg = await channel.messages.fetch({ limit: 30 }).then(list => list.find(m =>
    m.author.id === client.user.id && m.embeds[0]?.title?.includes(`Ticket #${ticket.number}`)
  )).catch(() => null);
  if (!msg) return;
  const e = EmbedBuilder.from(msg.embeds[0]);
  const fields = [
    { name: "Ticket owner", value: `<@${ticket.userId}>`, inline: true },
    { name: "Priority", value: ticket.priority || "Normal", inline: true },
    { name: "Status", value: ticket.status || "Active", inline: true },
    { name: "Claimed by", value: ticket.claimedBy ? `<@${ticket.claimedBy}>` : "Unclaimed", inline: true }
  ];
  e.setFields(fields);
  await msg.edit({ embeds: [e] }).catch(() => {});
}

function addTicketCommand() {
  return new SlashCommandBuilder().setName("ticket").setDescription("Manage support tickets")
    .addSubcommand(s => s.setName("unclaim").setDescription("Unclaim this ticket"))
    .addSubcommand(s => s.setName("waiting").setDescription("Mark this ticket waiting on the customer"))
    .addSubcommand(s => s.setName("reopen").setDescription("Reopen a closed ticket by number")
      .addIntegerOption(o => o.setName("number").setDescription("Ticket number").setRequired(true).setMinValue(1)))
    .addSubcommand(s => s.setName("transfer").setDescription("Transfer ticket department")
      .addStringOption(o => o.setName("department").setDescription("New department").setRequired(true)
        .addChoices(...DEPARTMENTS.map(d => ({ name: d.name, value: d.value })))))
    .addSubcommand(s => s.setName("note").setDescription("Add a private staff note")
      .addStringOption(o => o.setName("note").setDescription("Private note").setRequired(true).setMaxLength(1000)))
    .addSubcommand(s => s.setName("priority").setDescription("Set this ticket priority")
      .addStringOption(o => o.setName("level").setDescription("Priority").setRequired(true)
        .addChoices(...PRIORITIES.map(p => ({ name: p, value: p.toLowerCase() })))))
    .addSubcommand(s => s.setName("active").setDescription("Mark this ticket active again"));
}

function addCoreCommand() {
  return new SlashCommandBuilder().setName("core").setDescription("JJSTUDIOS customer and product management")
    .addSubcommand(s => s.setName("statusset").setDescription("Set product status")
      .addStringOption(o => o.setName("status").setDescription("Current status").setRequired(true)
        .addChoices(...PRODUCT_STATUSES.map(x => ({ name: x, value: x }))))
      .addStringOption(o => o.setName("message").setDescription("Status details").setRequired(false).setMaxLength(1000)))
    .addSubcommand(s => s.setName("setup").setDescription("Configure JJSTUDIOS status and staff settings")
      .addChannelOption(o => o.setName("status_channel").setDescription("Channel for the status board").addChannelTypes(ChannelType.GuildText))
      .addRoleOption(o => o.setName("staff_role").setDescription("Staff role"))
    )
    .addSubcommand(s => s.setName("statusboard").setDescription("Post or update the product status board"))
    .addSubcommand(s => s.setName("resolveincident").setDescription("Resolve an incident")
      .addStringOption(o => o.setName("incident_id").setDescription("Incident ID").setRequired(true)))
    .addSubcommand(s => s.setName("rolesync").setDescription("Repair a customer's configured staff/customer role mapping")
      .addUserOption(o => o.setName("user").setDescription("Customer").setRequired(true)))
    .addSubcommand(s => s.setName("permission").setDescription("Set a role capability")
      .addStringOption(o => o.setName("capability").setDescription("Capability name").setRequired(true))
      .addBooleanOption(o => o.setName("enabled").setDescription("Enable or disable").setRequired(true)))
    .addSubcommand(s => s.setName("release").setDescription("Publish a release announcement")
      .addStringOption(o => o.setName("title").setDescription("Release title").setRequired(true))
      .addStringOption(o => o.setName("details").setDescription("Release details").setRequired(true).setMaxLength(3500))
      .addChannelOption(o => o.setName("channel").setDescription("Announcement channel").addChannelTypes(ChannelType.GuildText)))
    .addSubcommand(s => s.setName("customernote").setDescription("Add an internal customer note")
      .addUserOption(o => o.setName("user").setDescription("Customer").setRequired(true))
      .addStringOption(o => o.setName("note").setDescription("Internal note").setRequired(true).setMaxLength(1000)))
    .addSubcommand(s => s.setName("incident").setDescription("Create a product incident")
      .addStringOption(o => o.setName("title").setDescription("Incident title").setRequired(true))
      .addStringOption(o => o.setName("details").setDescription("Incident details").setRequired(true).setMaxLength(1500)))
    .addSubcommand(s => s.setName("component").setDescription("Set a component status")
      .addStringOption(o => o.setName("name").setDescription("Component name").setRequired(true))
      .addStringOption(o => o.setName("status").setDescription("Component status").setRequired(true)
        .addChoices(...PRODUCT_STATUSES.map(x => ({ name: x, value: x })))))
    .addSubcommand(s => s.setName("customerflag").setDescription("Set a customer flag")
      .addUserOption(o => o.setName("user").setDescription("Customer").setRequired(true))
      .addStringOption(o => o.setName("flag").setDescription("Flag").setRequired(true))
      .addStringOption(o => o.setName("value").setDescription("Flag value").setRequired(true)))
    .addSubcommand(s => s.setName("analytics").setDescription("View support analytics"));
}

function addModCommand() {
  return new SlashCommandBuilder().setName("mod").setDescription("Customer moderation tools")
    .addSubcommand(s => s.setName("warn").setDescription("Warn a user")
      .addUserOption(o => o.setName("user").setDescription("User").setRequired(true))
      .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(true).setMaxLength(1000)))
    .addSubcommand(s => s.setName("history").setDescription("View moderation history")
      .addUserOption(o => o.setName("user").setDescription("User").setRequired(true)))
    .addSubcommand(s => s.setName("blacklist").setDescription("Blacklist a user")
      .addUserOption(o => o.setName("user").setDescription("User").setRequired(true))
      .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(true)))
    .addSubcommand(s => s.setName("unblacklist").setDescription("Remove a blacklist")
      .addUserOption(o => o.setName("user").setDescription("User").setRequired(true)));
}

function addFeatureCommand() {
  return new SlashCommandBuilder().setName("feature").setDescription("Feature request management")
    .addSubcommand(s => s.setName("status").setDescription("View a feature request")
      .addStringOption(o => o.setName("id").setDescription("Feature ID").setRequired(true)))
    .addSubcommand(s => s.setName("update").setDescription("Update a feature request")
      .addStringOption(o => o.setName("id").setDescription("Feature ID").setRequired(true))
      .addStringOption(o => o.setName("status").setDescription("New status").setRequired(true))
      .addStringOption(o => o.setName("details").setDescription("Update details").setRequired(false)));
}

function addBugCommand() {
  return new SlashCommandBuilder().setName("bug").setDescription("Bug report management")
    .addSubcommand(s => s.setName("status").setDescription("View a bug")
      .addStringOption(o => o.setName("id").setDescription("Bug ID").setRequired(true)))
    .addSubcommand(s => s.setName("update").setDescription("Update a bug")
      .addStringOption(o => o.setName("id").setDescription("Bug ID").setRequired(true))
      .addStringOption(o => o.setName("status").setDescription("New status").setRequired(true))
      .addStringOption(o => o.setName("details").setDescription("Update details").setRequired(false)));
}

const commands = [
  new SlashCommandBuilder().setName("ticket-setup").setDescription("Post the JJSTUDIOS support panel"),
  new SlashCommandBuilder().setName("accounts").setDescription("View your private JJSTUDIOS customer account"),
  new SlashCommandBuilder().setName("account").setDescription("Open your private JJSTUDIOS customer panel"),
  addTicketCommand(),
  new SlashCommandBuilder().setName("staff").setDescription("Open the JJSTUDIOS staff dashboard"),
  new SlashCommandBuilder().setName("status").setDescription("View JJSTUDIOS product status"),
  new SlashCommandBuilder().setName("executors").setDescription("View Roblox executor status information"),
  new SlashCommandBuilder().setName("customer").setDescription("Look up a JJSTUDIOS customer")
    .addUserOption(o => o.setName("user").setDescription("Customer to look up").setRequired(true)),
  addModCommand(),
  addCoreCommand(),
  addFeatureCommand(),
  addBugCommand()
];

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
    body: commands.map(command => command.toJSON())
  });
  console.log("JJSTUDIOS slash commands registered.");
}

// ---------------- STATUS BOARD ----------------

function statusEmbed(data) {
  const e = makeEmbed("Product Status", `**Overall:** ${data.productStatus || "Operational"}\n\n${data.statusMessage || "No additional status information."}`,
    data.productStatus === "Operational" ? COLORS.green :
    data.productStatus === "Maintenance" ? COLORS.yellow : COLORS.red);
  const components = Object.entries(data.components || {});
  if (components.length) e.addFields({ name: "Components", value: components.slice(0, 20).map(([n, s]) => `â¢ **${n}** â ${s}`).join("\n") });
  const incidents = Object.entries(data.incidents || {}).filter(([, v]) => !v.resolvedAt);
  if (incidents.length) e.addFields({ name: "Active incidents", value: incidents.slice(-10).map(([id, v]) => `**${id}: ${v.title}**\n${v.details}`).join("\n\n").slice(0, 1024) });
  return e.setFooter({ text: `${BRAND} â¢ Status updates` });
}

async function updateStatusBoard(guild) {
  const data = loadData();
  const channelId = data.config.statusChannelId;
  if (!channelId) throw new Error("Run /core setup and select a status channel first.");
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) throw new Error("Configured status channel is unavailable.");
  const embed = statusEmbed(data);
  if (data.config.statusMessageId) {
    const old = await channel.messages.fetch(data.config.statusMessageId).catch(() => null);
    if (old) {
      await old.edit({ embeds: [embed] });
      return old;
    }
  }
  const message = await channel.send({ embeds: [embed] });
  data.config.statusMessageId = message.id;
  saveData(data);
  return message;
}

// ---------------- COMMAND HANDLERS ----------------

async function handleTicketCommand(interaction) {
  if (!await requireStaff(interaction)) return;
  const sub = interaction.options.getSubcommand();
  const data = loadData();
  const ticket = data.tickets[interaction.channelId];

  if (sub === "reopen") {
    const number = interaction.options.getInteger("number");
    const found = ticketByNumber(data, number);
    if (!found) return interaction.reply({ content: `Ticket #${number} was not found.`, ephemeral: true });
    const [channelId, record] = found;
    if (!record.closedAt) return interaction.reply({ content: `Ticket #${number} is already open.`, ephemeral: true });
    const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
    if (!channel) return interaction.reply({ content: "The archived ticket channel no longer exists.", ephemeral: true });
    record.closedAt = null;
    record.status = "Active";
    record.reopenedAt = new Date().toISOString();
    record.reopenedBy = interaction.user.id;
    await channel.permissionOverwrites.edit(record.userId, {
      ViewChannel: true, SendMessages: true, ReadMessageHistory: true,
      AttachFiles: true, EmbedLinks: true
    });
    await channel.setName(`ticket-${String(number).padStart(4, "0")}`).catch(() => {});
    await channel.setTopic(`${BRAND} | Ticket #${number} | ${record.category} | Owner: ${record.userId}`).catch(() => {});
    saveData(data);
    await channel.send(`Ticket reopened by ${interaction.user}. <@${record.userId}>`);
    return interaction.reply({ content: `Ticket #${number} reopened: ${channel}`, ephemeral: true });
  }

  if (!ticket) return interaction.reply({ content: "Use this command inside a registered ticket channel.", ephemeral: true });
  if (ticket.closedAt) return interaction.reply({ content: "This ticket is closed. Reopen it first.", ephemeral: true });

  if (sub === "unclaim") {
    ticket.claimedBy = null;
    ticket.status = "Active";
    saveData(data);
    await updateTicketEmbed(interaction.channel, ticket);
    return interaction.reply({ content: "Ticket unclaimed.", ephemeral: true });
  }
  if (sub === "waiting") {
    ticket.status = "Waiting on customer";
    ticket.waitingSince = new Date().toISOString();
    saveData(data);
    await updateTicketEmbed(interaction.channel, ticket);
    return interaction.reply({ content: `Ticket marked as waiting on <@${ticket.userId}>.`, ephemeral: true });
  }
  if (sub === "active") {
    ticket.status = "Active";
    ticket.waitingSince = null;
    saveData(data);
    await updateTicketEmbed(interaction.channel, ticket);
    return interaction.reply({ content: "Ticket marked active.", ephemeral: true });
  }
  if (sub === "note") {
    const note = interaction.options.getString("note", true);
    ticket.notes ||= [];
    ticket.notes.push({ by: interaction.user.id, note, at: new Date().toISOString() });
    saveData(data);
    await logTicket(interaction.guild, `ð **Private staff note â Ticket #${ticket.number}**\nBy: ${interaction.user}\n${note}`);
    return interaction.reply({ content: "Private staff note saved. It was not posted in the customer ticket.", ephemeral: true });
  }
  if (sub === "priority") {
    const level = interaction.options.getString("level", true);
    ticket.priority = level.charAt(0).toUpperCase() + level.slice(1);
    saveData(data);
    await updateTicketEmbed(interaction.channel, ticket);
    return interaction.reply({ content: `Ticket priority set to **${ticket.priority}**.`, ephemeral: true });
  }
  if (sub === "transfer") {
    const department = interaction.options.getString("department", true);
    ticket.category = department;
    ticket.transferredAt = new Date().toISOString();
    ticket.transferredBy = interaction.user.id;
    saveData(data);
    await interaction.channel.setTopic(`${BRAND} | Ticket #${ticket.number} | ${department} | Owner: ${ticket.userId}`).catch(() => {});
    const roleId = data.config.departmentRoles?.[department];
    if (roleId) await interaction.channel.permissionOverwrites.edit(roleId, {
      ViewChannel: true, SendMessages: true, ReadMessageHistory: true
    }).catch(() => {});
    await interaction.channel.send(`This ticket was transferred to **${department}** by staff. <@${ticket.userId}>`);
    return interaction.reply({ content: `Ticket transferred to **${department}**. Configure department roles with the bot environment/database if needed.`, ephemeral: true });
  }
}

async function handleStaffDashboard(interaction) {
  if (!await requireStaff(interaction)) return;
  const data = loadData();
  const records = Object.values(data.tickets);
  const open = records.filter(t => !t.closedAt);
  const waiting = open.filter(t => t.status === "Waiting on customer").length;
  const claimed = open.filter(t => t.claimedBy).length;
  const urgent = open.filter(t => t.priority === "Urgent").length;
  const embed = makeEmbed("Staff Dashboard", "JJSTUDIOS support overview.")
    .addFields(
      { name: "Open tickets", value: String(open.length), inline: true },
      { name: "Waiting", value: String(waiting), inline: true },
      { name: "Claimed", value: String(claimed), inline: true },
      { name: "Urgent", value: String(urgent), inline: true },
      { name: "Product status", value: data.productStatus || "Operational", inline: true },
      { name: "Active incidents", value: String(Object.values(data.incidents).filter(i => !i.resolvedAt).length), inline: true }
    )
    .setFooter({ text: "Use /ticket, /mod, /core, /feature and /bug to manage support." });
  return interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleCustomerLookup(interaction) {
  if (!await requireStaff(interaction)) return;
  const user = interaction.options.getUser("user", true);
  const data = loadData();
  const tickets = Object.values(data.tickets).filter(t => t.userId === user.id);
  const notes = data.customerNotes[user.id] || [];
  const flags = data.customerFlags[user.id] || {};
  const mod = data.moderation[user.id] || [];
  const embed = makeEmbed("Customer Lookup", `Customer: ${user} (\`${user.id}\`)`)
    .addFields(
      { name: "Tickets", value: String(tickets.length), inline: true },
      { name: "Open tickets", value: String(tickets.filter(t => !t.closedAt).length), inline: true },
      { name: "Warnings / moderation", value: String(mod.length), inline: true },
      { name: "Flags", value: Object.keys(flags).length ? Object.entries(flags).map(([k, v]) => `${k}: ${v}`).join("\n").slice(0, 1024) : "None" },
      { name: "Internal notes", value: notes.length ? `${notes.length} note(s) recorded` : "None" }
    );
  return interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleMod(interaction) {
  if (!await requireStaff(interaction)) return;
  const data = loadData();
  const sub = interaction.options.getSubcommand();
  const user = interaction.options.getUser("user", true);
  data.moderation[user.id] ||= [];

  if (sub === "warn" || sub === "blacklist") {
    const reason = interaction.options.getString("reason", true);
    data.moderation[user.id].push({
      type: sub,
      reason,
      by: interaction.user.id,
      at: new Date().toISOString(),
      active: true
    });
    saveData(data);
    await logTicket(interaction.guild, `**${sub.toUpperCase()}**\nUser: ${user} (\`${user.id}\`)\nBy: ${interaction.user}\nReason: ${reason}`);
    return interaction.reply({ content: `${user} ${sub === "warn" ? "warned" : "blacklisted"} and the action was recorded.`, ephemeral: true });
  }
  if (sub === "history") {
    const entries = data.moderation[user.id];
    const text = entries.length ? entries.slice(-10).reverse().map(x =>
      `**${x.type.toUpperCase()}** â¢ ${x.active ? "Active" : "Removed"}\n${x.reason}\n<t:${Math.floor(new Date(x.at).getTime() / 1000)}:R> â¢ by <@${x.by}>`
    ).join("\n\n") : "No moderation history.";
    return interaction.reply({ embeds: [makeEmbed("Moderation History", text)], ephemeral: true });
  }
  if (sub === "unblacklist") {
    const item = [...data.moderation[user.id]].reverse().find(x => x.type === "blacklist" && x.active);
    if (!item) return interaction.reply({ content: "No active blacklist record was found.", ephemeral: true });
    item.active = false;
    item.removedAt = new Date().toISOString();
    item.removedBy = interaction.user.id;
    saveData(data);
    await logTicket(interaction.guild, `Blacklist removed for ${user} by ${interaction.user}.`);
    return interaction.reply({ content: `${user} has been removed from the JJSTUDIOS blacklist record.`, ephemeral: true });
  }
}

async function handleCore(interaction) {
  if (!await requireStaff(interaction)) return;
  const sub = interaction.options.getSubcommand();
  const data = loadData();

  if (sub === "statusset") {
    data.productStatus = interaction.options.getString("status", true);
    data.statusMessage = interaction.options.getString("message") || "Status updated by staff.";
    saveData(data);
    const board = await updateStatusBoard(interaction.guild).catch(() => null);
    return interaction.reply({ content: `Product status set to **${data.productStatus}**.${board ? " Status board updated." : " Run /core statusboard after configuring it with /core setup."}`, ephemeral: true });
  }
  if (sub === "setup") {
    const channel = interaction.options.getChannel("status_channel");
    const role = interaction.options.getRole("staff_role");
    if (channel) data.config.statusChannelId = channel.id;
    if (role) data.config.staffRoleId = role.id;
    saveData(data);
    return interaction.reply({ content: `Configuration saved.${channel ? ` Status channel: ${channel}.` : ""}${role ? ` Staff role: ${role}.` : ""}`, ephemeral: true });
  }
  if (sub === "statusboard") {
    const message = await updateStatusBoard(interaction.guild);
    return interaction.reply({ content: `Status board posted/updated: ${message.url}`, ephemeral: true });
  }
  if (sub === "incident") {
    const id = `INC-${Date.now().toString(36).toUpperCase()}`;
    data.incidents[id] = {
      title: interaction.options.getString("title", true),
      details: interaction.options.getString("details", true),
      createdAt: new Date().toISOString(),
      createdBy: interaction.user.id,
      resolvedAt: null
    };
    saveData(data);
    await updateStatusBoard(interaction.guild).catch(() => {});
    await logTicket(interaction.guild, `ð¨ **New incident ${id}: ${data.incidents[id].title}**\n${data.incidents[id].details}`);
    return interaction.reply({ content: `Incident **${id}** created.`, ephemeral: true });
  }
  if (sub === "resolveincident") {
    const id = interaction.options.getString("incident_id", true).toUpperCase();
    if (!data.incidents[id] || data.incidents[id].resolvedAt) return interaction.reply({ content: "Active incident not found.", ephemeral: true });
    data.incidents[id].resolvedAt = new Date().toISOString();
    data.incidents[id].resolvedBy = interaction.user.id;
    saveData(data);
    await updateStatusBoard(interaction.guild).catch(() => {});
    return interaction.reply({ content: `Incident ${id} resolved.`, ephemeral: true });
  }
  if (sub === "component") {
    const name = interaction.options.getString("name", true);
    data.components[name] = interaction.options.getString("status", true);
    saveData(data);
    await updateStatusBoard(interaction.guild).catch(() => {});
    return interaction.reply({ content: `Component **${name}** updated.`, ephemeral: true });
  }
  if (sub === "customernote") {
    const user = interaction.options.getUser("user", true);
    const note = interaction.options.getString("note", true);
    data.customerNotes[user.id] ||= [];
    data.customerNotes[user.id].push({ note, by: interaction.user.id, at: new Date().toISOString() });
    saveData(data);
    await logTicket(interaction.guild, `ð Internal customer note for ${user}, added by ${interaction.user}.`);
    return interaction.reply({ content: "Internal customer note saved.", ephemeral: true });
  }
  if (sub === "customerflag") {
    const user = interaction.options.getUser("user", true);
    const flag = interaction.options.getString("flag", true);
    const value = interaction.options.getString("value", true);
    data.customerFlags[user.id] ||= {};
    data.customerFlags[user.id][flag] = value;
    saveData(data);
    return interaction.reply({ content: `Flag **${flag}** saved for ${user}.`, ephemeral: true });
  }
  if (sub === "analytics") {
    const tickets = Object.values(data.tickets);
    const open = tickets.filter(t => !t.closedAt);
    const closed = tickets.filter(t => t.closedAt);
    const embed = makeEmbed("Support Analytics", "Current support totals.")
      .addFields(
        { name: "Total tickets", value: String(tickets.length), inline: true },
        { name: "Open", value: String(open.length), inline: true },
        { name: "Closed", value: String(closed.length), inline: true },
        { name: "Waiting", value: String(open.filter(t => t.status === "Waiting on customer").length), inline: true },
        { name: "Urgent", value: String(open.filter(t => t.priority === "Urgent").length), inline: true }
      );
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }
  if (sub === "permission") {
    const capability = interaction.options.getString("capability", true);
    const enabled = interaction.options.getBoolean("enabled", true);
    data.permissions[capability] = enabled;
    saveData(data);
    return interaction.reply({ content: `Capability **${capability}** set to **${enabled ? "enabled" : "disabled"}**. This records the capability setting; it does not grant Discord permissions by itself.`, ephemeral: true });
  }
  if (sub === "rolesync") {
    const user = interaction.options.getUser("user", true);
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) return interaction.reply({ content: "That user is not in this server.", ephemeral: true });
    const roleId = data.config.staffRoleId || STAFF_ROLE_ID;
    if (!roleId) return interaction.reply({ content: "Configure a staff role with /core setup first.", ephemeral: true });
    // Safe repair: confirms role membership against the configured role; does not arbitrarily grant access.
    const hasRole = member.roles.cache.has(roleId);
    return interaction.reply({ content: `${user} ${hasRole ? "already has" : "does not have"} the configured staff role. Role sync is verification-only until a customer-role mapping is configured.`, ephemeral: true });
  }
  if (sub === "release") {
    const title = interaction.options.getString("title", true);
    const details = interaction.options.getString("details", true);
    const channel = interaction.options.getChannel("channel") || interaction.channel;
    const embed = makeEmbed(`Release â¢ ${title}`, details).setFooter({ text: `${BRAND} â¢ Release notes` });
    const message = await channel.send({ embeds: [embed] });
    data.releases.push({ title, details, channelId: channel.id, messageId: message.id, at: new Date().toISOString(), by: interaction.user.id });
    saveData(data);
    return interaction.reply({ content: `Release announcement published: ${message.url}`, ephemeral: true });
  }
}

async function handleFeatureBug(interaction, kind) {
  if (!await requireStaff(interaction)) return;
  const sub = interaction.options.getSubcommand();
  const id = interaction.options.getString("id", true).toUpperCase();
  const store = kind === "feature" ? "featureRequests" : "bugs";
  const data = loadData();
  if (sub === "status") {
    const item = data[store][id];
    if (!item) return interaction.reply({ content: `${kind === "feature" ? "Feature" : "Bug"} ${id} was not found in the bot database.`, ephemeral: true });
    return interaction.reply({ embeds: [makeEmbed(`${kind} ${id}`, `**Status:** ${item.status}\n**Details:** ${item.details || "No details"}\n**Updated:** ${item.updatedAt || "Not available"}`)], ephemeral: true });
  }
  const status = interaction.options.getString("status", true);
  const details = interaction.options.getString("details") || "";
  data[store][id] = { ...(data[store][id] || {}), status, details, updatedAt: new Date().toISOString(), updatedBy: interaction.user.id };
  saveData(data);
  return interaction.reply({ content: `${kind === "feature" ? "Feature" : "Bug"} ${id} updated to **${status}**.`, ephemeral: true });
}

// ---------------- INTERACTION ROUTER ----------------

client.on("interactionCreate", async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      const name = interaction.commandName;

      if (name === "ticket-setup") {
        if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)) {
          return interaction.reply({ content: "You need Manage Server permission to post the ticket panel.", ephemeral: true });
        }
        await interaction.channel.send(makePanel());
        return interaction.reply({ content: "JJSTUDIOS ticket panel posted.", ephemeral: true });
      }
      if (name === "accounts" || name === "account") return handleAccount(interaction);
      if (name === "ticket") return handleTicketCommand(interaction);
      if (name === "staff") return handleStaffDashboard(interaction);
      if (name === "customer") return handleCustomerLookup(interaction);
      if (name === "mod") return handleMod(interaction);
      if (name === "core") return handleCore(interaction);
      if (name === "feature") return handleFeatureBug(interaction, "feature");
      if (name === "bug") return handleFeatureBug(interaction, "bug");
      if (name === "status") {
        const data = loadData();
        return interaction.reply({ embeds: [statusEmbed(data)], ephemeral: true });
      }
      if (name === "executors") {
        return interaction.reply({
          embeds: [makeEmbed("Executor Status", "Live executor status is not connected yet. This panel will show verified availability once a trusted status source is configured.", COLORS.gray)],
          ephemeral: true
        });
      }
    }

    if (interaction.isStringSelectMenu() && interaction.customId === "ticket_category") {
      await interaction.deferReply({ ephemeral: true });
      const index = Number(interaction.values[0].replace("category_", ""));
      const category = CATEGORIES[index];
      if (!category) return interaction.editReply("Invalid ticket category.");
      return createTicket(interaction, category);
    }

    if (interaction.isButton() && interaction.customId === "ticket_close") return closeTicket(interaction);

    if (interaction.isButton() && interaction.customId === "ticket_claim") {
      if (!isStaff(interaction)) return interaction.reply({ content: "Staff only.", ephemeral: true });
      const data = loadData();
      const ticket = data.tickets[interaction.channelId];
      if (!ticket || ticket.closedAt) return interaction.reply({ content: "This ticket is unavailable.", ephemeral: true });
      if (ticket.claimedBy && ticket.claimedBy !== interaction.user.id) {
        return interaction.reply({ content: `Already claimed by <@${ticket.claimedBy}>.`, ephemeral: true });
      }
      ticket.claimedBy = interaction.user.id;
      ticket.status = "Active";
      saveData(data);
      await updateTicketEmbed(interaction.channel, ticket);
      return interaction.reply({ content: `Ticket claimed by ${interaction.user}.`, ephemeral: true });
    }
  } catch (error) {
    console.error("[INTERACTION ERROR]", error);
    if (interaction.isRepliable()) {
      const payload = { content: "Something went wrong. Please contact JJSTUDIOS staff.", ephemeral: true };
      if (interaction.deferred) await interaction.editReply(payload).catch(() => {});
      else if (!interaction.replied) await interaction.reply(payload).catch(() => {});
    }
  }
});

// ---------------- TICKET HISTORY + MESSAGE COUNTS ----------------

client.on("messageCreate", message => {
  if (!message.guild || message.author.bot) return;
  const data = loadData();
  const ticket = data.tickets[message.channelId];
  if (!ticket || ticket.closedAt) return;
  ticket.messages = (Number(ticket.messages) || 0) + 1;
  ticket.lastMessageAt = new Date().toISOString();
  saveData(data);
});

// Add /ticket history separately to keep the main subcommand builder readable.
const ticketCommand = commands.find(c => c.name === "ticket");
ticketCommand.addSubcommand(s => s.setName("history").setDescription("Browse a customer's ticket history")
  .addUserOption(o => o.setName("user").setDescription("Customer (defaults to ticket owner)").setRequired(false)));

const originalTicketHandler = handleTicketCommand;
handleTicketCommand = async function(interaction) {
  if (interaction.options.getSubcommand() !== "history") return originalTicketHandler(interaction);
  if (!await requireStaff(interaction)) return;
  const data = loadData();
  const user = interaction.options.getUser("user");
  const current = data.tickets[interaction.channelId];
  const targetId = user?.id || current?.userId;
  if (!targetId) return interaction.reply({ content: "Provide a customer or run this inside one of their tickets.", ephemeral: true });
  const records = Object.values(data.tickets).filter(t => t.userId === targetId).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const description = records.length ? records.slice(0, 15).map(t =>
    `**#${t.number}** â¢ ${t.category} â¢ ${t.status || (t.closedAt ? "Closed" : "Active")} â¢ ${t.priority || "Normal"}`
  ).join("\n") : "No ticket history found.";
  return interaction.reply({ embeds: [makeEmbed("Customer Ticket History", `Customer: <@${targetId}>\n\n${description}`)], ephemeral: true });
};

// ---------------- HEALTH SERVER ----------------

const healthServer = http.createServer((req, res) => {
  if (req.url === "/" || req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    return res.end(JSON.stringify({ success: true, service: `${BRAND} Ticket Bot`, discord: client.isReady() ? "online" : "connecting" }));
  }
  res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ success: false, message: "Not found" }));
});

healthServer.listen(PORT, "0.0.0.0", () => console.log(`Health server listening on ${PORT}`));
healthServer.on("error", error => {
  console.error("Health server error:", error);
  process.exit(1);
});

// ---------------- KEEP ALIVE ----------------

const KEEP_ALIVE_INTERVAL = 5 * 60 * 1000;
function startKeepAlive() {
  const base = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  const url = base.replace(/\/+$/, "") + "/health";
  const mod = url.startsWith("https://") ? https : http;
  setInterval(() => {
    mod.get(url, { timeout: 10000 }, response => {
      let body = "";
      response.on("data", chunk => body += chunk);
      response.on("end", () => {
        try {
          const parsed = JSON.parse(body);
          if (response.statusCode === 200 && parsed.success) console.log(`[KEEP-ALIVE] OK ${new Date().toLocaleTimeString()}`);
          else console.warn(`[KEEP-ALIVE] HTTP ${response.statusCode}`);
        } catch (e) { console.warn("[KEEP-ALIVE] Invalid response:", e.message); }
      });
    }).on("error", error => console.warn("[KEEP-ALIVE] Ping failed:", error.message));
  }, KEEP_ALIVE_INTERVAL);
}
startKeepAlive();

// ---------------- START ----------------

client.once("ready", async () => {
  console.log(`${BRAND} Ticket Bot online as ${client.user.tag}`);
  try {
    await registerCommands();
  } catch (error) {
    console.error("Slash command registration failed:", error);
  }
});

client.login(TOKEN).catch(error => {
  console.error("Discord login failed. Check TICKET_BOT_TOKEN:", error);
  process.exit(1);
});
