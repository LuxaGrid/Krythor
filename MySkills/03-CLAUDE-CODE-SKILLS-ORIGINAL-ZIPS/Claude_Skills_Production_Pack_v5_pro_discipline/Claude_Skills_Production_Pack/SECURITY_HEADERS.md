# Security Headers (Firebase Hosting)

This pack provides a conservative CSP starter in templates/firebase_headers_snippet.json.

You may need to extend CSP for:
- Firebase Auth (connect-src)
- Google Fonts (style-src / font-src)
- Analytics (script-src / connect-src)

How to test:
- Open DevTools → Network → pick document → Response Headers
- Verify CSP doesn’t block required calls (Console warnings show violations)

Keep it allowlist-based. Add only what you need.
