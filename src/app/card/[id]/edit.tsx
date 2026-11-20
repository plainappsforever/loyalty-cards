// Edit (SPEC §7.5), also for a new card (`/card/new/edit?number=&format=&hint=&name=&confirm=1`). Name with known-shop
// suggestions, number, optional different barcode content, ranked barcode types with reasons (invalid ones marked, the
// fix offered as a button, never applied silently — L26), colour, categories, photos, note, balance, dates. Validation of
// long 2D values is debounced (D32: it may trial-encode). A number read from a PHOTO must be confirmed against the card
// before Save (D41.2, orchestrator decision for R2). Save renders a 2D code once and stores it with the row (D42).
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';

import { Button } from '@/components/button';
import { Chip } from '@/components/chip';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { codeOf, getCard, updateCard, type Card } from '@/db/cards';
import { listCategories, type Category } from '@/db/categories';
import { useSQLiteContext } from '@/db/provider';
import { clearDraftCard, getSettings, loadDraftCard, saveDraftCard } from '@/db/settings';
import { FORMAT_IDS, FORMATS, isFormatId, type FormatId } from '@/engine/barcode/formats';
import { suggestFormats, validate, type FormatSuggestion } from '@/engine/barcode/validate';
import { chainById, searchChains, type Chain } from '@/engine/chains';
import { colorForName } from '@/engine/catima/color';
import { isCurrencyCode } from '@/engine/currency';
import { deviceRegion } from '@/i18n';
import { useT } from '@/hooks/use-t';
import { useTheme } from '@/hooks/use-theme';
import { buildCodeCache } from '@/lib/code-cache';
import { dayText, parseDay } from '@/lib/dates';
import { draftApplies, EMPTY_FIELDS, fieldsKey, type DraftFields } from '@/lib/draft';
import { photoPaths, replacePhoto, storeNewCard, type PhotoSide } from '@/lib/files';
import { docUri, expoFs } from '@/lib/fs-expo';
import { newId } from '@/lib/id';
import { photoToTempJpeg, photoUri } from '@/lib/services';

const PRESETS = ['#1f6f43', '#c0392b', '#e67e22', '#e0a100', '#27ae60', '#16a085', '#2980b9', '#2c3e50', '#6b2fa0', '#8e44ad', '#d35400', '#7f8c8d'];
const DEBOUNCE_MS = 250;
// Draft (SPEC §9, D55): written this long after the last keystroke, and at once when the app goes to the background.
const DRAFT_DELAY_MS = 800;

type PhotoState = { kind: 'none' } | { kind: 'stored' } | { kind: 'new'; temp: string };

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const h = setTimeout(() => setV(value), ms);
    return () => clearTimeout(h);
  }, [value, ms]);
  return v;
}

export default function EditScreen() {
  const params = useLocalSearchParams<{ id: string; number?: string; format?: string; hint?: string; name?: string; confirm?: string }>();
  const isNew = params.id === 'new';
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const t = useT();

  const [card, setCard] = useState<Card | null>(null);
  const [ready, setReady] = useState(isNew);
  const [name, setName] = useState(params.name ?? '');
  const [number, setNumber] = useState(params.number ?? '');
  const [differs, setDiffers] = useState(false);
  const [codeValue, setCodeValue] = useState('');
  const [format, setFormat] = useState<FormatId | null>(isFormatId(params.format) ? params.format : null);
  const [showAll, setShowAll] = useState(false);
  const [color, setColor] = useState<string | null>(null);
  const [chainId, setChainId] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [balance, setBalance] = useState('');
  const [currency, setCurrency] = useState('');
  const [expiry, setExpiry] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [photos, setPhotos] = useState<Record<PhotoSide, PhotoState>>({ front: { kind: 'none' }, back: { kind: 'none' } });
  const [confirmed, setConfirmed] = useState(params.confirm !== '1');
  const [country, setCountry] = useState<string | null>(null);
  const [nameFocused, setNameFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const navigation = useNavigation();
  const [draftReady, setDraftReady] = useState(false);
  const leaving = useRef(false);
  const baselineKey = useRef('');
  const latest = useRef<{ fields: DraftFields; dirty: boolean }>({ fields: EMPTY_FIELDS, dirty: false });

  useEffect(() => {
    void listCategories(db).then(setCategories);
    void getSettings(db).then((s) => setCountry(s.defaultCountry || deviceRegion() || null));
    if (isNew) return;
    void getCard(db, params.id).then((c) => {
      if (!c) return;
      setCard(c);
      setName(c.name);
      setNumber(c.number);
      setDiffers(c.codeValue !== '');
      setCodeValue(c.codeValue);
      setFormat(c.format);
      setColor(c.color);
      setChainId(c.chainId);
      setCategoryIds(c.categoryIds);
      setNote(c.note);
      setBalance(c.balance);
      setCurrency(c.balanceCurrency);
      setExpiry(dayText(c.expiry));
      setValidFrom(dayText(c.validFrom));
      setPhotos({ front: { kind: c.hasFront ? 'stored' : 'none' }, back: { kind: c.hasBack ? 'stored' : 'none' } });
      setReady(true);
    });
  }, [db, isNew, params.id]);

  const value = (differs ? codeValue : number).trim();
  const debounced = useDebounced(value, value.length > 100 ? DEBOUNCE_MS : 0);
  const suggestions: FormatSuggestion[] = useMemo(() => (debounced === '' ? [] : suggestFormats(debounced, params.hint)), [debounced, params.hint]);
  const chosen: FormatId = format ?? suggestions[0]?.format ?? 'none';
  const validation = useMemo(() => (chosen === 'none' ? null : validate(debounced, chosen)), [debounced, chosen]);
  const pending = debounced !== value;
  const formatOk = chosen === 'none' || validation?.ok === true;
  const chains: Chain[] = useMemo(() => (nameFocused && name.trim().length >= 2 && !chainId ? searchChains(name, country, 4) : []), [nameFocused, name, chainId, country]);
  const shownFormats: FormatId[] = showAll ? [...FORMAT_IDS] : [...new Set<FormatId>([...suggestions.map((s) => s.format), chosen, 'none'])];
  const reasonOf = (f: FormatId) => suggestions.find((s) => s.format === f);

  const target = isNew ? 'new' : params.id;
  const baseUpdatedAt = card?.updatedAt ?? null;
  // A form opened with a scan/photo result (or the "check the number" box) is a fresh task: no draft is restored into it.
  const prefilled = isNew && !!(params.number || params.name || params.format || params.hint || params.confirm);
  const fields: DraftFields = useMemo(
    () => ({ name, number, differs, codeValue, format, color, chainId, categoryIds, note, balance, currency, expiry, validFrom }),
    [name, number, differs, codeValue, format, color, chainId, categoryIds, note, balance, currency, expiry, validFrom]
  );
  const key = useMemo(() => fieldsKey(fields), [fields]);

  // Restore (once, after the card is loaded): the unsaved form of a previous run of THIS form, if the app was killed or its task
  // was replaced by a widget or shortcut tap (D53.4). The baseline is the form as it opens, so a restored draft counts as changed.
  useEffect(() => {
    if (!ready || draftReady) return;
    baselineKey.current = fieldsKey(
      isNew
        ? { ...EMPTY_FIELDS, name: params.name ?? '', number: params.number ?? '', format: isFormatId(params.format) ? params.format : null }
        : {
            ...EMPTY_FIELDS,
            name: card?.name ?? '',
            number: card?.number ?? '',
            differs: (card?.codeValue ?? '') !== '',
            codeValue: card?.codeValue ?? '',
            format: card?.format ?? null,
            color: card?.color ?? null,
            chainId: card?.chainId ?? null,
            categoryIds: card?.categoryIds ?? [],
            note: card?.note ?? '',
            balance: card?.balance ?? '',
            currency: card?.balanceCurrency ?? '',
            expiry: dayText(card?.expiry ?? null),
            validFrom: dayText(card?.validFrom ?? null),
          }
    );
    let cancelled = false;
    void (prefilled ? Promise.resolve(null) : loadDraftCard(db)).then((d) => {
      if (cancelled) return;
      if (draftApplies(d, target, baseUpdatedAt)) {
        const f = d.fields;
        setName(f.name);
        setNumber(f.number);
        setDiffers(f.differs);
        setCodeValue(f.codeValue);
        setFormat(f.format);
        setColor(f.color);
        setChainId(f.chainId);
        setCategoryIds(f.categoryIds);
        setNote(f.note);
        setBalance(f.balance);
        setCurrency(f.currency);
        setExpiry(f.expiry);
        setValidFrom(f.validFrom);
      }
      setDraftReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [ready, draftReady, isNew, prefilled, db, target, baseUpdatedAt, card, params.name, params.number, params.format]);

  // Save: shortly after typing stops, and immediately when the app goes to the background (the last moment before a kill).
  useEffect(() => {
    const dirty = draftReady && key !== baselineKey.current;
    latest.current = { fields, dirty };
    if (!dirty || leaving.current) return;
    const h = setTimeout(() => {
      if (!leaving.current) void saveDraftCard(db, { v: 1, target, baseUpdatedAt, savedAt: Date.now(), fields });
    }, DRAFT_DELAY_MS);
    return () => clearTimeout(h);
  }, [draftReady, key, fields, db, target, baseUpdatedAt]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' || leaving.current || !latest.current.dirty) return;
      void saveDraftCard(db, { v: 1, target, baseUpdatedAt, savedAt: Date.now(), fields: latest.current.fields });
    });
    return () => sub.remove();
  }, [db, target, baseUpdatedAt]);

  // Leaving on purpose (Save, Back, Cancel) clears the draft. A task replaced by a widget tap or a killed process never gets here.
  useEffect(
    () =>
      navigation.addListener('beforeRemove', () => {
        leaving.current = true;
        void clearDraftCard(db);
      }),
    [navigation, db]
  );

  function pickFormat(f: FormatId) {
    setFormat(f);
    const s = reasonOf(f);
    // the "adds the check digit" reading is a different number: taking it is the user's tap (L26)
    if (s && s.reason === 'digitsCheckShown') (differs ? setCodeValue : setNumber)(s.value);
  }

  function pickChain(c: Chain) {
    setName(c.name);
    setChainId(c.id);
    setColor(c.color);
    if (format === null && value !== '' && validate(value, c.format).ok) setFormat(c.format);
  }

  async function pickPhoto(side: PhotoSide) {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1, exif: false });
    if (r.canceled || !r.assets[0]) return;
    try {
      const temp = await photoToTempJpeg(r.assets[0].uri);
      setPhotos((p) => ({ ...p, [side]: { kind: 'new', temp } }));
    } catch (e) {
      setError(t('edit.saveFailed', { reason: e instanceof Error ? e.message : String(e) }));
    }
  }

  const expiryMs = expiry.trim() === '' ? null : parseDay(expiry);
  const validFromMs = validFrom.trim() === '' ? null : parseDay(validFrom);
  const datesOk = (expiry.trim() === '' || expiryMs !== null) && (validFrom.trim() === '' || validFromMs !== null);
  const currencyOk = currency.trim() === '' || isCurrencyCode(currency.trim().toUpperCase());
  const canSave = ready && !saving && !pending && name.trim().length > 0 && number.trim().length + codeValue.trim().length > 0 && formatOk && datesOk && currencyOk && confirmed;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    const finalColor = color ?? colorForName(name.trim());
    const fields = {
      name: name.trim(),
      number: number.trim(),
      codeValue: differs ? codeValue.trim() : '',
      format: chosen,
      color: finalColor,
      chainId,
      note,
      balance: balance.trim(),
      balanceCurrency: currency.trim().toUpperCase(),
      validFrom: validFromMs,
      expiry: expiryMs,
      categoryIds,
    };
    // render once on save (D42): the only place a heavy 2D encode happens, behind "Saving…"
    await new Promise((r) => setTimeout(r, 0));
    const codeCache = buildCodeCache(codeOf(fields), chosen);
    try {
      if (isNew) {
        const id = newId();
        const captured = {
          front: photos.front.kind === 'new' ? photos.front.temp : undefined,
          back: photos.back.kind === 'new' ? photos.back.temp : undefined,
        };
        await storeNewCard(expoFs, db, { id, ...fields, codeCache }, captured);
        router.replace(`/card/${id}`);
        return;
      }
      const id = params.id;
      const removed = (['front', 'back'] as const).filter((s) => photos[s].kind === 'none' && (s === 'front' ? card?.hasFront : card?.hasBack));
      await updateCard(db, id, { ...fields, codeCache, ...(removed.includes('front') ? { hasFront: false } : {}), ...(removed.includes('back') ? { hasBack: false } : {}) });
      for (const side of removed) await expoFs.remove(photoPaths(id)[side]).catch(() => undefined);
      for (const side of ['front', 'back'] as const) {
        const p = photos[side];
        if (p.kind === 'new') await replacePhoto(expoFs, id, side, p.temp, () => updateCard(db, id, side === 'front' ? { hasFront: true } : { hasBack: true }));
      }
      router.back();
    } catch (e) {
      setError(t('edit.saveFailed', { reason: e instanceof Error ? e.message : String(e) }));
      setSaving(false);
    }
  }

  const input = [styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }];
  const invalid = validation && !validation.ok ? validation : null;

  return (
    <>
      <Stack.Screen options={{ title: isNew ? t('edit.titleNew') : t('edit.titleEdit') }} />
      <ScrollView testID="edit-screen" style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {params.confirm === '1' ? (
          <View testID="edit-confirm-box" style={[styles.confirm, { borderColor: theme.danger }]}>
            <ThemedText type="smallBold">{t('edit.confirmTitle')}</ThemedText>
            <ThemedText type="small">{t('edit.confirmBody')}</ThemedText>
            <ThemedText style={styles.confirmNumber} selectable>
              {value}
            </ThemedText>
            <View style={styles.switchRow}>
              <Switch testID="edit-confirm-number" accessibilityLabel={t('edit.confirmed')} value={confirmed} onValueChange={setConfirmed} />
              <ThemedText style={{ flex: 1 }}>{t('edit.confirmed')}</ThemedText>
            </View>
          </View>
        ) : null}

        <ThemedText type="smallBold">{t('edit.name')}</ThemedText>
        <TextInput
          testID="edit-name"
          accessibilityLabel={t('edit.name')}
          style={input}
          value={name}
          onChangeText={(v) => {
            setName(v);
            if (chainId && chainById(chainId)?.name !== v) setChainId(null);
          }}
          onFocus={() => setNameFocused(true)}
          onBlur={() => setTimeout(() => setNameFocused(false), 200)}
          placeholder={t('edit.namePlaceholder')}
          placeholderTextColor={theme.textSecondary}
          maxLength={80}
        />
        {chains.length ? (
          <View style={styles.wrap}>
            {chains.map((c, i) => (
              <Chip key={c.id} testID={`chain-suggestion-${i}`} label={`${c.name} · ${FORMATS[c.format].name}`} onPress={() => pickChain(c)} />
            ))}
          </View>
        ) : null}

        <ThemedText type="smallBold">{t('edit.number')}</ThemedText>
        <TextInput testID="edit-number" accessibilityLabel={t('edit.number')} style={[input, styles.mono]} value={number} onChangeText={setNumber} autoCapitalize="characters" autoCorrect={false} maxLength={1000} />
        <View style={styles.switchRow}>
          <Switch testID="edit-code-differs" accessibilityLabel={t('edit.codeDiffers')} value={differs} onValueChange={setDiffers} />
          <ThemedText style={{ flex: 1 }}>{t('edit.codeDiffers')}</ThemedText>
        </View>
        {differs ? (
          <>
            <ThemedText type="smallBold">{t('edit.codeValue')}</ThemedText>
            <TextInput testID="edit-code-value" accessibilityLabel={t('edit.codeValue')} style={[input, styles.mono]} value={codeValue} onChangeText={setCodeValue} autoCapitalize="none" autoCorrect={false} multiline maxLength={1000} />
          </>
        ) : null}

        <ThemedText type="smallBold">{t('edit.format')}</ThemedText>
        <View style={styles.wrap}>
          {shownFormats.map((f) => {
            const s = reasonOf(f);
            const ok = f === 'none' || !!s || (value !== '' && !pending && validate(debounced, f).ok);
            const label = f === 'none' ? t('format.none') : s ? `${FORMATS[f].name} · ${t(`edit.reason.${s.reason}`)}` : ok ? FORMATS[f].name : `${FORMATS[f].name} ✕`;
            return <Chip key={f} testID={`format-${f}`} label={label} selected={chosen === f} danger={!ok} onPress={() => pickFormat(f)} />;
          })}
        </View>
        <Pressable testID="edit-more-formats" accessibilityRole="button" onPress={() => setShowAll(!showAll)} hitSlop={6}>
          <ThemedText themeColor="tint" type="small">
            {showAll ? t('edit.fewerFormats') : t('edit.moreFormats')}
          </ThemedText>
        </Pressable>
        {invalid && value !== '' ? (
          <View style={{ gap: Spacing.one }}>
            <ThemedText testID="edit-error" themeColor="danger" accessibilityRole="alert" accessibilityLiveRegion="polite">
              {t(`edit.invalid.${invalid.error}`)}
            </ThemedText>
            {invalid.suggestion ? (
              <Button testID="edit-suggestion" variant="secondary" label={t('edit.useSuggestion', { value: invalid.suggestion.value })} onPress={() => (differs ? setCodeValue : setNumber)(invalid.suggestion!.value)} />
            ) : null}
          </View>
        ) : null}
        {validation?.ok && validation.notes.includes('upperCased') ? (
          <ThemedText type="small" themeColor="textSecondary">
            {t('edit.upperCased')}
          </ThemedText>
        ) : null}

        <ThemedText type="smallBold">{t('edit.color')}</ThemedText>
        <View style={styles.wrap}>
          {PRESETS.map((c, i) => (
            <Pressable key={c} testID={`color-${i}`} accessibilityRole="button" accessibilityLabel={`${t('edit.color')} ${i + 1}`} accessibilityState={{ selected: (color ?? '') === c }} onPress={() => setColor(c)} style={[styles.swatch, { backgroundColor: c, borderColor: (color ?? '') === c ? theme.text : 'transparent' }]} />
          ))}
        </View>

        {categories.length ? (
          <>
            <ThemedText type="smallBold">{t('edit.categories')}</ThemedText>
            <View style={styles.wrap}>
              {categories.map((c, i) => {
                const on = categoryIds.includes(c.id);
                return <Chip key={c.id} testID={`edit-category-${i}`} label={c.name} selected={on} onPress={() => setCategoryIds(on ? categoryIds.filter((x) => x !== c.id) : [...categoryIds, c.id])} />;
              })}
            </View>
          </>
        ) : null}

        <ThemedText type="smallBold">{t('edit.photos')}</ThemedText>
        <View style={styles.photos}>
          {(['front', 'back'] as const).map((side) => {
            const p = photos[side];
            const label = t(side === 'front' ? 'card.front' : 'card.back');
            const uri = p.kind === 'new' ? docUri(p.temp) : p.kind === 'stored' && card ? photoUri(card.id, side, card.updatedAt) : null;
            return (
              <View key={side} style={{ flex: 1, gap: Spacing.one }}>
                {uri ? <Image source={{ uri }} style={styles.photo} contentFit="cover" accessibilityLabel={label} /> : null}
                <Button testID={`edit-photo-${side}`} variant="secondary" label={t('edit.choosePhoto', { side: label })} onPress={() => pickPhoto(side)} />
                {p.kind !== 'none' ? <Button testID={`edit-photo-remove-${side}`} variant="secondary" label={t('edit.removePhoto', { side: label })} onPress={() => setPhotos((s) => ({ ...s, [side]: { kind: 'none' } }))} /> : null}
              </View>
            );
          })}
        </View>

        <ThemedText type="smallBold">{t('edit.note')}</ThemedText>
        <TextInput testID="edit-note" accessibilityLabel={t('edit.note')} style={[input, styles.multiline]} value={note} onChangeText={setNote} multiline maxLength={2000} />
        <ThemedText type="smallBold">{t('edit.balance')}</ThemedText>
        <TextInput testID="edit-balance" accessibilityLabel={t('edit.balance')} style={input} value={balance} onChangeText={setBalance} keyboardType="decimal-pad" maxLength={20} />
        <ThemedText type="smallBold">{t('edit.currency')}</ThemedText>
        <TextInput testID="edit-currency" accessibilityLabel={t('edit.currency')} style={input} value={currency} onChangeText={setCurrency} autoCapitalize="characters" maxLength={3} />
        {!currencyOk ? <ThemedText themeColor="danger">{t('edit.badCurrency')}</ThemedText> : null}
        <ThemedText type="smallBold">{t('edit.expiry')}</ThemedText>
        <TextInput testID="edit-expiry" accessibilityLabel={t('edit.expiry')} style={input} value={expiry} onChangeText={setExpiry} placeholder="2027-12-31" placeholderTextColor={theme.textSecondary} maxLength={10} />
        <ThemedText type="smallBold">{t('edit.validFrom')}</ThemedText>
        <TextInput testID="edit-valid-from" accessibilityLabel={t('edit.validFrom')} style={input} value={validFrom} onChangeText={setValidFrom} placeholder="2026-01-01" placeholderTextColor={theme.textSecondary} maxLength={10} />
        {!datesOk ? <ThemedText themeColor="danger">{t('edit.badDate')}</ThemedText> : null}

        {error ? (
          <ThemedText testID="edit-save-error" themeColor="danger" accessibilityRole="alert" accessibilityLiveRegion="polite">
            {error}
          </ThemedText>
        ) : null}
        <Button testID="edit-save" label={saving ? `${t('common.save')}…` : t('common.save')} onPress={save} disabled={!canSave} />
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.two, paddingBottom: Spacing.six },
  input: { minHeight: 48, borderRadius: Radius.card, paddingHorizontal: Spacing.three, fontSize: 16 },
  mono: { fontVariant: ['tabular-nums'], letterSpacing: 0.5 },
  multiline: { minHeight: 90, paddingTop: Spacing.three, textAlignVertical: 'top' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  swatch: { width: 40, height: 40, borderRadius: 20, borderWidth: 3 },
  photos: { flexDirection: 'row', gap: Spacing.two },
  photo: { width: '100%', aspectRatio: 1.586, borderRadius: 10 },
  confirm: { borderWidth: 2, borderRadius: Radius.card, padding: Spacing.three, gap: Spacing.two },
  confirmNumber: { fontSize: 24, lineHeight: 30, fontWeight: 700 },
});
