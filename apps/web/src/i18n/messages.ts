/**
 * Every piece of text the user reads, in every language the application ships.
 *
 * Nothing user-facing is written inline in a component: English is the source
 * locale and Spanish ships in v1, and a literal in a component is a string that
 * only ever exists in one of them. Everything else in the repository — code,
 * comments, errors thrown in code, Node ids — stays English and is not in here.
 */

export const LOCALES = ["en", "es"] as const

export type Locale = (typeof LOCALES)[number]

const en = {
  "run.title": "Run your bot",
  "run.token.label": "Bot token",
  "run.token.placeholder": "Paste the token from the Discord Developer Portal",
  "run.token.stored": "Saved. Your token is kept in Windows, not in your Project.",
  "run.token.save": "Save token",
  "run.testServer.label": "Test server",
  "run.testServer.help": "Your commands appear on this server straight away.",
  "run.testServer.search": "Search your servers",
  "run.testServer.loading": "Looking for your servers…",
  "run.testServer.reload": "Look again",
  "run.testServer.none": "This bot is not in any server yet. Invite it to one, then look again.",
  "run.testServer.noMatch": "No server matches that.",
  "run.testServer.capped": "Showing the first {count}. If yours is not here, type its id below.",
  "run.testServer.manual": "Or paste a server id",
  "run.start": "Run",
  "run.stop": "Stop",
  "run.status.stopped": "Stopped",
  "run.status.connecting": "Connecting…",
  "run.status.ready": "Ready",
  "run.status.failed": "Could not start",
  "run.output.title": "What your bot is saying",
  "run.output.empty": "Nothing yet. Press Run.",
  "run.registered": "Registered on Discord: {commands}",
  "run.deleted": "No longer on Discord: {commands}",
  "run.failure.token": "Discord did not accept that token. Check it and paste it again.",
  "run.failure.missingSecret": "Paste your bot token first, then press Run.",
  "run.failure.unknown": "Your bot could not start: {message}",
  "run.failure.timeout":
    "Your bot never finished connecting. Check your internet connection and press Run again.",
  "run.failure.flow": "The Flow {flow} stopped: {message}",

  "flows.title": "Your flows",
  "canvas.label": "Canvas",
  "canvas.wire.remove": "Remove this wire",
  "canvas.node.remove": "Remove this node",

  "connections.rejected.direction":
    "Wires run from an output on the right of a node to an input on the left.",
  "connections.rejected.kind":
    "That is an order wire and a value wire. Order connects to order, values connect to values.",
  "connections.rejected.dataType": "Those two values are not of the same kind.",
  "connections.rejected.unknownPort": "That connection point is no longer there.",
  "connections.rejected.executionOutputTaken":
    "Only one thing can happen next. Remove the wire that is already there first.",
  "connections.rejected.dataInputTaken":
    "This field already reads a value. Remove the wire that is already there first.",
  "connections.rejected.cycle": "That would send your bot round in a circle.",

  "coercions.userToText.label": "as text",

  "ports.in.label": "Run this",
  "ports.next.label": "Then",

  "nodes.discord.trigger.slashCommand.label": "Slash command",
  "nodes.discord.trigger.slashCommand.description": "Starts when someone uses your command.",
  "nodes.discord.trigger.slashCommand.fields.name.label": "Command",
  "nodes.discord.trigger.slashCommand.fields.description.label": "What it does",
  "nodes.discord.trigger.slashCommand.fields.parameters.label": "What it asks for",
  "nodes.discord.trigger.slashCommand.ports.user.label": "Who used it",

  "nodes.discord.interaction.reply.label": "Reply",
  "nodes.discord.interaction.reply.description": "Answers whoever used the command.",
  "nodes.discord.interaction.reply.fields.content.label": "Message",
  "nodes.discord.interaction.reply.fields.ephemeral.label": "Only they can see it",
  "nodes.discord.interaction.reply.ports.content.label": "Message"
} as const

export type MessageKey = keyof typeof en

const es: Record<MessageKey, string> = {
  "run.title": "Ejecuta tu bot",
  "run.token.label": "Token del bot",
  "run.token.placeholder": "Pega el token del portal de desarrolladores de Discord",
  "run.token.stored": "Guardado. Tu token queda en Windows, no en tu Proyecto.",
  "run.token.save": "Guardar token",
  "run.testServer.label": "Servidor de pruebas",
  "run.testServer.help": "Tus comandos aparecen en este servidor de inmediato.",
  "run.testServer.search": "Busca entre tus servidores",
  "run.testServer.loading": "Buscando tus servidores…",
  "run.testServer.reload": "Buscar de nuevo",
  "run.testServer.none":
    "Este bot todavía no está en ningún servidor. Invítalo a uno y vuelve a buscar.",
  "run.testServer.noMatch": "Ningún servidor coincide.",
  "run.testServer.capped":
    "Mostrando los primeros {count}. Si el tuyo no está, escribe su id abajo.",
  "run.testServer.manual": "O pega el id de un servidor",
  "run.start": "Ejecutar",
  "run.stop": "Detener",
  "run.status.stopped": "Detenido",
  "run.status.connecting": "Conectando…",
  "run.status.ready": "Listo",
  "run.status.failed": "No pudo arrancar",
  "run.output.title": "Lo que dice tu bot",
  "run.output.empty": "Nada todavía. Pulsa Ejecutar.",
  "run.registered": "Registrados en Discord: {commands}",
  "run.deleted": "Ya no están en Discord: {commands}",
  "run.failure.token": "Discord no aceptó ese token. Revísalo y pégalo de nuevo.",
  "run.failure.missingSecret": "Pega el token de tu bot antes de pulsar Ejecutar.",
  "run.failure.unknown": "Tu bot no pudo arrancar: {message}",
  "run.failure.timeout":
    "Tu bot nunca terminó de conectarse. Revisa tu conexión a internet y pulsa Ejecutar otra vez.",
  "run.failure.flow": "El Flow {flow} se detuvo: {message}",

  "flows.title": "Tus flujos",
  "canvas.label": "Lienzo",
  "canvas.wire.remove": "Quitar este cable",
  "canvas.node.remove": "Quitar este nodo",

  "connections.rejected.direction":
    "Los cables van de una salida a la derecha de un nodo a una entrada a la izquierda.",
  "connections.rejected.kind":
    "Ese es un cable de orden y el otro de valor. El orden se conecta con el orden y los valores con los valores.",
  "connections.rejected.dataType": "Esos dos valores no son del mismo tipo.",
  "connections.rejected.unknownPort": "Ese punto de conexión ya no está ahí.",
  "connections.rejected.executionOutputTaken":
    "Solo puede pasar una cosa después. Quita primero el cable que ya está ahí.",
  "connections.rejected.dataInputTaken":
    "Este campo ya lee un valor. Quita primero el cable que ya está ahí.",
  "connections.rejected.cycle": "Eso haría que tu bot diera vueltas en círculo.",

  "coercions.userToText.label": "como texto",

  "ports.in.label": "Haz esto",
  "ports.next.label": "Después",

  "nodes.discord.trigger.slashCommand.label": "Comando",
  "nodes.discord.trigger.slashCommand.description": "Empieza cuando alguien usa tu comando.",
  "nodes.discord.trigger.slashCommand.fields.name.label": "Comando",
  "nodes.discord.trigger.slashCommand.fields.description.label": "Qué hace",
  "nodes.discord.trigger.slashCommand.fields.parameters.label": "Qué pide",
  "nodes.discord.trigger.slashCommand.ports.user.label": "Quién lo usó",

  "nodes.discord.interaction.reply.label": "Responder",
  "nodes.discord.interaction.reply.description": "Contesta a quien usó el comando.",
  "nodes.discord.interaction.reply.fields.content.label": "Mensaje",
  "nodes.discord.interaction.reply.fields.ephemeral.label": "Solo lo ve esa persona",
  "nodes.discord.interaction.reply.ports.content.label": "Mensaje"
}

const messages: Record<Locale, Record<MessageKey, string>> = { en, es }

/** The locale the application reads text in, taken from the operating system. */
export function currentLocale(): Locale {
  const preferred = typeof navigator === "undefined" ? "en" : navigator.language.slice(0, 2)
  return LOCALES.find(locale => locale === preferred) ?? "en"
}

/**
 * Resolves a key a Node definition, a Port or the Coercion table carries.
 *
 * Those keys are plain strings by construction — the catalogue is compiled
 * without the editor — so this is the one place a key is not known at compile
 * time. A missing one shows as itself rather than as blank space, which is a
 * bug report the user can read out loud.
 */
export function translateDefinitionKey(key: string, locale: Locale = currentLocale()): string {
  return messages[locale][key as MessageKey] ?? key
}

/** Resolves a key to text, filling in `{placeholders}`. */
export function translate(
  key: MessageKey,
  values: Readonly<Record<string, string>> = {},
  locale: Locale = currentLocale()
): string {
  const text = messages[locale][key]
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => values[name] ?? whole)
}
