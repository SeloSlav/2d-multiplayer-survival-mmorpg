//! jwt.rs – Supabase‑token verification (HS256) + optional SpacetimeDB token signing
//!
//! Put this file in `auth-server/src/jwt.rs` (or similar).  
//! It shows **one** way to:
//! 1. fetch & cache your Supabase project's JWK set
//! 2. verify a client‑supplied Supabase session JWT (now HS256)
//! 3. (optionally) mint your own short‑lived HS256 token you can pass to SpacetimeDB
//!
//! ### Cargo.toml additions
//! ```toml
//! [dependencies]
//! anyhow        = "1"
//! chrono        = { version = "0.4", features = ["serde"] }
//! jsonwebtoken  = "9"
//! once_cell     = "1"
//! reqwest       = { version = "0.11", features = ["json", "rustls-tls" ] }
//! serde         = { version = "1", features = ["derive"] }
//! tokio         = { version = "1", features = ["rt-multi-thread", "macros"] }
//! ```

use anyhow::{anyhow, Result};
use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use std::env;
use log;

//──────────────────────────────────────────────────────────────────────────────
// 1. Data structures
//──────────────────────────────────────────────────────────────────────────────
#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,        // user id (Supabase UUID)
    pub email: Option<String>,
    pub exp: usize,         // UTC timestamp (seconds)
    pub role: Option<String>,
    // …add other custom claims you care about
}

//──────────────────────────────────────────────────────────────────────────────
// 2. Verify Supabase JWT (HS256)
//──────────────────────────────────────────────────────────────────────────────
/// Verify a Supabase `access_token` using the shared JWT Secret (HS256).
///
/// * `supabase_jwt_secret` – The secret obtained from Supabase Dashboard -> API Settings.
/// * `token` – the JWT string received in the browser
pub fn verify_supabase_jwt_hs256(supabase_jwt_secret: &str, token: &str) -> Result<Claims> {
    // Use HS256 algorithm for validation
    let mut validation = Validation::new(Algorithm::HS256);
    validation.validate_exp = true;
    validation.validate_aud = false; // Explicitly disable audience check
    // Optional: Validate audience if present in your tokens
    // validation.set_audience(&["authenticated"]); 
    // Optional: Validate issuer if needed
    // validation.set_issuer(&["supabase"]); // Or your specific issuer URL

    log::debug!("Attempting HS256 verification");
    let decoding_key = DecodingKey::from_secret(supabase_jwt_secret.as_bytes());

    match decode::<Claims>(token, &decoding_key, &validation) {
        Ok(token_data) => {
            log::info!("Supabase HS256 token verified successfully for sub: {}", token_data.claims.sub);
            Ok(token_data.claims)
        }
        Err(e) => {
            log::warn!("Supabase HS256 token verification failed: {}", e);
            Err(anyhow!("HS256 token validation failed: {}", e))
        }
    }
}

//──────────────────────────────────────────────────────────────────────────────
// 4. (Optional) Create your own HS256 token for SpacetimeDB
//──────────────────────────────────────────────────────────────────────────────
#[derive(Debug, Serialize, Deserialize)]
struct SpacetimeClaims {
    sub: String,
    iat: usize,
    exp: usize,
}

/// Sign a short‑lived token your game server will accept.
pub fn sign_spacetime_token(secret: &[u8], user_id: &str, ttl_minutes: u64) -> Result<String> {
    let now = Utc::now();
    let claims = SpacetimeClaims {
        sub: user_id.to_string(),
        iat: now.timestamp() as usize,
        exp: (now + Duration::minutes(ttl_minutes as i64)).timestamp() as usize,
    };

    let token = encode(&Header::default(), &claims, &EncodingKey::from_secret(secret))?;
    Ok(token)
}
