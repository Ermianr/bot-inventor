# A Reload is something the user asks for

While a Session runs, the editor rebuilds the user's bot on its own: 400 ms after the last edit that changes the generated code, the running bot is killed and another one takes its place. The code that does it says so in prose — that it is there rather than on a button "because the user is meant to never think about it". That was the wrong reading of the problem. The user does think about it, because they can see it: the bot they were about to try disappears at a moment they did not pick, and a long editing session spends dozens of gateway connections nobody asked for.

We decided instead that **a Reload is something the user asks for**. The editor keeps watching the Project and, when the running bot no longer matches it, says so — the Session is an Outdated Session — but nothing is replaced until the user presses Reload. The automatic path is removed rather than made optional.

The trade-off is immediacy. An edit no longer reaches Discord by itself, and the user who forgets to Reload is testing yesterday's bot. We buy, with that, the thing only the user knows: when their bot is allowed to drop off Discord.

The first alternative we rejected was reloading only the Nodes that changed. The Compiler translates a whole Project, and a partially applied Project is a bot running code that matches no state of the Canvas — including states the user never had. There is no version of it that is cheap and honest at once.

The second was keeping the automatic reload as a user preference. Two reload models are two mental models, two test paths, and a question a new user has no way to answer on the day they are asked it.

## Consequences

- **Reload is the third thing the user does to a running bot**, beside Run and Stop, and it lives where those live. It has meaning only while a Session is running and could actually be replaced: with nothing running there is only Run, and a bot still connecting is not interrupted to start another.
- **Outdated is a state of the Session, not of the Project.** The Project is never behind — the application keeps it up to date and it is never saved. What has fallen behind is the bot, which is why "Pending Changes" was rejected as a name for this: nothing about the Project is pending.
- **Being outdated is not being broken.** A bot that needs reloading is alive and answering on Discord, and the editor has to say both things at once, so that "needs reloading" is never read as "crashed".
- **An edit that undoes itself ends the Outdated Session.** What makes a Session outdated is the running bot differing from the Project, not the fact that something was typed — so a Node dragged across the Canvas changes nothing, and an edit undone puts the Session back to matching.
- **A Project that cannot compile cannot be reloaded.** The running bot is left alone while the edit is broken, because it is the working bot the user is still testing against, and the reason the Reload is unavailable is written where they can read it rather than hidden behind a hover.
- **A Reload is one bot replacing another, not a Session ending.** The Console keeps everything it said and marks the seam, so the old bot's last words and the new one's first are readable together; the Canvas drops the previous bot's Run, whose values belong to code that no longer exists.
