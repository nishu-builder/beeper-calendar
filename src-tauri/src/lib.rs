use std::{fs, sync::Mutex, time::Duration};
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_opener::OpenerExt;
// OAuth module is integrated in the follow-up.
const SERVICE: &str = "com.nishubuilder.beepercalendar";
pub fn save_secret_value(service: &str, token: &str) -> Result<(), String> {
    if !["beeper", "github"].contains(&service) { return Err("Unknown credential.".into()); }
    let entry = keyring::Entry::new(SERVICE, service).map_err(|_| "Credential store unavailable.")?;
    if token.is_empty() { entry.delete_credential().or_else(|e| if matches!(e, keyring::Error::NoEntry) { Ok(()) } else { Err(e) }).map_err(|_| "Could not remove credential.".to_string()) }
    else { entry.set_password(token).map_err(|_| "Could not save credential in the system keychain.".to_string()) }
}
fn secret(service: &str) -> Result<String, String> {
    keyring::Entry::new(SERVICE, service).and_then(|e| e.get_password()).map_err(|_| format!("Connect {} in Settings. Its credential is missing or the keychain is locked.", service))
}
#[tauri::command]
fn save_secret(service: String, token: String) -> Result<(), String> { save_secret_value(&service, &token) }
#[tauri::command]
fn credential_status() -> serde_json::Value { serde_json::json!({"beeper":secret("beeper").is_ok(),"github":secret("github").is_ok()}) }
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Request { service: String, base_url: String, path: String, method: String, body: Option<serde_json::Value> }
#[derive(Serialize)]
struct Response { status: u16, body: serde_json::Value }
fn allowed_url(request: &Request) -> Result<url::Url, String> {
    let base = url::Url::parse(&request.base_url).map_err(|_| "Invalid service URL.")?;
    if !base.username().is_empty() || base.password().is_some() || base.query().is_some() || base.fragment().is_some() { return Err("Service URLs cannot contain credentials, queries or fragments.".into()); }
    if !request.path.starts_with('/') || request.path.starts_with("//") || request.path.contains('#') { return Err("Invalid service path.".into()); }
    let parsed = base.join(&request.path).map_err(|_| "Invalid service path.")?;
    if parsed.origin() != base.origin() { return Err("Cross-origin requests are blocked.".into()); }
    let path = parsed.path();
    match request.service.as_str() {
        "github" => {
            if base.as_str() != "https://api.github.com/" || !path.starts_with("/repos/") { return Err("Only the GitHub repository API is supported.".into()); }
            if !["GET", "POST", "PATCH", "PUT"].contains(&request.method.as_str()) { return Err("Unsupported GitHub operation.".into()); }
        },
        "beeper" | "ollama" => {
            if base.scheme() != "http" || !matches!(base.host_str(), Some("localhost" | "127.0.0.1" | "[::1]")) { return Err("Beeper and the model must run locally over a loopback HTTP address.".into()); }
            let allowed = if request.service == "beeper" {
                (request.method == "GET" && (path == "/v1/info" || path == "/v1/messages/search" || path.starts_with("/v1/chats/"))) ||
                (request.method == "POST" && path == "/v1/focus")
            } else {
                (request.method == "GET" && path == "/api/tags") || (request.method == "POST" && path == "/api/chat")
            };
            if !allowed { return Err("This service operation is blocked.".into()); }
        },
        _ => return Err("Unknown service.".into())
    }
    Ok(parsed)
}
#[tauri::command]
async fn service_request(request: Request) -> Result<Response, String> {
    let url = allowed_url(&request)?;
    if request.body.as_ref().map(|v| v.to_string().len()).unwrap_or(0) > 2_000_000 { return Err("Request exceeds the size limit.".into()); }
    let client = reqwest::Client::builder().redirect(reqwest::redirect::Policy::none()).no_proxy()
        .timeout(Duration::from_secs(if request.service == "ollama" { 180 } else { 30 })).build().map_err(|_| "Could not start HTTP client.")?;
    let method = reqwest::Method::from_bytes(request.method.as_bytes()).map_err(|_| "Invalid HTTP method.")?;
    let mut builder = client.request(method, url).header("User-Agent", "Beeper-Calendar/0.1");
    if request.service != "ollama" { builder = builder.bearer_auth(secret(&request.service)?); }
    if request.service == "github" { builder = builder.header("Accept", "application/vnd.github+json").header("X-GitHub-Api-Version", "2022-11-28"); }
    if let Some(body) = request.body { builder = builder.json(&body); }
    let mut response = builder.send().await.map_err(|e| if e.is_timeout() { "Service timed out. Check that it is running, then retry.".to_string() } else { "Could not reach the service. Check its address and connection in Settings.".to_string() })?;
    let status = response.status().as_u16();
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "Interrupted service response.")? {
        if bytes.len() + chunk.len() > 12_000_000 { return Err("Service response exceeds the size limit. Choose a smaller calendar repository.".into()); }
        bytes.extend_from_slice(&chunk);
    }
    let body = serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null);
    // Error bodies can contain secrets or message contents; expose only the HTTP status.
    Ok(Response { status, body: if status >= 400 { serde_json::Value::Null } else { body } })
}
struct StorageLock(Mutex<()>);
fn state_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|_| "Application storage unavailable.")?;
    fs::create_dir_all(&dir).map_err(|_| "Could not create application storage.")?;
    #[cfg(unix)] { use std::os::unix::fs::PermissionsExt; fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).map_err(|_| "Could not protect application storage.")?; }
    Ok(dir.join("state.json"))
}
#[tauri::command]
fn load_state(app: tauri::AppHandle, lock: tauri::State<StorageLock>) -> Result<Option<serde_json::Value>, String> {
    let _guard = lock.0.lock().map_err(|_| "Storage is busy.")?;
    let path = state_path(&app)?;
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map(Some).map_err(|_| "Saved state is unreadable. Preserve the state file before recovery.".into()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err("Could not read saved state.".into())
    }
}
#[tauri::command]
fn save_state(app: tauri::AppHandle, state: serde_json::Value, lock: tauri::State<StorageLock>) -> Result<(), String> {
    use std::io::Write;
    let _guard = lock.0.lock().map_err(|_| "Storage is busy.")?;
    let path = state_path(&app)?;
    let bytes = serde_json::to_vec(&state).map_err(|_| "Invalid state.")?;
    if bytes.len() > 20_000_000 { return Err("Local history is full. Remove completed items before continuing.".into()); }
    let temp = path.with_extension("tmp");
    let mut options = fs::OpenOptions::new(); options.write(true).create(true).truncate(true);
    #[cfg(unix)] { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600); }
    let mut file = options.open(&temp).map_err(|_| "Could not save local state.")?;
    file.write_all(&bytes).and_then(|_| file.sync_all()).map_err(|_| "Could not persist local state.")?;
    fs::rename(&temp, &path).map_err(|_| "Could not commit local state.")?;
    #[cfg(unix)] fs::File::open(path.parent().unwrap()).and_then(|f| f.sync_all()).map_err(|_| "Could not sync application storage.")?;
    Ok(())
}
#[tauri::command]
fn read_clipboard(app: tauri::AppHandle) -> Result<String, String> {
    let text = app.clipboard().read_text().map_err(|_| "Copy a text message in Beeper first.")?;
    if text.len() > 16_000 { return Err("Copy a shorter message (under 16,000 characters).".into()); }
    Ok(text)
}
#[tauri::command]
fn open_link(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let parsed = url::Url::parse(&url).map_err(|_| "Invalid link.")?;
    if parsed.scheme() != "https" || !matches!(parsed.host_str(), Some("github.com" | "calendar.google.com")) { return Err("This external link is not allowed.".into()); }
    app.opener().open_url(url, None::<&str>).map_err(|_| "Could not open your browser.".into())
}
fn show(app: &tauri::AppHandle, capture: bool) {
    if let Some(window) = app.get_webview_window("main") { let _ = window.show(); let _ = window.unminimize(); let _ = window.set_focus(); }
    if capture { let _ = app.emit("capture-message", ()); }
}
pub fn run() {
    tauri::Builder::default()
        .manage(StorageLock(Mutex::new(())))
        .plugin(tauri_plugin_single_instance::init(|app, _, _| show(app, false)))
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().with_handler(|app, _, event| { if event.state() == ShortcutState::Pressed { show(app, true); } }).build())
        .setup(|app| {
            use tauri::menu::{Menu, MenuItem};
            let open = MenuItem::with_id(app, "open", "Open Beeper Calendar", true, None::<&str>)?;
            let capture = MenuItem::with_id(app, "capture", "Use copied message", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &capture, &quit])?;
            let mut tray = tauri::tray::TrayIconBuilder::new().menu(&menu).tooltip("Beeper Calendar").on_menu_event(|app, event| match event.id().as_ref() { "open" => show(app, false), "capture" => show(app, true), "quit" => app.exit(0), _ => {} });
            if let Some(icon) = app.default_window_icon() { tray = tray.icon(icon.clone()); }
            tray.build(app)?;
            if app.global_shortcut().register("CommandOrControl+Shift+K").is_err() {
                let _ = app.emit("shortcut-unavailable", "The shortcut is already in use. Use the menu bar instead.");
            }
            Ok(())
        })
        .on_window_event(|window, event| { if let tauri::WindowEvent::CloseRequested { api, .. } = event { api.prevent_close(); let _ = window.hide(); } })
        .invoke_handler(tauri::generate_handler![service_request, save_secret, credential_status, load_state, save_state, read_clipboard, open_link])
        .run(tauri::generate_context!())
        .expect("Beeper Calendar could not start");
}
#[cfg(test)]
mod tests {
    use super::*;
    fn req(service: &str, base: &str, path: &str, method: &str) -> Request { Request { service: service.into(), base_url: base.into(), path: path.into(), method: method.into(), body: None } }
    #[test] fn rejects_remote_models_and_message_sends() {
        assert!(allowed_url(&req("ollama", "https://example.com", "/api/chat", "POST")).is_err());
        assert!(allowed_url(&req("beeper", "http://localhost:23373", "/v1/chats/x/messages", "POST")).is_err());
        assert!(allowed_url(&req("beeper", "http://localhost:23373", "//evil.test/x", "GET")).is_err());
        assert!(allowed_url(&req("beeper", "http://localhost:23373", "/v1/focus", "POST")).is_ok());
    }
}
