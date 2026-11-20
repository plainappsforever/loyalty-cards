// Poster (1.1.0): the card used most, at credit-card ratio across the full width. Colour band with the shop name on top,
// white paper below with the code at the largest size that fits and the number. The code comes from the same render-once
// cache and the same layout rules as the card screen (never an encode here, D42). Tapping opens the card screen, which
// raises the brightness: the poster itself changes nothing about the till flow.
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { CodeView } from '@/components/code-view';
import { ThemedText } from '@/components/themed-text';
import { Colors, Paper, Radius, Spacing } from '@/constants/theme';
import type { Card } from '@/db/cards';
import { codeOf } from '@/db/cards';
import { codeKey, getCodeCache, type CodeCacheEntry } from '@/db/code-cache';
import { useSQLiteContext } from '@/db/provider';
import { FORMATS } from '@/engine/barcode/formats';
import { expiryState, groupNumber, textColorOn } from '@/engine/format';
import { useT } from '@/hooks/use-t';
import { isTwoD } from '@/lib/code-cache';

export const CARD_RATIO = 1.586;
const BAND = 36;
const NUMBER_ROW = 34;

type Props = { card: Card; width: number; now: number; testID: string; onPress: () => void };

export function Poster({ card, width, now, testID, onPress }: Props) {
  const db = useSQLiteContext();
  const t = useT();
  const [cache, setCache] = useState<CodeCacheEntry | null>(null);
  const two = isTwoD(card.format);
  const value = codeOf(card);

  useEffect(() => {
    let live = true;
    if (!two) return;
    void getCodeCache(db, card.id).then((c) => live && setCache(c && c.key === codeKey(card.format, value) ? c : null));
    return () => {
      live = false;
    };
  }, [db, card.id, card.format, value, two]);

  const height = Math.round(width / CARD_RATIO);
  const room = height - BAND - NUMBER_ROW - Spacing.three;
  const ink = textColorOn(card.color);
  const exp = expiryState(card.expiry, now);
  const drawable = card.format !== 'none' && FORMATS[card.format] !== undefined && (!two || cache !== null);
  const shownCache = two ? cache : null;

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={card.favourite ? `${card.name}, ${t('common.favourite')}` : card.name}
      onPress={onPress}
      style={({ pressed }) => [styles.card, { width, height }, pressed && styles.pressed]}>
      <View style={[styles.band, { backgroundColor: card.color }]}>
        <ThemedText numberOfLines={1} style={[styles.name, { color: ink }]}>
          {card.name}
        </ThemedText>
      </View>
      <View style={styles.paper}>
        {drawable ? (
          <CodeView value={value} format={card.format} cache={shownCache} width={width - Spacing.three * 2} height={room} />
        ) : (
          <View style={{ height: room }} />
        )}
        <View style={styles.numberRow}>
          <ThemedText numeric numberOfLines={1} style={styles.number}>
            {groupNumber(card.number)}
          </ThemedText>
        </View>
        {exp.state === 'soon' || exp.state === 'expired' ? (
          <ThemedText testID="poster-expiry" type="smallBold" style={styles.expiry}>
            {exp.state === 'soon' ? t('cards.expiresSoon') : t('cards.expired')}
          </ThemedText>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: Radius.card, overflow: 'hidden', backgroundColor: Paper.background, borderWidth: StyleSheet.hairlineWidth, borderColor: Colors.light.border },
  pressed: { opacity: 0.85 },
  band: { height: BAND, justifyContent: 'center', paddingHorizontal: Spacing.three },
  name: { fontSize: 17, fontWeight: 600 },
  paper: { flex: 1, alignItems: 'center', paddingTop: Spacing.two },
  numberRow: { height: NUMBER_ROW, justifyContent: 'center' },
  number: { color: Paper.ink, fontSize: 19, letterSpacing: 1.5 },
  expiry: { position: 'absolute', right: Spacing.three, bottom: Spacing.two, color: Paper.warning },
});
