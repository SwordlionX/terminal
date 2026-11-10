export const MAX_UPLOAD_FILES = 10;

/** Keep successful reads even if another file fails; never run provider calls in parallel. */
export async function readUploadQueue<T>(
  files: readonly File[],
  read: (file: File, index: number) => Promise<T[]>,
  stop: (error: unknown) => boolean,
) {
  if (!files.length || files.length > MAX_UPLOAD_FILES) throw new Error('Bir seferde 1–10 dosya yükle.');
  const results: { fileName: string; value: T }[] = [];
  const failures: string[] = [];
  for (const [index, file] of files.entries()) {
    try {
      if (!file.size || file.size > 3 * 1024 * 1024) throw new Error('Dosya boş veya 3 MB sınırını aşıyor.');
      for (const value of await read(file, index)) results.push({ fileName: file.name, value });
    } catch (error) {
      failures.push(
        `${file.name}: ${(error as Error).name === 'TimeoutError' ? 'Okuma süresi doldu; yeniden yükle.' : (error as Error).message}`,
      );
      if (stop(error)) {
        if (index + 1 < files.length)
          failures.push(`${files.length - index - 1} dosya işlenmedi. Yeniden giriş yapıp yükle.`);
        break;
      }
    }
  }
  return { results, failures };
}
