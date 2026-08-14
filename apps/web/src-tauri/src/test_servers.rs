use serde::{Deserialize, Serialize};

use crate::secrets::{self, Refusal};

/// The servers a Project's bot is in, so the user picks their Test Server from
/// a list instead of pasting an id.
///
/// Asking Discord takes the token, which means it happens here: the webview is
/// never sent one. What comes back is a name and an id, and the name is the
/// only reason this exists — an id pasted by hand is a typo away from
/// registering someone's commands on a server they are not looking at.

/// Discord's own maximum for one page of this endpoint.
const PAGE: usize = 200;

/// How many servers we are willing to list. A bot in more servers than this is
/// not a bot being developed on someone's desktop, and the editor keeps its
/// "type the id yourself" way in for exactly that case.
const LIMIT: usize = 1000;

const API: &str = "https://discord.com/api/v10";

/// One server, as the picker shows it.
#[derive(Clone, Serialize)]
pub struct TestServer {
    pub id: String,
    pub name: String,
}

/// The fields we read of what Discord answers with. Everything else it sends
/// about a server is none of the picker's business.
#[derive(Deserialize)]
struct Guild {
    id: String,
    name: String,
}

/// Lists the servers the bot is in, oldest first, as Discord orders them.
///
/// The bot does not have to be running: this is a REST call with the stored
/// token, so the user can choose where to test before ever pressing Run.
#[tauri::command]
pub async fn list_test_servers(project_id: String) -> Result<Vec<TestServer>, Refusal> {
    let token = secrets::read(&project_id)
        .map_err(Refusal::failed)?
        .ok_or(Refusal::MissingSecret)?;

    let client = reqwest::Client::new();
    let mut servers: Vec<TestServer> = Vec::new();

    // Discord pages this endpoint by id: each request asks for what comes after
    // the last server of the previous one.
    loop {
        let after = servers.last().map(|server| server.id.clone());
        let url = match &after {
            Some(id) => format!("{API}/users/@me/guilds?limit={PAGE}&after={id}"),
            None => format!("{API}/users/@me/guilds?limit={PAGE}"),
        };

        let response = client
            .get(url)
            .header("Authorization", format!("Bot {token}"))
            .send()
            .await
            .map_err(|error| Refusal::Failed {
                message: format!("Discord could not be reached: {error}"),
            })?;

        if response.status() == reqwest::StatusCode::UNAUTHORIZED {
            return Err(Refusal::Rejected);
        }
        if !response.status().is_success() {
            return Err(Refusal::Failed {
                message: format!("Discord answered with {}.", response.status()),
            });
        }

        let page: Vec<Guild> = response.json().await.map_err(|error| Refusal::Failed {
            message: format!("Discord's answer could not be read: {error}"),
        })?;
        let complete = page.len() < PAGE;

        servers.extend(page.into_iter().map(|guild| TestServer {
            id: guild.id,
            name: guild.name,
        }));

        if complete || servers.len() >= LIMIT {
            break;
        }
    }

    Ok(servers)
}
