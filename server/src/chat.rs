// server/src/chat.rs
//
// Module for managing chat functionality including messages and related
// operations in the multiplayer game.

use spacetimedb::{ReducerContext, Identity, Timestamp, Table};
use log;
// Import necessary table traits and structs
use crate::PlayerKillCommandCooldown;
use crate::player_kill_command_cooldown as PlayerKillCommandCooldownTableTrait;
use crate::player as PlayerTableTrait;
use crate::player_corpse; // To call create_player_corpse
use crate::active_equipment; // To call clear_active_item_reducer
use crate::PrivateMessage; // Struct for private messages
use crate::private_message as PrivateMessageTableTrait; // Trait for private messages

// --- Table Definitions ---

#[spacetimedb::table(name = message, public)]
#[derive(Clone, Debug)]
pub struct Message {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub sender: Identity,
    pub text: String,
    pub sent: Timestamp, // Timestamp for sorting
}

// --- Reducers ---

/// Sends a chat message that will be visible to all players
#[spacetimedb::reducer]
pub fn send_message(ctx: &ReducerContext, text: String) -> Result<(), String> {
    if text.is_empty() {
        return Err("Message cannot be empty.".to_string());
    }
    if text.len() > 100 { // Match client-side max length
        return Err("Message too long (max 100 characters).".to_string());
    }

    let sender_id = ctx.sender;
    let current_time = ctx.timestamp;

    // --- Command Handling ---
    if text.starts_with("/") {
        let parts: Vec<&str> = text.split_whitespace().collect();
        let command = parts.get(0).unwrap_or(&"").to_lowercase();

        match command.as_str() {
            "/kill" | "/respawn" => { // Added /respawn alias
                log::info!("[Command] Player {:?} used {} command.", sender_id, command);
                let cooldown_table = ctx.db.player_kill_command_cooldown();
                
                if let Some(cooldown_record) = cooldown_table.player_id().find(&sender_id) {
                    let micros_elapsed: u64 = (current_time.to_micros_since_unix_epoch().saturating_sub(cooldown_record.last_kill_command_at.to_micros_since_unix_epoch())).try_into().unwrap();
                    let elapsed_seconds: u64 = micros_elapsed / 1_000_000u64;
                    
                    if elapsed_seconds < crate::KILL_COMMAND_COOLDOWN_SECONDS {
                        let remaining_cooldown = crate::KILL_COMMAND_COOLDOWN_SECONDS - elapsed_seconds;
                        let private_feedback = PrivateMessage {
                            id: 0, // Auto-incremented
                            recipient_identity: sender_id,
                            sender_display_name: "SYSTEM".to_string(),
                            text: format!("You can use {} again in {} seconds.", command, remaining_cooldown),
                            sent: current_time,
                        };
                        ctx.db.private_message().insert(private_feedback);
                        log::info!("Sent private cooldown message to {:?} for command {}. Remaining: {}s", sender_id, command, remaining_cooldown);
                        return Ok(()); // Command processed by sending private feedback
                    }
                }

                // Proceed with kill
                let mut players = ctx.db.player();
                if let Some(mut player) = players.identity().find(&sender_id) {
                    if player.is_dead {
                        return Err("You are already dead.".to_string());
                    }
                    player.health = 0.0;
                    player.is_dead = true;
                    player.death_timestamp = Some(current_time);
                    player.last_update = current_time; // Update timestamp
                    players.identity().update(player.clone()); // Update player state

                    // Create corpse
                    if let Err(e) = player_corpse::create_player_corpse(ctx, sender_id, player.position_x, player.position_y, &player.username) {
                        log::error!("Failed to create corpse for player {:?} after {}: {}", sender_id, command, e);
                    }

                    // Clear active item
                    if let Err(e) = active_equipment::clear_active_item_reducer(ctx, sender_id) {
                        log::error!("Failed to clear active item for player {:?} after {}: {}", sender_id, command, e);
                    }
                    
                    // Update cooldown
                    let new_cooldown_record = crate::PlayerKillCommandCooldown {
                        player_id: sender_id,
                        last_kill_command_at: current_time,
                    };
                    if cooldown_table.player_id().find(&sender_id).is_some() {
                        cooldown_table.player_id().update(new_cooldown_record);
                    } else {
                        cooldown_table.insert(new_cooldown_record);
                    }

                    log::info!("Player {:?} successfully used {}.", sender_id, command);
                    return Ok(()); // Command processed, don't send message to chat
                } else {
                    return Err(format!("Player not found for {} command.", command));
                }
            }
            "/players" => {
                log::info!("[Command] Player {:?} used /players command.", sender_id);
                let online_players_count = ctx.db.player().iter().filter(|p| p.is_online && !p.is_dead).count();
                
                let system_message_text = format!("Players Online: {}", online_players_count);
                let system_message = Message {
                    id: 0, // Auto-incremented
                    sender: ctx.identity(), // Module identity as sender for system messages
                    text: system_message_text,
                    sent: current_time,
                };
                ctx.db.message().insert(system_message);
                log::info!("System message sent: Players Online: {}", online_players_count);
                return Ok(()); // Command processed, don't send original message to chat
            }
            _ => {
                return Err(format!("Unknown command: {}", command));
            }
        }
    }
    // --- End Command Handling ---


    let new_message = Message {
        id: 0, // Auto-incremented
        sender: ctx.sender,
        text: text.clone(), // Clone text for logging after potential move
        sent: ctx.timestamp,
    };

    log::info!("User {} sent message: {}", ctx.sender, text); // Log the message content
    
    // Use the database context handle to insert
    ctx.db.message().insert(new_message);

    Ok(())
}

// Could add more chat-related functionality in the future:
// - Private messages
// - Chat filtering
// - Chat commands/emotes
// - Chat history management (pruning old messages)