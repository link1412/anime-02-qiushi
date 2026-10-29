"""Stand-in for the film's screen during the real Spotlight/Maps take: a full-screen borderless window showing the
film's desktop + OpenCode window (compose.panel without the notch strip), so Spotlight's translucent panel blurs
the film's picture and nothing of the real desktop is behind it.
usage: python3 backdrop.py <3024x1890 png>   (main display is 3024x1890 at 1:1)"""
import sys, AppKit, objc
from PyObjCTools import AppHelper
WIN_X, WIN_Y, W, H, SCREEN_H = 0, 0, 3024, 1890, 1890
app = AppKit.NSApplication.sharedApplication()
app.setActivationPolicy_(AppKit.NSApplicationActivationPolicyRegular)
img = AppKit.NSImage.alloc().initWithContentsOfFile_(sys.argv[1])
img.setSize_((W, H))
win = AppKit.NSWindow.alloc().initWithContentRect_styleMask_backing_defer_(((WIN_X, SCREEN_H - WIN_Y - H), (W, H)), AppKit.NSWindowStyleMaskBorderless, AppKit.NSBackingStoreBuffered, False)
win.setOpaque_(False); win.setBackgroundColor_(AppKit.NSColor.clearColor()); win.setHasShadow_(False)
v = AppKit.NSImageView.alloc().initWithFrame_(((0, 0), (W, H)))
v.setImage_(img); v.setImageScaling_(AppKit.NSImageScaleNone); v.setWantsLayer_(True)
win.setContentView_(v)
win.makeKeyAndOrderFront_(None)
app.activateIgnoringOtherApps_(True)
AppHelper.runEventLoop()
