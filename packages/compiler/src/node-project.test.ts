import {
  emptyProject,
  greetingProject,
  helloProject,
  requireFirst
} from "@bot-inventor/schema/fixtures"
import { describe, expect, it } from "vitest"
import {
  ENTRY_FILE_NAME,
  type GeneratedFile,
  renderNodeProject,
  TOKEN_VARIABLE
} from "./node-project.js"

/**
 * The fast seam for the Node Project format: what the files say, without a disk
 * or an `npm install` anywhere near it. Whether the folder actually runs is a
 * question only `export-node-project.test.ts` can answer.
 */

const DEPENDENCIES = { "discord.js": "^14.27.0", dotenv: "^17.4.2" }

function render(project = helloProject()): readonly GeneratedFile[] {
  return renderNodeProject(project, { dependencies: DEPENDENCIES })
}

function fileAt(files: readonly GeneratedFile[], path: string): string {
  const file = files.find(candidate => candidate.path === path)
  if (file === undefined) {
    throw new Error(`the Export has no ${path}, only: ${files.map(f => f.path).join(", ")}`)
  }
  return file.contents
}

describe("the folder a Node Project Export writes", () => {
  it("splits the source across files a person can navigate", () => {
    expect(render().map(file => file.path)).toEqual([
      "package.json",
      ENTRY_FILE_NAME,
      "src/flows/hello.js",
      ".env.example",
      ".gitignore",
      "README.md"
    ])
  })

  it("gives each Flow its own file, named after the Flow", () => {
    const project = helloProject()
    const flow = requireFirst(project.flows, "Flow")
    flow.name = "Welcome New Members"

    const paths = render(project).map(file => file.path)

    expect(paths).toContain("src/flows/welcome-new-members.js")
  })

  it("keeps two Flows of the same name in files of their own", () => {
    const project = helloProject()
    const flow = requireFirst(project.flows, "Flow")
    const other = requireFirst(greetingProject().flows, "Flow")
    project.flows = [flow, { ...other, name: flow.name }]

    const paths = render(project).map(file => file.path)

    expect(paths).toContain("src/flows/hello.js")
    expect(paths).toContain("src/flows/hello-2.js")
  })

  it("leaves out a Flow with no Trigger, as the Build does", () => {
    const files = render(emptyProject())

    expect(files.map(file => file.path)).not.toContain("src/flows/main.js")
    expect(fileAt(files, ENTRY_FILE_NAME)).toContain("no Flow with a Trigger")
  })
})

describe("the entry point", () => {
  it("declares every Flow on the Runtime and then starts it", () => {
    const entry = fileAt(render(), ENTRY_FILE_NAME)

    expect(entry).toContain('import { defineHello } from "./src/flows/hello.js"')
    expect(entry).toContain("defineHello(runtime)")
    expect(entry).toContain("await runtime.start()")
  })

  it("reads the token from the environment rather than carrying one", () => {
    expect(fileAt(render(), ENTRY_FILE_NAME)).toContain(`process.env.${TOKEN_VARIABLE}`)
  })

  it("imports the Runtime from beside it rather than from npm", () => {
    // The Runtime is not published, so an Export that asked npm for it would be
    // a folder that never installs.
    expect(fileAt(render(), ENTRY_FILE_NAME)).toContain('from "./src/runtime/index.js"')
  })
})

describe("the package.json", () => {
  it("asks for the dependencies the bot actually needs, and no others", () => {
    const manifest = JSON.parse(fileAt(render(), "package.json")) as {
      name: string
      type: string
      scripts: Record<string, string>
      dependencies: Record<string, string>
    }

    expect(manifest.dependencies).toEqual(DEPENDENCIES)
    expect(manifest.type).toBe("module")
    expect(manifest.scripts.start).toBe(`node ${ENTRY_FILE_NAME}`)
  })

  it("names the package after the Project, in a form npm accepts", () => {
    const project = helloProject()
    project.name = "Kevin's Bot!"

    const manifest = JSON.parse(fileAt(render(project), "package.json")) as { name: string }

    expect(manifest.name).toBe("kevin-s-bot")
  })
})

describe("the configuration a person has to fill in", () => {
  it("documents the token as required in .env.example", () => {
    const example = fileAt(render(), ".env.example")

    expect(example).toContain(`${TOKEN_VARIABLE}=`)
    expect(example).toContain("Required")
  })

  it("documents the optional variables commented out, so an empty one is never read", () => {
    // An empty DISCORD_API_URL is read as a base URL by anything less careful
    // than the Runtime, so it must not arrive uncommented.
    expect(fileAt(render(), ".env.example")).toContain("# DISCORD_API_URL=")
  })

  it("keeps the filled-in .env out of version control", () => {
    expect(fileAt(render(), ".gitignore")).toContain(".env")
  })

  it("explains in the README how to install, configure and run the bot", () => {
    const readme = fileAt(render(), "README.md")

    expect(readme).toContain("npm install")
    expect(readme).toContain("npm start")
    // The product is a Windows app, so the setup step must not be a command
    // that only exists on someone else's shell.
    expect(readme).not.toContain("cp .env.example")
    expect(readme).toContain(TOKEN_VARIABLE)
    expect(readme).toContain("src/flows/hello.js")
  })
})

describe("what the generated source must never contain", () => {
  it("carries no Tracing instrumentation", () => {
    const sources = render(greetingProject())
      .map(file => file.contents)
      .join("\n")

    expect(sources).not.toContain("node-entered")
    expect(sources).not.toContain("value-produced")
  })
})
