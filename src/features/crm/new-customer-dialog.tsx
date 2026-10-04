"use client";

import { useRef, useState, useTransition } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { createCustomerAction } from "@/app/customers/actions";

export function NewCustomerDialog() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      try {
        await createCustomerAction(formData);
        formRef.current?.reset();
        setOpen(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Müşteri eklenirken bir hata oluştu.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<button className="desk-button desk-button-primary" />}>Yeni müşteri ekle</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Yeni müşteri ekle</DialogTitle>
          <DialogDescription>Yeni müşteri kaydı için bilgileri doldurun.</DialogDescription>
        </DialogHeader>
        <form ref={formRef} action={handleSubmit} className="stock-dialog-fields">
          <label className="desk-field stock-dialog-wide">Şirket adı *<input name="companyName" required /></label>
          <label className="desk-field">Müşteri no *<input name="customerNumber" required /></label>
          <label className="desk-field">Vergi no<input name="taxNumber" /></label>
          <label className="desk-field">Şube<input name="branch" /></label>
          <label className="desk-field">Segment<input name="customerSegment" placeholder="Örn: Kurumsal, Bireysel" /></label>
          <label className="desk-field">Portföy yöneticisi<input name="portfolioManager" /></label>
          <label className="desk-field">İlişki yöneticisi<input name="relationshipManager" /></label>
          <label className="desk-field">Durum<select name="status" defaultValue="Active"><option value="Active">Aktif</option><option value="Passive">Pasif</option></select></label>
          <label className="desk-field stock-dialog-wide">Notlar<input name="notes" /></label>
          {error && <p className="desk-policy stock-dialog-wide" role="alert">{error}</p>}
          <DialogFooter className="stock-dialog-wide">
            <button type="submit" className="desk-button desk-button-primary" disabled={isPending}>{isPending ? 'Kaydediliyor…' : 'Kaydet'}</button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
