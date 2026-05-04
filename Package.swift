// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "CornerTasks",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(name: "CornerTasks", targets: ["CornerTasks"])
    ],
    targets: [
        .executableTarget(
            name: "CornerTasks",
            path: "Sources/CornerTasks",
            resources: [
                .process("Resources")
            ],
            linkerSettings: [
                .linkedLibrary("sqlite3")
            ]
        )
    ]
)
