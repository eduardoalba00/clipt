/** Stands in for `@tauri-apps/api/core`. Files are already URLs here. */
export function convertFileSrc(path: string): string {
  return path;
}

export function invoke<T>(_cmd: string, _args?: unknown): Promise<T> {
  return Promise.reject(new Error("There's no Tauri on the web"));
}
