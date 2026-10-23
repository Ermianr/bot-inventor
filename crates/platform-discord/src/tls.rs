//! The TLS crypto provider. rustls works only once one is installed for the process, and the
//! twilight crates leave the choice to the application.

/// Installs the `ring` provider if the process has none yet. It is safe to call many times.
pub(crate) fn install() {
    // `Err` means a provider is already installed, which is just as good.
    let _ = rustls::crypto::ring::default_provider().install_default();
}
