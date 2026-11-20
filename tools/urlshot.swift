import Cocoa
import WebKit
// usage: COOKIE=name=value urlshot <url> <out.png> <width> <height> <waitSec> [js]
let a = CommandLine.arguments
let url = URL(string: a[1])!, out = a[2]
let w = Double(a[3])!, h = Double(a[4])!, wait = Double(a[5])!
let js = a.count > 6 ? a[6] : ""
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
class D: NSObject, WKNavigationDelegate {
  var done = false
  func webView(_ wv: WKWebView, didFinish n: WKNavigation!) {
    if done { return }; done = true
    DispatchQueue.main.asyncAfter(deadline: .now() + wait) {
      let style = "var s=document.createElement('style');s.textContent='*{animation:none!important;transition:none!important}';document.head.appendChild(s);"
      wv.evaluateJavaScript(style + js) { _, _ in
        DispatchQueue.main.asyncAfter(deadline: .now() + wait) {
          let cfg = WKSnapshotConfiguration()
          cfg.rect = CGRect(x: 0, y: 0, width: w, height: h)
          wv.takeSnapshot(with: cfg) { img, err in
            guard let img = img, let t = img.tiffRepresentation, let r = NSBitmapImageRep(data: t),
                  let png = r.representation(using: .png, properties: [:]) else { print("ERR \(String(describing: err))"); exit(1) }
            try! png.write(to: URL(fileURLWithPath: out)); print("wrote \(out)"); exit(0)
          }
        }
      }
    }
  }
}
let d = D()
let wv = WKWebView(frame: CGRect(x: 0, y: 0, width: w, height: h))
wv.navigationDelegate = d
if let c = ProcessInfo.processInfo.environment["COOKIE"], let eq = c.firstIndex(of: "=") {
  let props: [HTTPCookiePropertyKey: Any] = [.name: String(c[..<eq]), .value: String(c[c.index(after: eq)...]), .domain: url.host!, .path: "/"]
  wv.configuration.websiteDataStore.httpCookieStore.setCookie(HTTPCookie(properties: props)!) { wv.load(URLRequest(url: url)) }
} else { wv.load(URLRequest(url: url)) }
DispatchQueue.main.asyncAfter(deadline: .now() + 60) { print("timeout"); exit(2) }
app.run()
