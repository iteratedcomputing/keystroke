import Cocoa
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, NSWindowDelegate {
  private var window: NSWindow!
  private var webView: WKWebView!
  private var server: Process?
  private let info = Bundle.main.infoDictionary ?? [:]

  private var root: String { info["KeystrokeRoot"] as? String ?? "" }
  private var node: String { info["KeystrokeNode"] as? String ?? "node" }
  private var port: String { info["KeystrokePort"] as? String ?? "7778" }
  private var url: URL { URL(string: "http://localhost:\(port)/")! }

  func applicationDidFinishLaunching(_ notification: Notification) {
    buildMenu()
    if let icon = NSImage(contentsOfFile: "\(root)/public/favicon.svg") {
      NSApp.applicationIconImage = icon
    }
    let config = WKWebViewConfiguration()
    config.websiteDataStore = .default()
    webView = WKWebView(frame: .zero, configuration: config)
    webView.navigationDelegate = self
    window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 1100, height: 760),
      styleMask: [.titled, .closable, .miniaturizable, .resizable],
      backing: .buffered, defer: false)
    window.title = "keystroke"
    window.titlebarAppearsTransparent = true
    window.appearance = NSAppearance(named: .darkAqua)
    window.backgroundColor = NSColor(red: 0.047, green: 0.051, blue: 0.063, alpha: 1)
    window.contentView = webView
    window.delegate = self
    window.center()
    window.setFrameAutosaveName("KeystrokeMain")
    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
    startServer()
    waitForServer(attempts: 100)
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

  func applicationWillTerminate(_ notification: Notification) {
    server?.terminate()
    server?.waitUntilExit()
  }

  private func startServer() {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/bin/zsh")
    process.arguments = ["-lc", "exec \"$KEYSTROKE_NODE\" src/server.js"]
    process.currentDirectoryURL = URL(fileURLWithPath: root)
    var env = ProcessInfo.processInfo.environment
    env["KEYSTROKE_NODE"] = node
    env["KEYSTROKE_OPEN"] = "0"
    env["PORT"] = port
    process.environment = env
    let log = FileManager.default.homeDirectoryForCurrentUser
      .appendingPathComponent("Library/Logs/keystroke.log")
    FileManager.default.createFile(atPath: log.path, contents: nil)
    if let handle = try? FileHandle(forWritingTo: log) {
      process.standardOutput = handle
      process.standardError = handle
    }
    do {
      try process.run()
      server = process
    } catch {
      showError("could not start node: \(error.localizedDescription)")
    }
  }

  private func waitForServer(attempts: Int) {
    var request = URLRequest(url: url.appendingPathComponent("api/status"))
    request.timeoutInterval = 1
    URLSession.shared.dataTask(with: request) { _, response, _ in
      DispatchQueue.main.async {
        if (response as? HTTPURLResponse)?.statusCode == 200 {
          self.webView.load(URLRequest(url: self.url))
        } else if attempts > 0 {
          DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
            self.waitForServer(attempts: attempts - 1)
          }
        } else {
          self.showError("the keystroke server did not start. see ~/Library/Logs/keystroke.log")
        }
      }
    }.resume()
  }

  private func showError(_ message: String) {
    let html = "<body style='background:#0c0d10;color:#e8e6e3;font:14px ui-monospace;padding:40px'>\(message)</body>"
    webView.loadHTMLString(html, baseURL: nil)
  }

  func webView(
    _ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
    decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
  ) {
    if let target = action.request.url, target.host != "localhost",
      action.navigationType == .linkActivated
    {
      NSWorkspace.shared.open(target)
      decisionHandler(.cancel)
      return
    }
    decisionHandler(.allow)
  }

  private func call(_ name: String) {
    webView.evaluateJavaScript("window.keystroke?.\(name)()")
  }

  @objc func newPost(_ sender: Any?) { call("newPost") }
  @objc func savePost(_ sender: Any?) { call("save") }
  @objc func togglePreview(_ sender: Any?) { call("togglePreview") }
  @objc func reload(_ sender: Any?) { webView.load(URLRequest(url: url)) }
  @objc func revealDrafts(_ sender: Any?) {
    webView.evaluateJavaScript("window.keystroke?.draftsDir()") { result, _ in
      if let dir = result as? String {
        NSWorkspace.shared.open(URL(fileURLWithPath: dir))
      }
    }
  }

  private func buildMenu() {
    let main = NSMenu()
    let appItem = NSMenuItem()
    let appMenu = NSMenu()
    appMenu.addItem(withTitle: "Hide keystroke", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
    appMenu.addItem(.separator())
    appMenu.addItem(withTitle: "Quit keystroke", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    appItem.submenu = appMenu
    main.addItem(appItem)

    let fileItem = NSMenuItem()
    let fileMenu = NSMenu(title: "File")
    fileMenu.addItem(withTitle: "New", action: #selector(newPost(_:)), keyEquivalent: "n")
    fileMenu.addItem(withTitle: "Save", action: #selector(savePost(_:)), keyEquivalent: "s")
    fileMenu.addItem(withTitle: "Show Drafts Folder", action: #selector(revealDrafts(_:)), keyEquivalent: "o")
    fileMenu.addItem(.separator())
    fileMenu.addItem(withTitle: "Close Window", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
    fileItem.submenu = fileMenu
    main.addItem(fileItem)

    let editItem = NSMenuItem()
    let editMenu = NSMenu(title: "Edit")
    editMenu.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
    editMenu.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
    editMenu.addItem(.separator())
    editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
    editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
    editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
    editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
    editItem.submenu = editMenu
    main.addItem(editItem)

    let viewItem = NSMenuItem()
    let viewMenu = NSMenu(title: "View")
    viewMenu.addItem(withTitle: "Toggle Preview", action: #selector(togglePreview(_:)), keyEquivalent: "p")
    viewMenu.addItem(withTitle: "Reload", action: #selector(reload(_:)), keyEquivalent: "r")
    let fullScreen = viewMenu.addItem(withTitle: "Enter Full Screen", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
    fullScreen.keyEquivalentModifierMask = [.command, .control]
    viewItem.submenu = viewMenu
    main.addItem(viewItem)

    let windowItem = NSMenuItem()
    let windowMenu = NSMenu(title: "Window")
    windowMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
    windowItem.submenu = windowMenu
    main.addItem(windowItem)
    NSApp.windowsMenu = windowMenu

    NSApp.mainMenu = main
  }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
