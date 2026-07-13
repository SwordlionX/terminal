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

/** Native tarih girişi (takvim ikonlu) — biçim tarayıcı/işletim sistemi diline göre değişir. */
export function DateInput({ value, onValueChange, ...props }: DateInputProps) {
  return (
    <Input
      {...props}
      type="date"
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
    />
  );
}
