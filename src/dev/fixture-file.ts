// Test-only: a bundled test image as a real file path the native code can open.
// Debug builds serve assets over Metro (expo-asset downloads them into the cache: file://). A Release build embeds them as
// Android drawable resources, and expo-asset then reports the bare resource name ("test_fixtures_images_ean13") as
// `localUri`, which is no file (P8a-2: add-photo, export and the self-test read "0 codes" / "Could not decode"). The
// legacy expo-file-system copy opens resources by name, so such an asset is copied into the cache first.
import { Asset } from 'expo-asset';
import * as LegacyFs from 'expo-file-system/legacy';

export async function fixtureFileUri(module: number): Promise<string> {
  const asset = await Asset.fromModule(module).downloadAsync();
  const uri = asset.localUri ?? asset.uri;
  if (uri.startsWith('file://') || uri.startsWith('/')) return uri;
  const base = LegacyFs.cacheDirectory ?? '';
  const to = `${base}fixture-${asset.hash ?? asset.name}.${asset.type || 'png'}`;
  if (!(await LegacyFs.getInfoAsync(to)).exists) await LegacyFs.copyAsync({ from: uri, to });
  return to;
}
