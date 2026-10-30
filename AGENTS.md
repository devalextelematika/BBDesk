# Delivery of BBDesk archives

When the user requests a ZIP, a distributable build, or a download link for this plugin:

- Run `npm run share:zip` from `bb-plugin-dashboard`. It builds the plugin, packages it, uploads the ZIP as a BB project attachment, and verifies the downloaded bytes.
- Return the HTTP(S) download URL printed by the command as a Markdown link. A Windows filesystem path is not a download link.
- Use the current BB project and server context; never hardcode a project ID, port, or attachment filename from an earlier run.
- Explain that a localhost URL works on the BB computer. Do not present it as a public link for other people; the ZIP itself can be sent to them.
- If upload or verification fails, report the failure and keep the local archive. Do not claim that a download link is ready.

This is the default delivery process for future archive requests in this project.
