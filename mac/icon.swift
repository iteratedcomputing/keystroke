import Cocoa

let args = CommandLine.arguments
guard args.count == 3, let svg = NSImage(contentsOfFile: args[1]) else {
  fputs("usage: icon.swift <svg> <iconset dir>\n", stderr)
  exit(1)
}

func render(_ size: Int, to path: String) {
  let rep = NSBitmapImageRep(
    bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8,
    samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
    bytesPerRow: 0, bitsPerPixel: 0)!
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
  let s = CGFloat(size)
  let tile = NSRect(x: s * 0.1, y: s * 0.1, width: s * 0.8, height: s * 0.8)
  NSColor(red: 0.91, green: 0.70, blue: 0.25, alpha: 1).setFill()
  NSBezierPath(roundedRect: tile, xRadius: s * 0.18, yRadius: s * 0.18).fill()
  let inset = tile.insetBy(dx: s * 0.12, dy: s * 0.12)
  let aspect = svg.size.width / max(svg.size.height, 1)
  let h = inset.width / aspect
  svg.draw(in: NSRect(x: inset.minX, y: inset.midY - h / 2, width: inset.width, height: h))
  NSGraphicsContext.restoreGraphicsState()
  try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: path))
}

for base in [16, 32, 128, 256, 512] {
  render(base, to: "\(args[2])/icon_\(base)x\(base).png")
  render(base * 2, to: "\(args[2])/icon_\(base)x\(base)@2x.png")
}
