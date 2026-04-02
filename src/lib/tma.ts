export function isTMA(): boolean {
  return typeof window !== 'undefined' && !!window.Telegram?.WebApp?.initData;
}
