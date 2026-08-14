import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { bundleDevelopmentRuntime } from "@bot-inventor/compiler/export"

/**
 * Everything the Tauri side needs on disk before it can run a bot: the pinned
 * Node.js sidecar, and the Runtime a Session runs against.
 *
 * Both are inputs to packaging rather than things built at Run time, and both
 * are deliberately kept out of git — one is 50MB of somebody else's binary, the
 * other is a build artifact. Running this before `tauri dev` or `tauri build`
 * is what puts them there.
 */

/**
 * The Node.js every Session runs on. ADR 0002 says to move it deliberately:
 * raising this line changes the runtime underneath every user's bot in
 * development, so it is a decision, not a refresh.
 */
const NODE_VERSION = "22.20.0"

/** The only platform v1 ships on, which is also the only sidecar we package. */
const DEFAULT_TARGET_TRIPLE = "x86_64-pc-windows-msvc"

const here = dirname(fileURLToPath(import.meta.url))
const tauri = join(here, "..", "apps", "web", "src-tauri")

await main()

async function main(): Promise<void> {
  await ensureNodeSidecar()
  await ensureDevelopmentRuntime()
}

/**
 * Downloads the pinned Node.js and puts it where Tauri expects a sidecar: a
 * binary whose name ends in the target triple it was built for.
 *
 * A sidecar that is already there is left alone, so this is cheap enough to run
 * before every `tauri dev`.
 */
async function ensureNodeSidecar(): Promise<void> {
  const triple = await targetTriple()
  const binaries = join(tauri, "binaries")
  const path = join(binaries, `node-${triple}.exe`)

  if (await exists(path)) {
    console.log(`The Node.js ${NODE_VERSION} sidecar is already in place.`)
    return
  }

  const archive = `node-v${NODE_VERSION}-win-x64.zip`
  const url = `https://nodejs.org/dist/v${NODE_VERSION}/${archive}`
  console.log(`Downloading ${url} ...`)

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Node.js ${NODE_VERSION} could not be downloaded: ${response.status}.`)
  }
  const downloaded = Buffer.from(await response.arrayBuffer())
  await verify(downloaded, archive)

  const staging = await mkdtemp(join(tmpdir(), "bot-inventor-sidecar-"))
  try {
    const zip = join(staging, archive)
    await writeFile(zip, downloaded)
    await extract(zip, staging)

    await mkdir(binaries, { recursive: true })
    await writeFile(
      path,
      await readFile(join(staging, `node-v${NODE_VERSION}-win-x64`, "node.exe"))
    )
    console.log(`The Node.js ${NODE_VERSION} sidecar is at ${path}.`)
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

/**
 * Checks the download against the checksums published beside it.
 *
 * They come from the same server as the archive, so this is not a defence
 * against nodejs.org itself: it catches a truncated or corrupted download,
 * which is the failure that actually happens and which would otherwise turn
 * into a sidecar that cannot start with no explanation.
 */
async function verify(archive: Buffer, name: string): Promise<void> {
  const response = await fetch(`https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt`)
  if (!response.ok) {
    throw new Error(`The checksums for Node.js ${NODE_VERSION} could not be read.`)
  }

  const published = (await response.text())
    .split("\n")
    .map(line => line.trim().split(/\s+/))
    .find(([, file]) => file === name)?.[0]

  if (published === undefined) {
    throw new Error(`Node.js ${NODE_VERSION} publishes no checksum for ${name}.`)
  }

  const actual = createHash("sha256").update(archive).digest("hex")
  if (actual !== published) {
    throw new Error(`The download of ${name} is not what nodejs.org published for it.`)
  }
}

/** Bundles the Runtime into the resource a Session's entry point imports. */
async function ensureDevelopmentRuntime(): Promise<void> {
  const bundle = await bundleDevelopmentRuntime({
    outputDirectory: join(tauri, "resources")
  })
  console.log(`The Runtime for Development Mode is at ${bundle.path} (${bundle.bytes} bytes).`)
}

/**
 * The triple Tauri names a sidecar after. It has to be the one the Rust
 * toolchain will build for, so it is asked rather than assumed — except when
 * there is no toolchain to ask, where the only platform v1 targets is the
 * answer.
 */
async function targetTriple(): Promise<string> {
  try {
    const rustc = Bun.spawn(["rustc", "-vV"], { stdout: "pipe", stderr: "ignore" })
    const reported = /^host:\s*(\S+)$/m.exec(await new Response(rustc.stdout).text())?.[1]
    if (reported !== undefined) return reported
  } catch {
    // No Rust toolchain on this machine. Packaging needs one, but bundling the
    // Runtime alone does not, and failing here would block that.
  }
  return DEFAULT_TARGET_TRIPLE
}

async function extract(archive: string, into: string): Promise<void> {
  // Windows can unzip on its own, which saves pulling in a dependency for the
  // one thing this script cannot do itself. Both obvious ways of asking it are
  // avoided on purpose: `tar` is bsdtar on Windows but GNU tar — which does not
  // read zips — on a machine with Git earlier on the PATH, and Expand-Archive
  // lives in a module that a developer's PowerShell may fail to autoload. The
  // .NET call below is neither.
  const extracted = Bun.spawn(
    [
      "powershell",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory('${archive}', '${into}')`
    ],
    { stdout: "inherit", stderr: "inherit" }
  )
  if ((await extracted.exited) !== 0) {
    throw new Error(`${archive} could not be extracted.`)
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}
