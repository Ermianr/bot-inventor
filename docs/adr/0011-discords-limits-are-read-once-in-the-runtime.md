# Discord's limits are read once, in the Runtime

Discord refuses an Embed for being too long in eight different ways, and a bot that is refused says nothing a person can use: the message never appears, and what comes back is a `400`. Four places in this repository have a reason to know those numbers — the text box the user is typing into, the Node drawing what is wrong with itself, the check that refuses a Run before the Session starts, and the generated code that actually sends the thing. Written out four times, they drift, and the way they drift is the worst one: the editor lets the user build something the bot then refuses, or refuses something the bot would have sent.

The alternative we rejected was to keep the numbers where each reader wants them and test that they agree. A test that compares two constants passes right up until somebody adds a ninth limit to one of them.

We decided instead that **Discord's limits are read once, in the Runtime**, as `EMBED_LIMITS` and one `checkEmbed` that reports every problem as a value. `embeds.build` — what generated code calls — builds and then checks, so the exported bot enforces exactly what the editor enforced. The editor calls the same `checkEmbed` on the Embed the Node describes.

## Consequences

- `packages/nodes` depends on `@bot-inventor/runtime`, which inverts the layering the package list implies — the Runtime is described as what generated code consumes. It is a constants-and-types import through the `@bot-inventor/runtime/embed` subpath, which pulls in no discord.js, and the editor imports the same subpath so the browser bundle does not grow a Discord client. The alternative was a fifth package holding nothing but numbers, which is a package to explain rather than a dependency to explain.
- The builder no longer cuts anything down to size. Truncating is what hid the problem: a title silently shortened is a bot that ran and said the wrong thing. What is over a limit is reported, and the run stops.
- A problem is a value, not a sentence, because its two readers speak differently: the bot says it in English down the Failure Port, where there is nothing to translate with, and the editor says it in the user's own language. Adding a problem kind means adding both readings.
- A Node can say what is wrong with what was typed into it, through `problems(fields)`. The Embed Node is the first, and nothing about the mechanism is the Embed's.
- What the editor can check is only what does not depend on a Wire, so a Slot counts as the one character it is worth at the least — the same arithmetic the character count in the text box uses, so the Node never calls a field too long that the count says is not. What the Wire actually carries is checked when it arrives, and a run stopped there ends the Flow and records the reason.
