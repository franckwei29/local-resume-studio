import Foundation
import PDFKit

// Report each GoTo annotation's physical source center and destination page in the exported document.
struct Link: Encodable {
    let from: Int
    let x: Double
    let y: Double
    let target: Int
}
let document = PDFDocument(url: URL(fileURLWithPath: CommandLine.arguments[1]))!
var links = [Link]()
for index in 0..<document.pageCount {
    guard let page = document.page(at: index) else { continue }
    let paper = page.bounds(for: .cropBox)
    for annotation in page.annotations {
        if let destination = (annotation.action as? PDFActionGoTo)?.destination ?? annotation.destination,
           let target = destination.page {
            let bounds = annotation.bounds
            links.append(Link(from: index+1,
                              x: (bounds.midX-paper.minX)/paper.width*210,
                              y: (paper.maxY-bounds.midY)/paper.height*297,
                              target: document.index(for: target)+1))
        }
    }
}
print(String(decoding: try JSONEncoder().encode(links), as: UTF8.self))
