package uk.co.cargotechnology.app;

import android.content.Context;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * CargoPrint.printHtml({ html, name, baseUrl }) — renders an HTML document in an
 * off-screen WebView and hands it to the system print service (printers, or
 * "Save as PDF"). Used by src/lib/native/windows.js, which is what the web
 * app's print windows (labels, QR sheets, reports) turn into.
 */
@CapacitorPlugin(name = "CargoPrint")
public class CargoPrintPlugin extends Plugin {

    // Held until the print job has its document — a collected WebView prints blank.
    private WebView renderer;

    @PluginMethod
    public void printHtml(PluginCall call) {
        String html = call.getString("html");
        if (html == null || html.isEmpty()) {
            call.reject("html is required");
            return;
        }
        String name = call.getString("name", "Cargo");
        String baseUrl = call.getString("baseUrl", null);

        getActivity().runOnUiThread(() -> {
            WebView web = new WebView(getContext());
            web.getSettings().setJavaScriptEnabled(false);
            web.setWebViewClient(new WebViewClient() {
                private boolean printed = false;

                @Override
                public void onPageFinished(WebView view, String url) {
                    if (printed) return;
                    printed = true;
                    PrintManager pm = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
                    if (pm == null) {
                        renderer = null;
                        call.reject("printing is not available on this device");
                        return;
                    }
                    pm.print(name, view.createPrintDocumentAdapter(name),
                            new PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.ISO_A4).build());
                    call.resolve();
                }
            });
            renderer = web;
            web.loadDataWithBaseURL(baseUrl, html, "text/html", "UTF-8", null);
        });
    }
}
