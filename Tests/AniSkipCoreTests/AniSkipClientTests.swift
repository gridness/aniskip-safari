import XCTest
@testable import AniSkipCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

private final class StubProtocol: URLProtocol {
    static var handler: ((URLRequest) throws -> (Int, Data))!
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            let (status, data) = try Self.handler(request)
            let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}

final class AniSkipClientTests: XCTestCase {
    private var session: URLSession!
    override func setUp() {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubProtocol.self]
        session = URLSession(configuration: config)
    }
    override func tearDown() { session.invalidateAndCancel(); session = nil; StubProtocol.handler = nil }

    func testUsesMALIDAndRepeatedSkipTypes() async throws {
        StubProtocol.handler = { request in
            let url = try XCTUnwrap(request.url)
            XCTAssertEqual(url.host, "api.aniskip.com")
            XCTAssertEqual(url.path, "/v2/skip-times/21/1.0")
            let query = URLComponents(url: url, resolvingAgainstBaseURL: false)!.queryItems!
            XCTAssertEqual(query.filter { $0.name == "types[]" }.compactMap(\.value), ["op", "ed"])
            XCTAssertEqual(query.first { $0.name == "episodeLength" }?.value, "1500.0")
            return (200, Data(#"{"found":true,"results":[{"skipType":"op","interval":{"startTime":28.783,"endTime":118.783},"episodeLength":1500.04}]}"#.utf8))
        }
        let result = try await AniSkipClient(session: session).skipTimes(for: .init(malID: 21, episode: 1, duration: 1500))
        XCTAssertTrue(result.found)
        XCTAssertEqual(result.results.first?.interval.endTime, 118.783)
    }

    func testMissingTimingsIsNotAnError() async throws {
        StubProtocol.handler = { _ in (404, Data(#"{"found":false,"message":"No skip times found"}"#.utf8)) }
        let result = try await AniSkipClient(session: session).skipTimes(for: .init(malID: 21, episode: 2, duration: 1500))
        XCTAssertFalse(result.found)
        XCTAssertTrue(result.results.isEmpty)
    }

    func testRateLimitingIsAnError() async {
        StubProtocol.handler = { _ in (429, Data()) }
        do {
            _ = try await AniSkipClient(session: session).skipTimes(for: .init(malID: 21, episode: 1, duration: 1500))
            XCTFail("Expected rate limit failure")
        } catch AniSkipError.http(let status) { XCTAssertEqual(status, 429) }
        catch { XCTFail("Unexpected error: \(error)") }
    }

    func testMalformedResponsesAreRejected() async {
        StubProtocol.handler = { _ in (200, Data("<html>not JSON</html>".utf8)) }
        do {
            _ = try await AniSkipClient(session: session).skipTimes(for: .init(malID: 21, episode: 1, duration: 1500))
            XCTFail("Expected response failure")
        } catch AniSkipError.invalidResponse {} catch { XCTFail("Unexpected error: \(error)") }
    }

    func testInvalidInputDoesNotMakeANetworkRequest() async {
        StubProtocol.handler = { _ in XCTFail("Invalid input reached the network"); return (500, Data()) }
        for request in [SkipTimesRequest(malID: 0, episode: 1, duration: 1500), .init(malID: 21, episode: -1, duration: 1500), .init(malID: 21, episode: 1, duration: .infinity)] {
            do {
                _ = try await AniSkipClient(session: session).skipTimes(for: request)
                XCTFail("Expected invalid input failure")
            } catch AniSkipError.invalidRequest {} catch { XCTFail("Unexpected error: \(error)") }
        }
    }
}
