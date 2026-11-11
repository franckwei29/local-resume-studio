import CoreGraphics
import CoreText
import Foundation

let root=URL(fileURLWithPath: CommandLine.arguments[1],isDirectory:true)
var box=CGRect(x:0,y:0,width:595,height:842)
let words=["Education","North Lake University  2018.09 - 2022.07","West City College  2022.09 - 2024.07"]
func draw(_ cg:CGContext) {
  cg.setFillColor(CGColor(gray:1,alpha:1)); cg.fill(box)
  let font=CTFontCreateWithName("Helvetica" as CFString,20,nil)
  for (i,item) in words.enumerated() {
    let attr=NSAttributedString(string:item,attributes:[NSAttributedString.Key(kCTFontAttributeName as String):font,NSAttributedString.Key(kCTForegroundColorAttributeName as String):CGColor(gray:0,alpha:1)])
    cg.textPosition=CGPoint(x:40,y:760-40*i); CTLineDraw(CTLineCreateWithAttributedString(attr),cg)
  }
}
for image in [false,true] {
  let file=root.appendingPathComponent(image ? "scanned.pdf" : "text.pdf")
  let output=CGContext(file as CFURL,mediaBox:&box,nil)!
  output.beginPDFPage(nil)
  if image {
    let bitmap=CGContext(data:nil,width:1190,height:1684,bitsPerComponent:8,bytesPerRow:0,space:CGColorSpaceCreateDeviceRGB(),bitmapInfo:CGImageAlphaInfo.noneSkipLast.rawValue)!
    bitmap.scaleBy(x:2,y:2);draw(bitmap);output.draw(bitmap.makeImage()!,in:box)
  } else {draw(output)}
  output.endPDFPage();output.closePDF()
}
