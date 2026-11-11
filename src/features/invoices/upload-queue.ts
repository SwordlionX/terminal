export const MAX_UPLOAD_FILES = 10;
const MAX_FILE_BYTES = 3 * 1024 * 1024;

const acceptable = (file: File) => file.size > 0 && file.size <= MAX_FILE_BYTES;

/** Keep successful reads even if another file fails; never run provider calls in parallel.
 * The optional local `prepare` step (QR/PDF scan) of the next file overlaps the current
 * file's server request; `read` calls themselves stay strictly sequential. */
export async function readUploadQueue<T, P = undefined>(
  files: readonly File[],
  read: (file: File, index: number, prepared: P | undefined) => Promise<T[]>,
  stop: (error: unknown) => boolean,
  prepare?: (file: File, index: number) => Promise<P>,
) {
  if (!files.length || files.length > MAX_UPLOAD_FILES) throw new Error('Bir seferde 1–10 dosya yükle.');
  const results: { fileName: string; value: T }[] = [];
  const failures: string[] = [];
  const start = (index: number) => {
    if (!prepare || index >= files.length || !acceptable(files[index])) return undefined;
    const pending = prepare(files[index], index);
    // A failed scan only means the file is read without local evidence.
    pending.catch(() => {});
    return pending;
  };
  let next = start(0);
  for (const [index, file] of files.entries()) {
    const current = next;
    next = undefined;
    try {
      if (!acceptable(file)) throw new Error('Dosya boş veya 3 MB sınırını aşıyor.');
      const prepared = current ? await current.catch(() => undefined) : undefined;
      next = start(index + 1);
      for (const value of await read(file, index, prepared)) results.push({ fileName: file.name, value });
    } catch (error) {
      failures.push(
        `${file.name}: ${(error as Error).name === 'TimeoutError' ? 'Okuma süresi doldu; yeniden yükle.' : (error as Error).message}`,
      );
      if (stop(error)) {
        if (index + 1 < files.length)
          failures.push(`${files.length - index - 1} dosya işlenmedi. Yeniden giriş yapıp yükle.`);
        break;
      }
      next ??= start(index + 1);
    }
  }
  return { results, failures };
}
