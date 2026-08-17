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
  "run.token.label": "Bot token",
  "run.token.placeholder": "Paste the token from the Discord Developer Portal",
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

  "console.title": "Console",
  "console.tab.output": "Output",
  "console.empty": "Nothing yet. Press Run.",
  "console.collapse": "Hide the console",
  "console.expand": "Show the console",

  "menu.project": "Project",
  "menu.project.dashboard": "All my bots",
  "menu.view": "View",
  "menu.help": "Help",

  "dashboard.title": "Your bots",
  "dashboard.subtitle": "Everything you have built. Pick one to carry on with it.",
  "dashboard.create": "New bot",
  "dashboard.example": "Open an example",
  "dashboard.example.title": "Open the example",
  "dashboard.example.description":
    "It arrives as a bot of your own, already built, for you to take apart. It needs a token to run, like any other.",
  "dashboard.example.name": "Example bot",
  "dashboard.empty.title": "You have not built a bot yet.",
  "dashboard.empty.body":
    "Make one from scratch, or open the example and take it apart to see how it works.",
  "dashboard.card.changed": "Last changed {when}",
  "dashboard.card.unreadable": "This bot could not be read",
  "dashboard.create.title": "Make a bot",
  "dashboard.create.description":
    "Bot Inventor keeps it for you. You will not be asked where to put it.",
  "dashboard.create.name": "What is it called?",
  "dashboard.create.confirm": "Make it",
  "dashboard.create.cancel": "Cancel",
  "dashboard.create.tokenRequired": "Paste a bot token. Without one your bot cannot run.",
  "dashboard.card.manage": "What to do with this bot",
  "dashboard.card.rename": "Rename",
  "dashboard.card.duplicate": "Make a copy",
  "dashboard.card.delete": "Delete",
  "dashboard.rename.title": "Rename this bot",
  "dashboard.rename.description":
    "Only the name changes. Everything you have built stays as it is.",
  "dashboard.rename.name": "What is it called?",
  "dashboard.rename.confirm": "Rename it",
  "dashboard.rename.cancel": "Cancel",
  "dashboard.rename.nameRequired": "Give your bot a name, so you can tell it from the others.",
  "dashboard.duplicate.name": "{name} (copy)",
  "dashboard.delete.title": "Delete {name}?",
  "dashboard.delete.body":
    "Everything in this bot goes with it, along with its token. This cannot be undone.",
  "dashboard.delete.confirm": "Delete it",
  "dashboard.delete.cancel": "Keep it",
  "dashboard.problem.list": "Your bots could not be listed: {message}",
  "dashboard.problem.create": "This bot could not be made: {message}",
  "dashboard.problem.rename": "This bot could not be renamed: {message}",
  "dashboard.problem.duplicate": "This bot could not be copied: {message}",
  "dashboard.problem.delete": "This bot could not be deleted: {message}",

  "about.menu": "About",
  // The product's name is filled in rather than written into the sentence, so
  // that renaming it is one edit and not one per language.
  "about.title": "About {name}",
  "about.description": "What this application is, and which version of it you are running.",
  "about.name": "Application",
  "about.version": "Version",
  "about.licence": "Licence",
  "about.node": "The Node.js it runs your bot on",
  "about.repository": "Where its code lives",
  // Shown in place of anything only the installed application can answer, which
  // is what the editor running in a browser cannot.
  "about.unknown": "Unknown",
  "about.close": "Close",

  "theme.title": "Theme",
  "theme.light": "Light",
  "theme.dark": "Dark",
  "theme.system": "System",

  "minimap.title": "Minimap",
  // What the picture in the corner is, for anyone who cannot see it.
  "minimap.label": "Minimap of this flow",

  "project.untitled": "Untitled bot",
  "project.flow.default": "Main",
  "project.token.help":
    "Your bot signs in to Discord with this. Make an application on the Discord Developer Portal, add a bot to it, and copy the token it gives you.",
  "project.token.present": "A token is stored for this bot. Paste a new one to replace it.",
  "project.token.absent": "No token is stored for this bot yet.",
  "project.options.title": "Bot settings",
  "project.options.description":
    "How this bot signs in to Discord, and where you try it out. Nothing here is written into the bot you share.",
  "project.options.done": "Done",
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
  "export.show": "Open folder",
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
  "canvas.addNode": "Add a node",
  "canvas.addNode.help": "Search for a node and press Enter to put it where you clicked.",
  "canvas.addNode.search": "Search for a node",
  "canvas.addNode.noMatch": "No node matches that.",
  "canvas.addNode.group.triggers": "Starts a flow",
  "canvas.addNode.group.rest": "Everything else",
  "canvas.node.remove": "Delete this node",
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

  "catalogue.rejected.triggerTaken": "This flow already has something that starts it.",

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
  "run.token.label": "Token del bot",
  "run.token.placeholder": "Pega el token del portal de desarrolladores de Discord",
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

  "console.title": "Consola",
  "console.tab.output": "Salida",
  "console.empty": "Nada todavía. Pulsa Ejecutar.",
  "console.collapse": "Ocultar la consola",
  "console.expand": "Mostrar la consola",

  "menu.project": "Proyecto",
  "menu.project.dashboard": "Todos mis bots",
  "menu.view": "Ver",
  "menu.help": "Ayuda",

  "dashboard.title": "Tus bots",
  "dashboard.subtitle": "Todo lo que has construido. Elige uno para seguir con él.",
  "dashboard.create": "Nuevo bot",
  "dashboard.example": "Abrir un ejemplo",
  "dashboard.example.title": "Abrir el ejemplo",
  "dashboard.example.description":
    "Llega como un bot tuyo, ya construido, para que lo desarmes. Necesita un token para ejecutarse, como cualquier otro.",
  "dashboard.example.name": "Bot de ejemplo",
  "dashboard.empty.title": "Todavía no has construido ningún bot.",
  "dashboard.empty.body":
    "Haz uno desde cero, o abre el ejemplo y desármalo para ver cómo funciona.",
  "dashboard.card.changed": "Cambiado por última vez el {when}",
  "dashboard.card.unreadable": "Este bot no se pudo leer",
  "dashboard.create.title": "Crear un bot",
  "dashboard.create.description": "Bot Inventor lo guarda por ti. No te preguntará dónde ponerlo.",
  "dashboard.create.name": "¿Cómo se llama?",
  "dashboard.create.confirm": "Crearlo",
  "dashboard.create.cancel": "Cancelar",
  "dashboard.create.tokenRequired": "Pega un token de bot. Sin uno, tu bot no puede ejecutarse.",
  "dashboard.card.manage": "Qué hacer con este bot",
  "dashboard.card.rename": "Cambiar el nombre",
  "dashboard.card.duplicate": "Hacer una copia",
  "dashboard.card.delete": "Eliminar",
  "dashboard.rename.title": "Cambiar el nombre de este bot",
  "dashboard.rename.description":
    "Solo cambia el nombre. Todo lo que has construido se queda como está.",
  "dashboard.rename.name": "¿Cómo se llama?",
  "dashboard.rename.confirm": "Cambiarlo",
  "dashboard.rename.cancel": "Cancelar",
  "dashboard.rename.nameRequired": "Ponle un nombre a tu bot, para distinguirlo de los demás.",
  "dashboard.duplicate.name": "{name} (copia)",
  "dashboard.delete.title": "¿Eliminar {name}?",
  "dashboard.delete.body":
    "Todo lo que hay en este bot se va con él, y su token también. Esto no se puede deshacer.",
  "dashboard.delete.confirm": "Eliminarlo",
  "dashboard.delete.cancel": "Conservarlo",
  "dashboard.problem.list": "Tus bots no se pudieron listar: {message}",
  "dashboard.problem.create": "Este bot no se pudo crear: {message}",
  "dashboard.problem.rename": "Este bot no se pudo renombrar: {message}",
  "dashboard.problem.duplicate": "Este bot no se pudo copiar: {message}",
  "dashboard.problem.delete": "Este bot no se pudo eliminar: {message}",

  "about.menu": "Acerca de",
  "about.title": "Acerca de {name}",
  "about.description": "Qué es esta aplicación y qué versión tienes.",
  "about.name": "Aplicación",
  "about.version": "Versión",
  "about.licence": "Licencia",
  "about.node": "El Node.js con el que ejecuta tu bot",
  "about.repository": "Dónde vive su código",
  "about.unknown": "Desconocido",
  "about.close": "Cerrar",

  "theme.title": "Tema",
  "theme.light": "Claro",
  "theme.dark": "Oscuro",
  "theme.system": "Sistema",

  "minimap.title": "Minimapa",
  "minimap.label": "Minimapa de este flujo",

  "project.untitled": "Bot sin nombre",
  "project.flow.default": "Principal",
  "project.token.help":
    "Tu bot inicia sesión en Discord con esto. Crea una aplicación en el portal de desarrolladores de Discord, añádele un bot y copia el token que te dé.",
  "project.token.present": "Este bot ya tiene un token guardado. Pega uno nuevo para reemplazarlo.",
  "project.token.absent": "Este bot todavía no tiene un token guardado.",
  "project.options.title": "Ajustes del bot",
  "project.options.description":
    "Cómo inicia sesión este bot en Discord y dónde lo pruebas. Nada de esto se escribe en el bot que compartes.",
  "project.options.done": "Listo",
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
  "export.show": "Abrir carpeta",
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
  "canvas.addNode": "Añadir un nodo",
  "canvas.addNode.help": "Busca un nodo y pulsa Enter para ponerlo donde hiciste clic.",
  "canvas.addNode.search": "Busca un nodo",
  "canvas.addNode.noMatch": "Ningún nodo coincide.",
  "canvas.addNode.group.triggers": "Empieza un flujo",
  "canvas.addNode.group.rest": "Todo lo demás",
  "canvas.node.remove": "Eliminar este nodo",
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

  "catalogue.rejected.triggerTaken": "Este flujo ya tiene algo que lo inicia.",

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
