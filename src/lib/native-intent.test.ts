/**
 * @jest-environment node
 */
import { redirectSystemPath } from '@/app/+native-intent';

describe('+native-intent (S2 open-with → Receive)', () => {
  it('sends an opened file (iOS file://, Android content:// or file://) to the Receive screen', () => {
    const ios = 'file:///private/var/mobile/Containers/Data/Application/X/Documents/Inbox/Catima%20Export.zip';
    expect(redirectSystemPath({ path: ios, initial: true })).toBe(`/receive?uri=${encodeURIComponent(ios)}`);
    const android = 'content://com.android.providers.downloads.documents/document/42';
    expect(redirectSystemPath({ path: android, initial: false })).toBe(`/receive?uri=${encodeURIComponent(android)}`);
  });

  it('leaves app links and routes alone', () => {
    expect(redirectSystemPath({ path: 'loyaltycards-dev://debug/seed?set=ten', initial: false })).toBe('loyaltycards-dev://debug/seed?set=ten');
    expect(redirectSystemPath({ path: '/card/abc', initial: true })).toBe('/card/abc');
  });
});
