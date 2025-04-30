import { Button } from "@/components/ui/button";
import { PrismaClient } from "@/prisma/generated/client";

export default async function Home() {
  const prisma = new PrismaClient();
  const users = await prisma.user.findMany();
  return (
    <div className="grid grid-rows-[20px_1fr_20px] items-center justify-items-center min-h-screen p-8 pb-20 gap-16 sm:p-20 font-[family-name:var(--font-geist-sans)]">
      <main className="flex flex-col gap-[32px] row-start-2 items-center sm:items-start">
        <h1>We have {users.length} users now</h1>
        <Button>Click me!</Button>
      </main>
    </div>
  );
}
