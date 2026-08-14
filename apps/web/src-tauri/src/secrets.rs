use keyring::Entry;

/// Secrets, kept in the operating system keychain and never in the Project.
///
/// A Project is meant to be shared: it is a file the user can send to somebody
/// else, and a bot token inside it would travel with it. So the token is keyed
/// by Project here instead, and the Project file holds nothing but the fact
/// that there is one.
///
/// Nothing in this module hands a Secret to the frontend. The one thing that
/// reads a token is the code that starts a Session, which puts it on the child
/// process's environment and nowhere else.

/// What the keychain lists these entries under, which is what the user sees if
/// they ever open the Windows Credential Manager.
const SERVICE: &str = "Bot Inventor";

fn entry(project_id: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, project_id).map_err(|error| format!("the keychain refused to open: {error}"))
}

/// Reads a Project's bot token. Only the Session start calls this.
pub fn read(project_id: &str) -> Result<Option<String>, String> {
    match entry(project_id)?.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(format!("the keychain could not be read: {error}")),
    }
}

/// Stores a Project's bot token, replacing whatever was there.
#[tauri::command]
pub fn store_secret(project_id: String, secret: String) -> Result<(), String> {
    entry(&project_id)?
        .set_password(&secret)
        .map_err(|error| format!("the token could not be stored: {error}"))
}

/// Whether a Project has a token, without handing it out.
#[tauri::command]
pub fn secret_exists(project_id: String) -> Result<bool, String> {
    Ok(read(&project_id)?.is_some())
}
