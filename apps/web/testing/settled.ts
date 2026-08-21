import { act } from "@testing-library/react"

/**
 * Lets React finish what the last render started, before a test acts on it.
 *
 * An element being in the document does not mean the component behind it is
 * ready to be used. A component that wires itself up in a layout effect — which
 * every Base UI popup does, connecting its trigger to the root that owns the
 * open state — is wired one render later than the render that drew it, and that
 * render is scheduled rather than run. `findBy…` hands back the element as soon
 * as it exists, which can be inside that gap: a click that lands there reaches
 * a trigger that is not yet attached to anything, is dropped without a word,
 * and nothing ever retries it. The menu simply never opens.
 *
 * This is what closes the gap: `act` flushes what React has pending instead of
 * waiting to see whether it happens to have finished. It is not a delay, and
 * making it a longer one would not help — the click that fell in the gap is
 * gone, not late.
 *
 * A test needs this between finding a control that has just appeared and using
 * it, and at the end of a test that leaves something unanswered behind it. It
 * does nothing for a control that was already there.
 *
 * It lives outside `src` because it reaches for Testing Library, which this app
 * has as a development dependency: in `src` it would be one stray import away
 * from being something the shipped editor needs and does not have.
 */
export async function settled(): Promise<void> {
  await act(async () => {})
}
