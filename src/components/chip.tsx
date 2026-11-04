import { Pressable, StyleSheet, Text, type PressableProps } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = Omit<PressableProps, 'children'> & { label: string; selected?: boolean; danger?: boolean };

/** Small toggle/filter button (category chips, sort modes, formats, duplicate rule). */
export function Chip({ label, selected = false, danger = false, style, ...rest }: Props) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      hitSlop={4}
      style={(state) => [
        styles.chip,
        { backgroundColor: selected ? theme.tint : theme.backgroundElement },
        state.pressed && styles.pressed,
        typeof style === 'function' ? style(state) : style,
      ]}
      {...rest}>
      <Text style={[styles.label, { color: selected ? theme.onTint : danger ? theme.danger : theme.text }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: { minHeight: 36, borderRadius: 18, paddingHorizontal: Spacing.three, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 14, fontWeight: 600 },
  pressed: { opacity: 0.6 },
});
