//! Loopback OAuth authorization for Beeper Desktop. Credentials never enter the webview.
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri_plugin_opener::OpenerExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::time::{timeout, Instant};
use url::Url;

static AUTHORIZING: AtomicBool = AtomicBool::new(false);

struct AuthorizationGuard;
impl Drop for AuthorizationGuard {
    fn drop(&mut self) {
        AUTHORIZING.store(false, Ordering::SeqCst);
    }
}

#[derive(Deserialize)]
struct Registration {
    client_id: String,
}

#[derive(Deserialize)]
struct Token {
    access_token: String,
    token_type: String,
}

fn loopback_base(raw: &str) -> Result<Url, String> {
    let mut url = Url::parse(raw).map_err(|_| "Enter Beeper's local HTTP address.".to_owned())?;
    if url.scheme() != "http"
        || !matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"))
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || !matches!(url.path(), "" | "/")
    {
        return Err("Beeper authorization requires an HTTP address on localhost.".into());
    }
    url.set_path("/");
    Ok(url)
}

fn random_secret() -> String {
    URL_SAFE_NO_PAD.encode(rand::random::<[u8; 32]>())
}

fn pkce_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

fn equal_secret(left: &str, right: &str) -> bool {
    left.len() == right.len()
        && left
            .bytes()
            .zip(right.bytes())
            .fold(0u8, |difference, (a, b)| difference | (a ^ b))
            == 0
}

fn callback_code(target: &str, expected_state: &str) -> Result<String, &'static str> {
    // Parse only an origin-form request on the listener's fixed callback path.
    if !target.starts_with("/callback?") {
        return Err("invalid_callback");
    }
    let url = Url::parse(&format!("http://127.0.0.1{target}")).map_err(|_| "invalid_callback")?;
    let pairs: Vec<_> = url.query_pairs().collect();
    let states: Vec<_> = pairs.iter().filter(|(key, _)| key == "state").collect();
    if states.len() != 1 || !equal_secret(&states[0].1, expected_state) {
        return Err("invalid_state");
    }
    if pairs.iter().any(|(key, _)| key == "error") {
        return Err("denied");
    }
    let codes: Vec<_> = pairs.iter().filter(|(key, _)| key == "code").collect();
    if codes.len() != 1 || codes[0].1.is_empty() || codes[0].1.len() > 4096 {
        return Err("invalid_callback");
    }
    Ok(codes[0].1.to_string())
}

async fn request_target(stream: &mut TcpStream) -> Result<String, ()> {
    let mut headers = Vec::new();
    while headers.len() < 16_384 {
        let mut bytes = [0u8; 1024];
        let count = stream.read(&mut bytes).await.map_err(|_| ())?;
        if count == 0 {
            return Err(());
        }
        headers.extend_from_slice(&bytes[..count]);
        if headers.windows(4).any(|window| window == b"\r\n\r\n") {
            let text = std::str::from_utf8(&headers).map_err(|_| ())?;
            let mut parts = text.lines().next().ok_or(())?.split_whitespace();
            if parts.next() != Some("GET") {
                return Err(());
            }
            let target = parts.next().ok_or(())?;
            if !matches!(parts.next(), Some("HTTP/1.1" | "HTTP/1.0")) || parts.next().is_some() {
                return Err(());
            }
            return Ok(target.to_owned());
        }
    }
    Err(())
}

async fn reply(stream: &mut TcpStream, status: &str, body: &str) {
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: default-src 'none'; frame-ancestors 'none'\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = timeout(
        Duration::from_secs(2),
        stream.write_all(response.as_bytes()),
    )
    .await;
}

#[tauri::command]
pub async fn beeper_authorize(app: tauri::AppHandle, base_url: String) -> Result<(), String> {
    if AUTHORIZING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("Beeper authorization is already open. Finish that request first.".into());
    }
    let _guard = AuthorizationGuard;
    let base = loopback_base(&base_url)?;
    let endpoint = |path: &str| base.join(path).expect("fixed OAuth path");
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|_| "Could not initialize Beeper authorization.".to_owned())?;
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|_| "Could not open the local authorization callback.".to_owned())?;
    let port = listener
        .local_addr()
        .map_err(|_| "Could not read the local callback address.".to_owned())?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{port}/callback");
    let registration = client
        .post(endpoint("oauth/register"))
        .json(&serde_json::json!({
            "client_name": "Beeper Calendar",
            "client_uri": "https://github.com/nishu-builder/beeper-calendar",
            "redirect_uris": [redirect_uri],
            "grant_types": ["authorization_code"],
            "response_types": ["code"],
            "token_endpoint_auth_method": "none",
            "scope": "read write"
        }))
        .send()
        .await
        .map_err(|_| {
            "Could not reach Beeper. Open Beeper Desktop and enable its Desktop API.".to_owned()
        })?
        .error_for_status()
        .map_err(|_| {
            "Beeper rejected client registration. Check its Desktop API settings.".to_owned()
        })?
        .json::<Registration>()
        .await
        .map_err(|_| "Beeper returned an invalid registration response.".to_owned())?;
    if registration.client_id.is_empty() {
        return Err("Beeper returned an empty client identifier.".into());
    }
    let state = random_secret();
    let verifier = random_secret();
    let mut authorize_url = endpoint("oauth/authorize");
    authorize_url
        .query_pairs_mut()
        .append_pair("client_id", &registration.client_id)
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("scope", "read write")
        .append_pair("state", &state)
        .append_pair("code_challenge", &pkce_challenge(&verifier))
        .append_pair("code_challenge_method", "S256");
    app.opener()
        .open_url(authorize_url.as_str(), None::<&str>)
        .map_err(|_| "Could not open Beeper's authorization page in your browser.".to_owned())?;
    let deadline = Instant::now() + Duration::from_secs(180);
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(
                "Beeper authorization timed out. Click Connect Beeper to try again.".into(),
            );
        }
        let (mut stream, _) = timeout(remaining, listener.accept())
            .await
            .map_err(|_| {
                "Beeper authorization timed out. Click Connect Beeper to try again.".to_owned()
            })?
            .map_err(|_| "The local authorization callback stopped unexpectedly.".to_owned())?;
        let target = match timeout(Duration::from_secs(3), request_target(&mut stream)).await {
            Ok(Ok(target)) => target,
            _ => {
                reply(
                    &mut stream,
                    "400 Bad Request",
                    "Invalid authorization callback.",
                )
                .await;
                continue;
            }
        };
        let code = match callback_code(&target, &state) {
            Ok(code) => code,
            Err("denied") => {
                reply(
                    &mut stream,
                    "200 OK",
                    "Beeper was not connected. Return to Beeper Calendar to try again.",
                )
                .await;
                return Err("Beeper authorization was declined.".into());
            }
            Err(_) => {
                reply(
                    &mut stream,
                    "400 Bad Request",
                    "This callback does not match the current authorization request.",
                )
                .await;
                continue;
            }
        };
        let token_result = client
            .post(endpoint("oauth/token"))
            .form(&[
                ("grant_type", "authorization_code"),
                ("code", &code),
                ("code_verifier", &verifier),
                ("client_id", &registration.client_id),
                ("redirect_uri", &redirect_uri),
            ])
            .send()
            .await;
        let token = match token_result {
            Ok(response) if response.status().is_success() => response.json::<Token>().await.ok(),
            _ => None,
        };
        let Some(token) = token.filter(|token| {
            !token.access_token.is_empty() && token.token_type.eq_ignore_ascii_case("bearer")
        }) else {
            reply(
                &mut stream,
                "502 Bad Gateway",
                "Beeper could not finish authorization. Return to Beeper Calendar and try again.",
            )
            .await;
            return Err("Beeper could not exchange the authorization code. Connect again.".into());
        };
        if crate::save_secret_value("beeper", &token.access_token).is_err() {
            // Do not leave an orphaned credential active when secure storage fails.
            let _ = client
                .post(endpoint("oauth/revoke"))
                .form(&[("token", token.access_token.as_str())])
                .send()
                .await;
            reply(
                &mut stream,
                "500 Internal Server Error",
                "Beeper Calendar could not save access securely. Return to the app to try again.",
            )
            .await;
            return Err("Could not save Beeper access in the system credential store.".into());
        }
        reply(
            &mut stream,
            "200 OK",
            "Beeper is connected. You can close this tab and return to Beeper Calendar.",
        )
        .await;
        return Ok(());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn authorization_is_loopback_only() {
        for address in [
            "http://127.0.0.1:23373",
            "http://localhost:23373/",
            "http://[::1]:23373/",
        ] {
            assert!(loopback_base(address).is_ok());
        }
        for address in [
            "https://example.com",
            "http://127.0.0.1.evil.test",
            "http://user@localhost",
            "http://localhost/x",
            "http://localhost/?next=evil",
            "http://localhost/#fragment",
        ] {
            assert!(loopback_base(address).is_err());
        }
    }
    #[test]
    fn pkce_matches_rfc7636_vector() {
        assert_eq!(
            pkce_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }
    #[test]
    fn callback_rejects_wrong_or_duplicate_state_and_code() {
        assert_eq!(
            callback_code("/callback?state=secret&code=abc", "secret"),
            Ok("abc".into())
        );
        for target in [
            "/callback?state=wrong&code=abc",
            "/callback?code=abc",
            "/callback?state=secret&state=secret&code=abc",
            "/callback?state=secret&code=abc&code=def",
            "/callback?state=secret&code=",
            "http://evil.test/callback?state=secret&code=abc",
        ] {
            assert!(callback_code(target, "secret").is_err());
        }
    }
    #[test]
    fn decline_requires_matching_state() {
        assert_eq!(
            callback_code("/callback?state=secret&error=access_denied", "secret"),
            Err("denied")
        );
        assert_eq!(
            callback_code("/callback?state=wrong&error=access_denied", "secret"),
            Err("invalid_state")
        );
    }
}
