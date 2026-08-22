// `bunfig.toml` loads plugins by specifier and takes the default export, so the
// pass declared in `react-compiler.ts` is re-exported here as one.
export { reactCompilerBunPlugin as default } from "./react-compiler.ts"
