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
  "run.failure.flow": "The Flow {flow} stopped: {message}"
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
  "run.failure.flow": "El Flow {flow} se detuvo: {message}"
}

const messages: Record<Locale, Record<MessageKey, string>> = { en, es }

/** The locale the application reads text in, taken from the operating system. */
export function currentLocale(): Locale {
  const preferred = typeof navigator === "undefined" ? "en" : navigator.language.slice(0, 2)
  return LOCALES.find(locale => locale === preferred) ?? "en"
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
