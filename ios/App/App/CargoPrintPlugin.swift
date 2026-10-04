import UIKit
import WebKit
import Capacitor

// CargoPrint.printHtml({ html, name, baseUrl }) — renders an HTML document in an
// off-screen web view and opens the system print sheet (AirPrint, or "Save to
// Files" as PDF via the share button). Used by src/lib/native/windows.js, which
// is what the web app's print windows (labels, QR sheets, reports) turn into.
@objc(CargoPrintPlugin)
public class CargoPrintPlugin: CAPPlugin, CAPBridgedPlugin, WKNavigationDelegate {
    public let identifier = "CargoPrintPlugin"
    public let jsName = "CargoPrint"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "printHtml", returnType: CAPPluginReturnPromise)
    ]

    private var renderer: WKWebView?
    private var pending: CAPPluginCall?
    private var jobName = "Cargo"

    @objc func printHtml(_ call: CAPPluginCall) {
        guard let html = call.getString("html"), !html.isEmpty else {
            call.reject("html is required")
            return
        }
        jobName = call.getString("name") ?? "Cargo"
        let base = URL(string: call.getString("baseUrl") ?? "")
        DispatchQueue.main.async {
            self.pending?.reject("superseded by a newer print job")
            self.pending = call
            let web = WKWebView(frame: CGRect(x: 0, y: 0, width: 794, height: 1123)) // A4 @ 96dpi
            web.navigationDelegate = self
            self.renderer = web
            web.loadHTMLString(html, baseURL: base)
        }
    }

    public func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // Give images / web fonts a moment to paint before snapshotting.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { self.present(webView) }
    }

    public func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        finish(error: error.localizedDescription)
    }

    private func present(_ webView: WKWebView) {
        let info = UIPrintInfo(dictionary: nil)
        info.outputType = .general
        info.jobName = jobName
        let controller = UIPrintInteractionController.shared
        controller.printInfo = info
        controller.printFormatter = webView.viewPrintFormatter()

        let completion: UIPrintInteractionController.CompletionHandler = { _, _, error in
            self.finish(error: error?.localizedDescription)
        }
        if UIDevice.current.userInterfaceIdiom == .pad, let view = bridge?.viewController?.view {
            let anchor = CGRect(x: view.bounds.midX, y: view.bounds.maxY - 1, width: 1, height: 1)
            controller.present(from: anchor, in: view, animated: true, completionHandler: completion)
        } else {
            controller.present(animated: true, completionHandler: completion)
        }
    }

    private func finish(error: String?) {
        if let error = error { pending?.reject(error) } else { pending?.resolve() }
        pending = nil
        renderer = nil
    }
}
