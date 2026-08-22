/**
 * Side-effect imports of stylesheets, which the bundler resolves and TypeScript
 * otherwise refuses. `vite/client` used to declare this; the Bun build ships no
 * equivalent, so it is declared here.
 */
declare module "*.css" {}
