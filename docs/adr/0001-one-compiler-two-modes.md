# One Compiler with two modes, instead of an interpreter in development and codegen in production

Development Mode needs to know which Node is executing and what values travel along each Wire, which invites writing an interpreter that walks the graph live; a Build, in contrast, must produce fast JavaScript with no trace of that instrumentation. We decided that **a single Compiler** emits JavaScript in both cases from the same definition of each Node, and that Development Mode differs only in injecting Tracing. The cost is that the development loop goes through a recompile on every change (hot reload restarts the process). The benefit is that the characteristic failure of these platforms — "works in development, breaks on export" — becomes impossible, because there are not two semantics that can drift apart.

## Consequences

- A Node's visual definition and its code generation live in the same file, under `packages/nodes`. Splitting them would make adding Nodes tedious, and adding Nodes is the product's permanent activity.
- Execution tests of the Compiler, run against a fake Discord client, exercise both modes at once, because there is only one generator.
