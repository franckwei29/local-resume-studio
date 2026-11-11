import AppKit
import Foundation
import PDFKit
import Vision

// Newline-delimited messages keep the UI responsive while OCR is running.
func emit(_ value: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: value) {
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data([10]))
    }
}
struct ImportError: LocalizedError {
    let reason: String
    var errorDescription: String? { reason }
    init(_ reason: String) { self.reason = reason }
}

func collectWordParagraphs(_ url: URL) throws -> [String] {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/unzip")
    process.arguments = ["-p", url.path, "word/document.xml"]
    let output = Pipe()
    process.standardOutput = output
    process.standardError = FileHandle.nullDevice
    try process.run()
    let data = output.fileHandleForReading.readDataToEndOfFile()
    process.waitUntilExit()
    guard process.terminationStatus == 0 else { throw ImportError("Word 文件已损坏或需要密码。") }
    let parser = XMLParser(data: data)
    let reader = WordReader()
    parser.delegate = reader
    parser.shouldResolveExternalEntities = false
    guard parser.parse() else { throw ImportError("无法解析 Word 文档段落。") }
    return reader.paragraphs
}

final class WordReader: NSObject, XMLParserDelegate {
    var paragraphs: [String] = []
    var current = ""
    var inText = false
    func parser(_ parser: XMLParser, didStartElement name: String, namespaceURI: String?, qualifiedName: String?, attributes: [String:String] = [:]) {
        switch name.split(separator: ":").last {
        case "p": current = ""
        case "t": inText = true
        case "br": current += "\n"
        case "tab": current += "\t"
        default: break
        }
    }
    func parser(_ parser: XMLParser, foundCharacters string: String) {
        if inText { current += string }
    }
    func parser(_ parser: XMLParser, didEndElement name: String, namespaceURI: String?, qualifiedName: String?) {
        switch name.split(separator: ":").last {
        case "t": inText = false
        case "p":
            let text = current.trimmingCharacters(in: .whitespacesAndNewlines)
            if !text.isEmpty { paragraphs.append(text) }
        default: break
        }
    }
}

func raster(_ page: PDFPage, longEdge: CGFloat) throws -> CGImage {
    let bounds = page.bounds(for: .cropBox)
    guard bounds.width > 0, bounds.height > 0 else { throw ImportError("无法读取页面尺寸。") }
    let ratio = longEdge / max(bounds.width, bounds.height)
    let image = page.thumbnail(of: NSSize(width: bounds.width * ratio, height: bounds.height * ratio), for: .cropBox)
    guard let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
        throw ImportError("无法读取 PDF 页图。")
    }
    return cg
}

func recognize(_ image: CGImage) throws -> [String] {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["zh-Hans", "en-US"]
    request.usesLanguageCorrection = true
    try VNImageRequestHandler(cgImage: image).perform([request])
    return (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
}

func importDocument(_ url: URL) throws {
    if url.pathExtension.lowercased() == "docx" {
        let paragraphs = try collectWordParagraphs(url)
        emit(["event": "page", "page": 1, "total": 1, "method": "docx", "lines": paragraphs])
        return
    }
    guard url.pathExtension.lowercased() == "pdf", let pdf = PDFDocument(url: url) else {
        throw ImportError("请选择有效的 PDF 或 DOCX 文件。")
    }
    guard !pdf.isLocked else { throw ImportError("此 PDF 已加密，请先在本机解锁副本。") }
    guard pdf.pageCount > 0 else { throw ImportError("PDF 没有可读取的页面。") }
    for index in 0..<pdf.pageCount {
        try autoreleasepool {
            guard let page = pdf.page(at: index) else { throw ImportError("无法读取第 \(index + 1) 页。") }
            let native = (page.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            let method = native.isEmpty ? "ocr" : "pdf"
            emit(["event": "progress", "page": index + 1, "total": pdf.pageCount, "method": method])
            let image = try raster(page, longEdge: native.isEmpty ? 2200 : 850)
            var lines: [String] = []
            var warning = ""
            if native.isEmpty {
                do { lines = try recognize(image) }
                catch { warning = "本页识别不可用，可对照原页手工补录。" }
            } else { lines = native.components(separatedBy: .newlines) }
            let thumb = try raster(page, longEdge: 800)
            let data = NSBitmapImageRep(cgImage: thumb).representation(using: .jpeg, properties: [.compressionFactor: 0.58])
            emit(["event": "page", "page": index + 1, "total": pdf.pageCount, "method": method,
                  "lines": lines.filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }, "warning": warning,
                  "image": data.map { "data:image/jpeg;base64," + $0.base64EncodedString() } ?? ""])
        }
    }
}

do {
    guard CommandLine.arguments.count == 2 else { throw ImportError("需要一个本机文档。") }
    try importDocument(URL(fileURLWithPath: CommandLine.arguments[1]))
} catch {
    emit(["event": "error", "message": error.localizedDescription])
    exit(1)
}
