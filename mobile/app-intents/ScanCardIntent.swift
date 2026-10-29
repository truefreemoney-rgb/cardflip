import AppIntents
internal import ExpoAppIntents

/// The scanner shortcut (docs/APP-PLAN.md step 6, "Lock Screen / Action Button
/// scanner shortcut", 10-29). One App Intent that opens the app straight into
/// the camera. Because it is an App Shortcut with phrases, iOS lists it on its
/// own in the Shortcuts app, in Settings → Action Button → Shortcut, in the
/// Lock Screen / Control Center "Shortcut" control, and in Siri ("Scan a card
/// in CardFlip"), with nothing for the user to build. The JavaScript side
/// (src/app/_layout.tsx) receives the "scanCard" invocation and pushes /scan.
struct ScanCardIntent: AppIntent {
  static let title: LocalizedStringResource = "Scan a card"
  static let description = IntentDescription("Opens the CardFlip camera to scan a card and see what it is worth.")
  static let openAppWhenRun: Bool = true

  @MainActor
  func perform() async throws -> some IntentResult {
    await AppIntentDispatcher.shared.dispatch(name: "scanCard")
    return .result()
  }
}

struct CardFlipShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: ScanCardIntent(),
      phrases: [
        "Scan a card in \(.applicationName)",
        "Scan a card with \(.applicationName)",
        "Open the scanner in \(.applicationName)",
      ],
      shortTitle: "Scan a card",
      systemImageName: "camera.viewfinder"
    )
  }
}
