import UIKit
import Capacitor

private let cargoCanvas = UIColor(red: 0xF8 / 255.0, green: 0xFA / 255.0, blue: 0xFC / 255.0, alpha: 1)

// The Capacitor bridge (its view *is* the web view). Registers the app's local
// plugins.
class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(CargoPrintPlugin())
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        webView?.isOpaque = false
        webView?.backgroundColor = cargoCanvas
        webView?.scrollView.backgroundColor = cargoCanvas
    }
}

// Window root: hosts the bridge inside the safe area (below the status bar /
// notch / Dynamic Island, above the home indicator), so the web app's fixed
// 64px header and full-height pages lay out exactly as in a browser — no
// env(safe-area-inset-*) CSS needed across the app. The strips outside show
// the Cargo canvas colour.
class SafeAreaContainerViewController: UIViewController {
    let bridgeController = MainViewController()

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = cargoCanvas
        addChild(bridgeController)
        let content = bridgeController.view!
        content.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(content)
        let guide = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            content.topAnchor.constraint(equalTo: guide.topAnchor),
            content.bottomAnchor.constraint(equalTo: guide.bottomAnchor),
            content.leadingAnchor.constraint(equalTo: guide.leadingAnchor),
            content.trailingAnchor.constraint(equalTo: guide.trailingAnchor),
        ])
        bridgeController.didMove(toParent: self)
    }

    // Let the bridge (SystemBars plugin) drive the status bar.
    override var childForStatusBarStyle: UIViewController? { bridgeController }
    override var childForStatusBarHidden: UIViewController? { bridgeController }
}
