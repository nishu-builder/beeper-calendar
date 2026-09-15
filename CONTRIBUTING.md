# Contributing

Use Node.js 22+ and stable Rust. Install dependencies with `npm ci`, then run `npm run tauri dev` on macOS or `npm run dev` for the browser demo.

Run `npm run check`, `npm test`, `npm run test:e2e`, `npm run build` and the native tests before submitting a change. Format frontend files with `npm run format` and Rust with `cargo fmt`.

Keep service adapters separate from UI components. Add focused tests for changes to identity, retries, approval, state persistence or confirmation. Use synthetic messages and calendar fixtures in tests, screenshots and issues.

Do not add cloud fallback, implicit message sends, credential logging or optimistic calendar confirmation. New external mutations need explicit user-facing approval and durable recovery semantics. A server response that says a request was received is not proof it was applied.

Open a normal pull request describing the user-visible change, relevant boundary decisions and validation. Include screenshots for material UI changes. Never publish real message or calendar data.
