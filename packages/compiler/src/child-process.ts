import type { ChildProcess } from "node:child_process"

/**
 * The waiting both Export tests do around a real child process. It lives here
 * rather than in either test because an Export that hangs is the interesting
 * failure, and both formats can hang the same way.
 */

export function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, milliseconds).unref()
  })
}

/** Resolves when the child process is gone, describing how it went. */
export function died(child: ChildProcess): Promise<string> {
  return new Promise(resolve => {
    child.once("exit", (code, signal) => resolve(`code ${code}, signal ${signal}`))
    child.once("error", error => resolve(String(error)))
  })
}

/**
 * Kills a child and waits for it to actually be gone. Windows kills
 * asynchronously, and a live process holding a directory open is what makes
 * deleting an Export's folder fail.
 */
export async function stop(child: ChildProcess | undefined): Promise<void> {
  if (child === undefined) return
  child.kill()
  // A process killed by a signal has no exit code, so `exitCode` alone reads a
  // child that is already gone as one still running, and the wait below then
  // sits out its whole timeout listening for an `exit` that has been and gone.
  if (child.exitCode === null && child.signalCode === null) {
    await Promise.race([died(child), delay(10_000)])
  }
}
