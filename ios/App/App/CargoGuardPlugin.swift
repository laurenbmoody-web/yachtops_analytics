import UIKit
import Capacitor

// CargoGuard — tells the web app about screenshots and screen recording (iOS
// can report them but not block them), and whether this is a TestFlight
// (beta) build. Used by src/lib/security/guard.js:
//   CargoGuard.getInfo() → { testFlight, captured }
//   listeners: 'screenshot' {}, 'capture' { captured }
@objc(CargoGuardPlugin)
public class CargoGuardPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CargoGuardPlugin"
    public let jsName = "CargoGuard"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getInfo", returnType: CAPPluginReturnPromise)
    ]

    override public func load() {
        NotificationCenter.default.addObserver(
            self, selector: #selector(didTakeScreenshot),
            name: UIApplication.userDidTakeScreenshotNotification, object: nil)
        NotificationCenter.default.addObserver(
            self, selector: #selector(captureDidChange),
            name: UIScreen.capturedDidChangeNotification, object: nil)
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    // A TestFlight install carries a sandbox App Store receipt.
    private var isTestFlight: Bool {
        Bundle.main.appStoreReceiptURL?.lastPathComponent == "sandboxReceipt"
    }

    @objc func getInfo(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            call.resolve(["testFlight": self.isTestFlight, "captured": UIScreen.main.isCaptured])
        }
    }

    @objc private func didTakeScreenshot() {
        notifyListeners("screenshot", data: [:])
    }

    @objc private func captureDidChange() {
        DispatchQueue.main.async {
            self.notifyListeners("capture", data: ["captured": UIScreen.main.isCaptured])
        }
    }
}
