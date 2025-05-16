// ... existing code ...
            // If health was reduced by a damaging effect, cancel any active HealthRegen effects for that player.
            if health_was_reduced && (effect.effect_type == EffectType::Damage || effect.effect_type == EffectType::Bleed) {
                cancel_health_regen_effects(ctx, effect.player_id); // Keep this for actual HoTs
                cancel_bandage_burst_effects(ctx, effect.player_id); // ADDED: Also cancel BandageBurst if damage taken
            }
        }

// ... existing code ... 