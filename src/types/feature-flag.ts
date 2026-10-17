/// One remote on/off switch, as `GET /api/admin/features` returns it.
export type FeatureFlag = {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
};

/// Defensive parse: a missing label falls back to the key so a row is never
/// blank, and only a literal `true` reads as on — the same rule the server and
/// the app apply.
export function parseFeatureFlag(raw: Record<string, unknown>): FeatureFlag {
  const key = typeof raw.key === 'string' ? raw.key : '';
  return {
    key,
    label: typeof raw.label === 'string' && raw.label.trim() !== '' ? raw.label : key,
    description: typeof raw.description === 'string' ? raw.description : '',
    enabled: raw.enabled === true,
  };
}
