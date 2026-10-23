# DISCORD-TEST: manual check against a real server

The network is not part of the automated suite (`ARCHITECTURE.md` §11), so what the adapter does against Discord is checked by hand with this list. Run it when `crates/platform-discord` changes in a way the unit tests cannot show (requests, the gateway, deferral), and before a milestone that depends on the adapter is marked done.

## Set up

1. In the [Developer Portal](https://discord.com/developers/applications) create an application and a bot, **only for testing**. Do not enable any privileged intent: Ping needs none.
2. Invite it to a server you own with the `applications.commands` and `bot` scopes. Copy the server id (Developer Mode, right click, *Copy Server ID*).
3. Make a file outside the repository, for example `~/bot-test.env`, with mode 0600:

   ```sh
   install -m 600 /dev/null ~/bot-test.env
   printf 'DISCORD_TOKEN=<the bot token>\nDISCORD_DEV_GUILD_ID=<the server id>\n' > ~/bot-test.env
   ```

   Never put the token in an argument, a commit, an issue or a screenshot. With `DISCORD_DEV_GUILD_ID` the commands appear at once in that server; without it they are global and can take a while.

The commands used below, from the repository root. The payload is compiled from a sample project, and the runner reads the token from the env file and keeps its data in a throwaway folder:

```sh
cargo run -q -p runtime --example compile -- crates/graph/tests/samples/v1/ping /tmp/ping.payload
export BOT_INVENTOR_ENV_FILE=~/bot-test.env BOT_INVENTOR_DATA_DIR=/tmp/bot-test-data
cargo run -p runner -- --payload /tmp/ping.payload
```

The runner prints JSON lines on standard output (`ARCHITECTURE.md` §9.2) and one `error: ...` line on standard error when it cannot start. `echo $?` after it stops shows the exit code (§9.3).

## Checklist

| # | Do | Expect |
|---|---|---|
| 1 | Start the runner on a server with no commands | A line with `"msg":"commands: 1 created, 0 updated, 0 deleted"` and then one with `listening` |
| 2 | In the server, type `/ping` | The bot answers `Pong!` in a second or two, with no "application did not respond" |
| 3 | Press Ctrl+C, then start it again | The first run ends with a `stopped` line and exit code `0`; the second prints `commands: 0 created, 0 updated, 0 deleted` (a second start sends no change) |
| 4 | Copy the sample (`cp -r crates/graph/tests/samples/v1/ping /tmp/ping-copy`), change the description of the command in `/tmp/ping-copy/flows`, compile it with the `compile` command above into `/tmp/ping-copy.payload`, and start with `--payload /tmp/ping-copy.payload` | `commands: 0 created, 1 updated, 0 deleted`, and the new description shows in Discord |
| 5 | Start again with `/tmp/ping.payload` | `1 updated` again (the description goes back); then remove the command's flow from the copy, compile and start with it, and see `0 created, 0 updated, 1 deleted`, and `/ping` is gone |
| 6 | Deferral: no node takes 2 seconds yet, so in a local build add `tokio::time::sleep(std::time::Duration::from_secs(4)).await;` at the start of `execute` in `crates/runtime/src/nodes/reply.rs`, before the lock (do not commit it), and use `/ping`. A delay in the platform does not work: it runs with the lock held. Setting `DEFER_AFTER` to zero does not show it either, because "thinking" lasts a few milliseconds | From second 2 Discord shows "is thinking" and at second 4 `Pong!` replaces it, with no second message. Remove the sleep afterwards. A node that waits (M14) will replace this step |
| 7 | Set `ephemeral` to `true` on the command node of the copy and use `/ping` | Only you see the reply; with the deferral of row 6 also on, "thinking" is also seen only by you |
| 8 | Put an invalid token in the env file and start | It exits with code `2` and `error: Discord rejected the bot token: check `DISCORD_TOKEN` in `.env``, and the token appears nowhere in the output |
| 9 | Start with `DISCORD_DEV_GUILD_ID=abc` | It exits with code `2` and ``error: `DISCORD_DEV_GUILD_ID` is not a server id``, before it connects |
| 10 | While it listens, send it `SIGTERM` from another terminal (`kill -TERM $(pgrep -x runner)`) and use `/ping` just before | A `stopping` line and a `stopped` line within a few seconds, exit code `0`, and the reply that was on its way was sent |
| 11 | Run the whole session with `> /tmp/runner.log 2>&1` and then `grep -c "$(sed -n 's/^DISCORD_TOKEN=//p' ~/bot-test.env)" /tmp/runner.log` | It prints `0`: the token is in no line |
| 12 | `cargo run -p runner -- --check --payload /tmp/ping.payload` | One `the check passed` line and exit code `0`, with no connection made |

Write the date, the commit and which rows passed in the pull request.
