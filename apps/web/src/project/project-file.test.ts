import type { Migration } from "@bot-inventor/schema"
import { CURRENT_SCHEMA_VERSION } from "@bot-inventor/schema"
import { futureVersionProject, helloProject } from "@bot-inventor/schema/fixtures"
import { describe, expect, it } from "vitest"
import {
  PROJECT_FILE_EXTENSION,
  type ProjectFileSystem,
  readProjectFile,
  serializeProject,
  suggestedFileName,
  writeProjectFile
} from "@/project/project-file"

/** A file system held in memory, recording what was asked of it and in which order. */
function fakeFileSystem(files: Record<string, string> = {}) {
  const calls: string[] = []

  const fileSystem: ProjectFileSystem = {
    read: async path => {
      calls.push(`read ${path}`)
      const contents = files[path]
      if (contents === undefined) throw new Error(`no such file: ${path}`)
      return contents
    },
    write: async (path, contents) => {
      calls.push(`write ${path}`)
      files[path] = contents
    },
    backUp: async path => {
      calls.push(`backUp ${path}`)
      const backup = `${path}.backup`
      files[backup] = files[path] ?? ""
      return backup
    }
  }

  return { fileSystem, files, calls }
}

describe("writing a Project to a .botinv file", () => {
  it("writes a document this build reads back as the same Project", async () => {
    const project = helloProject()
    const { fileSystem, files } = fakeFileSystem()

    await writeProjectFile("C:/bots/hello.botinv", project, fileSystem)
    const reopened = await readProjectFile("C:/bots/hello.botinv", fileSystem)

    expect(reopened.status).toBe("opened")
    expect(reopened.status === "opened" && reopened.project).toEqual(project)
    expect(files["C:/bots/hello.botinv"]).toBeDefined()
  })

  it("writes the Project and nothing else, so no Secret can travel with the file", () => {
    const document = JSON.parse(serializeProject(helloProject()))

    expect(Object.keys(document).sort()).toEqual(["flows", "id", "name", "schemaVersion"])
    expect(serializeProject(helloProject())).not.toMatch(/token|secret/i)
  })

  it("suggests a file name built from the Project's name", () => {
    expect(suggestedFileName(helloProject())).toBe(`hello-bot.${PROJECT_FILE_EXTENSION}`)
    expect(suggestedFileName({ ...helloProject(), name: "  ¡Mi Bot!  " })).toBe(
      `mi-bot.${PROJECT_FILE_EXTENSION}`
    )
    expect(suggestedFileName({ ...helloProject(), name: "***" })).toBe(
      `project.${PROJECT_FILE_EXTENSION}`
    )
  })
})

describe("opening a .botinv file", () => {
  it("restores the Project that was saved", async () => {
    const project = helloProject()
    const { fileSystem } = fakeFileSystem({
      "C:/bots/hello.botinv": serializeProject(project)
    })

    const opened = await readProjectFile("C:/bots/hello.botinv", fileSystem)

    expect(opened).toEqual({ status: "opened", project, migrated: false })
  })

  it("refuses a file that is not JSON at all", async () => {
    const { fileSystem } = fakeFileSystem({ "C:/bots/broken.botinv": "not a project" })

    const opened = await readProjectFile("C:/bots/broken.botinv", fileSystem)

    expect(opened.status).toBe("malformed")
  })

  it("refuses a Project from a newer build without touching the file", async () => {
    const { fileSystem, calls } = fakeFileSystem({
      "C:/bots/future.botinv": JSON.stringify(futureVersionProject())
    })

    const opened = await readProjectFile("C:/bots/future.botinv", fileSystem)

    expect(opened.status).toBe("future-version")
    expect(calls).toEqual(["read C:/bots/future.botinv"])
  })

  it("backs the file up before a migration runs, and never after", async () => {
    const older = { ...helloProject(), schemaVersion: CURRENT_SCHEMA_VERSION }
    const chain: readonly Migration[] = [
      {
        from: CURRENT_SCHEMA_VERSION,
        to: CURRENT_SCHEMA_VERSION + 1,
        migrate: document => ({
          ...(document as object),
          schemaVersion: CURRENT_SCHEMA_VERSION + 1
        })
      }
    ]
    const { fileSystem, calls, files } = fakeFileSystem({
      "C:/bots/older.botinv": JSON.stringify(older)
    })

    const opened = await readProjectFile("C:/bots/older.botinv", fileSystem, {
      chain,
      targetVersion: CURRENT_SCHEMA_VERSION + 1
    })

    expect(opened.status === "opened" && opened.migrated).toBe(true)
    expect(calls).toEqual(["read C:/bots/older.botinv", "backUp C:/bots/older.botinv"])
    expect(files["C:/bots/older.botinv.backup"]).toBe(JSON.stringify(older))
  })
})
