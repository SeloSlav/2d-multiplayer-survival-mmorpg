//! SOVA AI procedure — direct external HTTP calls from SpacetimeDB module.
//! API keys and active provider are stored in a private table.

use spacetimedb::http::{Request, Timeout};
use spacetimedb::{ProcedureContext, ReducerContext, Table};
use crate::sova_procedure::ai_http_config as AiHttpConfigTableTrait;
use base64::Engine as _;

#[spacetimedb::table(accessor = ai_http_config)]
#[derive(Clone, Debug)]
pub struct AiHttpConfig {
    #[primary_key]
    pub id: u8, // singleton row id=1
    pub active_provider: String, // "openai" | "grok" | "gemini"
    pub openai_api_key: String,
    pub gemini_api_key: String,
    pub grok_api_key: String,
}

fn provider_url_and_key(provider: &str, cfg: &AiHttpConfig) -> Result<(String, String), String> {
    match provider.to_lowercase().as_str() {
        "openai" => Ok((
            "https://api.openai.com/v1/chat/completions".to_string(),
            cfg.openai_api_key.clone(),
        )),
        "grok" => Ok((
            "https://api.x.ai/v1/chat/completions".to_string(),
            cfg.grok_api_key.clone(),
        )),
        "gemini" => Err("Gemini uses a separate request format and endpoint.".to_string()),
        other => Err(format!("Unsupported provider '{}'", other)),
    }
}

/// Shared HTTP client for OpenAI/Grok API calls. Used by both ask_sova and generate_brew_recipe
/// so they hit the same code path and avoid divergent behavior.
fn send_openai_compatible_request(
    ctx: &mut ProcedureContext,
    url: &str,
    api_key: &str,
    body: serde_json::Value,
    timeout_secs: u64,
) -> Result<String, String> {
    let request = Request::builder()
        .uri(url)
        .method("POST")
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", api_key))
        .extension(Timeout(std::time::Duration::from_secs(timeout_secs).into()))
        .body(body.to_string())
        .map_err(|e| format!("Failed to build request: {}", e))?;

    let response = ctx
        .http
        .send(request)
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    let (parts, body) = response.into_parts();
    let body_str = body.into_string_lossy();
    if !parts.status.is_success() {
        return Err(format!("API returned status {}: {}", parts.status, body_str));
    }

    let data: serde_json::Value =
        serde_json::from_str(&body_str).map_err(|e| format!("Failed to parse response: {}", e))?;

    let content = data
        .get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
        .map(|s| s.trim().to_string())
        .ok_or_else(|| "No response content in LLM reply".to_string())?;

    Ok(content)
}

fn audio_format_from_mime(mime_type: &str) -> &'static str {
    let normalized = mime_type.to_lowercase();
    if normalized.contains("webm") {
        "webm"
    } else if normalized.contains("ogg") {
        "ogg"
    } else if normalized.contains("mp4") || normalized.contains("m4a") {
        "mp4"
    } else if normalized.contains("wav") {
        "wav"
    } else if normalized.contains("flac") {
        "flac"
    } else {
        "webm"
    }
}

fn extract_json_block(text: &str) -> String {
    if let (Some(start), Some(end)) = (text.find("```"), text.rfind("```")) {
        if end > start {
            let block = &text[start + 3..end];
            if let Some(stripped) = block.strip_prefix("json") {
                return stripped.trim().to_string();
            }
            return block.trim().to_string();
        }
    }
    text.trim().to_string()
}

const BREW_SYSTEM_PROMPT: &str = r#"You are an AI recipe generator for a survival game called "Broth & Bullets".
Players combine 3 ingredients in a broth pot to create unique brews.

Return ONLY valid JSON (no markdown, no prose) with this shape:
{
  "name": "string",
  "description": "string",
  "health": number,
  "hunger": number,
  "thirst": number,
  "brew_time_secs": number,
  "category": "string",
  "effect_type": "string or null",
  "icon_subject": "string"
}

Rules:
- Exactly 3 ingredients are provided.
- brew_time_secs must be 15-30.
- category must be one of:
  healing_broth, medicinal_tea, alcoholic, poison, performance_enhancer, utility_brew,
  psychoactive, nutritional_drink, maritime_specialty, technological
- If category is poison, enforce:
  health=0, hunger=0, thirst=0, effect_type="PoisonCoating"
- For alcoholic category, effect_type should be "Intoxicated".
"#;

/// Generate AI brew recipe JSON via the selected LLM provider.
/// Returns a JSON string that can be passed into create_generated_brew reducer.
#[spacetimedb::procedure]
pub fn generate_brew_recipe(
    ctx: &mut ProcedureContext,
    ingredients_json: String,
    ingredient_rarities_json: String,
    provider: String,
) -> Result<String, String> {
    let cfg = ctx
        .with_tx(|tx| tx.db.ai_http_config().id().find(&1))
        .ok_or_else(|| "SOVA backend not configured (missing ai_http_config row id=1).".to_string())?;

    let ingredients: Vec<String> = serde_json::from_str(&ingredients_json)
        .map_err(|e| format!("Invalid ingredients_json: {}", e))?;
    if ingredients.len() != 3 {
        return Err("Exactly 3 ingredients required".to_string());
    }
    let ingredient_rarities: Vec<f32> =
        serde_json::from_str(&ingredient_rarities_json).unwrap_or_else(|_| vec![0.3, 0.3, 0.3]);

    let avg_rarity = if ingredient_rarities.is_empty() {
        0.3
    } else {
        ingredient_rarities.iter().copied().sum::<f32>() / ingredient_rarities.len() as f32
    };
    let rarity_tier = if avg_rarity < 0.3 {
        "Common"
    } else if avg_rarity < 0.6 {
        "Uncommon"
    } else if avg_rarity < 0.8 {
        "Rare"
    } else {
        "Very Rare"
    };

    let ingredient_lines = ingredients
        .iter()
        .enumerate()
        .map(|(idx, ing)| {
            let rarity = ingredient_rarities.get(idx).copied().unwrap_or(0.3);
            format!("- {} (rarity: {:.2})", ing, rarity)
        })
        .collect::<Vec<_>>()
        .join("\n");

    let user_prompt = format!(
        "Generate a brew recipe for these 3 ingredients:\n{}\n\nAverage rarity tier: {} ({:.2})\n\nCRITICAL RULES FOR POISON CATEGORY:\n- If category is \"poison\", you MUST set: health: 0, hunger: 0, thirst: 0\n- Effect type MUST be \"PoisonCoating\" for poison category",
        ingredient_lines, rarity_tier, avg_rarity
    );

    let selected_provider = if provider.trim().is_empty() {
        cfg.active_provider.to_lowercase()
    } else {
        provider.trim().to_lowercase()
    };

    let generated_text = {
        if selected_provider == "gemini" {
            let gemini_api_key = cfg.gemini_api_key.trim().to_string();
            if gemini_api_key.is_empty() {
                return Err("gemini_api_key is empty in ai_http_config".to_string());
            }

            let model = "gemini-2.0-flash";
            let url = format!(
                "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
                model, gemini_api_key
            );
            let request_json = serde_json::json!({
                "systemInstruction": {
                    "parts": [{ "text": BREW_SYSTEM_PROMPT }]
                },
                "contents": [{
                    "role": "user",
                    "parts": [{ "text": user_prompt }]
                }],
                "generationConfig": {
                    "temperature": 0.7,
                    "maxOutputTokens": 1024
                }
            });

            let request = Request::builder()
                .uri(&url)
                .method("POST")
                .header("Content-Type", "application/json")
                .extension(Timeout(std::time::Duration::from_secs(45).into()))
                .body(request_json.to_string())
                .map_err(|e| format!("Failed to build brew Gemini request: {}", e))?;

            let response = ctx
                .http
                .send(request)
                .map_err(|e| format!("Brew Gemini HTTP request failed: {}", e))?;
            let (parts, body) = response.into_parts();
            let body_str = body.into_string_lossy();
            if !parts.status.is_success() {
                return Err(format!("Brew Gemini API returned status {}: {}", parts.status, body_str));
            }

            let data: serde_json::Value = serde_json::from_str(&body_str)
                .map_err(|e| format!("Failed to parse brew Gemini response: {}", e))?;
            data.get("candidates")
                .and_then(|c| c.get(0))
                .and_then(|c| c.get("content"))
                .and_then(|c| c.get("parts"))
                .and_then(|p| p.get(0))
                .and_then(|p| p.get("text"))
                .and_then(|t| t.as_str())
                .ok_or_else(|| "Brew Gemini response missing text".to_string())?
                .to_string()
        } else {
            let (url, api_key) = provider_url_and_key(&selected_provider, &cfg)?;
            let model = if selected_provider == "openai" {
                "gpt-6-luna"
            } else {
                "grok-4-1-fast-reasoning"
            };

            let mut request_json = serde_json::json!({
                "model": model,
                "messages": [
                    { "role": "system", "content": BREW_SYSTEM_PROMPT },
                    { "role": "user", "content": user_prompt }
                ],
                "max_completion_tokens": 512
            });
            if selected_provider == "openai" {
                request_json["reasoning_effort"] = serde_json::json!("none");
                request_json["response_format"] = serde_json::json!({ "type": "json_object" });
            } else {
                request_json["temperature"] = serde_json::json!(0.7);
            }

            send_openai_compatible_request(ctx, &url, &api_key, request_json, 45)
                .map_err(|e| format!("Brew {}", e))?
        }
    };

    let recipe_json_str = extract_json_block(&generated_text);
    let mut recipe: serde_json::Value =
        serde_json::from_str(&recipe_json_str).map_err(|e| format!("Failed to parse recipe JSON: {}", e))?;

    let obj = recipe
        .as_object_mut()
        .ok_or_else(|| "Recipe JSON must be an object".to_string())?;
    let valid_categories = [
        "healing_broth",
        "medicinal_tea",
        "alcoholic",
        "poison",
        "performance_enhancer",
        "utility_brew",
        "psychoactive",
        "nutritional_drink",
        "maritime_specialty",
        "technological",
    ];

    let category = obj
        .get("category")
        .and_then(|v| v.as_str())
        .unwrap_or("healing_broth");
    if !valid_categories.contains(&category) {
        obj.insert("category".to_string(), serde_json::Value::String("healing_broth".to_string()));
    }

    let final_category = obj
        .get("category")
        .and_then(|v| v.as_str())
        .unwrap_or("healing_broth")
        .to_string();
    if final_category == "poison" {
        obj.insert("health".to_string(), serde_json::Value::Number(serde_json::Number::from(0)));
        obj.insert("hunger".to_string(), serde_json::Value::Number(serde_json::Number::from(0)));
        obj.insert("thirst".to_string(), serde_json::Value::Number(serde_json::Number::from(0)));
        obj.insert("effect_type".to_string(), serde_json::Value::String("PoisonCoating".to_string()));
    }
    if final_category == "alcoholic" && obj.get("effect_type").is_none() {
        obj.insert("effect_type".to_string(), serde_json::Value::String("Intoxicated".to_string()));
    }

    // Clamp brew time and ensure required fields exist.
    let brew_time = obj
        .get("brew_time_secs")
        .and_then(|v| v.as_u64())
        .unwrap_or(20)
        .clamp(15, 30);
    obj.insert(
        "brew_time_secs".to_string(),
        serde_json::Value::Number(serde_json::Number::from(brew_time)),
    );
    if obj.get("name").and_then(|v| v.as_str()).unwrap_or("").is_empty() {
        obj.insert("name".to_string(), serde_json::Value::String("Improvised Brew".to_string()));
    }
    if obj.get("description").and_then(|v| v.as_str()).unwrap_or("").is_empty() {
        obj.insert(
            "description".to_string(),
            serde_json::Value::String("A rough brew mixed from whatever was on hand.".to_string()),
        );
    }
    if obj.get("icon_subject").and_then(|v| v.as_str()).unwrap_or("").is_empty() {
        obj.insert(
            "icon_subject".to_string(),
            serde_json::Value::String("steaming improvised broth in a rustic bowl".to_string()),
        );
    }

    Ok(recipe.to_string())
}

/// Generate brew icon descriptor through procedures (proxy replacement).
/// Returns JSON matching client expectations:
/// { "icon_base64": null, "icon_asset": "broth_pot_icon.png", "mime_type": "image/png" }
#[spacetimedb::procedure]
pub fn generate_brew_icon(_ctx: &mut ProcedureContext, _subject: String) -> Result<String, String> {
    let result = serde_json::json!({
        "icon_base64": serde_json::Value::Null,
        "icon_asset": "broth_pot_icon.png",
        "mime_type": "image/png"
    });
    Ok(result.to_string())
}

/// Sends OpenAI-compatible request JSON (messages/model/etc) to configured provider.
/// The caller should pass the full request body as JSON string.
#[spacetimedb::procedure]
pub fn ask_sova(ctx: &mut ProcedureContext, request_body: String) -> Result<String, String> {
    let cfg = ctx
        .with_tx(|tx| tx.db.ai_http_config().id().find(&1))
        .ok_or_else(|| "SOVA backend not configured (missing ai_http_config row id=1).".to_string())?;

    let mut payload: serde_json::Value = serde_json::from_str(&request_body)
        .map_err(|e| format!("Invalid ask_sova request JSON: {}", e))?;
    let payload_obj = payload
        .as_object_mut()
        .ok_or_else(|| "ask_sova request_body must be a JSON object".to_string())?;
    let selected_provider = payload_obj
        .get("provider")
        .and_then(|v| v.as_str())
        .map(|s| s.to_lowercase())
        .unwrap_or_else(|| cfg.active_provider.to_lowercase());
    // Internal control field; do not forward upstream.
    payload_obj.remove("provider");

    if selected_provider == "openai" {
        // Own the billable model and output cap on the server. Browser-supplied
        // model settings are not trusted for this shared SOVA endpoint.
        payload_obj.insert("model".to_string(), serde_json::json!("gpt-6-luna"));
        payload_obj.insert("reasoning_effort".to_string(), serde_json::json!("none"));
        payload_obj.insert("max_completion_tokens".to_string(), serde_json::json!(300));
        payload_obj.remove("temperature");
        payload_obj.remove("max_tokens");
    }

    if selected_provider == "gemini" {
        let gemini_api_key = cfg.gemini_api_key.trim().to_string();
        if gemini_api_key.is_empty() {
            return Err("gemini_api_key is empty in ai_http_config".to_string());
        }

        let model = payload_obj
            .get("model")
            .and_then(|v| v.as_str())
            .unwrap_or("gemini-2.0-flash");
        let temperature = payload_obj.get("temperature").and_then(|v| v.as_f64());
        let max_completion_tokens = payload_obj
            .get("max_completion_tokens")
            .and_then(|v| v.as_u64())
            .or_else(|| payload_obj.get("max_tokens").and_then(|v| v.as_u64()));

        let messages = payload_obj
            .get("messages")
            .and_then(|v| v.as_array())
            .ok_or_else(|| "ask_sova request_body missing messages for Gemini".to_string())?;

        let mut system_texts: Vec<String> = Vec::new();
        let mut contents: Vec<serde_json::Value> = Vec::new();

        for msg in messages {
            let role = msg.get("role").and_then(|r| r.as_str()).unwrap_or("user");
            let content_text = match msg.get("content") {
                Some(serde_json::Value::String(s)) => s.clone(),
                Some(serde_json::Value::Array(arr)) => arr
                    .iter()
                    .filter_map(|part| part.get("text").and_then(|v| v.as_str()))
                    .collect::<Vec<_>>()
                    .join("\n"),
                _ => String::new(),
            };

            if content_text.trim().is_empty() {
                continue;
            }

            if role == "system" {
                system_texts.push(content_text);
                continue;
            }

            let gemini_role = if role == "assistant" { "model" } else { "user" };
            contents.push(serde_json::json!({
                "role": gemini_role,
                "parts": [{ "text": content_text }]
            }));
        }

        if contents.is_empty() {
            return Err("ask_sova Gemini request had no usable messages".to_string());
        }

        let mut gemini_payload = serde_json::json!({ "contents": contents });
        if !system_texts.is_empty() {
            gemini_payload["systemInstruction"] = serde_json::json!({
                "parts": [{ "text": system_texts.join("\n\n") }]
            });
        }
        if temperature.is_some() || max_completion_tokens.is_some() {
            let mut generation_config = serde_json::Map::new();
            if let Some(t) = temperature {
                generation_config.insert(
                    "temperature".to_string(),
                    serde_json::Value::Number(
                        serde_json::Number::from_f64(t)
                            .ok_or_else(|| "Invalid Gemini temperature value".to_string())?,
                    ),
                );
            }
            if let Some(max_tokens) = max_completion_tokens {
                generation_config.insert(
                    "maxOutputTokens".to_string(),
                    serde_json::Value::Number(serde_json::Number::from(max_tokens)),
                );
            }
            gemini_payload["generationConfig"] = serde_json::Value::Object(generation_config);
        }

        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
            model, gemini_api_key
        );
        let request = Request::builder()
            .uri(&url)
            .method("POST")
            .header("Content-Type", "application/json")
            .extension(Timeout(std::time::Duration::from_secs(30).into()))
            .body(gemini_payload.to_string())
            .map_err(|e| format!("Failed to build Gemini request: {}", e))?;

        let response = ctx
            .http
            .send(request)
            .map_err(|e| format!("Gemini HTTP request failed: {}", e))?;

        let (parts, body) = response.into_parts();
        let body_str = body.into_string_lossy();
        if !parts.status.is_success() {
            return Err(format!("Gemini API returned status {}: {}", parts.status, body_str));
        }

        let data: serde_json::Value =
            serde_json::from_str(&body_str).map_err(|e| format!("Failed to parse Gemini response: {}", e))?;

        let content = data
            .get("candidates")
            .and_then(|c| c.get(0))
            .and_then(|c| c.get("content"))
            .and_then(|c| c.get("parts"))
            .and_then(|p| p.get(0))
            .and_then(|p| p.get("text"))
            .and_then(|t| t.as_str())
            .map(|s| s.trim().to_string())
            .ok_or_else(|| "No response content in Gemini reply".to_string())?;

        return Ok(content);
    }

    let (url, api_key) = provider_url_and_key(&selected_provider, &cfg)?;
    send_openai_compatible_request(ctx, &url, &api_key, payload, 30)
}

/// Upserts the singleton AI config row (id=1).
/// Call once after publish to seed API keys and active provider.
/// Subsequent calls update the existing row.
#[spacetimedb::reducer]
pub fn configure_sova(
    ctx: &ReducerContext,
    active_provider: String,
    openai_api_key: String,
    gemini_api_key: String,
    grok_api_key: String,
) -> Result<(), String> {
    let existing = ctx.db.ai_http_config().id().find(&1);
    if existing.is_some() {
        ctx.db.ai_http_config().id().delete(&1);
    }
    ctx.db.ai_http_config().insert(AiHttpConfig {
        id: 1,
        active_provider,
        openai_api_key,
        gemini_api_key,
        grok_api_key,
    });
    log::info!("[SOVA] ai_http_config row upserted (id=1)");
    Ok(())
}

/// Transcribes speech via OpenAI using the private `openai_api_key`.
/// This is intentionally hard-wired to OpenAI (not active_provider).
#[spacetimedb::procedure]
pub fn transcribe_speech(
    ctx: &mut ProcedureContext,
    audio_base64: String,
    mime_type: String,
) -> Result<String, String> {
    let cfg = ctx
        .with_tx(|tx| tx.db.ai_http_config().id().find(&1))
        .ok_or_else(|| "SOVA backend not configured (missing ai_http_config row id=1).".to_string())?;

    if cfg.openai_api_key.trim().is_empty() {
        return Err("openai_api_key is empty in ai_http_config".to_string());
    }

    let request_json = serde_json::json!({
        "model": "gpt-4o-mini-transcribe",
        "input": [{
            "role": "user",
            "content": [{
                "type": "input_audio",
                "input_audio": {
                    "data": audio_base64,
                    "format": audio_format_from_mime(&mime_type),
                }
            }]
        }],
        "temperature": 0,
    });

    let primary_request = Request::builder()
        .uri("https://api.openai.com/v1/responses")
        .method("POST")
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", cfg.openai_api_key))
        .extension(Timeout(std::time::Duration::from_secs(60).into()))
        .body(request_json.to_string())
        .map_err(|e| format!("Failed to build transcription request: {}", e))?;

    let response = ctx
        .http
        .send(primary_request)
        .map_err(|e| format!("Transcription HTTP request failed: {}", e))?;

    let (parts, body) = response.into_parts();
    let body_str = body.into_string_lossy();

    if parts.status.is_success() {
        let data: serde_json::Value = serde_json::from_str(&body_str)
            .map_err(|e| format!("Failed to parse transcription response: {}", e))?;

        let text = data
            .get("output_text")
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .or_else(|| {
                data.get("output")
                    .and_then(|o| o.get(0))
                    .and_then(|o| o.get("content"))
                    .and_then(|c| c.get(0))
                    .and_then(|c| c.get("text"))
                    .and_then(|t| t.as_str())
                    .map(|s| s.trim().to_string())
            })
            .or_else(|| {
                data.get("text")
                    .and_then(|v| v.as_str())
                    .map(|s| s.trim().to_string())
            })
            .unwrap_or_default();

        if !text.is_empty() {
            return Ok(text);
        }
    }

    // Fallback to classic Whisper endpoint when the primary transcription
    // model/path is unavailable for the account or payload.
    let audio_bytes = base64::engine::general_purpose::STANDARD
        .decode(audio_base64.as_bytes())
        .map_err(|e| format!("Invalid audio base64: {}", e))?;
    let normalized_mime = if mime_type.trim().is_empty() {
        "audio/webm".to_string()
    } else {
        mime_type
    };
    let extension = audio_format_from_mime(&normalized_mime);
    let boundary = format!("----spacetime-whisper-{}", ctx.timestamp.to_micros_since_unix_epoch());
    let mut multipart_body = Vec::<u8>::new();

    let prefix = format!(
        "--{b}\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\nwhisper-1\r\n\
--{b}\r\nContent-Disposition: form-data; name=\"response_format\"\r\n\r\njson\r\n\
--{b}\r\nContent-Disposition: form-data; name=\"temperature\"\r\n\r\n0\r\n\
--{b}\r\nContent-Disposition: form-data; name=\"language\"\r\n\r\nen\r\n\
--{b}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"audio.{ext}\"\r\nContent-Type: {mime}\r\n\r\n",
        b = boundary,
        ext = extension,
        mime = normalized_mime
    );
    multipart_body.extend_from_slice(prefix.as_bytes());
    multipart_body.extend_from_slice(&audio_bytes);
    let suffix = format!("\r\n--{}--\r\n", boundary);
    multipart_body.extend_from_slice(suffix.as_bytes());

    let fallback_request = Request::builder()
        .uri("https://api.openai.com/v1/audio/transcriptions")
        .method("POST")
        .header("Content-Type", format!("multipart/form-data; boundary={}", boundary))
        .header("Authorization", format!("Bearer {}", cfg.openai_api_key))
        .extension(Timeout(std::time::Duration::from_secs(60).into()))
        .body(multipart_body)
        .map_err(|e| format!("Failed to build whisper fallback request: {}", e))?;

    let fallback_response = ctx
        .http
        .send(fallback_request)
        .map_err(|e| format!("Whisper fallback HTTP request failed: {}", e))?;
    let (fallback_parts, fallback_body) = fallback_response.into_parts();
    let fallback_body_str = fallback_body.into_string_lossy();
    if !fallback_parts.status.is_success() {
        return Err(format!(
            "Transcription failed (primary status {} / fallback status {}): {}",
            parts.status, fallback_parts.status, fallback_body_str
        ));
    }

    let fallback_json: serde_json::Value = serde_json::from_str(&fallback_body_str)
        .map_err(|e| format!("Failed to parse whisper fallback response: {}", e))?;
    let fallback_text = fallback_json
        .get("text")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .ok_or_else(|| "No transcription text in whisper fallback response".to_string())?;
    if fallback_text.is_empty() {
        return Err("Whisper fallback returned empty text".to_string());
    }

    Ok(fallback_text)
}
