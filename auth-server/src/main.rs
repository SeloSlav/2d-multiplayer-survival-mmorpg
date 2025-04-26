//! auth-server/src/main.rs
//!
//! Axum‑powered micro‑service that:
//! 1. accepts a Supabase `access_token` (POST /verify)
//! 2. verifies it via `jwt::verify_supabase_jwt`
//! 3. mints a short‑lived HS256 token for SpacetimeDB (optional)
//!
//! Environment variables (put in a `.env` next to Cargo.toml):
//! ```env
//! SUPABASE_PROJECT_URL=https://abcd.supabase.co
//! SPACETIME_SECRET=super‑secret‑key
//! TOKEN_TTL_MINUTES=120         # optional, default 120
//! BIND_ADDR=0.0.0.0:4000        # optional
//! ```

mod jwt;

use axum::{routing::{get, post}, Json, Router, http::Method};
use jwt::{sign_spacetime_token, verify_supabase_jwt_hs256, Claims};
use serde::{Deserialize, Serialize};
use std::env;
use std::net::SocketAddr;
use tokio::net::TcpListener;
use tower_http::cors::{CorsLayer, Any};
use log;
use env_logger;

#[derive(Debug, Deserialize)]
struct VerifyReq {
    token: String,
}

#[derive(Debug, Serialize)]
struct VerifyResp {
    user_id: String,
    email: Option<String>,
    spacetime_token: String,
    expires_in: u64,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    let bind_addr: SocketAddr = env::var("BIND_ADDR")
        .unwrap_or_else(|_| "0.0.0.0:4000".to_string())
        .parse()?;

    let cors = CorsLayer::new()
        .allow_origin("http://localhost:3008".parse::<axum::http::HeaderValue>().unwrap())
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers(Any);

    let router = Router::new()
        .route("/verify", post(verify_handler))
        .route("/health", get(|| async { "ok" }))
        .layer(cors);

    log::info!("Auth-server starting, listening on http://{}", bind_addr);
    let listener = TcpListener::bind(bind_addr).await?;
    axum::serve(listener, router).await?;
    Ok(())
}

async fn verify_handler(Json(body): Json<VerifyReq>) -> Result<Json<VerifyResp>, (axum::http::StatusCode, String)> {
    log::info!("Received /verify request");
    let secret = env::var("SPACETIME_SECRET").map_err(|e| {
        log::error!("Missing SPACETIME_SECRET: {}", e);
        internal_err(e)
    })?;
    let supabase_secret = env::var("SUPABASE_JWT_SECRET").map_err(|e| {
        log::error!("Missing SUPABASE_JWT_SECRET: {}", e);
        internal_err(e)
    })?;
    let ttl: u64 = env::var("TOKEN_TTL_MINUTES").ok().and_then(|v| v.parse().ok()).unwrap_or(120);

    let claims: Claims = match verify_supabase_jwt_hs256(&supabase_secret, &body.token) {
        Ok(c) => {
            c
        }
        Err(e) => {
            return Err((axum::http::StatusCode::UNAUTHORIZED, format!("Supabase token verification failed: {}", e)));
        }
    };

    let st_token = match sign_spacetime_token(secret.as_bytes(), &claims.sub, ttl) {
        Ok(token) => {
            token
        }
        Err(e) => {
            return Err(internal_err(e));
        }
    };

    Ok(Json(VerifyResp {
        user_id: claims.sub,
        email: claims.email,
        spacetime_token: st_token,
        expires_in: ttl * 60,
    }))
}

fn internal_err<E: std::fmt::Display>(e: E) -> (axum::http::StatusCode, String) {
    log::error!("Internal server error: {}", e);
    (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
}
