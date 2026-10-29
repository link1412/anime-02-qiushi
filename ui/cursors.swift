import AppKit
_ = NSApplication.shared
let out = CommandLine.arguments[1]
let S: CGFloat = 4   // render scale (px per pt)
let cs: [(String, NSCursor)] = [("arrow", .arrow), ("hand", .pointingHand), ("ibeam", .iBeam)]
var meta: [String: Any] = [:]
for (n, c) in cs {
  let img = c.image; let sz = img.size
  let w = Int(ceil(sz.width * S)), h = Int(ceil(sz.height * S))
  let cs = CGColorSpace(name: CGColorSpace.sRGB)!
  let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: cs, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  ctx.scaleBy(x: S, y: S)
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(cgContext: ctx, flipped: false)
  img.draw(in: NSRect(origin: .zero, size: sz))
  NSGraphicsContext.restoreGraphicsState()
  let rep = NSBitmapImageRep(cgImage: ctx.makeImage()!)
  try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "\(out)/\(n).png"))
  meta[n] = ["w": sz.width, "h": sz.height, "hx": c.hotSpot.x, "hy": c.hotSpot.y, "scale": S]
}
let d = try! JSONSerialization.data(withJSONObject: meta, options: [.prettyPrinted, .sortedKeys])
try! d.write(to: URL(fileURLWithPath: "\(out)/meta.json"))
