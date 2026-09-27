import Foundation
import Vision

struct Point: Codable {
    let x: Double
    let y: Double
}

struct TextBlock: Codable {
    let text: String
    let confidence: Double
    let polygon: [Point]
}

struct OcrResponse: Codable {
    let rawText: String
    let blocks: [TextBlock]
    let engineVersion: String
}

struct VisionRegion: Codable {
    let confidence: Double
    let polygon: [Point]
}

struct FaceRegion: Codable {
    let confidence: Double
    let polygon: [Point]
    let landmarkSignature: [Double]?
}

struct RectangleDetectionResponse: Codable {
    let imagePath: String
    let rectangles: [VisionRegion]
    let engineVersion: String
}

struct PeopleDetectionResponse: Codable {
    let imagePath: String
    let faces: [FaceRegion]
    let humans: [VisionRegion]
    let engineVersion: String
}

struct TextRegionDetectionResponse: Codable {
    let imagePath: String
    let textRegions: [VisionRegion]
    let engineVersion: String
}

enum VisionOcrError: LocalizedError {
    case missingImagePath
    case imageCouldNotBeLoaded(String)
    case noSupportedLanguages
    case recognitionFailed(String)

    var errorDescription: String? {
        switch self {
        case .missingImagePath:
            return "画像パスが指定されていません。"
        case .imageCouldNotBeLoaded(let path):
            return "OCR対象の画像を読み込めませんでした: \(path)"
        case .noSupportedLanguages:
            return "このmacOS環境で利用できるOCR言語がありません。"
        case .recognitionFailed(let message):
            return "Apple Visionの処理に失敗しました: \(message)"
        }
    }
}

func requestedLanguages(from value: String) -> [String] {
    value.split(separator: "+").compactMap { language in
        switch language.lowercased() {
        case "ja", "ja-jp", "jpn":
            return "ja-JP"
        case "en", "en-us", "eng":
            return "en-US"
        default:
            return nil
        }
    }
}

func topLeftPolygon(for box: CGRect) -> [Point] {
    // Vision normally returns normalized coordinates, but observations at an
    // image edge can contain tiny floating-point excursions outside [0, 1].
    // Keep the sidecar response valid for the client-side schema.
    func clampNormalized(_ value: Double) -> Double {
        min(max(value, 0), 1)
    }

    let minX = clampNormalized(Double(box.minX))
    let maxX = clampNormalized(Double(box.maxX))
    let minY = clampNormalized(1 - Double(box.maxY))
    let maxY = clampNormalized(1 - Double(box.minY))

    return [
        Point(x: minX, y: minY),
        Point(x: maxX, y: minY),
        Point(x: maxX, y: maxY),
        Point(x: minX, y: maxY),
    ]
}

func topLeftPoint(for point: CGPoint) -> Point {
    func clampNormalized(_ value: Double) -> Double {
        min(max(value, 0), 1)
    }

    return Point(
        x: clampNormalized(Double(point.x)),
        y: clampNormalized(1 - Double(point.y))
    )
}

func topLeftPolygon(for observation: VNRectangleObservation) -> [Point] {
    [
        topLeftPoint(for: observation.topLeft),
        topLeftPoint(for: observation.topRight),
        topLeftPoint(for: observation.bottomRight),
        topLeftPoint(for: observation.bottomLeft),
    ]
}

func recognize(imagePath: String, languageValue: String) throws -> OcrResponse {
    let imageURL = URL(fileURLWithPath: imagePath)
    guard FileManager.default.fileExists(atPath: imagePath) else {
        throw VisionOcrError.imageCouldNotBeLoaded(imagePath)
    }

    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false

    let revision = VNRecognizeTextRequest.currentRevision
    request.revision = revision
    let supportedLanguages = try VNRecognizeTextRequest.supportedRecognitionLanguages(
        for: .accurate,
        revision: revision
    )
    let requested = requestedLanguages(from: languageValue)
    let languages = requested.filter { supportedLanguages.contains($0) }
    guard !languages.isEmpty else {
        throw VisionOcrError.noSupportedLanguages
    }
    request.recognitionLanguages = languages

    let handler = VNImageRequestHandler(url: imageURL, options: [:])
    do {
        try handler.perform([request])
    } catch {
        let nsError = error as NSError
        throw VisionOcrError.recognitionFailed(
            "\(error.localizedDescription) (domain=\(nsError.domain), code=\(nsError.code), revision=\(revision))"
        )
    }

    let blocks = (request.results ?? []).compactMap { observation -> TextBlock? in
        guard let candidate = observation.topCandidates(1).first else { return nil }
        let text = candidate.string.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }

        return TextBlock(
            text: text,
            confidence: Double(candidate.confidence),
            polygon: topLeftPolygon(for: observation.boundingBox)
        )
    }.sorted { first, second in
        let firstY = first.polygon.first?.y ?? 0
        let secondY = second.polygon.first?.y ?? 0
        if abs(firstY - secondY) > 0.02 {
            return firstY < secondY
        }

        let firstX = first.polygon.first?.x ?? 0
        let secondX = second.polygon.first?.x ?? 0
        return firstX < secondX
    }

    return OcrResponse(
        rawText: blocks.map(\.text).joined(separator: "\n"),
        blocks: blocks,
        engineVersion: "apple-vision-revision-\(revision)"
    )
}

func detectRectangles(imagePath: String) throws -> RectangleDetectionResponse {
    let imageURL = URL(fileURLWithPath: imagePath)
    guard FileManager.default.fileExists(atPath: imagePath) else {
        throw VisionOcrError.imageCouldNotBeLoaded(imagePath)
    }

    let rectangleRequest = VNDetectRectanglesRequest()
    rectangleRequest.maximumObservations = 8
    rectangleRequest.minimumConfidence = 0.2
    rectangleRequest.minimumSize = 0.18
    rectangleRequest.minimumAspectRatio = 0.35
    rectangleRequest.maximumAspectRatio = 1.0
    rectangleRequest.quadratureTolerance = 30

    let handler = VNImageRequestHandler(url: imageURL, options: [:])

    do {
        try handler.perform([rectangleRequest])
    } catch {
        let nsError = error as NSError
        throw VisionOcrError.recognitionFailed(
            "矩形検出に失敗しました: \(error.localizedDescription) (domain=\(nsError.domain), code=\(nsError.code))"
        )
    }

    let rectangles = (rectangleRequest.results ?? []).map { observation in
        VisionRegion(
            confidence: Double(observation.confidence),
            polygon: topLeftPolygon(for: observation)
        )
    }

    return RectangleDetectionResponse(
        imagePath: imagePath,
        rectangles: rectangles,
        engineVersion: "apple-vision-rectangles-\(VNDetectRectanglesRequest.currentRevision)"
    )
}

func normalizedPoints(from region: VNFaceLandmarkRegion2D?) -> [Double] {
    guard let region else { return [] }
    return (0..<region.pointCount).flatMap { index in
        let point = region.normalizedPoints[index]
        return [Double(point.x), Double(point.y)]
    }
}

func faceLandmarkSignature(from landmarks: VNFaceLandmarks2D?) -> [Double]? {
    guard let landmarks else { return nil }
    let signature = [
        landmarks.faceContour,
        landmarks.leftEye,
        landmarks.rightEye,
        landmarks.leftEyebrow,
        landmarks.rightEyebrow,
        landmarks.nose,
        landmarks.noseCrest,
        landmarks.medianLine,
        landmarks.outerLips,
        landmarks.innerLips,
    ].flatMap(normalizedPoints)
    return signature.isEmpty ? nil : signature
}

func detectFaces(imageURL: URL, cpuOnly: Bool) throws -> [FaceRegion] {
    let faceRequest = VNDetectFaceLandmarksRequest()
    faceRequest.revision = VNDetectFaceLandmarksRequest.currentRevision
    faceRequest.usesCPUOnly = cpuOnly
    try VNImageRequestHandler(url: imageURL, options: [:]).perform([faceRequest])
    return (faceRequest.results ?? []).map { observation in
        FaceRegion(
            confidence: Double(observation.confidence),
            polygon: topLeftPolygon(for: observation.boundingBox),
            landmarkSignature: faceLandmarkSignature(from: observation.landmarks)
        )
    }
}

func detectTextRegions(imagePath: String) throws -> TextRegionDetectionResponse {
    let imageURL = URL(fileURLWithPath: imagePath)
    guard FileManager.default.fileExists(atPath: imagePath) else {
        throw VisionOcrError.imageCouldNotBeLoaded(imagePath)
    }

    let request = VNDetectTextRectanglesRequest()
    request.reportCharacterBoxes = false
    try VNImageRequestHandler(url: imageURL, options: [:]).perform([request])

    let regions = (request.results ?? []).map { observation in
        VisionRegion(
            confidence: Double(observation.confidence),
            polygon: topLeftPolygon(for: observation.boundingBox)
        )
    }
    return TextRegionDetectionResponse(
        imagePath: imagePath,
        textRegions: regions,
        engineVersion: "apple-vision-text-regions-\(VNDetectTextRectanglesRequest.currentRevision)"
    )
}

func detectHumans(imageURL: URL, cpuOnly: Bool) throws -> [VisionRegion] {
    let humanRequest = VNDetectHumanRectanglesRequest()
    humanRequest.revision = VNDetectHumanRectanglesRequest.currentRevision
    humanRequest.usesCPUOnly = cpuOnly
    if #available(macOS 12.0, *) {
        humanRequest.upperBodyOnly = false
    }
    try VNImageRequestHandler(url: imageURL, options: [:]).perform([humanRequest])
    return (humanRequest.results ?? []).map { observation in
        VisionRegion(
            confidence: Double(observation.confidence),
            polygon: topLeftPolygon(for: observation.boundingBox)
        )
    }
}

func detectPeople(imagePath: String) throws -> PeopleDetectionResponse {
    let imageURL = URL(fileURLWithPath: imagePath)
    guard FileManager.default.fileExists(atPath: imagePath) else {
        throw VisionOcrError.imageCouldNotBeLoaded(imagePath)
    }

    var faceRegions: [FaceRegion] = []
    var humanRegions: [VisionRegion] = []
    var usedCpuFallback = false
    var failures: [String] = []
    do {
        faceRegions = try detectFaces(imageURL: imageURL, cpuOnly: false)
    } catch {
        do {
            faceRegions = try detectFaces(imageURL: imageURL, cpuOnly: true)
            usedCpuFallback = true
        } catch {
            failures.append("face: \(error.localizedDescription)")
        }
    }
    do {
        humanRegions = try detectHumans(imageURL: imageURL, cpuOnly: false)
    } catch {
        do {
            humanRegions = try detectHumans(imageURL: imageURL, cpuOnly: true)
            usedCpuFallback = true
        } catch {
            failures.append("human: \(error.localizedDescription)")
        }
    }
    if failures.count == 2 {
        throw VisionOcrError.recognitionFailed("人物検出に失敗しました: \(failures.joined(separator: "; "))")
    }

    return PeopleDetectionResponse(
        imagePath: imagePath,
        faces: faceRegions,
        humans: humanRegions,
        engineVersion: "apple-vision-people-face-landmarks-\(VNDetectFaceLandmarksRequest.currentRevision)-human-\(VNDetectHumanRectanglesRequest.currentRevision)-\(usedCpuFallback ? "cpu-fallback" : "default")"
    )
}

func writeJSON<T: Encodable>(_ value: T) throws {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    let data = try encoder.encode(value)
    guard let output = String(data: data, encoding: .utf8) else {
        throw VisionOcrError.recognitionFailed("JSON出力をUTF-8へ変換できませんでした")
    }
    print(output)
}

do {
    guard CommandLine.arguments.count >= 2 else {
        throw VisionOcrError.missingImagePath
    }

    if CommandLine.arguments[1] == "--detect-people" {
        let imagePaths = Array(CommandLine.arguments.dropFirst(2))
        guard !imagePaths.isEmpty else {
            throw VisionOcrError.missingImagePath
        }
        try writeJSON(imagePaths.map { try detectPeople(imagePath: $0) })
    } else if CommandLine.arguments[1] == "--detect-text-regions" {
        let imagePaths = Array(CommandLine.arguments.dropFirst(2))
        guard !imagePaths.isEmpty else {
            throw VisionOcrError.missingImagePath
        }
        try writeJSON(imagePaths.map { try detectTextRegions(imagePath: $0) })
    } else if CommandLine.arguments[1] == "--detect-rectangles" {
        let imagePaths = Array(CommandLine.arguments.dropFirst(2))
        guard imagePaths.count == 1, let imagePath = imagePaths.first else {
            throw VisionOcrError.missingImagePath
        }
        try writeJSON(detectRectangles(imagePath: imagePath))
    } else {
        let imagePath = CommandLine.arguments[1]
        let languageValue = CommandLine.arguments.count >= 3 ? CommandLine.arguments[2] : "ja+en"
        try writeJSON(recognize(imagePath: imagePath, languageValue: languageValue))
    }
} catch {
    FileHandle.standardError.write(
        Data("\(error.localizedDescription)\n".utf8)
    )
    exit(EXIT_FAILURE)
}
