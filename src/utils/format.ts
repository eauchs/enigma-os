export const formatFileSize = (value: number | undefined) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return '—';
  }
  if (value === 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  const precision = size >= 100 || units[unitIndex] === 'B' ? 0 : size >= 10 ? 1 : 2;
  return `${size.toFixed(precision)} ${units[unitIndex]}`;
};

export const formatTimestamp = (timestamp: number | undefined) => {
  if (!timestamp || !Number.isFinite(timestamp)) {
    return '—';
  }
  try {
    return new Date(timestamp).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch (error) {
    console.warn('Unable to format timestamp', error);
    return '—';
  }
};

export const normalizeResourceName = (input: string) => {
  if (!input) {
    return 'resource';
  }
  const withoutQuery = input.split('?')[0];
  const withoutHash = withoutQuery.split('#')[0];
  const pathSegments = withoutHash.split('/').filter(Boolean);
  const candidate = pathSegments[pathSegments.length - 1];
  return candidate || withoutHash || 'resource';
};
