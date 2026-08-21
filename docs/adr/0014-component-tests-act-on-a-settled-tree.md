# Component tests act on a settled tree

`dashboard.test.tsx` failed now and then, and only when the whole workspace ran at once. The failure was always the same: the menu in the corner of a card was clicked, the menu never opened, and the entry the test then looked for never appeared. On its own the file passed every time.

Two things were wrong, and only the second one was the cause.

The first is that `apps/web` had no `setupFiles`, so `globalThis.IS_REACT_ACT_ENVIRONMENT` was never set. Every `act()` in every component test printed "The current testing environment is not configured to support act(...)" and then did not do the thing its name says: React leaves the work the scope caused to whatever the scheduler gets round to rather than flushing it before handing back. That is now set once, for every test in the app, and the warning is gone.

The second is what the failure actually was. A Base UI popup attaches its trigger to the root that owns the open state in a layout effect, one render after the render that drew the trigger — and that follow-up render is scheduled, not run on the spot. The Dashboard's cards arrive with the list, which the store answers asynchronously, so `findByTestId` hands back the menu button the moment it is in the document, which can be inside that gap. A click that lands there reaches a trigger attached to nothing: Base UI drops it silently, nothing retries, and the menu stays shut for good. A loaded machine loses that race more often, which is why the whole workspace running at once was what showed it.

So we decided that **a test interacts with a control only once React has finished with it**. `settled()` — an empty `await act()` — is what a test puts between finding a control that has just appeared and using it. It flushes what React has pending; it is not a delay.

## Consequences

- **A longer timeout would never have fixed this.** The click that fell in the gap is gone rather than late, and the entry it would have drawn is never coming. Anything that only waits longer is waiting for something that will not happen.
- **`act()` means what it says now, everywhere in `apps/web`.** The flag is set for the whole app rather than for the one test that noticed, because every test that renders a component was relying on it.
- **`settled()` is for a control that has just appeared.** A control that was already on the screen when the test found it needs nothing, and adding it everywhere would be cargo cult rather than care.
- **A test owns what it started.** With the flag set, an update that lands after the test that caused it has ended is no longer silent — React says so. A test that deliberately looks at the screen before the store has answered ends with `settled()` too, so that the answer arrives while the test that asked for it is still the one running.
- **This is a hazard of testing, not a bug the user can meet.** In a browser React commits the follow-up render before it paints, so there is no moment where a person can press a button that is not yet attached.
