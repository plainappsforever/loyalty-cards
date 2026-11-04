# Retired files (kept, not built)

Files the app no longer uses, moved here with `git mv` instead of being deleted (owner rule: agents never delete files).
Nothing in this folder is compiled, linted or tested (`tsconfig.json` exclude, `eslint.config.js` ignores, Jest
`testPathIgnorePatterns`). Deleting the folder is the owner's call.

| File | Why it is here |
|---|---|
| `src/lib/notifications.ts` | Template demo for local notifications. `expo-notifications` was removed in P8a (DECISIONS D51): SPEC says no notifications, and the package linked Firebase Messaging, Google Play services and the install referrer into the Android release. |
| `plugins/without-firebase-push.js` | Removed Firebase push entries from the merged Android manifest; with `expo-notifications` gone nothing adds them. Restore it together with `expo-notifications` if the app ever schedules notifications. |
