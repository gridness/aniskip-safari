import Foundation
import SafariServices

final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    private struct Message: Decodable {
        let action: String
        let malID: Int
        let episode: Double
        let duration: Double
    }

    func beginRequest(with context: NSExtensionContext) {
        guard let item = context.inputItems.first as? NSExtensionItem,
              let payload = item.userInfo?[SFExtensionMessageKey] as? [String: Any],
              let data = try? JSONSerialization.data(withJSONObject: payload),
              let message = try? JSONDecoder().decode(Message.self, from: data),
              message.action == "skipTimes" else {
            reply(["error": "Unsupported extension request."], to: context)
            return
        }
        let request = SkipTimesRequest(malID: message.malID, episode: message.episode, duration: message.duration)
        Task {
            do {
                let result = try await AniSkipClient().skipTimes(for: request)
                let data = try JSONEncoder().encode(result)
                guard let payload = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                    throw AniSkipError.invalidResponse
                }
                reply(payload, to: context)
            } catch {
                reply(["error": error.localizedDescription], to: context)
            }
        }
    }

    private func reply(_ payload: [String: Any], to context: NSExtensionContext) {
        let item = NSExtensionItem()
        item.userInfo = [SFExtensionMessageKey: payload]
        context.completeRequest(returningItems: [item], completionHandler: nil)
    }
}
