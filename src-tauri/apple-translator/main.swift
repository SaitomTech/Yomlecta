import Foundation
import Translation

struct TranslationRequest: Decodable {
    let id: String
    let sourceLanguage: String
    let targetLanguage: String
    let items: [TranslationItem]
}

struct TranslationItem: Codable {
    let id: String
    let text: String
}

struct TranslatedItem: Encodable {
    let id: String
    let text: String
}

struct TranslationResponse: Encodable {
    let id: String
    let ok: Bool
    let translations: [TranslatedItem]?
    let error: String?
}

enum AppleTranslationError: LocalizedError {
    case unavailable(String)
    case emptyText
    case missingTranslation(String)

    var errorDescription: String? {
        switch self {
        case .unavailable(let detail): return detail
        case .emptyText: return "翻訳する文章が空です。"
        case .missingTranslation(let id): return "翻訳結果を対応付けられませんでした: \(id)"
        }
    }
}

@available(macOS 26.0, *)
func translate(
    _ request: TranslationRequest,
    onProgress: (Int, Int) -> Void
) async throws -> [TranslatedItem] {
    guard !request.items.isEmpty,
          request.items.allSatisfy({ !$0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) else {
        throw AppleTranslationError.emptyText
    }

    let source = Locale.Language(identifier: request.sourceLanguage)
    let target = Locale.Language(identifier: request.targetLanguage)
    let availability = await LanguageAvailability().status(from: source, to: target)
    switch availability {
    case .installed:
        break
    case .supported:
        throw AppleTranslationError.unavailable(
            "選択した言語の翻訳モデルがまだインストールされていません。システム設定の「一般」>「言語と地域」>「翻訳言語」でダウンロードしてください。"
        )
    case .unsupported:
        throw AppleTranslationError.unavailable(
            "Apple Translationはこの言語の組み合わせに対応していません。"
        )
    @unknown default:
        throw AppleTranslationError.unavailable("Apple Translationの対応状況を確認できませんでした。")
    }

    let session = TranslationSession(installedSource: source, target: target)
    let requests = request.items.map {
        TranslationSession.Request(sourceText: $0.text, clientIdentifier: $0.id)
    }
    var translationsByID: [String: String] = [:]
    for try await response in session.translate(batch: requests) {
        if let id = response.clientIdentifier {
            translationsByID[id] = response.targetText
        }
        onProgress(translationsByID.count, request.items.count)
    }
    return try request.items.map { item in
        guard let translatedText = translationsByID[item.id] else {
            throw AppleTranslationError.missingTranslation(item.id)
        }
        return TranslatedItem(id: item.id, text: translatedText)
    }
}

func writeProgress(id: String, completed: Int, total: Int) {
    let response: [String: Any] = [
        "id": id,
        "type": "progress",
        "completed": completed,
        "total": total,
    ]
    guard let data = try? JSONSerialization.data(withJSONObject: response, options: [.sortedKeys]) else {
        return
    }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([0x0A]))
}

func writeResponse(_ response: TranslationResponse) {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    do {
        let data = try encoder.encode(response)
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data([0x0A]))
    } catch {
        fputs("Apple Translationの応答を書き出せませんでした: \(error.localizedDescription)\n", stderr)
    }
}

@main
struct AppleTranslatorMain {
    static func main() async {
        do {
            for try await line in FileHandle.standardInput.bytes.lines {
                guard let data = line.data(using: .utf8) else { continue }
                do {
                    let request = try JSONDecoder().decode(TranslationRequest.self, from: data)
                    if #available(macOS 26.0, *) {
                        let result = try await translate(request) { completed, total in
                            writeProgress(id: request.id, completed: completed, total: total)
                        }
                        writeResponse(
                            TranslationResponse(
                                id: request.id,
                                ok: true,
                                translations: result,
                                error: nil
                            )
                        )
                    } else {
                        writeResponse(
                            TranslationResponse(
                                id: request.id,
                                ok: false,
                                translations: nil,
                                error: "Apple Translationのアプリ内翻訳にはmacOS 26以降が必要です。GPT-6 LunaまたはLFM2も利用できます。"
                            )
                        )
                    }
                } catch {
                    let id = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["id"] as? String ?? "unknown"
                    writeResponse(
                        TranslationResponse(
                            id: id,
                            ok: false,
                            translations: nil,
                            error: error.localizedDescription
                        )
                    )
                }
            }
        } catch {
            fputs("翻訳リクエストを読み取れませんでした: \(error.localizedDescription)\n", stderr)
            exit(EXIT_FAILURE)
        }
    }
}
