import { Search, X } from 'lucide-react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { useTheme } from '~/theme';
import { IconButton, Input } from '~/ui';

/**
 * The always-visible search box.
 *
 * On the web, search on the People screen is a `min-width: 240px` input in a toolbar; on a phone
 * it is the primary way to find anyone at all, so it lives in the header of every list that has
 * more rows than fit on a screen. A clear button rather than a keyboard dismissal: clearing a
 * query one character at a time on a phone keyboard is the sort of thing that makes people stop
 * using search.
 */
export function SearchField({
  value,
  onChange,
  placeholder,
  style,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  style?: StyleProp<ViewStyle>;
}) {
  const th = useTheme();

  return (
    <Input
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      accessibilityLabel={placeholder}
      autoCorrect={false}
      autoCapitalize="none"
      returnKeyType="search"
      containerStyle={style}
      iconLeft={<Search size={18} color={th.color.textMuted} />}
      iconRight={
        value ? (
          <IconButton label="Clear" size="sm" onPress={() => onChange('')}>
            <X size={16} color={th.color.textMuted} />
          </IconButton>
        ) : undefined
      }
    />
  );
}

/**
 * The one matching rule the whole app uses: case-insensitive, accent-sensitive substring over a
 * few fields.
 *
 * Accent-SENSITIVE is deliberate. Vietnamese names differ only by diacritic ("Hoà" vs "Hoa"), and
 * stripping them would make a search for one teacher return three. A staff member typing on a
 * Vietnamese keyboard gets the diacritics for free.
 */
export function matches(query: string, ...fields: (string | null | undefined)[]): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => (f ?? '').toLowerCase().includes(q));
}
