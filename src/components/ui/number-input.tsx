"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { parseNumberInput } from "@/lib/number-input-parser";

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
  const [invalid, setInvalid] = React.useState(false);

  // Dışarıdan değer değişirse (ör. canlı spot) alanı render sırasında senkronla —
  // ama kullanıcının yazdığı değerle aynıysa dokunma (0'a boş alanı ezmemek için).
  if (!Object.is(value, prevValue)) {
    setPrevValue(value);
    const current = parseNumberInput(text);
    if (current !== value) {
      // Boş alan 0'a denk geliyorsa boş bırak; aksi halde değeri yansıt.
      setText(value === 0 && text.trim() === "" ? "" : numToText(value));
      setInvalid(false);
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setText(raw);
    const parsed = parseNumberInput(raw);
    setInvalid(raw.trim() !== "" && parsed === null);
    if (raw.trim() === "") {
      onValueChange(0);
      return;
    }
    if (parsed !== null) onValueChange(parsed);
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const parsed = parseNumberInput(text);
    if (text.trim() === "") {
      setInvalid(false);
    } else if (parsed === null) {
      setText(numToText(value));
      setInvalid(false);
    } else {
      setText(numToText(parsed));
      setInvalid(false);
    }
    props.onBlur?.(e);
  };

  return (
    <Input
      {...props}
      type="text"
      inputMode="decimal"
      value={text}
      onChange={handleChange}
      onBlur={handleBlur}
      aria-invalid={invalid || props["aria-invalid"]}
    />
  );
}

/** Turkish decimal comma without grouping, so the text stays easy to edit and parses back exactly. */
function numToText(v: number): string {
  if (v === 0) return "0";
  if (!Number.isFinite(v)) return "";
  return String(v).replace(".", ",");
}
