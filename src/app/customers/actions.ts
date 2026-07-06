"use server";

import { db } from "@/services/mockDb";
import { revalidatePath } from "next/cache";

export async function deleteCustomerAction(id: string) {
  await db.customers.delete(id);
  revalidatePath("/customers");
  revalidatePath("/risk");
}
