// Draws a card's code at an integer module size (layout.ts, D20): 1D live from the engine (≤ 1.3 ms on Hermes, S4) as
// the referee-tested SVG; 2D ONLY from the render-once cache (D41.1, D42) as one path in module units scaled by the
// layout's module size — never an encode on the card screen. Black on white with its quiet zone, rotated 90° when the
// layout says so. `onDrawn` fires once after the first commit with the code (the card-open clock).
import { useEffect, useMemo, useRef } from 'react';
import { PixelRatio, View } from 'react-native';
import Svg, { Path, Rect, SvgXml } from 'react-native-svg';

import type { CodeCacheEntry } from '@/db/code-cache';
import { FORMATS, type FormatId } from '@/engine/barcode/formats';
import { layout, type Layout } from '@/engine/barcode/layout';
import { renderMatrix } from '@/engine/barcode/render';
import { toSvg } from '@/engine/barcode/svg';

type Props = {
  value: string;
  format: FormatId;
  /** Required for 2D formats; without it nothing is drawn (the caller shows why). */
  cache: CodeCacheEntry | null;
  /** Room in points. */
  width: number;
  height: number;
  testID?: string;
  onDrawn?: (info: { layout: Layout }) => void;
  onDense?: (dense: boolean) => void;
};

type Drawn = { kind: '1d'; svg: string; w: number; h: number; layout: Layout } | { kind: '2d'; entry: CodeCacheEntry; w: number; h: number; layout: Layout };

export function useDrawn(value: string, format: FormatId, cache: CodeCacheEntry | null, width: number, height: number): Drawn | null {
  return useMemo(() => {
    const ratio = PixelRatio.get();
    const info = FORMATS[format];
    if (info.kind === '2d') {
      if (!cache) return null;
      const l = layout({ kind: '2d', modulesWide: cache.modulesWide, modulesHigh: cache.modulesHigh }, { widthPx: width, heightPx: height }, info.minModulePx, ratio);
      return { kind: '2d', entry: cache, w: l.widthPx / ratio, h: l.heightPx / ratio, layout: l };
    }
    if (info.kind !== '1d' || value === '') return null;
    try {
      const m = renderMatrix(value, format);
      const l = layout(m, { widthPx: width, heightPx: height }, info.minModulePx, ratio);
      const s = toSvg(m, { modulePx: l.modulePx, barHeightPx: l.heightPx });
      return { kind: '1d', svg: s.svg, w: s.widthPx / ratio, h: s.heightPx / ratio, layout: l };
    } catch {
      return null;
    }
  }, [value, format, cache, width, height]);
}

export function CodeView({ value, format, cache, width, height, testID, onDrawn, onDense }: Props) {
  const drawn = useDrawn(value, format, cache, width, height);
  const reported = useRef(false);
  useEffect(() => {
    if (!drawn) return;
    onDense?.(drawn.layout.dense);
    if (reported.current || !onDrawn) return;
    reported.current = true;
    // the next frame is the first one that shows the code
    requestAnimationFrame(() => onDrawn({ layout: drawn.layout }));
  }, [drawn, onDrawn, onDense]);
  if (!drawn) return null;
  const rotate = drawn.layout.rotate;
  const body =
    drawn.kind === '1d' ? (
      <SvgXml xml={drawn.svg} width={drawn.w} height={drawn.h} />
    ) : (
      <Svg width={drawn.w} height={drawn.h} viewBox={`0 0 ${drawn.entry.modulesWide} ${drawn.entry.modulesHigh}`}>
        <Rect x={0} y={0} width={drawn.entry.modulesWide} height={drawn.entry.modulesHigh} fill="#ffffff" />
        <Path d={drawn.entry.path} fill="#000000" />
      </Svg>
    );
  if (!rotate) {
    return (
      <View testID={testID} style={{ width: drawn.w, height: drawn.h, backgroundColor: '#ffffff' }}>
        {body}
      </View>
    );
  }
  // rotated: the box takes the swapped size; the code is turned around its centre
  return (
    <View testID={testID} style={{ width: drawn.h, height: drawn.w, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ffffff' }}>
      <View style={{ width: drawn.w, height: drawn.h, transform: [{ rotate: '90deg' }] }}>{body}</View>
    </View>
  );
}
