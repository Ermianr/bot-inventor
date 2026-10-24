/**
 * The entry the end-to-end tests load instead of `src/main.ts`. It puts a fake backend where Tauri
 * would be and then starts the real app, so the app itself carries no test code. It is built only
 * in `--mode e2e` (`vite.config.ts`) and is never part of the app that ships.
 */

import { installFakeBackend } from "./fakeBackend";

installFakeBackend();
await import("../src/main");
