//! What the payload asks of the gateway: intents, event types and cache resources
//! (`docs/ARCHITECTURE.md` §7). Only what the nodes in use declared is switched on.

use twilight_cache_inmemory::{DefaultInMemoryCache, InMemoryCache, ResourceType};
use twilight_gateway::{EventTypeFlags, Intents};

use crate::AdapterError;

/// The intents a node may declare, by the name the schema uses.
const INTENTS: &[(&str, Intents)] = &[
    ("guilds", Intents::GUILDS),
    ("guild_members", Intents::GUILD_MEMBERS),
    ("guild_messages", Intents::GUILD_MESSAGES),
    ("guild_message_reactions", Intents::GUILD_MESSAGE_REACTIONS),
    ("guild_voice_states", Intents::GUILD_VOICE_STATES),
    ("direct_messages", Intents::DIRECT_MESSAGES),
    ("message_content", Intents::MESSAGE_CONTENT),
];

/// The cache resources a node may declare.
const RESOURCES: &[(&str, ResourceType)] = &[
    ("channel", ResourceType::CHANNEL),
    ("emoji", ResourceType::EMOJI),
    ("guild", ResourceType::GUILD),
    ("member", ResourceType::MEMBER),
    ("message", ResourceType::MESSAGE),
    ("presence", ResourceType::PRESENCE),
    ("reaction", ResourceType::REACTION),
    ("role", ResourceType::ROLE),
    ("user", ResourceType::USER),
    ("user_current", ResourceType::USER_CURRENT),
    ("voice_state", ResourceType::VOICE_STATE),
];

/// Messages kept per channel when the message cache is on. A bot has no use for old ones.
const MESSAGES_PER_CHANNEL: usize = 10;

/// The gateway intents for `names`. An empty list gives no intent at all.
///
/// # Errors
///
/// [`AdapterError::UnknownIntent`] for a name this version does not know.
pub fn intents(names: &[String]) -> Result<Intents, AdapterError> {
    names.iter().try_fold(Intents::empty(), |all, name| {
        INTENTS
            .iter()
            .find(|(known, _)| known == name)
            .map(|(_, intent)| all | *intent)
            .ok_or_else(|| AdapterError::UnknownIntent(name.clone()))
    })
}

/// The resource types of the cache for `names`.
///
/// # Errors
///
/// [`AdapterError::UnknownCache`] for a name this version does not know.
pub fn resources(names: &[String]) -> Result<ResourceType, AdapterError> {
    names.iter().try_fold(ResourceType::empty(), |all, name| {
        RESOURCES
            .iter()
            .find(|(known, _)| known == name)
            .map(|(_, resource)| all | *resource)
            .ok_or_else(|| AdapterError::UnknownCache(name.clone()))
    })
}

/// The cache for `names`, or `None` when no node needs one.
///
/// # Errors
///
/// [`AdapterError::UnknownCache`] for a name this version does not know.
pub fn cache(names: &[String]) -> Result<Option<DefaultInMemoryCache>, AdapterError> {
    let resources = resources(names)?;
    Ok((!resources.is_empty()).then(|| {
        InMemoryCache::builder()
            .resource_types(resources)
            .message_cache_size(MESSAGES_PER_CHANNEL)
            .build()
    }))
}

/// The gateway event types worth parsing. Interactions and the ready event are always read; a
/// cache needs the events that carry its resources, which are all of them until a node that uses
/// a cache narrows them.
#[must_use]
pub fn event_types(cache: bool) -> EventTypeFlags {
    if cache {
        EventTypeFlags::all()
    } else {
        EventTypeFlags::INTERACTION_CREATE | EventTypeFlags::READY
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(names: &[&str]) -> Vec<String> {
        names.iter().map(|name| (*name).to_owned()).collect()
    }

    #[test]
    fn ping_needs_only_the_guilds_intent() {
        assert_eq!(intents(&names(&["guilds"])).unwrap(), Intents::GUILDS);
    }

    #[test]
    fn no_names_enable_nothing() {
        assert_eq!(intents(&[]).unwrap(), Intents::empty());
        assert!(resources(&[]).unwrap().is_empty());
    }

    #[test]
    fn privileged_intents_are_only_there_when_asked() {
        let all = intents(&names(&[
            "guilds",
            "guild_members",
            "message_content",
            "guilds",
        ]))
        .unwrap();
        assert_eq!(
            all,
            Intents::GUILDS | Intents::GUILD_MEMBERS | Intents::MESSAGE_CONTENT
        );
        assert!(
            !intents(&names(&["guilds"]))
                .unwrap()
                .contains(Intents::GUILD_MEMBERS)
        );
    }

    #[test]
    fn an_unknown_name_is_an_error() {
        assert_eq!(
            intents(&names(&["guilds", "everything"])),
            Err(AdapterError::UnknownIntent("everything".to_owned()))
        );
        assert_eq!(
            resources(&names(&["role", "souls"])),
            Err(AdapterError::UnknownCache("souls".to_owned()))
        );
        assert!(intents(&names(&["GUILDS"])).is_err());
    }

    #[test]
    fn every_known_name_maps_to_a_flag() {
        for (name, intent) in INTENTS {
            assert_eq!(intents(&names(&[name])).unwrap(), *intent);
        }
        for (name, resource) in RESOURCES {
            assert_eq!(resources(&names(&[name])).unwrap(), *resource);
        }
    }

    #[test]
    fn a_bot_with_no_cache_resource_has_no_cache() {
        assert!(cache(&[]).unwrap().is_none());
        let with_roles = cache(&names(&["role"])).unwrap().unwrap();
        assert_eq!(with_roles.config().resource_types(), ResourceType::ROLE);
        assert_eq!(
            with_roles.config().message_cache_size(),
            MESSAGES_PER_CHANNEL
        );
    }

    #[test]
    fn without_a_cache_only_interactions_and_ready_are_parsed() {
        let flags = event_types(false);
        assert!(flags.contains(EventTypeFlags::INTERACTION_CREATE));
        assert!(flags.contains(EventTypeFlags::READY));
        assert!(!flags.contains(EventTypeFlags::MESSAGE_CREATE));
        assert_eq!(event_types(true), EventTypeFlags::all());
    }
}
