# PrioriLearn Focus Companion

This MV3 Chrome extension is intentionally small: users open it on a Canvas page, it reads only the active page title/heading after that click, then it opens the PrioriLearn focus session.

Load it through `chrome://extensions` → enable Developer mode → Load unpacked → select this `extension` directory.

The hackathon app includes an in-app preview of the same interaction. Production configuration will replace the local Vite URL in `popup.js` with the deployed application URL and pass a signed, consented context reference instead of page text.
