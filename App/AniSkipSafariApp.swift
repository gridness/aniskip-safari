import SwiftUI
import SafariServices

@main
struct AniSkipSafariApp: App {
    var body: some Scene {
        WindowGroup("aniskip") {
            SetupView()
        }
        .windowResizability(.contentSize)
        .defaultSize(width: 400, height: 200)
    }
}

private struct SetupView: View {
    private let extensionIdentifier = "com.gridness.AniSkipSafari.Extension"
    @State private var status = "Checking Safari…"
    @State private var isEnabled = false
    private let accent = Color(red: 27.0 / 255, green: 94.0 / 255, blue: 32.0 / 255)

    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            HStack(spacing: 20) {
                Image("Anime365Logo")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 120, height: 35)
                    .padding(6)
                    .background(.white, in: .rect(cornerRadius: 7))
                    .accessibilityLabel("Anime365")
                Text("aniskip").font(.title.bold())
            }
            Label(status, systemImage: isEnabled ? "checkmark.circle.fill" : "safari")
                .foregroundStyle(isEnabled ? accent : Color.secondary)
            Button("Open Safari Extension Settings") {
                SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionIdentifier) { error in
                    if error != nil {
                        DispatchQueue.main.async { status = "Could not open Safari settings." }
                    }
                }
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
        }
        .padding(32)
        .frame(width: 400)
        .tint(accent)
        .task { refreshState() }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in refreshState() }
    }

    private func refreshState() {
        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: extensionIdentifier) { state, error in
            DispatchQueue.main.async {
                isEnabled = state?.isEnabled == true
                status = isEnabled ? "Enabled in Safari" : error == nil ? "Not enabled" : "Extension unavailable"
            }
        }
    }
}
