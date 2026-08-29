using System.Windows.Input;
using System.Windows.Interop;

namespace BuildConsole.Controls
{
    /// <summary>
    /// Git #1631 — Home/End typed inside a WebView2 chat tab was switching the
    /// active BuildConsole tab instead of moving the caret.
    ///
    /// Home and End don't map to a printable character, so WebView2 classifies
    /// them as "accelerator keys" (Microsoft's own definition: an accelerator is
    /// any key where Ctrl/Alt is held, OR the key doesn't map to a character —
    /// Home/End satisfy the second clause with no modifier needed). Left
    /// unhandled, WebView2 (which derives from HwndHost) turns an unhandled
    /// accelerator key into a real WPF routed KeyDown that bubbles up the visual
    /// tree. EditorTabs is a plain TabControl, and TabControl.OnKeyDown has a
    /// built-in class handler that marks Home/End as handled and jumps to the
    /// first/last TabItem — so with nothing intercepting it first, every Home/End
    /// typed inside any chat composer bubbled straight into that navigation.
    ///
    /// The SDK version this project references (Microsoft.Web.WebView2
    /// 1.0.4129.50) does not expose CoreWebView2Controller or an
    /// AcceleratorKeyPressed event publicly on the WPF WebView2 control — both
    /// are internal in this version (confirmed by direct reflection against the
    /// resolved assembly; a build attempting `wv.AcceleratorKeyPressed` fails
    /// with CS1061). The supported extensibility point for a hosted HWND control
    /// is HwndHost.TranslateAcceleratorCore, which WebView2's own base-class
    /// plumbing calls before turning an unhandled accelerator key into that
    /// routed KeyDown in the first place. Returning true here for Home/End
    /// (without calling base) stops the translation at the WebView2 itself, so
    /// it never reaches EditorTabs — every other key (Ctrl+N, Ctrl+K, Ctrl+Tab,
    /// Page Up/Down, the arrow keys, everything Window_PreviewKeyDown or
    /// TabControl's own Ctrl+Tab handling relies on) flows through completely
    /// unchanged, since only VK_HOME/VK_END are ever intercepted here.
    ///
    /// Use this in place of Microsoft.Web.WebView2.Wpf.WebView2 at every WebView2
    /// construction site in the app — it IS-A WebView2, so nothing else about
    /// existing call sites (event wiring, CoreWebView2 usage, return types) needs
    /// to change.
    /// </summary>
    internal sealed class ChatSafeWebView2 : Microsoft.Web.WebView2.Wpf.WebView2
    {
        private const int WM_KEYDOWN = 0x0100;
        private const int WM_SYSKEYDOWN = 0x0104;
        private const int VK_HOME = 0x24;
        private const int VK_END = 0x23;

        protected override bool TranslateAcceleratorCore(ref MSG msg, ModifierKeys modifiers)
        {
            if (msg.message == WM_KEYDOWN || msg.message == WM_SYSKEYDOWN)
            {
                int virtualKey = msg.wParam.ToInt32();
                if (virtualKey == VK_HOME || virtualKey == VK_END)
                {
                    // Handled — swallow it here so it never becomes a WPF routed
                    // KeyDown that TabControl's default Home/End navigation can see.
                    // The browser itself still gets the key (WebView2 already
                    // dispatched it as an accelerator candidate before asking us),
                    // so Home/End keep moving the caret inside the composer.
                    return true;
                }
            }

            return base.TranslateAcceleratorCore(ref msg, modifiers);
        }
    }
}
