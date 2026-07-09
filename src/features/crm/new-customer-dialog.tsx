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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createCustomerAction } from "@/app/customers/actions";

const selectClassName =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

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
      <DialogTrigger render={<Button />}>Yeni Müşteri Ekle</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Yeni Müşteri Ekle</DialogTitle>
          <DialogDescription>
            Yeni bir müşteri kaydı oluşturmak için aşağıdaki bilgileri doldurun.
          </DialogDescription>
        </DialogHeader>

        <form
          ref={formRef}
          action={handleSubmit}
          className="grid grid-cols-1 sm:grid-cols-2 gap-4"
        >
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="companyName">Şirket Adı *</Label>
            <Input id="companyName" name="companyName" required />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="customerNumber">Müşteri No *</Label>
            <Input id="customerNumber" name="customerNumber" required />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="taxNumber">Vergi No</Label>
            <Input id="taxNumber" name="taxNumber" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="branch">Şube</Label>
            <Input id="branch" name="branch" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="customerSegment">Segment</Label>
            <Input id="customerSegment" name="customerSegment" placeholder="Örn: Kurumsal, Bireysel" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="portfolioManager">Portfolio Manager</Label>
            <Input id="portfolioManager" name="portfolioManager" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="relationshipManager">Relationship Manager</Label>
            <Input id="relationshipManager" name="relationshipManager" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="riskLimit">Risk Limiti</Label>
            <Input id="riskLimit" name="riskLimit" type="number" step="any" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="status">Durum</Label>
            <select id="status" name="status" defaultValue="Active" className={selectClassName}>
              <option value="Active">Active</option>
              <option value="Passive">Passive</option>
            </select>
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="notes">Notlar</Label>
            <Input id="notes" name="notes" />
          </div>

          {error && (
            <p className="sm:col-span-2 text-sm text-rose-500">{error}</p>
          )}

          <DialogFooter className="sm:col-span-2">
            <Button type="submit" disabled={isPending}>
              {isPending ? "Kaydediliyor..." : "Kaydet"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
