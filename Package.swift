// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "AniSkipCore",
    platforms: [.macOS("27.0")],
    products: [.library(name: "AniSkipCore", targets: ["AniSkipCore"])],
    targets: [
        .target(name: "AniSkipCore"),
        .testTarget(name: "AniSkipCoreTests", dependencies: ["AniSkipCore"], path: "Tests/AniSkipCoreTests")
    ],
    swiftLanguageModes: [.v5]
)
