// ---------------------------------------------------------------------------
// Forced-alignment PRE-FLIGHT readiness check (WS1 Session M, Step 4).
//
// WHY THIS EXISTS. Before Session M, the only way to learn that forced
// alignment could not run was to run a full Apply Sync and read the FA-fallback
// entry AFTER it finished — several minutes of Whisper work for a run that was
// never going to use FA in the first place. Worse, the most common failure (the
// bundled onnxruntime runtime not loading) was invisible in the app entirely.
//
// This command answers, up front and cheaply, the three questions the FA gate's
// own `runForcedAlignmentForSync` can only answer by failing: is the runtime
// library loadable, and is the model for this language present. (Capability and
// language RESOLUTION are decided on the TS side, where the project object and
// the `isFaCapable`/`resolveFaLanguage` helpers already live — this command is
// the half that requires the backend: disk and the native runtime.) The TS
// caller folds all four into one pre-flight log entry the user sees before the
// sync starts, and skips the entry when the gate is closed.
//
// COST. The runtime probe is a dlopen + `ort` env init (milliseconds, no
// model). The model check is a path resolution + existence stat — it does NOT
// hash the ~1.2 GiB model (the real run's `verify_model_manifest` still owns
// that). A pre-flight is meant to be run before every FA sync, so it must stay
// this side of cheap.
// ---------------------------------------------------------------------------

use crate::fa::FaError;

/// The backend half of the FA readiness report. `camelCase` for the TS side.
#[derive(serde::Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FaPreflightReport {
    /// Whether this binary was compiled with the `fa-inference` feature at all.
    /// `false` in a plain `tauri:dev`/`tauri:build` — FA can never run there
    /// regardless of runtime/model, and the report says so rather than
    /// reporting a runtime failure that is really a build-config fact.
    pub feature_compiled: bool,
    /// The onnxruntime C library resolved AND loaded+init'd successfully.
    pub runtime_ok: bool,
    /// Human-readable: the resolved dylib path on success, or the verbatim
    /// resolution/loader error on failure (the same class of message the
    /// FA-fallback entry now surfaces).
    pub runtime_detail: String,
    /// The FA model for `language` was found on disk (path-resolved + exists).
    /// Not hash-verified here — that is the real run's job.
    pub model_present: bool,
    /// Human-readable: the resolved model path, or the searched-paths error.
    pub model_detail: String,
    /// Echoed back so the log entry and the run can be checked to agree on
    /// which language the readiness was computed for.
    pub language: String,
}

/// Reports FA runtime + model readiness for `language`, without running
/// inference. Never throws for a "not ready" condition — those are reported in
/// the boolean fields; it only `Err`s on a genuinely broken IPC precondition
/// (none today, so it is effectively infallible, but the signature matches the
/// other FA commands so the TS `invoke` shape is uniform).
#[tauri::command]
pub async fn fa_preflight(
    app: tauri::AppHandle,
    language: String,
) -> Result<FaPreflightReport, FaError> {
    // Model presence is a feature-independent fact (the resolver is compiled in
    // both configs), so check it the same way regardless.
    let (model_present, model_detail) = match crate::fa::fa_model_path(&app, &language) {
        Ok(path) => (true, path.to_string_lossy().to_string()),
        Err(e) => (false, e.message),
    };

    #[cfg(feature = "fa-inference")]
    let (feature_compiled, runtime_ok, runtime_detail) = {
        match crate::fa_onnx::probe_ort_runtime(&app) {
            Ok(dylib) => (true, true, format!("onnxruntime loaded from {dylib}")),
            Err(e) => (true, false, e.to_string()),
        }
    };

    #[cfg(not(feature = "fa-inference"))]
    let (feature_compiled, runtime_ok, runtime_detail) = (
        false,
        false,
        "forced-alignment inference is not compiled into this build (the `fa-inference` Cargo \
         feature is off — see CLAUDE.md §2, `npm run tauri:dev:fa`)."
            .to_string(),
    );

    Ok(FaPreflightReport {
        feature_compiled,
        runtime_ok,
        runtime_detail,
        model_present,
        model_detail,
        language,
    })
}
