/**
 * P7 (iOS only, SPEC §6.4, A10): the "Tillcard" widget with expo-widgets + @expo/ui (mood-journal D68 pattern).
 * - systemSmall: one card's tile + name; tap opens that card.
 * - systemMedium: that card's barcode (PNG from the App Group, drawn at its own pixel size — the scale came from
 *   layout(), src/lib/widget-data.ts) or its tile when the code cannot be shown, its number, and 3 more tiles (each a Link).
 * - accessoryCircular: initials → opens the card; accessoryRectangular: name + "Open".
 * Which card: the widget's configuration (iOS 17+, "Card" 1–8 = the position in the widget list: chosen, favourites,
 * most used); default the first. The `'widget'` function is turned into a string at build time and runs in the widget
 * extension, where every @expo/ui/swift-ui component and modifier is a global: it may use only its arguments and those
 * globals (no other imports, no module constants). Import this file only through src/lib/widgets.ts (iOS, lazily).
 */
import { HStack, Image, Link, RoundedRectangle, Spacer, Text, VStack, ZStack } from '@expo/ui/swift-ui';
import { font, foregroundStyle, frame, lineLimit, minimumScaleFactor, resizable, widgetURL } from '@expo/ui/swift-ui/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';

import type { WidgetData } from '@/lib/widget-data';

/** Must match the widget `name` in the expo-widgets plugin config (app.config.ts). */
export const CARDS_WIDGET = 'CardsWidget';

/** `card1` … `card8` (enum values must be Swift identifiers). */
export type CardsWidgetConfiguration = { card: string };

function CardsWidgetLayout(props: WidgetData, environment: WidgetEnvironment<CardsWidgetConfiguration>) {
  'widget';
  const family = environment.widgetFamily;
  const cards = props.cards ?? [];
  const wanted = Math.max(0, Number(String(environment.configuration?.card ?? 'card1').replace('card', '')) - 1 || 0);
  const index = cards.length ? Math.min(wanted, cards.length - 1) : -1;
  const main = index >= 0 ? cards[index] : null;
  const secondary = foregroundStyle({ type: 'hierarchical', style: 'secondary' });
  const tile = (c: WidgetData['cards'][number], size: number) => (
    <ZStack modifiers={[frame({ width: size, height: size })]}>
      <RoundedRectangle cornerRadius={size * 0.22} modifiers={[foregroundStyle(c.color)]} />
      <Text modifiers={[font({ size: size * 0.38, weight: 'bold' }), foregroundStyle(c.fg), lineLimit(1), minimumScaleFactor(0.5)]}>{c.initials}</Text>
    </ZStack>
  );

  if (!main) {
    return (
      <VStack alignment="leading" spacing={4} modifiers={[widgetURL(props.appUrl ?? 'loyaltycards://')]}>
        <Text modifiers={[font({ size: 14, weight: 'semibold' }), lineLimit(1)]}>{props.title ?? 'Tillcard'}</Text>
        <Text modifiers={[font({ size: 12 }), secondary, lineLimit(3), minimumScaleFactor(0.7)]}>{props.empty ?? ''}</Text>
      </VStack>
    );
  }

  if (family === 'accessoryCircular') {
    return (
      <ZStack modifiers={[widgetURL(main.url)]}>
        <Text modifiers={[font({ size: 20, weight: 'bold' }), lineLimit(1), minimumScaleFactor(0.5)]}>{main.initials}</Text>
      </ZStack>
    );
  }
  if (family === 'accessoryRectangular' || family === 'accessoryInline') {
    return (
      <VStack alignment="leading" spacing={2} modifiers={[widgetURL(main.url)]}>
        <Text modifiers={[font({ size: 15, weight: 'semibold' }), lineLimit(1)]}>{main.name}</Text>
        <Text modifiers={[font({ size: 13 }), lineLimit(1)]}>{props.open}</Text>
      </VStack>
    );
  }
  if (family === 'systemMedium' || family === 'systemLarge') {
    const others = cards.filter((_c, i) => i !== index).slice(0, 3);
    const code = main.image ? (
      <Image uiImage={main.image.uri} modifiers={[resizable(), frame({ width: main.image.width, height: main.image.height })]} />
    ) : (
      tile(main, 56)
    );
    return (
      <VStack alignment="leading" spacing={4}>
        <Link destination={main.url}>
          <VStack alignment="leading" spacing={3}>
            <HStack spacing={6}>
              <Text modifiers={[font({ size: 14, weight: 'semibold' }), lineLimit(1)]}>{main.name}</Text>
              <Spacer />
              {main.image ? null : <Text modifiers={[font({ size: 12 }), secondary, lineLimit(1)]}>{main.kind === 'none' ? props.open : props.noCode}</Text>}
            </HStack>
            {main.kind === '2d' && main.image ? (
              <HStack spacing={8}>
                {code}
                <Text modifiers={[font({ size: 13, design: 'monospaced' }), lineLimit(3), minimumScaleFactor(0.6)]}>{main.number}</Text>
              </HStack>
            ) : (
              <VStack alignment="leading" spacing={2}>
                {code}
                <Text modifiers={[font({ size: 12, design: 'monospaced' }), lineLimit(1), minimumScaleFactor(0.6)]}>{main.number}</Text>
              </VStack>
            )}
          </VStack>
        </Link>
        {main.kind === '2d' && main.image ? null : (
          <HStack spacing={8}>
            {others.map((c) => (
              <Link key={c.id} destination={c.url}>
                {tile(c, 26)}
              </Link>
            ))}
            <Spacer />
          </HStack>
        )}
      </VStack>
    );
  }
  // systemSmall (and anything else): the card's tile + name; one tap opens it.
  return (
    <VStack alignment="leading" spacing={6} modifiers={[widgetURL(main.url)]}>
      {tile(main, 52)}
      <Spacer />
      <Text modifiers={[font({ size: 15, weight: 'semibold' }), lineLimit(2), minimumScaleFactor(0.7)]}>{main.name}</Text>
      <Text modifiers={[font({ size: 12 }), secondary, lineLimit(1)]}>{props.open}</Text>
    </VStack>
  );
}

export const CardsWidget = createWidget<WidgetData, CardsWidgetConfiguration>(CARDS_WIDGET, CardsWidgetLayout);
