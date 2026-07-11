"use server";

import { db } from "@/services/mockDb";
import { revalidatePath } from "next/cache";

export async function deleteCustomerAction(id: string) {
  await db.customers.delete(id);
  revalidatePath("/customers");
  revalidatePath("/risk");
}

export async function createCustomerAction(formData: FormData) {
  const companyName = String(formData.get("companyName") || "").trim();
  const customerNumber = String(formData.get("customerNumber") || "").trim();

  if (!companyName || !customerNumber) {
    throw new Error("Şirket Adı ve Müşteri No zorunludur.");
  }

  const customer = await db.customers.create({
    companyName,
    customerNumber,
    taxNumber: String(formData.get("taxNumber") || "").trim(),
    branch: String(formData.get("branch") || "").trim(),
    portfolioManager: String(formData.get("portfolioManager") || "").trim(),
    relationshipManager: String(formData.get("relationshipManager") || "").trim(),
    customerSegment: String(formData.get("customerSegment") || "").trim(),
    notes: String(formData.get("notes") || "").trim(),
    status: (formData.get("status") === "Passive" ? "Passive" : "Active"),
  });

  await db.activity.log(customer.id, "Customer Created", "Müşteri sisteme eklendi.");

  revalidatePath("/customers");
  revalidatePath("/risk");
  revalidatePath("/dashboard");
}
