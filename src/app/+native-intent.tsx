// Incoming system URLs (S2 open-with, D40.5): iOS hands an opened zip/CSV over as a file:// URL (a copy in the app's
// Inbox), Android as the VIEW intent's content:// or file:// URI. Expo Router would treat either as a route path and
// show "Unmatched Route"; they go to the Receive screen instead. Every other link (our scheme, dev routes) passes through.
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    if (/^(file|content):\/\//i.test(path)) return `/receive?uri=${encodeURIComponent(path)}`;
    return path;
  } catch {
    return '/';
  }
}
