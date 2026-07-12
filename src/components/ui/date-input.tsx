"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";

type DateInputProps = Omit<
  React.ComponentProps<typeof Input>,
  "value" | "onChange" | "type"
> & {
  /** ISO tarih (YYYY-MM-DD) — kaynak/depolama formatı. */
  value: string;
  /** Geçerli bir tarih girildiğinde ISO (YYYY-MM-DD) olarak çağrılır. */
  onValueChange: (iso: string) => void;
};

/**
 * Gün/Ay/Yıl (GG/AA/YYYY) tarih girişi. Native `type="date"` tarayıcı/işletim
 * sistemi diline göre biçim gösterdiğinden (ör. AA/GG/YYYY) kafa karıştırıyordu;
 * bu bileşen her yerde GG/AA/YYYY gösterir, arkada ISO (YYYY-MM-DD) tutar.
 */
export function DateInput({ value, onValueChange, ...props }: DateInputProps) {
  const [text, setText] = React.useState<string>(() => isoToDisplay(value));
  const [prevValue, setPrevValue] = React.useState<string>(value);

  // Dışarıdan ISO değişirse görünümü render sırasında senkronla (kullanıcı yazarken bozmadan).
  if (value !== prevValue) {
    setPrevValue(value);
    if (displayToIso(text) !== value) setText(isoToDisplay(value));
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const masked = maskDate(e.target.value);
    setText(masked);
    const iso = displayToIso(masked);
    if (iso) onValueChange(iso);
  };

  return (
    <Input
      {...props}
      type="text"
      inputMode="numeric"
      placeholder="GG/AA/YYYY"
      maxLength={10}
      value={text}
      onChange={handleChange}
    />
  );
}

/** ISO (YYYY-MM-DD) → görünüm (GG/AA/YYYY). */
function isoToDisplay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  if (!m) return "";
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** Rakamları GG/AA/YYYY maskesine sokar (kullanıcı yazarken). */
function maskDate(input: string): string {
  const d = input.replace(/\D/g, "").slice(0, 8);
  let out = d.slice(0, 2);
  if (d.length > 2) out += "/" + d.slice(2, 4);
  if (d.length > 4) out += "/" + d.slice(4, 8);
  return out;
}

/** Görünüm (GG/AA/YYYY) → geçerliyse ISO (YYYY-MM-DD), değilse null. */
function displayToIso(text: string): string | null {
  const digits = text.replace(/\D/g, "");
  if (digits.length !== 8) return null;
  const dd = digits.slice(0, 2);
  const mm = digits.slice(2, 4);
  const yyyy = digits.slice(4, 8);
  const d = Number(dd), mo = Number(mm), y = Number(yyyy);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1900) return null;
  return `${yyyy}-${mm}-${dd}`;
}
