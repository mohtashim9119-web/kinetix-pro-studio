// ---------------------------------------------------------------------------
// Generic swappable event sink + single-flight job registry.
//
// Extracted from `model_download.rs` (WS2 T4.4/T4.6), which originally
// hardcoded both pieces to the whisper/FA model-download use case: a
// `Mutex<HashMap<PathBuf, Arc<EventSink>>>` keyed by `.part` path, carrying a
// `Channel<ModelDownloadEvent>` payload. Nothing about either mechanism
// actually depends on that key or payload shape — the single-flight
// guarantee only needs `K: Eq + Hash`, and the swappable sink only needs a
// `Channel<T>` for whatever event enum a caller defines. Generalized here so
// a future consumer (e.g. a per-project transcription job) can reuse the
// SAME machinery with its own key/payload types by declaring its own
// `static X: InFlightRegistry<K, T> = InFlightRegistry::new();`, without
// duplicating the swap-point-under-reload fix or the single-flight fix.
//
// `model_download.rs` keeps its own `EventSink`/`IN_FLIGHT` names as thin
// aliases/wrappers over this module (`type EventSink = event_sink::
// EventSink<ModelDownloadEvent>`, a `static IN_FLIGHT: event_sink::
// InFlightRegistry<PathBuf, ModelDownloadEvent>`) — this file changes no
// observable behaviour of the download path; see that module for the WHY of
// the swap point and the single-flight guarantee themselves.
// ---------------------------------------------------------------------------

use std::borrow::Borrow;
use std::collections::HashMap;
use std::hash::Hash;
use std::sync::{Arc, Mutex, OnceLock};

use tauri::ipc::Channel;

/// A running job's event channel, behind a swap point so a fresh page can
/// take over the SAME job (`InFlightRegistry::attach`) instead of racing it.
/// See `model_download.rs`'s original `EventSink` doc comment for the full
/// WKWebView-reload rationale — unchanged here, just payload-generic.
pub(crate) struct EventSink<T: Clone>(Mutex<Channel<T>>);

impl<T: Clone + serde::Serialize> EventSink<T> {
    pub(crate) fn new(channel: Channel<T>) -> Self {
        Self(Mutex::new(channel))
    }

    /// Send is best-effort and always has been: a channel whose page is gone
    /// errors, and a job must not fail because nobody was watching.
    pub(crate) fn send(&self, event: T) {
        if let Ok(channel) = self.0.lock() {
            let _ = channel.send(event);
        }
    }

    /// Point the running job at a new page's channel.
    pub(crate) fn replace(&self, channel: Channel<T>) {
        if let Ok(mut slot) = self.0.lock() {
            *slot = channel;
        }
    }
}

/// A single-flight registry of jobs currently in progress, keyed by `K`.
/// Generalized from `model_download.rs`'s original `IN_FLIGHT` map — see its
/// doc comment for why this must be keyed by the actual contended resource
/// (there, the `.part` path) rather than a caller-chosen id string that could
/// drift from it.
pub(crate) struct InFlightRegistry<K, T: Clone> {
    map: OnceLock<Mutex<HashMap<K, Arc<EventSink<T>>>>>,
}

impl<K, T: Clone> InFlightRegistry<K, T> {
    pub(crate) const fn new() -> Self {
        Self { map: OnceLock::new() }
    }
}

impl<K: Eq + Hash, T: Clone> InFlightRegistry<K, T> {
    fn map(&self) -> &Mutex<HashMap<K, Arc<EventSink<T>>>> {
        self.map.get_or_init(|| Mutex::new(HashMap::new()))
    }

    /// The sink of the job currently holding `key`, if there is one. Returned
    /// under the same lock the guard removes itself under — see
    /// `model_download.rs::attach_to_in_flight`'s doc comment for why that
    /// ordering matters.
    pub(crate) fn attach<Q>(&self, key: &Q) -> Option<Arc<EventSink<T>>>
    where
        K: Borrow<Q>,
        Q: Hash + Eq + ?Sized,
    {
        self.map().lock().ok()?.get(key).cloned()
    }

    /// Whether a job is holding `key` right now.
    pub(crate) fn is_in_flight<Q>(&self, key: &Q) -> bool
    where
        K: Borrow<Q>,
        Q: Hash + Eq + ?Sized,
    {
        self.map().lock().map(|set| set.contains_key(key)).unwrap_or(false)
    }
}

impl<K, T> InFlightRegistry<K, T>
where
    K: Eq + Hash + Clone + Send + 'static,
    T: Clone + Send + 'static,
{
    /// `Some(guard)` if nothing else is holding `key`; `None` if one is. The
    /// insert and the test are one critical section, so two simultaneous
    /// callers cannot both observe "free".
    ///
    /// Takes `&'static self` because the returned guard releases the claim by
    /// reaching back into this registry on `Drop` — every consumer declares
    /// its registry as a `static`, so this is never a limitation in practice.
    pub(crate) fn try_acquire(
        &'static self,
        key: K,
        sink: Arc<EventSink<T>>,
    ) -> Option<InFlightGuard<K, T>> {
        let mut set = self.map().lock().ok()?;
        if set.contains_key(&key) {
            return None;
        }
        set.insert(key.clone(), sink);
        Some(InFlightGuard { key, registry: self })
    }
}

/// Releases its claim on drop — including on an early `return`, a `?`, or a
/// panic — so a failed job can never leave its target permanently unclaimable.
/// That is the whole reason this is a guard and not a matched acquire/release
/// pair.
pub(crate) struct InFlightGuard<K: Eq + Hash + 'static, T: Clone + 'static> {
    key: K,
    registry: &'static InFlightRegistry<K, T>,
}

impl<K: Eq + Hash, T: Clone> Drop for InFlightGuard<K, T> {
    fn drop(&mut self) {
        if let Ok(mut set) = self.registry.map().lock() {
            set.remove(&self.key);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Deliberately NOT `PathBuf`/`ModelDownloadEvent` — the download engine's
    // own tests (`model_download.rs`) already prove that instantiation keeps
    // working unchanged. These use a `String` key and a payload shape with no
    // relation to a download (no byte counts), so a pass here is evidence the
    // registry generalizes rather than evidence one particular monomorphization
    // still compiles.
    #[derive(Clone, serde::Serialize)]
    enum TestEvent {
        Tick(u32),
    }

    fn test_sink() -> Arc<EventSink<TestEvent>> {
        Arc::new(EventSink::new(Channel::new(|_body| Ok(()))))
    }

    static TEST_REGISTRY: InFlightRegistry<String, TestEvent> = InFlightRegistry::new();

    #[test]
    fn generalized_registry_supports_two_concurrent_distinct_keys() {
        let a = TEST_REGISTRY
            .try_acquire("project-a".to_string(), test_sink())
            .expect("project-a must be claimable");
        let b = TEST_REGISTRY
            .try_acquire("project-b".to_string(), test_sink())
            .expect("project-b must not be blocked by project-a — a different key entirely");
        assert!(TEST_REGISTRY.is_in_flight("project-a"));
        assert!(TEST_REGISTRY.is_in_flight("project-b"));
        // A payload with no relation to a byte count or a download event —
        // proves `EventSink::send` itself is generic, not just the registry.
        TEST_REGISTRY.attach("project-a").unwrap().send(TestEvent::Tick(1));
        drop(a);
        drop(b);
    }

    #[test]
    fn generalized_registry_rejects_duplicate_for_same_key() {
        let first = TEST_REGISTRY
            .try_acquire("project-dup".to_string(), test_sink())
            .expect("the first claim must succeed");
        assert!(
            TEST_REGISTRY.try_acquire("project-dup".to_string(), test_sink()).is_none(),
            "a second claim on the same key must be refused while the first holds it"
        );
        drop(first);
        assert!(
            TEST_REGISTRY.try_acquire("project-dup".to_string(), test_sink()).is_some(),
            "the claim must be released on drop, or the key becomes permanently unclaimable"
        );
    }

    #[test]
    fn generalized_registry_attach_hands_back_the_live_sink_and_none_once_dropped() {
        assert!(TEST_REGISTRY.attach("project-attach").is_none());
        let guard = TEST_REGISTRY
            .try_acquire("project-attach".to_string(), test_sink())
            .expect("claim");
        assert!(TEST_REGISTRY.attach("project-attach").is_some());
        drop(guard);
        assert!(TEST_REGISTRY.attach("project-attach").is_none());
    }
}
