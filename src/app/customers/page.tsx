import Link from "next/link";
import { db } from "@/services/mockDb";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { NewCustomerDialog } from "@/features/crm/new-customer-dialog";
import { DeleteCustomerButton } from "@/features/crm/delete-customer-button";

export const dynamic = "force-dynamic";

export default async function CustomersPage() {
  const customers = await db.customers.findMany();

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold tracking-tight">Müşteriler (CRM)</h1>
        <NewCustomerDialog />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Müşteri Listesi</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Şirket Adı</TableHead>
                <TableHead>Müşteri No</TableHead>
                <TableHead>Segment</TableHead>
                <TableHead>Şube</TableHead>
                <TableHead>Durum</TableHead>
                <TableHead className="text-right">Aksiyon</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customers.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.companyName}</TableCell>
                  <TableCell>{c.customerNumber}</TableCell>
                  <TableCell>{c.customerSegment}</TableCell>
                  <TableCell>{c.branch}</TableCell>
                  <TableCell>
                    <Badge variant={c.status === 'Active' ? 'default' : 'secondary'}>
                      {c.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-4">
                      <Link href={`/customers/${c.id}`} className="text-sm font-medium text-emerald-500 hover:underline">
                        Detay
                      </Link>
                      <DeleteCustomerButton id={c.id} name={c.companyName} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {customers.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    Müşteri bulunamadı.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
