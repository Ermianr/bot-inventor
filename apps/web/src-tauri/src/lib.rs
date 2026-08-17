mod about;
mod export;
mod jail;
mod projects;
mod secrets;
mod session;
mod test_servers;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_opener::init())
    .manage(session::Sessions::default())
    .invoke_handler(tauri::generate_handler![
      about::describe_application,
      about::open_repository,
      export::export_project,
      export::show_export,
      projects::back_up_project,
      projects::create_project,
      projects::delete_project,
      projects::list_projects,
      projects::read_project,
      projects::read_test_server,
      projects::write_project,
      projects::write_test_server,
      secrets::delete_secret,
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
