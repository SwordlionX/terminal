'use client';

import { useTransition } from 'react';
import { deleteCustomerAction } from '@/app/customers/actions';

export function DeleteCustomerButton({ id, name }: { id: string; name: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => {
        if (
          confirm(
            `"${name}" müşterisini ve bu müşteriye ait TÜM işlem/teminat kayıtlarını kalıcı olarak silmek istediğinize emin misiniz? Bu işlem geri alınamaz.`,
          )
        ) {
          startTransition(() => deleteCustomerAction(id));
        }
      }}
      className="desk-button"
    >
      {isPending ? 'Siliniyor…' : 'Müşteriyi sil'}
    </button>
  );
}
