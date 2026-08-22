import { createFileRoute } from "@tanstack/react-router"

/**
 * The Project editor's Route, with no component on it. What it draws lives in
 * `projects.$projectId.lazy.tsx` so that the Canvas, the Console and
 * `@xyflow/react` are fetched when a Project is opened rather than sitting in
 * the bundle the Dashboard loads. Splitting is declared here because the Bun
 * build has no `@tanstack/router-plugin` to infer it.
 */
export const Route = createFileRoute("/projects/$projectId")({})
