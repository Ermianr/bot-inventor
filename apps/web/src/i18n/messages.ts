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
  "run.failure.noDesktop": "Bot Inventor can only run your bot in the desktop app.",
  "run.failure.unknown": "Your bot could not start: {message}",
  "run.failure.timeout":
    "Your bot never finished connecting. Check your internet connection and press Run again.",
  "run.failure.flow": "The Flow {flow} stopped: {message}",
  "run.failure.build":
    "Your change could not be built, so your bot is still running the last version that worked. {message}",
  "run.reloading": "You changed something. Restarting your bot…",

  "project.untitled": "Untitled bot",
  "project.flow.default": "Main",
  "project.name.edit": "Rename this bot",
  "project.name.field": "The name of this bot",
  "project.file.filter": "Bot Inventor Project",
  "project.file.new": "New",
  "project.file.open": "Open",
  "project.file.save": "Save",
  "project.file.saveAs": "Save as…",
  "project.file.unsaved": "You have changes that are not saved yet.",
  "project.file.unsavedMark": "Unsaved",
  "project.file.location": "Saved in {path}",
  "project.file.nowhere": "Not saved to a file yet.",
  "project.discard.title": "Unsaved changes",
  "project.discard.message":
    "You have changes in {project} that are not saved. If you carry on, they are lost.",
  "project.discard.confirm": "Discard my changes",
  "project.discard.cancel": "Go back",
  "project.problem.futureVersion":
    "This Project was made with a newer version of Bot Inventor, so this one cannot open it. Nothing in the file was changed. Update the app and try again.",
  "project.problem.malformed":
    "This file is not a Project this version can read. It may be damaged, or it may not be a Project at all.",
  "project.problem.migrationFailed":
    "This Project could not be brought up to date, so nothing was changed. {message}",
  "project.problem.read": "This Project could not be opened: {message}",
  "project.problem.write": "This Project could not be saved: {message}",

  "export.title": "Export",
  "export.singleFile": "One file",
  "export.singleFile.help": "One .mjs file you upload anywhere Node.js runs. No install step.",
  "export.nodeProject": "A folder of code",
  "export.nodeProject.help":
    "Readable source with a README, for version control or to hand to a developer.",
  "export.working": "Building your bot…",
  "export.destination.file": "Where should the file go?",
  "export.destination.folder": "Which folder should your bot go in?",
  "export.written.file": "Written to {path}",
  "export.written.folder": "Written to {path}. Run npm install there, then start it.",
  "export.overwrite.title": "There is already an export here",
  "export.overwrite.message":
    "{path} already holds an export. Exporting again replaces it, including any changes you made to it by hand.",
  "export.overwrite.confirm": "Replace it",
  "export.overwrite.cancel": "Go back",
  "export.problem.failed": "Your bot could not be exported: {message}",

  "flows.title": "Your flows",
  "flows.create": "Add a flow",
  "flows.name.edit": "Rename this flow",
  "flows.name.field": "The name of this flow",
  "flows.name.taken": "One of your flows is already called {name}. Give this one another name.",
  "flows.remove": "Delete this flow",
  "flows.remove.title": "Delete {name}?",
  "flows.remove.body": "Everything you built in this flow goes with it, and this cannot be undone.",
  "flows.remove.confirm": "Delete flow",
  "flows.remove.cancel": "Keep it",
  "flows.remove.last": "This is your only flow. Add another one before deleting this one.",
  "flows.neverRuns": "This flow never runs: nothing in it makes it start.",
  "canvas.label": "Canvas",
  "canvas.wire.remove": "Remove this wire",
  "canvas.wire.carried": "Last run carried: {value}",

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
  "coercions.numberToText.label": "as text",
  "coercions.booleanToText.label": "as text",

  "ports.in.label": "Run this",
  "ports.next.label": "Then",
  // Shown only when a parameter has somehow lost its name: a parameter's Port is
  // normally labelled with what the user called it.
  "ports.commandParameter.label": "What they answered",

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
  "run.failure.noDesktop":
    "Bot Inventor solo puede ejecutar tu bot en la aplicación de escritorio.",
  "run.failure.unknown": "Tu bot no pudo arrancar: {message}",
  "run.failure.timeout":
    "Tu bot nunca terminó de conectarse. Revisa tu conexión a internet y pulsa Ejecutar otra vez.",
  "run.failure.flow": "El Flow {flow} se detuvo: {message}",
  "run.failure.build":
    "Tu cambio no se pudo construir, así que tu bot sigue con la última versión que funcionó. {message}",
  "run.reloading": "Cambiaste algo. Reiniciando tu bot…",

  "project.untitled": "Bot sin nombre",
  "project.flow.default": "Principal",
  "project.name.edit": "Cambiar el nombre de este bot",
  "project.name.field": "El nombre de este bot",
  "project.file.filter": "Proyecto de Bot Inventor",
  "project.file.new": "Nuevo",
  "project.file.open": "Abrir",
  "project.file.save": "Guardar",
  "project.file.saveAs": "Guardar como…",
  "project.file.unsaved": "Tienes cambios sin guardar.",
  "project.file.unsavedMark": "Sin guardar",
  "project.file.location": "Guardado en {path}",
  "project.file.nowhere": "Todavía no está guardado en ningún archivo.",
  "project.discard.title": "Cambios sin guardar",
  "project.discard.message":
    "Tienes cambios en {project} que no están guardados. Si sigues, se pierden.",
  "project.discard.confirm": "Descartar mis cambios",
  "project.discard.cancel": "Volver",
  "project.problem.futureVersion":
    "Este Proyecto se hizo con una versión más nueva de Bot Inventor, así que esta no puede abrirlo. No se cambió nada del archivo. Actualiza la aplicación e inténtalo de nuevo.",
  "project.problem.malformed":
    "Este archivo no es un Proyecto que esta versión pueda leer. Puede estar dañado, o puede no ser un Proyecto.",
  "project.problem.migrationFailed":
    "Este Proyecto no se pudo poner al día, así que no se cambió nada. {message}",
  "project.problem.read": "Este Proyecto no se pudo abrir: {message}",
  "project.problem.write": "Este Proyecto no se pudo guardar: {message}",

  "export.title": "Exportar",
  "export.singleFile": "Un solo archivo",
  "export.singleFile.help":
    "Un archivo .mjs que subes a donde haya Node.js. Sin paso de instalación.",
  "export.nodeProject": "Una carpeta de código",
  "export.nodeProject.help":
    "Código legible con un README, para control de versiones o para pasárselo a alguien que programe.",
  "export.working": "Construyendo tu bot…",
  "export.destination.file": "¿Dónde quieres el archivo?",
  "export.destination.folder": "¿En qué carpeta quieres tu bot?",
  "export.written.file": "Escrito en {path}",
  "export.written.folder": "Escrito en {path}. Ejecuta npm install ahí y luego inícialo.",
  "export.overwrite.title": "Ya hay una exportación aquí",
  "export.overwrite.message":
    "{path} ya tiene una exportación. Exportar de nuevo la reemplaza, incluyendo los cambios que le hayas hecho a mano.",
  "export.overwrite.confirm": "Reemplazarla",
  "export.overwrite.cancel": "Volver",
  "export.problem.failed": "Tu bot no se pudo exportar: {message}",

  "flows.title": "Tus flujos",
  "flows.create": "Añadir un flujo",
  "flows.name.edit": "Cambiar el nombre de este flujo",
  "flows.name.field": "El nombre de este flujo",
  "flows.name.taken": "Uno de tus flujos ya se llama {name}. Ponle otro nombre a este.",
  "flows.remove": "Eliminar este flujo",
  "flows.remove.title": "¿Eliminar {name}?",
  "flows.remove.body":
    "Todo lo que construiste en este flujo se va con él, y esto no se puede deshacer.",
  "flows.remove.confirm": "Eliminar flujo",
  "flows.remove.cancel": "Conservarlo",
  "flows.remove.last": "Este es tu único flujo. Añade otro antes de eliminar este.",
  "flows.neverRuns": "Este flujo nunca se ejecuta: nada dentro hace que empiece.",
  "canvas.label": "Lienzo",
  "canvas.wire.remove": "Quitar este cable",
  "canvas.wire.carried": "La última ejecución llevó: {value}",

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
  "coercions.numberToText.label": "como texto",
  "coercions.booleanToText.label": "como texto",

  "ports.in.label": "Haz esto",
  "ports.next.label": "Después",
  "ports.commandParameter.label": "Lo que respondieron",

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
