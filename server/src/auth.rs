use spacetimedb::{ReducerContext, Identity, Timestamp, Table, log};
use crate::PendingAuth; // Import the table definition from lib.rs
use crate::pending_auth as PendingAuthTableTrait; // Import the generated trait for db access
use std::env;
// Use jsonwebtoken imports
use jsonwebtoken::{decode, DecodingKey, Validation, Algorithm};
use serde::{Deserialize, Serialize};

// Define the structure of the claims we expect in the Supabase access token
#[derive(Debug, Serialize, Deserialize)] // Removed Clone, not needed by jsonwebtoken
struct Claims {
    sub: String, // Subject (Supabase User ID)
    // Add other claims you might need like 'exp', 'iss', etc.
    // exp: usize, 
    iss: Option<String>,
    aud: Option<String>,
}

// CustomClaims struct is not needed for jsonwebtoken

const SUPABASE_JWT_SECRET_ENV_VAR: &str = "SUPABASE_JWT_SECRET";
// Optional: Add expected issuer for validation
// const EXPECTED_SUPABASE_ISSUER: &str = "https://<your-project-ref>.supabase.co/auth/v1"; 

#[spacetimedb::reducer]
pub fn authenticate_with_supabase_token(ctx: &ReducerContext, supabase_access_token: String) -> Result<(), String> {
    log::info!("Attempting authentication for sender: {} using jsonwebtoken", ctx.sender);

    // 1. Get the Supabase JWT Secret
    let secret = match env::var(SUPABASE_JWT_SECRET_ENV_VAR) {
        Ok(val) => val,
        Err(_) => {
            let err_msg = format!("{} environment variable not set on the server.", SUPABASE_JWT_SECRET_ENV_VAR);
            log::error!("{}", err_msg);
            return Err(format!("Server configuration error: {}", err_msg)); 
        }
    };

    // 2. Define validation options
    // Use HS256 as Supabase typically uses this with the shared secret
    let mut validation = Validation::new(Algorithm::HS256);
    // Disable expiry validation for now, but recommended for production
    validation.validate_exp = false; 
    // Add issuer validation if desired
    // validation.set_issuer(&[EXPECTED_SUPABASE_ISSUER]);
    // Add audience validation if needed
    // validation.set_audience(&["authenticated"]); // Supabase default audience
    // Allow clock skew if needed
    // validation.leeway = 60; // 60 seconds

    // 3. Decode and validate the token
    match decode::<Claims>(&supabase_access_token, &DecodingKey::from_secret(secret.as_ref()), &validation) {
        Ok(token_data) => {
            let claims = token_data.claims;
            let supabase_sub = claims.sub; // The validated Supabase User ID
            let connection_id = ctx.sender; 

            log::info!("jsonwebtoken: Successfully validated token for Supabase sub: {}. Linking to connection ID: {}", supabase_sub, connection_id);

            // 3. Check if this connection ID already has a pending auth entry
            if let Some(existing_auth) = ctx.db.pending_auth().connection_id().find(&connection_id) {
                log::warn!("Connection ID {} already authenticated with sub {}. Ignoring duplicate auth attempt.", connection_id, existing_auth.supabase_sub);
                 return Ok(()); // Already processed for this connection
            }
            
            // Optional: Check if this supabase_sub is already linked to a *different* active connection_id? 
            // If using an index on supabase_sub:
            // if let Some(other_auth) = ctx.db.pending_auth().supabase_sub().find(&supabase_sub) {
            //     log::warn!("Supabase sub {} is already linked to connection {}. Handling duplicate session...", supabase_sub, other_auth.connection_id);
            //     // Example: Delete the old entry to allow the new connection
            //     ctx.db.pending_auth().connection_id().delete(&other_auth.connection_id);
            // }

            // 4. Insert the link into the PendingAuth table
            let pending_auth_entry = PendingAuth {
                connection_id,
                supabase_sub,
                timestamp: ctx.timestamp,
            };

            // Use try_insert for better error handling if needed (e.g., if PK somehow conflicts)
            match ctx.db.pending_auth().try_insert(pending_auth_entry) {
                Ok(_) => {
                     log::info!("PendingAuth entry created for connection ID: {}", connection_id);
                     Ok(())
                },
                Err(e) => {
                    log::error!("Failed to insert PendingAuth entry for {}: {:?}", connection_id, e);
                    Err("Failed to record authentication link.".to_string())
                }
            }
        }
        Err(err) => {
            let err_msg = format!("jsonwebtoken: JWT validation failed for sender {}: {}", ctx.sender, err);
            log::error!("{}", err_msg);
            // Return a generic error to the client for security
            Err("Authentication token validation failed.".to_string()) 
        }
    }
}

// Reducer to clean up PendingAuth entries on disconnect
#[spacetimedb::reducer(client_disconnected)]
pub fn handle_disconnect_auth_cleanup(ctx: &ReducerContext) {
    log::info!("Client disconnected: {}. Cleaning up PendingAuth entry if exists.", ctx.sender);
    // Delete the PendingAuth entry associated with the disconnected client's temporary ID
    // delete() returns true if a row was deleted, false otherwise.
    let deleted = ctx.db.pending_auth().connection_id().delete(&ctx.sender);
    if deleted {
        log::info!("Cleaned up PendingAuth entry for disconnected client: {}", ctx.sender);
    }
}