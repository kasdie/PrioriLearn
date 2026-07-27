# PrioriLearn Canvas Context Bridge

This MV3 Chrome extension is intentionally read only. After the user opens it on a Canvas page, it reads the visible page title or heading and opens PrioriLearn with that text as an unconfirmed manual-task draft.

Nothing is written to Canvas, and nothing is saved in PrioriLearn until the user reviews the course and task fields and presses the normal save action. The extension requests only `activeTab` and `scripting`; it has no OAuth token or background access.

Load it through `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select this `extension` directory.

The stable application origin is defined once in `popup.js`. Update that constant when the production domain changes.
