// Add – Scan (SPEC §7.3, §6.1, U1): the camera permission is asked HERE, when the user chose Scan (A8: the only prompt),
// never looped; denied → explanation + Type / From photo. All 13 barcode types; torch; "Type instead" always visible.
// A hit pauses scanning and shows the value and type; Continue → Edit prefilled with the scanner's type as the hint
// (suggestFormats ranks it first when the value is valid for it). An `LC1:` payload or a Catima link → Receive.
import { CameraView, useCameraPermissions, type BarcodeScanningResult, type BarcodeType } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { FORMATS, formatFromHint } from '@/engine/barcode/formats';
import { useT } from '@/hooks/use-t';
import { useTheme } from '@/hooks/use-theme';
import { readIncomingText } from '@/lib/receive';

const TYPES: BarcodeType[] = ['aztec', 'ean13', 'ean8', 'qr', 'pdf417', 'upc_e', 'datamatrix', 'code39', 'code93', 'itf14', 'codabar', 'code128', 'upc_a'];

export default function ScanScreen() {
  const router = useRouter();
  const theme = useTheme();
  const t = useT();
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [hit, setHit] = useState<{ value: string; type: string; shared: boolean } | null>(null);
  const asked = useRef(false);

  useEffect(() => {
    if (!permission || permission.granted || asked.current) return;
    if (permission.canAskAgain) {
      asked.current = true;
      void requestPermission();
    }
  }, [permission, requestPermission]);

  function onScanned(r: BarcodeScanningResult) {
    if (hit || !r.data) return;
    setHit({ value: r.data, type: r.type, shared: readIncomingText(r.data) !== null });
  }

  function proceed() {
    if (!hit) return;
    if (hit.shared) router.replace({ pathname: '/receive', params: { text: hit.value } });
    else router.replace({ pathname: '/card/[id]/edit', params: { id: 'new', number: hit.value, hint: hit.type } });
  }

  const denied = permission && !permission.granted && !permission.canAskAgain;
  const format = hit ? formatFromHint(hit.type) : undefined;

  return (
    <View testID="scan-screen" style={[styles.screen, { backgroundColor: theme.background }]}>
      {permission?.granted && !hit ? (
        <CameraView style={styles.camera} facing="back" enableTorch={torch} barcodeScannerSettings={{ barcodeTypes: TYPES }} onBarcodeScanned={onScanned} />
      ) : (
        <View style={[styles.camera, styles.placeholder, { backgroundColor: theme.backgroundElement }]}>
          {hit ? (
            <View testID="scan-hit" style={{ gap: Spacing.two, alignItems: 'center' }}>
              <ThemedText type="smallBold">{hit.shared ? t('scan.sharedCard') : t('scan.found', { format: format ? FORMATS[format].name : hit.type })}</ThemedText>
              <ThemedText testID="scan-value" style={styles.value} numberOfLines={4}>
                {hit.value}
              </ThemedText>
            </View>
          ) : (
            <ThemedText testID={denied ? 'scan-denied' : 'scan-waiting'} style={styles.message}>
              {denied ? t('scan.denied') : t('scan.asking')}
            </ThemedText>
          )}
        </View>
      )}
      <View style={styles.controls}>
        {hit ? (
          <>
            <Button testID="scan-continue" label={t('scan.continue')} onPress={proceed} />
            <Button testID="scan-again" variant="secondary" label={t('scan.again')} onPress={() => setHit(null)} />
          </>
        ) : (
          <>
            <ThemedText type="small" themeColor="textSecondary" style={styles.message}>
              {t('scan.hint')}
            </ThemedText>
            {permission?.granted ? <Button testID="scan-torch" variant="secondary" label={`${t('scan.torch')} ${torch ? '●' : '○'}`} accessibilityLabel={t('scan.torch')} accessibilityState={{ selected: torch }} onPress={() => setTorch(!torch)} /> : null}
          </>
        )}
        <Button testID="scan-type" variant="secondary" label={t('scan.typeInstead')} onPress={() => router.replace('/card/new/edit')} />
        <Button testID="scan-photo" variant="secondary" label={t('scan.fromPhoto')} onPress={() => router.replace('/add/photo')} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  camera: { flex: 1 },
  placeholder: { alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
  message: { textAlign: 'center' },
  value: { fontSize: 22, fontWeight: 700, textAlign: 'center' },
  controls: { padding: Spacing.three, gap: Spacing.two },
});
