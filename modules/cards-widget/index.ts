// cards-widget: Android home-screen widgets (SPEC §6.4, A10; mood-journal modules/mood-widget pattern, RemoteViews — no JS
// runs for them). "Cards" 2×2 grid: four tiles, each opens its card; "Barcode" 4×2: the first widget card's code (PNG
// written by src/lib/widgets.ts at the module size layout() chose) with name and number, tap opens the card. The app
// pushes a JSON snapshot (WidgetData, src/lib/widget-data.ts); the widgets redraw from it.
import { NativeModule, requireOptionalNativeModule } from 'expo';

declare class CardsWidgetModule extends NativeModule {
  /** Stores the snapshot (JSON of WidgetData) and redraws every placed widget. */
  setData(json: string): void;
  /** D53: replaces the app shortcuts with `<scheme>://card/<id>` links (JSON `[{id,title,url}]`); returns the count. */
  setLinkShortcuts(json: string): number;
  /** Placed widgets of both kinds. */
  widgetCount(): number;
  /** "requested" (the launcher shows its dialog), "alreadyAdded" or "unsupported". */
  requestPinWidget(kind: 'grid' | 'barcode'): 'requested' | 'alreadyAdded' | 'unsupported';
}

/** Android only; null on iOS and in tests. */
export default requireOptionalNativeModule<CardsWidgetModule>('CardsWidget');
