import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public struct SkipTimesRequest: Codable, Sendable {
    public let malID: Int
    public let episode: Double
    public let duration: Double

    public init(malID: Int, episode: Double, duration: Double) {
        self.malID = malID
        self.episode = episode
        self.duration = duration
    }

    public var isValid: Bool {
        malID > 0 && malID <= 9_007_199_254_740_991 &&
        episode.isFinite && episode >= 0 && episode <= 100_000 &&
        duration.isFinite && duration > 0 && duration <= 86_400
    }
}

public struct SkipTimesResponse: Codable, Sendable {
    public struct Segment: Codable, Sendable {
        public struct Interval: Codable, Sendable {
            public let startTime: Double
            public let endTime: Double
        }
        public let interval: Interval
        public let skipType: String
        public let episodeLength: Double
    }
    public let found: Bool
    public let results: [Segment]

    public init(found: Bool, results: [Segment]) {
        self.found = found
        self.results = results
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        found = try values.decode(Bool.self, forKey: .found)
        results = try values.decodeIfPresent([Segment].self, forKey: .results) ?? []
    }
}

public enum AniSkipError: LocalizedError {
    case invalidRequest
    case http(Int)
    case invalidResponse

    public var errorDescription: String? {
        switch self {
        case .invalidRequest: "The episode metadata is invalid."
        case .http(429): "AniSkip is busy. Please try again in a minute."
        case .http(let code): "AniSkip is unavailable (HTTP \(code))."
        case .invalidResponse: "AniSkip returned an invalid response."
        }
    }
}

/// Native HTTPS networking keeps API access outside the website's script context.
public struct AniSkipClient {
    private let session: URLSession

    public init(session: URLSession? = nil) {
        if let session {
            self.session = session
        } else {
            let configuration = URLSessionConfiguration.ephemeral
            configuration.timeoutIntervalForRequest = 15
            configuration.timeoutIntervalForResource = 20
            configuration.httpCookieStorage = nil
            configuration.urlCache = nil
            self.session = URLSession(configuration: configuration)
        }
    }

    public func skipTimes(for input: SkipTimesRequest) async throws -> SkipTimesResponse {
        guard input.isValid else { throw AniSkipError.invalidRequest }
        var components = URLComponents(string: "https://api.aniskip.com/v2/skip-times/\(input.malID)/\(input.episode)")!
        components.queryItems = [
            URLQueryItem(name: "types[]", value: "op"),
            URLQueryItem(name: "types[]", value: "ed"),
            URLQueryItem(name: "episodeLength", value: String(input.duration))
        ]
        var request = URLRequest(url: components.url!)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("AniSkipSafari/0.1", forHTTPHeaderField: "User-Agent")
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw AniSkipError.invalidResponse }
        guard response.statusCode == 200 || response.statusCode == 404 else { throw AniSkipError.http(response.statusCode) }
        guard data.count < 1_000_000,
              let decoded = try? JSONDecoder().decode(SkipTimesResponse.self, from: data),
              response.statusCode == 200 || !decoded.found else { throw AniSkipError.invalidResponse }
        guard decoded.found else { return SkipTimesResponse(found: false, results: []) }
        let valid = decoded.results.filter {
            ["op", "ed"].contains($0.skipType) &&
            $0.interval.startTime.isFinite && $0.interval.endTime.isFinite && $0.episodeLength.isFinite &&
            $0.interval.startTime >= 0 && $0.interval.endTime > $0.interval.startTime && $0.episodeLength > 0
        }
        return SkipTimesResponse(found: !valid.isEmpty, results: valid)
    }
}
