"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";

type NumberInputProps = Omit<
  React.ComponentProps<typeof Input>,
  "value" | "onChange" | "type"
> & {
  /** Sayısal değer (hesaplama için kaynak). */
  value: number;
  /** Kullanıcı değiştirdiğinde çağrılır; alan boşsa 0 döner ama alan boş kalır. */
  onValueChange: (value: number) => void;
};

/**
 * Sayı girişi — native `type="number"`'ın "alanı boşaltınca 0 takılı kalıyor,
 * mobilde silinemiyor" sorununu çözer. Alanı tamamen boşaltmaya izin verir
 * (görsel olarak boş kalır), hesaplama için 0 yayınlar; tekrar yazılınca senkronlanır.
 */
export function NumberInput({ value, onValueChange, ...props }: NumberInputProps) {
  const [text, setText] = React.useState<string>(() => numToText(value));
  const [prevValue, setPrevValue] = React.useState<number>(value);

  // Dışarıdan değer değişirse (ör. canlı spot) alanı render sırasında senkronla —
  // ama kullanıcının yazdığı değerle aynıysa dokunma (0'a boş alanı ezmemek için).
  if (value !== prevValue) {
    setPrevValue(value);
    const parsed = parseFloat(text);
    const current = isNaN(parsed) ? null : parsed;
    if (current !== value) {
      // Boş alan 0'a denk geliyorsa boş bırak; aksi halde değeri yansıt.
      setText(value === 0 && text.trim() === "" ? "" : numToText(value));
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setText(raw);
    if (raw.trim() === "") {
      onValueChange(0);
      return;
    }
    const parsed = parseFloat(raw);
    if (!isNaN(parsed)) onValueChange(parsed);
  };

  const handleBlur = () => {
    // Yarım kalan giriş ("-", ".", "") normalize edilir.
    if (text.trim() === "" || isNaN(parseFloat(text))) {
      setText("");
      onValueChange(0);
    } else {
      setText(numToText(parseFloat(text)));
    }
  };

  return (
    <Input
      {...props}
      type="text"
      inputMode="decimal"
      value={text}
      onChange={handleChange}
      onBlur={handleBlur}
    />
  );
}

function numToText(v: number): string {
  if (v === 0) return "0";
  if (!isFinite(v)) return "";
  return String(v);
}
