import Foundation
import LocalAuthentication

/// Fresh device-owner check before showing the mnemonic / QR code on screen.
///
/// Why this exists: macOS Keychain ACLs include an "Always Allow" affordance.
/// Once the user clicks it for our mnemonic item, every subsequent Keychain read
/// in the app's signed identity skips the prompt — meaning a bystander on an
/// unlocked Mac could expand "Show mnemonic" and read the secret with no friction.
///
/// `RevealGate` puts a fresh `LAPolicy.deviceOwnerAuthentication` prompt (Touch ID,
/// Apple Watch, or password) in front of every reveal. The keychain item stays
/// unlocked for sync (which has to read it on every push/pull tick); the on-screen
/// **display** of the secret requires a fresh device-owner gesture.
///
/// Failures: a thrown `LAError` or the user cancelling produces `false`. Callers
/// keep the disclosure collapsed in that case.
enum RevealGate {
    /// Test seam — set to a closure that returns `true`/`false` to bypass the real
    /// LocalAuthentication prompt in unit tests.
    static var override: ((String) async -> Bool)?

    /// Asks the OS to authenticate the device owner. `reason` is the sentence shown
    /// in the system prompt under the lock icon. Returns `true` only on a successful
    /// fresh authentication; cancellations and errors return `false`.
    static func require(reason: String) async -> Bool {
        if let override { return await override(reason) }

        let context = LAContext()
        // Force a fresh prompt every call — never reuse a recent successful auth.
        context.touchIDAuthenticationAllowableReuseDuration = 0

        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
            return false
        }
        return await withCheckedContinuation { (cont: CheckedContinuation<Bool, Never>) in
            context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { ok, _ in
                cont.resume(returning: ok)
            }
        }
    }
}
