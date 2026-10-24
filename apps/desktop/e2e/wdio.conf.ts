import { spawn, type ChildProcess } from "node:child_process";

const URL = "http://localhost:4173";

let preview: ChildProcess | undefined;

async function waitFor(url: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // The server is not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${url} did not answer`);
}

/**
 * End-to-end tests of the renderer in Chrome: the real app on a fake backend (`e2e/main.ts`),
 * served by `vite preview` with the production CSP. `pnpm run e2e` builds it first.
 */
export const config: WebdriverIO.Config = {
  runner: "local",
  specs: ["./specs/**/*.e2e.ts"],
  maxInstances: 1,
  capabilities: [
    {
      browserName: "chrome",
      "goog:chromeOptions": {
        args: ["--headless=new", "--window-size=1500,950", "--hide-scrollbars"],
      },
    },
  ],
  baseUrl: URL,
  logLevel: "warn",
  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: { timeout: 60_000 },
  async onPrepare() {
    const taken = await fetch(URL).then(
      () => true,
      () => false,
    );
    if (taken) {
      throw new Error(`${URL} is in use: stop the server that answers there`);
    }
    // Its own process group, so that stopping it also stops `vite` behind `pnpm`.
    preview = spawn(
      "pnpm",
      ["exec", "vite", "preview", "--mode", "e2e", "--outDir", "dist-e2e"],
      { stdio: "inherit", detached: true },
    );
    await waitFor(`${URL}/e2e/index.html`);
  },
  onComplete() {
    if (preview?.pid !== undefined) process.kill(-preview.pid);
  },
};
