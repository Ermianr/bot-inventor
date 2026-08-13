# Memory is a scoped key-value store, not a user-defined table schema

The bots people actually want to build — levels, economies, warnings, per-server configuration — need to remember things between runs, so a product without Memory would be a toy. We decided to expose it as a **key-value store with three Scopes** (Global, Server, User) backed by a local file, and **not** as tables with typed fields that the user defines visually. Tables would double the product: on top of teaching people to build bots, we would have to teach them to model data, with schemas, relationships and migrations of their own.

## Consequences

- The Single File export stops being strictly single at runtime: it creates its Memory file alongside itself on first start. The interface must say so at export time rather than letting the user discover it.
- Cases needing relational queries — leaderboards with complex filters, for instance — are out of scope. The "List by Scope" Node covers simple leaderboards.
- This is hard to reverse backwards: if tables are added later, existing Projects already depend on key-value semantics.
