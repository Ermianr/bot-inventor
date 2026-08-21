/**
 * What every unit test of the editor runs before it starts.
 *
 * React only treats `act()` as `act()` when it is told it is being tested, and
 * this flag is what tells it. Without it, `act()` prints "The current testing
 * environment is not configured to support act(...)" and then leaves the work
 * the scope caused to whatever the scheduler gets round to, rather than
 * flushing it before it hands back. Every `act()` in every component test here
 * was that: a scope that read as "and now React has caught up" and did nothing
 * of the kind.
 *
 * It is set here rather than in the one test that noticed, because it is true
 * of every test in this app that renders a component. What that test was
 * actually failing on is written down in ADR 0014, along with this.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true

// The empty export is what makes this file a module, which `declare global` needs.
// oxlint-disable-next-line unicorn/require-module-specifiers
export {}
