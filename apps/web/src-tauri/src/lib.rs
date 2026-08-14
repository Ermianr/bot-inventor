mod jail;
mod secrets;
mod session;
mod test_servers;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .manage(session::Sessions::default())
    .invoke_handler(tauri::generate_handler![
      secrets::store_secret,
      secrets::secret_exists,
      session::start_session,
      session::stop_session,
      test_servers::list_test_servers
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while running tauri application")
    // Closing the application takes the bot with it. The job object in
    // `jail.rs` is what covers the closes this never sees.
    .run(|app, event| {
      if let tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit = event {
        session::stop_everything(app);
      }
    });
}
